import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Shekels and dollars side by side, never merged.
 * Renders one amount per currency, in fixed ILS→USD order.
 */
export function DualMoney({
  values,
  size = "md",
  colored = false,
  sign = false,
  decimals = false,
  className,
}: {
  values: { currency: string; value: number }[];
  size?: "sm" | "md" | "lg" | "xl";
  colored?: boolean;
  sign?: boolean;
  decimals?: boolean;
  className?: string;
}) {
  const nonzero = values.filter((v) => Math.round(v.value * 100) !== 0);
  const list = nonzero.length > 0 ? nonzero : values.slice(0, 1);
  const sizeCls = {
    sm: "text-[12.5px]",
    md: "text-[13.5px]",
    lg: "text-[20px] font-semibold",
    xl: "text-[26px] font-semibold",
  }[size];
  return (
    <span className={cn("inline-flex flex-wrap items-baseline gap-x-3 gap-y-0.5", className)}>
      {list.map((v) => (
        <span
          key={v.currency}
          className={cn(
            "tnum",
            sizeCls,
            colored && v.value > 0 && "text-pos",
            colored && v.value < 0 && "text-neg",
          )}
        >
          {fmtMoney(v.value, v.currency, { decimals, sign })}
        </span>
      ))}
    </span>
  );
}
