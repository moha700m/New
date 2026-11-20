export function LogoMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="agx-g" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#8b5cf6" />
          <stop offset="0.55" stopColor="#6366f1" />
          <stop offset="1" stopColor="#3b82f6" />
        </linearGradient>
      </defs>
      <rect width="40" height="40" rx="11" fill="url(#agx-g)" />
      <path d="M20 8.5 30 31h-5.2l-1.9-4.6h-5.8L15.2 31H10L20 8.5Zm0 8.6-1.9 5.3h3.8L20 17.1Z" fill="#fff" />
      <circle cx="30.5" cy="10" r="2.4" fill="#22d3ee" />
    </svg>
  );
}

export function Logo({ size = "md" }: { size?: "md" | "lg" }) {
  return (
    <span className="inline-flex items-center gap-2.5" dir="ltr">
      <LogoMark className={size === "lg" ? "h-12 w-12" : "h-9 w-9"} />
      <span className={`font-bold tracking-tight text-white ${size === "lg" ? "text-3xl" : "text-xl"}`}>
        Agents<span className="gradient-text">ii</span>
      </span>
    </span>
  );
}
