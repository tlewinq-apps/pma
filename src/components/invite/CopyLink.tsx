"use client";
import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Copies text to the clipboard; false when the browser refuses (no permission, not a secure page). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** An invite link in a read-only field, selected on focus so it can be copied by hand, with a Copy button. */
export function CopyLink({ link, label = "Invite link" }: { link: string; label?: string }) {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input readOnly aria-label={label} value={link} onFocus={(e) => e.currentTarget.select()}
          className="field h-8 min-w-0 flex-1 px-2.5 font-mono text-xs outline-none" />
        <Button type="button" size="sm" variant="outline" onClick={async () => setCopied(await copyText(link))}>
          {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? "Copied" : "Copy"}
        </Button>
      </div>
      {copied === false && <p className="text-xs text-muted-foreground">Your browser wouldn&apos;t copy it. Select the link and copy it yourself.</p>}
    </div>
  );
}
