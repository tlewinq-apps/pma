"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SUPPORTED_EXTS, unsupportedFiles } from "@/lib/ingest/files";
import { useApp } from "@/components/app/AppContext";

const ACCEPT = SUPPORTED_EXTS.map((e) => `.${e}`).join(",");

type AddResponse = {
  error?: string;
  unsupported?: string[];
  sources?: { id: string; duplicate: boolean }[];
  errors?: { name: string; error: string }[];
};

/** Who / when / where: shared by every way of adding feedback. */
export function ContextFields() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <input name="who" placeholder="Who said it" className="field w-40 px-2.5 py-1.5 outline-none" />
      <input name="when" type="date" aria-label="When" className="field px-2.5 py-1.5 outline-none" />
      <input name="where" placeholder="Where (e.g. support call)" className="field w-52 px-2.5 py-1.5 outline-none" />
    </div>
  );
}

/** Paste text, or upload documents and screenshots. Both post to the app's sources route and land in the Received list. */
export function DropZone({ mode }: { mode: "paste" | "files" }) {
  const router = useRouter();
  const { api } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  function addFiles(picked: File[]) {
    const bad = new Set(unsupportedFiles(picked.map((f) => f.name)));
    const ok = picked.filter((f) => !bad.has(f.name));
    if (ok.length) setFiles((prev) => [...prev, ...ok]);
    setLines(bad.size ? [`Can't read ${[...bad].join(", ")}. Recordings go in the Recording tab.`] : []);
  }

  async function submit(form: HTMLFormElement) {
    setBusy(true);
    setLines([]);
    try {
      const fd = new FormData(form); // text/who/when/where only: the file input has no name
      files.forEach((f) => fd.append("files", f));
      const res = await fetch(api("/sources"), { method: "POST", body: fd });
      const json = (await res.json().catch(() => ({}))) as AddResponse;
      if (!res.ok) {
        const out = [json.error ?? "Something went wrong"];
        if (json.unsupported?.length) out.push(`Unsupported: ${json.unsupported.join(", ")}`);
        for (const e of json.errors ?? []) out.push(`${e.name}: ${e.error}`);
        setLines(out);
        return;
      }
      const dups = (json.sources ?? []).filter((s) => s.duplicate).length;
      setLines([
        dups ? `Added. ${dups} already existed and were skipped.` : "Added — analysing now. It appears under Received below.",
        ...(json.errors ?? []).map((e) => `${e.name}: ${e.error}`),
      ]);
      setText("");
      setFiles([]);
      form.reset();
      router.refresh();
    } catch {
      setLines(["Could not reach the server. Try again."]);
    } finally {
      setBusy(false);
    }
  }

  const ready = mode === "paste" ? !!text.trim() : files.length > 0;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); addFiles(Array.from(e.dataTransfer.files)); }}
      className="space-y-3"
    >
      {mode === "paste" ? (
        <textarea name="text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste a transcript, Slack thread, email or note" className="field h-36 w-full resize-y p-3 text-sm outline-none" />
      ) : (
        <button type="button" onClick={() => input.current?.click()} className={`group flex h-36 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-sm transition-[border-color,background-color,scale] duration-300 ease-smooth motion-reduce:transition-none ${drag ? "scale-[1.01] border-brand bg-brand/5" : "border-input hover:border-foreground/30 hover:bg-muted/50"}`}>
          <Upload aria-hidden className={`size-5 transition-[translate,color] duration-300 ease-smooth ${drag ? "-translate-y-1 text-brand" : "text-muted-foreground group-hover:-translate-y-0.5"}`} />
          <span className="font-medium">Drop files here, or choose files</span>
          <span className="text-xs text-muted-foreground">PDF, Word, email, captions (VTT, SRT), text and screenshots</span>
        </button>
      )}
      {/* no name attribute: files are appended manually so FormData(form) never carries an empty file part */}
      <input ref={input} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
      {files.length > 0 && (
        <ul className="flex flex-wrap gap-1.5 text-xs">{files.map((f, k) => (
          <li key={`${f.name}-${k}`} className="rise-in flex items-center gap-1 rounded-full bg-muted px-2.5 py-1">
            {f.name}
            <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((prev) => prev.filter((_, j) => j !== k))}><X className="size-3" /></button>
          </li>))}
        </ul>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <ContextFields />
        <Button type="submit" disabled={busy || !ready} className="ml-auto">{busy ? "Adding…" : "Add feedback"}</Button>
      </div>
      {lines.length > 0 && <div className="space-y-0.5 text-xs">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>}
    </form>
  );
}
