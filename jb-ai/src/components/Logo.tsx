export function Logo({ name = "JB AI", size = 28 }: { name?: string; size?: number }) {
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
        <path d="M12 9v9.5a3.5 3.5 0 0 1-6 2.4" fill="none" stroke="url(#jbg)" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M16 9h5a3.2 3.2 0 0 1 0 6.4h-5h5.6a3.3 3.3 0 0 1 0 6.6H16z" fill="none" stroke="url(#jbg)" strokeWidth="2.4" strokeLinejoin="round" />
      </svg>
      <span className="text-[17px] font-semibold tracking-tight">{name}</span>
    </span>
  );
}
