// A tiny ZIP writer for small downloads (the Claude Code task with its mock-up images): no dependency, everything in
// memory. Text is deflated with node:zlib; files that are already compressed (PNG) are stored as they are. Enough of
// the format for every unzip tool: local headers, a central directory and its end record, UTF-8 names, no ZIP64 (so
// the whole archive stays under 4 GB, far above what this is for).
import { crc32, deflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: Buffer | Uint8Array | string; deflate?: boolean };

/** DOS date and time, which ZIP stores in local time without a zone; UTC keeps the archive the same everywhere. */
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

/** A safe entry name: a relative path with forward slashes, no "..", no leading slash or drive letter. */
function entryName(name: string): string {
  const parts = name.replace(/\\/g, "/").split("/").filter((p) => p && p !== "." && p !== "..");
  const clean = parts.join("/").replace(/^[A-Za-z]:/, "");
  if (!clean) throw new Error(`zip: bad entry name "${name}"`);
  return clean;
}

export function zip(entries: ZipEntry[], at: Date = new Date()): Buffer {
  const { time, date } = dosTime(at);
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(entryName(e.name), "utf8");
    if (seen.has(name.toString())) throw new Error(`zip: "${name}" is in the archive twice`);
    seen.add(name.toString());
    const raw = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data);
    const deflated = e.deflate === false ? null : deflateRawSync(raw);
    // Keep the deflated bytes only when they are smaller.
    const method = deflated && deflated.length < raw.length ? 8 : 0;
    const body = method === 8 ? deflated! : raw;
    const crc = crc32(raw) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed: 2.0
    local.writeUInt16LE(0x0800, 6); // flags: names are UTF-8
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // no extra field
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x0314, 4); // made by: Unix, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    // extra, comment, disk number, internal attributes: 0
    central.writeUInt32LE(((0o100644 << 16) >>> 0), 38); // external attributes: a regular file, rw-r--r--
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}
