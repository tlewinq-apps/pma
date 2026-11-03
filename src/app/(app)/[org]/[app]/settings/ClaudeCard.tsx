"use client";
import { useState } from "react";
import { Check, Copy, Eye, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useApp } from "@/components/app/AppContext";
import { copyText } from "@/components/invite/CopyLink";
import { CLAUDE_CARD_ID, KEY_PLACEHOLDER, MCP_ASKS, mcpAddCommand, mcpEndpoint } from "@/lib/mcp/connect";

/**
 * Use PMA from Claude: when it helps (a PM asking about the backlog or filing notes from a call, an engineer building
 * an approved issue in Claude Code), the endpoint of PMA's MCP server (lib/mcp) and the command that adds it to Claude
 * Code. The page never ships the API key: owners and admins press Show key to fill it in; members are told who has it.
 */
export function ClaudeCard({ appUrl, keyPrefix }: { appUrl: string; keyPrefix: string }) {
  const { api, role } = useApp();
  const canSeeKey = role === "owner" || role === "admin";
  const [key, setKey] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "busy" | "copied" | "refused" | "failed">("idle");
  const endpoint = mcpEndpoint(appUrl);
  const command = mcpAddCommand(endpoint, key ?? KEY_PLACEHOLDER);

  const showKey = async () => {
    setState("busy");
    try {
      const r = await fetch(api("/api-key"), { cache: "no-store" });
      const j = (await r.json().catch(() => ({}))) as { key?: string };
      if (!r.ok || !j.key) return setState("failed");
      setKey(j.key);
      setState("idle");
    } catch {
      setState("failed");
    }
  };
  const copy = async () => {
    const ok = await copyText(command);
    setState(ok ? "copied" : "refused");
    if (ok) setTimeout(() => setState((s) => (s === "copied" ? "idle" : s)), 2200);
  };

  return (
    <section id={CLAUDE_CARD_ID} className="scroll-mt-6 space-y-3 surface p-5 text-sm">
      <h2 className="text-lg font-semibold">Use PMA from Claude</h2>
      <p className="text-xs text-muted-foreground">
        Ask Claude about this app&apos;s backlog where you already work. A PM can ask what&apos;s most urgent, what customers said about an issue, or hand Claude notes from a call to file. An engineer can pull an approved issue into Claude Code, build it in their own checkout and run their own tests; the pull request links back here.
      </p>
      <ul className="space-y-1 text-xs">
        {MCP_ASKS.map((a) => (
          <li key={a.tool} className="flex flex-wrap gap-x-2">
            <span>&ldquo;{a.ask}&rdquo;</span>
            <span className="text-muted-foreground">{a.who === "engineer" ? "in Claude Code, in the app's repository" : null}</span>
          </li>
        ))}
      </ul>
      <div className="space-y-1.5">
        <p className="text-xs text-muted-foreground">Add it to Claude Code:</p>
        <code className="block overflow-x-auto whitespace-pre rounded-lg bg-muted p-3 text-xs">{command}</code>
        <div className="flex flex-wrap items-center gap-2">
          {canSeeKey && !key && (
            <Button type="button" size="sm" variant="outline" onClick={() => void showKey()} disabled={state === "busy"}>
              {state === "busy" ? <Loader2 aria-hidden className="animate-spin" /> : <Eye aria-hidden />}Show key
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
            {state === "copied" ? <Check aria-hidden /> : <Copy aria-hidden />}{state === "copied" ? "Copied" : "Copy command"}
          </Button>
        </div>
        <p aria-live="polite" className="text-xs text-muted-foreground">
          {state === "failed" ? "Couldn't load the key. Try again."
            : state === "refused" ? "Your browser wouldn't copy it. Select the command and copy it yourself."
            : key ? "Anyone with this key can read this app's issues and add feedback. Share it only with your team."
            : canSeeKey ? <>Show key fills in this app&apos;s API key (it starts <code>{keyPrefix}</code>).</>
            : <>Ask a company owner or admin for this app&apos;s API key (it starts <code>{keyPrefix}</code>) and put it in place of {KEY_PLACEHOLDER}.</>}
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Claude reads issues, files the feedback you give it and picks up approved tasks. Everything else stays here: feedback still comes in through Slack, the widget and your connections, and mock-ups are approved on the issue. The same key works for the REST API at <code>/api/v1</code>.
      </p>
    </section>
  );
}
