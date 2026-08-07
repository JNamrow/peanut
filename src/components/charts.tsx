"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fmtMoney, shortDate } from "@/lib/format";

const AXIS = { fontSize: 11, fill: "#a5a39e" };
const GRID = "#eae8e3";

function compact(v: number, ccy: string) {
  return fmtMoney(v, ccy, { compact: true });
}

export function NetWorthChart({
  data,
  currency,
  height = 240,
}: {
  data: { date: string; value: number }[];
  currency: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="nw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#63b3d9" stopOpacity={0.35} />
            <stop offset="100%" stopColor="#63b3d9" stopOpacity={0.02} />
          </linearGradient>
        </defs>
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
          width={52}
          tickFormatter={(v: number) => compact(v, currency)}
        />
        <Tooltip
          formatter={(v) => [fmtMoney(Number(v), currency), "Net worth"]}
          labelFormatter={(d) => shortDate(String(d))}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eae8e3",
            fontSize: 12.5,
            boxShadow: "0 4px 16px rgba(34,32,29,.14)",
          }}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="#63b3d9"
          strokeWidth={2}
          fill="url(#nw)"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function TrendBars({
  data,
  currency,
  height = 240,
}: {
  data: { label: string; income: number; expense: number }[];
  currency: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barGap={3}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="label" tick={AXIS} tickLine={false} axisLine={false} minTickGap={16} />
        <YAxis
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v: number) => compact(v, currency)}
        />
        <Tooltip
          formatter={(v, name) => [
            fmtMoney(Number(v), currency),
            name === "income" ? "Income" : "Expenses",
          ]}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eae8e3",
            fontSize: 12.5,
            boxShadow: "0 4px 16px rgba(34,32,29,.14)",
          }}
        />
        <Bar dataKey="income" fill="#1a9a5c" radius={[3, 3, 0, 0]} maxBarSize={26} />
        <Bar dataKey="expense" fill="#d94f45" radius={[3, 3, 0, 0]} maxBarSize={26} />
      </BarChart>
    </ResponsiveContainer>
  );
}

const DONUT_COLORS = [
  "#63b3d9",
  "#1a9a5c",
  "#ee6a3c",
  "#8f7ad6",
  "#e8b93c",
  "#d96aa8",
  "#4f8f8b",
  "#a3a19e",
];

export function Donut({
  data,
  currency,
  height = 220,
}: {
  data: { name: string; value: number }[];
  currency: string;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="62%"
          outerRadius="90%"
          paddingAngle={2}
          strokeWidth={0}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(v, name) => [fmtMoney(Number(v), currency), String(name)]}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eae8e3",
            fontSize: 12.5,
            boxShadow: "0 4px 16px rgba(34,32,29,.14)",
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}

export { DONUT_COLORS };
