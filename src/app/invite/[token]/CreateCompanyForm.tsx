"use client";
import { useActionState, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { slugify } from "@/lib/links";
import type { CreateField, CreateResult } from "@/lib/companyForm";

/** A name and the short name that goes in links. The short name follows the name until the person edits it. */
function useNamePair() {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [edited, setEdited] = useState(false);
  return {
    name, slug,
    onName: (v: string) => { setName(v); if (!edited) setSlug(slugify(v)); },
    onSlug: (v: string) => { setSlug(v); setEdited(true); },
  };
}

function NameFields({ label, field, slugField, placeholder, pair, invalid }: {
  label: string; field: CreateField; slugField: CreateField; placeholder: string; pair: ReturnType<typeof useNamePair>; invalid: CreateField | undefined;
}) {
  const id = useId();
  return (
    <div className="space-y-3">
      <div className="space-y-1.5 text-sm">
        <label htmlFor={`${id}-name`} className="block font-medium">{label}</label>
        <Input id={`${id}-name`} name={field} required maxLength={80} value={pair.name} placeholder={placeholder} aria-invalid={invalid === field || undefined}
          onChange={(e) => pair.onName(e.target.value)} />
      </div>
      <div className="space-y-1.5 text-sm">
        <label htmlFor={`${id}-slug`} className="block font-medium">{label} in links</label>
        <Input id={`${id}-slug`} name={slugField} required maxLength={40} value={pair.slug} placeholder={slugify(placeholder)} aria-invalid={invalid === slugField || undefined}
          onChange={(e) => pair.onSlug(e.target.value)} className="font-mono" />
      </div>
    </div>
  );
}

/** Name the company and its first app, then create both: from a company invite, or on /no-company with none. */
export function CreateCompanyForm({ action }: { action: (form: FormData) => Promise<CreateResult> }) {
  const org = useNamePair(), app = useNamePair();
  const [state, submit, pending] = useActionState<CreateResult, FormData>(async (_prev, form) => action(form), null);
  return (
    <form action={submit} className="space-y-5">
      <NameFields label="Company name" field="orgName" slugField="orgSlug" placeholder="Acme" pair={org} invalid={state?.field} />
      <NameFields label="App name" field="appName" slugField="appSlug" placeholder="Web app" pair={app} invalid={state?.field} />
      <p className="text-xs text-muted-foreground">
        Short names use lowercase letters, numbers and dashes. Your app will live at <code className="font-mono">/{org.slug || "company"}/{app.slug || "app"}</code>.
      </p>
      <Button className="w-full" type="submit" disabled={pending}>{pending ? "Creating…" : "Create company"}</Button>
      {state?.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    </form>
  );
}
