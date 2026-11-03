"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AudioLines, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AUDIO_EXTS, MAX_RECORDING_BYTES, isAudio, sha256Hex } from "@/lib/ingest/recording";
import { SAMPLE_RECORDINGS } from "@/lib/transcribe/samples.generated";
import { useApp } from "@/components/app/AppContext";
import { ContextFields } from "./DropZone";

const ACCEPT = AUDIO_EXTS.map((e) => `.${e}`).join(",");

async function postJson(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? "Something went wrong");
  return json;
}

/**
 * A recorded conversation (an MP3 of a customer call, a user interview; in the demo, a Celeste member call). The file goes
 * straight to Storage through a signed URL; the pipeline then transcribes it, names the speakers and splits it into
 * single pieces of feedback. The bundled sample recordings are the demo's Celeste calls, so only the demo offers them.
 */
export function RecordingForm({ demo = true, audienceOne = "member" }: { demo?: boolean; audienceOne?: string }) {
  const router = useRouter();
  const { api } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [participants, setParticipants] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  function pick(f: File | undefined) {
    if (!f) return;
    if (!isAudio(f.name)) return setLines([`${f.name} isn't a recording. Use MP3, M4A, WAV, WebM or OGG; documents go in the Files tab.`]);
    if (f.size > MAX_RECORDING_BYTES) return setLines([`${f.name} is over 50 MB. Trim it or export at a lower bitrate.`]);
    setLines([]);
    setFile(f);
  }

  async function loadSample(s: (typeof SAMPLE_RECORDINGS)[number]) {
    setBusy("Loading the sample…");
    try {
      const blob = await (await fetch(`/samples/${s.file}`)).blob();
      setFile(new File([blob], s.file, { type: "audio/mpeg" }));
      setParticipants(s.participants);
      const f = form.current!;
      (f.elements.namedItem("who") as HTMLInputElement).value = s.who;
      (f.elements.namedItem("where") as HTMLInputElement).value = s.where;
      setLines([]);
    } finally {
      setBusy(null);
    }
  }

  async function submit(f: HTMLFormElement) {
    if (!file) return;
    setLines([]);
    try {
      setBusy("Preparing…");
      const sha256 = await sha256Hex(file);
      const { path, url } = await postJson(api("/feedback/recordings/upload-url"), { filename: file.name, size: file.size, sha256 });
      setBusy("Uploading…");
      const put = await fetch(url, { method: "PUT", headers: { "content-type": file.type || "audio/mpeg" }, body: file });
      if (!put.ok) throw new Error("The upload failed. Try again.");
      setBusy("Adding…");
      const fd = new FormData(f);
      const json = await postJson(api("/feedback/recordings"), {
        path, filename: file.name, sha256, consent, participants,
        who: fd.get("who"), when: fd.get("when"), where: fd.get("where"),
      });
      setLines([json.sources?.[0]?.duplicate ? "This recording is already in PMA." : "Added — transcribing now. It appears under Received below."]);
      setFile(null);
      setParticipants("");
      setConsent(false);
      f.reset();
      router.refresh();
    } catch (e) {
      setLines([(e as Error).message]);
    } finally {
      setBusy(null);
    }
  }

  return (
    <form ref={form} onSubmit={(e) => { e.preventDefault(); void submit(e.currentTarget); }} className="space-y-3">
      {file ? (
        <div className="rise-in flex h-36 items-center justify-center gap-2 rounded-xl bg-muted/60 text-sm shadow-[inset_0_0_0_1px_var(--input)]">
          <AudioLines aria-hidden className="size-5 text-muted-foreground" />
          <span className="font-medium">{file.name}</span>
          <span className="text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</span>
          <button type="button" aria-label="Remove the recording" onClick={() => setFile(null)}><X className="size-4" /></button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files[0]); }}
          className={`group flex h-36 w-full flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed text-sm transition-[border-color,background-color,scale] duration-300 ease-smooth motion-reduce:transition-none ${drag ? "scale-[1.01] border-brand bg-brand/5" : "border-input hover:border-foreground/30 hover:bg-muted/50"}`}
        >
          <AudioLines aria-hidden className="size-5 text-muted-foreground" />
          <span className="font-medium">Drop a recording here, or choose one</span>
          <span className="text-xs text-muted-foreground">MP3, M4A, WAV, WebM or OGG, up to 50 MB. Each speaker&apos;s points become separate feedback.</span>
        </button>
      )}
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
      {demo && SAMPLE_RECORDINGS.length > 0 && !file && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          No recording to hand? Try a sample:
          {SAMPLE_RECORDINGS.map((s) => <button key={s.file} type="button" disabled={!!busy} onClick={() => void loadSample(s)} className="link text-foreground">{s.title}</button>)}
        </p>
      )}
      <label className="block space-y-1 text-sm">
        <span className="text-muted-foreground">Who was in it? Names help PMA tell speakers apart.</span>
        <input value={participants} onChange={(e) => setParticipants(e.target.value)} placeholder={demo ? "Priya Nair (member), Dani (staff)" : `Sam Lee (${audienceOne}), Alex Kim (staff)`} className="field w-full px-2.5 py-1.5 outline-none" />
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 size-4 accent-[var(--brand-strong)]" />
        <span>Everyone in this recording agreed to it being used for product feedback.</span>
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <ContextFields />
        <Button type="submit" disabled={!!busy || !file || !consent} className="ml-auto">{busy ?? "Add recording"}</Button>
      </div>
      {lines.length > 0 && <div className="space-y-0.5 text-xs">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>}
    </form>
  );
}
