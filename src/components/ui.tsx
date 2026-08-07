import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export function Card({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn("card", className)}>{children}</div>;
}

export function CardHeader({
  title,
  sub,
  right,
  className,
}: {
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between px-5 pt-4 pb-2", className)}>
      <div className="flex items-baseline gap-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {sub ? <span className="text-[13px] text-muted">{sub}</span> : null}
      </div>
      {right}
    </div>
  );
}

export function PageHeader({
  title,
  right,
  tabs,
}: {
  title: ReactNode;
  right?: ReactNode;
  tabs?: ReactNode;
}) {
  return (
    <div className="sticky top-0 z-10 flex h-[52px] items-center justify-between gap-4 bg-bg px-6">
      <div className="flex items-center gap-5">
        <h1 className="text-[17px] font-semibold">{title}</h1>
        {tabs}
      </div>
      <div className="flex items-center gap-2">{right}</div>
    </div>
  );
}

const buttonStyles = {
  primary:
    "bg-accent text-white hover:bg-accent-strong border border-transparent",
  secondary:
    "bg-card text-ink border border-line-strong hover:bg-hover",
  ghost: "bg-transparent text-ink-soft hover:bg-hover border border-transparent",
} as const;

export function buttonCls(
  variant: keyof typeof buttonStyles = "secondary",
  size: "sm" | "md" = "md",
) {
  return cn(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default",
    size === "md" ? "h-9 px-3.5 text-[13.5px]" : "h-7.5 px-2.5 text-[12.5px]",
    buttonStyles[variant],
  );
}

export function Amount({
  value,
  formatted,
  colored = false,
  className,
}: {
  value: number;
  formatted: string;
  colored?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "tnum",
        colored && value > 0 && "text-pos",
        colored && value < 0 && "text-ink",
        className,
      )}
    >
      {formatted}
    </span>
  );
}

export function Pill({
  icon,
  label,
  className,
}: {
  icon?: string | null;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[12.5px] font-medium",
        className ?? "bg-active text-ink-soft",
      )}
    >
      {icon ? <span className="text-[12px] leading-none">{icon}</span> : null}
      <span className="truncate">{label}</span>
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  sub,
  action,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon ? (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-full bg-accent-soft text-accent">
          {icon}
        </div>
      ) : null}
      <div className="text-[15px] font-semibold">{title}</div>
      {sub ? <div className="max-w-sm text-[13px] text-muted">{sub}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

export function Segmented({
  options,
  value,
  hrefBase,
  param,
  className,
}: {
  options: { value: string; label: string }[];
  value: string;
  hrefBase: string;
  param: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-0.5 rounded-lg bg-active p-0.5", className)}>
      {options.map((o) => (
        <a
          key={o.value}
          href={`${hrefBase}${hrefBase.includes("?") ? "&" : "?"}${param}=${o.value}`}
          className={cn(
            "rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium transition-colors",
            o.value === value
              ? "bg-card text-ink shadow-card"
              : "text-muted hover:text-ink",
          )}
        >
          {o.label}
        </a>
      ))}
    </div>
  );
}

export const inputCls =
  "h-9 w-full rounded-lg border border-line-strong bg-card px-3 text-[13.5px] outline-none placeholder:text-faint focus:border-accent focus:ring-2 focus:ring-accent/15";

export const selectCls =
  "h-9 rounded-lg border border-line-strong bg-card px-2.5 text-[13.5px] outline-none focus:border-accent cursor-pointer";
