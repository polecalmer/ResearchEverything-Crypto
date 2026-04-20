import { useId } from "react";

export function SessionsMark({
  size = 20,
  strokeWidth = 1.7,
  ringWidth = 1,
  pulseRadius = 0.95,
  halo = true,
  className = "",
}: {
  size?: number;
  strokeWidth?: number;
  ringWidth?: number;
  pulseRadius?: number;
  halo?: boolean;
  className?: string;
}) {
  const uid = useId().replace(/:/g, "");
  const haloId = `halo-${uid}`;
  const armId = (i: number) => `arm${i}-${uid}`;
  const pulseGradId = `pulseG-${uid}`;
  const glowId = `glow-${uid}`;
  const coreId = `core-${uid}`;

  const arms = [
    { x1: 12, y1: 3.5, x2: 12, y2: 20.5 },
    { x1: 5.6, y1: 8.3, x2: 18.4, y2: 15.7 },
    { x1: 5.6, y1: 15.7, x2: 18.4, y2: 8.3 },
  ];
  const tips = [
    { x: 12, y: 3.5, d: "0s" },
    { x: 18.4, y: 8.3, d: "0.4s" },
    { x: 18.4, y: 15.7, d: "0.8s" },
    { x: 12, y: 20.5, d: "1.2s" },
    { x: 5.6, y: 15.7, d: "1.6s" },
    { x: 5.6, y: 8.3, d: "2.0s" },
  ];

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={`text-foreground ${className}`}
      aria-label="Sessions"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <radialGradient id={haloId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#7dcfff" stopOpacity="0.35" />
          <stop offset="45%" stopColor="#bb9af7" stopOpacity="0.10" />
          <stop offset="100%" stopColor="#7dcfff" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={coreId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="55%" stopColor="#cfe8ff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#7dcfff" stopOpacity="0.6" />
        </radialGradient>
        <radialGradient id={pulseGradId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="40%" stopColor="#7dcfff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#7dcfff" stopOpacity="0" />
        </radialGradient>
        {arms.map((a, i) => (
          <linearGradient
            key={i}
            id={armId(i)}
            x1={a.x1}
            y1={a.y1}
            x2={a.x2}
            y2={a.y2}
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor="currentColor" stopOpacity="0.15" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0.15" />
          </linearGradient>
        ))}
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="0.55" />
        </filter>
      </defs>

      {halo && <circle cx="12" cy="12" r="11.5" fill={`url(#${haloId})`} />}
      <circle
        cx="12"
        cy="12"
        r="10.25"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.22"
        strokeWidth={ringWidth}
      />
      <circle
        cx="12"
        cy="12"
        r="10.25"
        fill="none"
        stroke="#7dcfff"
        strokeOpacity="0.18"
        strokeWidth={ringWidth * 0.6}
        strokeDasharray="0.5 4"
      />
      <g strokeWidth={strokeWidth} strokeLinecap="round">
        {arms.map((a, i) => (
          <line
            key={i}
            x1={a.x1}
            y1={a.y1}
            x2={a.x2}
            y2={a.y2}
            stroke={`url(#${armId(i)})`}
          />
        ))}
      </g>
      <circle
        cx="12"
        cy="12"
        r={pulseRadius * 2.4}
        fill="#7dcfff"
        opacity="0.35"
        filter={`url(#${glowId})`}
      />
      <circle cx="12" cy="12" r={pulseRadius * 1.7} fill={`url(#${coreId})`} />
      {tips.map((p, i) => (
        <g key={i}>
          <circle r={pulseRadius * 2.2} fill={`url(#${pulseGradId})`} opacity="0">
            <animate attributeName="cx" values={`${p.x};12`} dur="2.4s" begin={p.d} repeatCount="indefinite" />
            <animate attributeName="cy" values={`${p.y};12`} dur="2.4s" begin={p.d} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;0.35;0.35;0" keyTimes="0;0.15;0.8;1" dur="2.4s" begin={p.d} repeatCount="indefinite" />
          </circle>
          <circle r={pulseRadius} fill="#ffffff" opacity="0">
            <animate attributeName="cx" values={`${p.x};12`} dur="2.4s" begin={p.d} repeatCount="indefinite" />
            <animate attributeName="cy" values={`${p.y};12`} dur="2.4s" begin={p.d} repeatCount="indefinite" />
            <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.15;0.8;1" dur="2.4s" begin={p.d} repeatCount="indefinite" />
          </circle>
        </g>
      ))}
    </svg>
  );
}

export function SessionsWordmark({ size = "md", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const sizeMap = {
    sm: { mark: 14, text: "text-sm", tag: "text-[9px] tracking-[0.28em]" },
    md: { mark: 18, text: "text-base", tag: "text-[10px] tracking-[0.32em]" },
    lg: { mark: 22, text: "text-xl", tag: "text-[11px] tracking-[0.32em]" },
  } as const;
  const s = sizeMap[size];
  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <SessionsMark size={s.mark} />
      <div className="flex flex-col leading-none">
        <span className={`${s.text} font-semibold tracking-tight bg-gradient-to-b from-foreground to-foreground/60 bg-clip-text text-transparent`}>
          Sessions
        </span>
        <span className={`${s.tag} uppercase text-muted-foreground/55 mt-0.5`}>
          the perspective layer
        </span>
      </div>
    </div>
  );
}
