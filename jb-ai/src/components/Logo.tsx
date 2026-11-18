export function Logo({ name = "محمد | التقني", size = 28 }: { name?: string; size?: number }) {
  return (
    <span className="flex items-center gap-2.5">
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <defs>
          <linearGradient id="jbg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#7aa2ff" />
            <stop offset="1" stopColor="#a78bfa" />
          </linearGradient>
        </defs>
        <rect x="2" y="2" width="28" height="28" rx="9" fill="url(#jbg)" opacity="0.18" />
        <text x="16" y="21.5" textAnchor="middle" fontSize="17" fontWeight="700" fill="url(#jbg)" fontFamily="var(--font-plex), sans-serif">م</text>
        <path d="M7 25h18" stroke="url(#jbg)" strokeWidth="1.6" strokeLinecap="round" opacity="0.7" />
      </svg>
      <span className="text-[17px] font-semibold">{name}</span>
    </span>
  );
}
