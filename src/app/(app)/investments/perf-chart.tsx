"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { shortDate } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "#a5a39e" };
const GRID = "#eae8e3";

export interface PerfSeries {
  name: string;
  color: string;
  points: { date: string; pct: number }[];
}

function fmtPctTick(v: number): string {
  return `${v > 0 ? "+" : ""}${v}%`;
}

/** Percent-change lines (portfolio vs benchmarks) on a shared date axis. */
export function PerfChart({
  series,
  height = 240,
}: {
  series: PerfSeries[];
  height?: number;
}) {
  // Merge the series into one row per date; benchmarks skip weekends, so
  // lines use connectNulls to bridge dates a given series doesn't have.
  const byDate = new Map<string, Record<string, string | number>>();
  for (const s of series) {
    for (const p of s.points) {
      const row = byDate.get(p.date) ?? { date: p.date };
      row[s.name] = Math.round(p.pct * 100) / 100;
      byDate.set(p.date, row);
    }
  }
  const data = [...byDate.values()].sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => shortDate(d)}
          minTickGap={48}
        />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={46}
          tickFormatter={fmtPctTick}
        />
        <Tooltip
          formatter={(v, name) => [
            `${Number(v) > 0 ? "+" : ""}${Number(v).toFixed(2)}%`,
            String(name),
          ]}
          labelFormatter={(d) => shortDate(String(d))}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eae8e3",
            fontSize: 12.5,
            boxShadow: "0 4px 16px rgba(34,32,29,.14)",
          }}
        />
        <Legend
          iconType="plainline"
          wrapperStyle={{ fontSize: 12, paddingTop: 4 }}
        />
        {series.map((s) => (
          <Line
            key={s.name}
            type="monotone"
            dataKey={s.name}
            stroke={s.color}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
