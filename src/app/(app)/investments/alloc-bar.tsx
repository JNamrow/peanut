import { fmtMoney } from "@/lib/format";

export interface AllocSegment {
  name: string;
  value: number;
  color: string;
}

/**
 * Monarch-style allocation band: one horizontal row of rounded blocks,
 * each block's width proportional to its share of the total. Labels sit
 * inside the block (top-left, white) and hide below an 8% share — the
 * title attribute keeps the full text reachable. Pure divs, server-safe.
 */
export function AllocBar({
  segments,
  currency,
  height = 280,
}: {
  segments: AllocSegment[];
  currency: string;
  height?: number;
}) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total <= 0 || segments.length === 0) return null;
  return (
    <div className="flex w-full gap-1.5" style={{ height }}>
      {segments.map((s) => {
        const share = s.value / total;
        const pctLabel = `${(share * 100).toFixed(1)}%`;
        const money = fmtMoney(s.value, currency, { decimals: false });
        return (
          <div
            key={s.name}
            className="min-w-0 overflow-hidden rounded-xl p-3.5"
            style={{
              flexGrow: share * 100,
              flexBasis: 0,
              minWidth: 8,
              background: s.color,
            }}
            title={`${s.name} — ${money} (${pctLabel})`}
          >
            {share >= 0.08 ? (
              <div className="flex flex-col gap-0.5 text-white">
                <span className="truncate text-[13px] font-semibold">
                  {s.name}
                </span>
                <span className="tnum truncate text-[13px] font-medium opacity-95">
                  {money}
                </span>
                <span className="tnum text-[12px] opacity-80">{pctLabel}</span>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
