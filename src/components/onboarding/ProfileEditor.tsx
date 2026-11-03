"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { FileSearch, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app/AppContext";
import { PLATFORMS, type ProductProfile } from "@/lib/product/profile";

type Field = keyof ProductProfile;
/** What the editor shows and saves. The audience words aren't in it: Read my repository drafts them and the server keeps
 *  them (PATCH /profile), and an app never drafted says "people" and "person". */
type Shown = "name" | "one_liner" | "platform";
type Draft = Record<Shown, string>;

const LABELS: { key: Exclude<Shown, "platform">; label: string; hint: string; max: number }[] = [
  { key: "name", label: "Name", hint: "What people call it.", max: 80 },
  { key: "one_liner", label: "In one line", hint: "What it is and what people do with it, starting with \"a\" or \"an\".", max: 240 },
];
const PLATFORM_LABEL: Record<(typeof PLATFORMS)[number], string> = { web: "Web", mobile: "Mobile", "web and mobile": "Web and mobile" };

const toDraft = (p: ProductProfile | null, name: string): Draft =>
  p ? { name: p.name, one_liner: p.one_liner, platform: p.platform } : { name, one_liner: "", platform: "web" };

/**
 * Describe your product: the words every prompt about this app's feedback is written in. Read my repository drafts
 * them from the connected code (and saves them); the owner checks and edits them here. Members see them read-only.
 */
export function ProfileEditor({ initial, appName, canEdit, hasRepo }: { initial: ProductProfile | null; appName: string; canEdit: boolean; hasRepo: boolean }) {
  const { api } = useApp();
  const router = useRouter();
  const id = useId();
  const [draft, setDraft] = useState<Draft>(() => toDraft(initial, appName));
  const [busy, setBusy] = useState<"read" | "save" | null>(null);
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  const [fields, setFields] = useState<Partial<Record<Field, string>>>({});

  const send = async (method: "POST" | "PATCH", body?: object) => {
    try {
      const res = await fetch(api("/profile"), { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
      return { ok: res.ok, body: (await res.json().catch(() => ({}))) as { error?: string; fields?: Partial<Record<Field, string>>; profile?: ProductProfile } };
    } catch {
      return { ok: false, body: { error: "Couldn't reach PMA. Check your connection and try again." } };
    }
  };
  const read = async () => {
    setBusy("read"); setFields({}); setNote({ text: "Reading the repository. It takes up to a minute." });
    const r = await send("POST");
    setBusy(null);
    if (!r.ok || !r.body.profile) return setNote({ text: r.body.error ?? "That didn't work. Try again.", bad: true });
    setDraft(toDraft(r.body.profile, appName));
    setNote({ text: "Saved. Check the words and change anything that's off." });
    router.refresh();
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy("save"); setNote(null);
    const r = await send("PATCH", draft);
    setBusy(null);
    setFields(r.body.fields ?? {});
    if (!r.ok) return setNote({ text: r.body.error ?? "That didn't save. Try again.", bad: true });
    if (r.body.profile) setDraft(toDraft(r.body.profile, appName));
    setNote({ text: "Saved." });
    router.refresh();
  };

  if (!canEdit) {
    return initial ? (
      <dl className="mt-3 grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
        {LABELS.map((l) => <div key={l.key} className="contents"><dt className="text-muted-foreground">{l.label}</dt><dd>{initial[l.key]}</dd></div>)}
        <dt className="text-muted-foreground">Used on</dt><dd>{PLATFORM_LABEL[initial.platform]}</dd>
      </dl>
    ) : <p className="mt-3 text-sm text-muted-foreground">Not described yet. A company owner or admin does this.</p>;
  }

  return (
    <form onSubmit={save} className="mt-4 space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button type="button" variant="outline" onClick={() => void read()} disabled={busy !== null || !hasRepo}>
          {busy === "read" ? <Loader2 aria-hidden className="animate-spin" /> : <FileSearch aria-hidden />}Read my repository
        </Button>
        {!hasRepo && <span className="text-xs text-muted-foreground">Connect your repository first, or fill in the fields yourself.</span>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {LABELS.map((l) => (
          <div key={l.key} className={`space-y-1 ${l.key === "one_liner" ? "sm:col-span-2" : ""}`}>
            <label htmlFor={`${id}-${l.key}`} className="block text-sm font-medium">{l.label}</label>
            <input
              id={`${id}-${l.key}`} name={l.key} value={draft[l.key]} maxLength={l.max} required
              onChange={(e) => setDraft({ ...draft, [l.key]: e.target.value })}
              aria-invalid={fields[l.key] ? true : undefined} aria-describedby={`${id}-${l.key}-hint`}
              className="field h-9 w-full px-3 text-sm outline-none aria-invalid:border-destructive"
            />
            <p id={`${id}-${l.key}-hint`} className={`text-xs ${fields[l.key] ? "text-destructive" : "text-muted-foreground"}`}>{fields[l.key] ?? l.hint}</p>
          </div>
        ))}
        <div className="space-y-1">
          <label htmlFor={`${id}-platform`} className="block text-sm font-medium">Used on</label>
          <select id={`${id}-platform`} name="platform" value={draft.platform} onChange={(e) => setDraft({ ...draft, platform: e.target.value })}
            aria-invalid={fields.platform ? true : undefined} className="field block h-9 w-full px-2.5 text-sm outline-none">
            {PLATFORMS.map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </select>
          {fields.platform && <p className="text-xs text-destructive">{fields.platform}</p>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={busy !== null}>{busy === "save" && <Loader2 aria-hidden className="animate-spin" />}Save</Button>
        {note && <p role={note.bad ? "alert" : "status"} className={`text-sm ${note.bad ? "text-destructive" : "text-muted-foreground"}`}>{note.text}</p>}
      </div>
    </form>
  );
}
