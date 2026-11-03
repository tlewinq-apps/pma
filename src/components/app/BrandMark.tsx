/** PMA's mark: a blue tile holding three cream bars, longest first, the way feedback becomes a ranked list. Lit from the top left. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={`shrink-0 ${className}`}>
      <defs>
        <linearGradient id="pma-mark-fill" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4a7ae6" />
          <stop offset="1" stopColor="#2246a8" />
        </linearGradient>
        <radialGradient id="pma-mark-glare" cx="0.3" cy="0.22" r="0.62">
          <stop offset="0" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#pma-mark-fill)" />
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#pma-mark-glare)" />
      <path d="M9.5 10.5h13M9.5 16h9M9.5 21.5h5" stroke="#fbf9f4" strokeWidth="2.6" strokeLinecap="round" />
    </svg>
  );
}
