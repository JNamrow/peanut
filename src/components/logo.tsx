import { cn } from "@/lib/utils";

/** The Peanut mark: a tilted peanut with a rising sparkline cut through it. */
export function PeanutMark({
  size = 28,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden
    >
      <g transform="rotate(-16 24 24)">
        <path
          d="M24 3.5
             A 9.5 9.5 0 0 1 32.2 17.7
             C 30.8 19.9 30.9 21.5 33 23.2
             A 12 12 0 1 1 15 23.2
             C 17.1 21.5 17.2 19.9 15.8 17.7
             A 9.5 9.5 0 0 1 24 3.5 Z"
          fill="#EE6A3C"
        />
        <path
          d="M15.5 32 L21 26.5 L24.5 29.2 L31.5 21.5"
          stroke="#FFFFFF"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M27.5 21.2 L31.7 21.2 L31.7 25.4"
          stroke="#FFFFFF"
          strokeWidth="4.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
        />
      </g>
    </svg>
  );
}

export function PeanutLogo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <PeanutMark />
      <span className="text-[19px] font-semibold tracking-tight text-ink">
        peanut
      </span>
    </span>
  );
}
