"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RetryButton({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  async function retry() {
    setBusy(true);
    try {
      await fetch(`/api/sources/${id}/retry`, { method: "POST" });
    } finally {
      setBusy(false);
      router.refresh();
    }
  }
  return (
    <button type="button" onClick={retry} disabled={busy} className="btn-paper px-2.5 py-1 text-xs disabled:opacity-50">
      {busy ? "Retrying…" : "Retry"}
    </button>
  );
}
