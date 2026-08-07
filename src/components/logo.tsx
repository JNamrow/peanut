import { cn } from "@/lib/utils";

/**
 * The Peanut mark: a single flat peanut silhouette, tilted.
 * Robinhood-simple — one color, one shape, no decoration.
 */
export function PeanutMark({
  size = 28,
  color = "#EE6A3C",
  className,
}: {
  size?: number;
  color?: string;
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
      <path
        d="M24 5.5
           C 29.5 5.5 32.5 9.5 32.5 14
           C 32.5 18 29.8 19.9 29.8 22.2
           C 29.8 24.6 35 26.2 35 32
           C 35 38.2 30.1 43 24 43
           C 17.9 43 13 38.2 13 32
           C 13 26.2 18.2 24.6 18.2 22.2
           C 18.2 19.9 15.5 18 15.5 14
           C 15.5 9.5 18.5 5.5 24 5.5 Z"
        fill={color}
        transform="rotate(-18 24 24)"
      />
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
