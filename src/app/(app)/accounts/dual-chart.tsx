"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney, shortDate } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "#a5a39e" };
const GRID = "#eae8e3";
const ILS_COLOR = "#1a9a5c";
const USD_COLOR = "#63b3d9";

type Point = { date: string; value: number };

/**
 * One chart, two currencies, zero mixing: ILS on the left axis,
 * USD on the right. If only one series has data, renders single-axis.
 */
export function DualChart({
  ils,
  usd,
  height = 240,
}: {
  ils: Point[];
  usd: Point[];
  height?: number;
}) {
  const hasIls = ils.length > 0;
  const hasUsd = usd.length > 0;
  if (!hasIls && !hasUsd) return null;
  const dual = hasIls && hasUsd;

  const byDate = new Map<string, { date: string; ils?: number; usd?: number }>();
  for (const p of ils) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row.ils = p.value;
    byDate.set(p.date, row);
  }
  for (const p of usd) {
    const row = byDate.get(p.date) ?? { date: p.date };
    row.usd = p.value;
    byDate.set(p.date, row);
  }
  const data = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));

  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: dual ? 4 : 8, left: 4, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="date"
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          tickFormatter={(d: string) => shortDate(d)}
          minTickGap={48}
        />
        {hasIls ? (
          <YAxis
            yAxisId="ils"
            orientation="left"
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => fmtMoney(v, "ILS", { compact: true })}
          />
        ) : null}
        {hasUsd ? (
          <YAxis
            yAxisId="usd"
            orientation={dual ? "right" : "left"}
            tick={AXIS}
            tickLine={false}
            axisLine={false}
            width={52}
            domain={["auto", "auto"]}
            tickFormatter={(v: number) => fmtMoney(v, "USD", { compact: true })}
          />
        ) : null}
        <Tooltip
          formatter={(v, name) => [
            fmtMoney(Number(v), name === "ils" ? "ILS" : "USD"),
            name === "ils" ? "₪ Net worth" : "$ Net worth",
          ]}
          labelFormatter={(d) => shortDate(String(d))}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eae8e3",
            fontSize: 12.5,
            boxShadow: "0 4px 16px rgba(34,32,29,.14)",
          }}
        />
        {hasIls ? (
          <Line
            isAnimationActive={false}
            yAxisId="ils"
            type="monotone"
            dataKey="ils"
            stroke={ILS_COLOR}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ) : null}
        {hasUsd ? (
          <Line
            isAnimationActive={false}
            yAxisId="usd"
            type="monotone"
            dataKey="usd"
            stroke={USD_COLOR}
            strokeWidth={2}
            dot={false}
            connectNulls
          />
        ) : null}
      </LineChart>
    </ResponsiveContainer>
  );
}
