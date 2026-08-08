"use client";

import { useId, useMemo } from "react";
import type { ReactElement, SVGProps } from "react";
import { Layer, Rectangle, ResponsiveContainer, Sankey, Tooltip } from "recharts";
import type { SankeyLinkProps, SankeyNodeProps } from "recharts";
import { fmtMoney } from "@/lib/format";

export interface SankeyNodeInput {
  name: string;
}

export interface SankeyLinkInput {
  source: number;
  target: number;
  value: number;
}

const INCOME_SOURCE = "#63b3d9"; // left column: income categories
const CENTER = "#1a9a5c"; // "Income" hub + "Savings"
const GROUP_COLORS = [
  "#ee6a3c",
  "#8f7ad6",
  "#e8b93c",
  "#d96aa8",
  "#4f8f8b",
  "#c98a3f",
  "#6a8fd6",
  "#a3a19e",
];
const LINK_GRAY = "#b8b5af";
const FALLBACK = "#a3a19e";

/** Mix a hex color toward white by `amt` (0..1). */
function lighten(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amt);
  const r = mix((n >> 16) & 255);
  const g = mix((n >> 8) & 255);
  const b = mix(n & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Monarch-style cash flow Sankey: income categories -> Income -> expense
 * groups (+ Savings) -> categories. Labels sit outside the flow — left of
 * the node on the left half of the chart, right of it on the right half.
 */
export function CashflowSankey({
  nodes,
  links,
  currency,
  height = 420,
}: {
  nodes: SankeyNodeInput[];
  links: SankeyLinkInput[];
  currency: string;
  height?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");

  const { depths, maxDepth, colors, incomeTotal } = useMemo(() => {
    const n = nodes.length;
    // Node depth = longest path from a root (fixed point over the links).
    const depths = new Array<number>(n).fill(0);
    for (let pass = 0; pass < n; pass++) {
      let changed = false;
      for (const l of links) {
        if (l.source < 0 || l.source >= n || l.target < 0 || l.target >= n) continue;
        if (depths[l.target] < depths[l.source] + 1) {
          depths[l.target] = depths[l.source] + 1;
          changed = true;
        }
      }
      if (!changed) break;
    }
    const maxDepth = depths.reduce((m, d) => Math.max(m, d), 0);

    const hasOutflow = new Set(links.map((l) => l.source));
    const firstParent = new Map<number, number>();
    for (const l of links) {
      if (!firstParent.has(l.target)) firstParent.set(l.target, l.source);
    }

    // Palette by position: income sources blue, hub/Savings green, expense
    // groups mid palette, leaf categories a lighter tint of their group.
    const colors = new Array<string>(n).fill(FALLBACK);
    const byDepth = nodes.map((_, i) => i).sort((a, b) => depths[a] - depths[b]);
    let groupCursor = 0;
    for (const i of byDepth) {
      const name = nodes[i].name;
      if (name === "Income" || name === "Savings") {
        colors[i] = CENTER;
      } else if (depths[i] === 0) {
        colors[i] = INCOME_SOURCE;
      } else if (depths[i] >= 2 && !hasOutflow.has(i)) {
        const parent = firstParent.get(i);
        colors[i] = lighten(parent != null ? colors[parent] : FALLBACK, 0.45);
      } else {
        colors[i] = GROUP_COLORS[groupCursor++ % GROUP_COLORS.length];
      }
    }

    // Percent base = total flowing through the "Income" hub.
    const incomeIdx = nodes.findIndex((nd) => nd.name === "Income");
    let flowIn = 0;
    let flowOut = 0;
    for (const l of links) {
      if (l.target === incomeIdx) flowIn += l.value;
      if (l.source === incomeIdx) flowOut += l.value;
    }
    return { depths, maxDepth, colors, incomeTotal: Math.max(flowIn, flowOut) };
  }, [nodes, links]);

  const data = useMemo(
    () => ({
      nodes: nodes.map((nd) => ({ name: nd.name })),
      links: links.map((l) => ({ ...l })),
    }),
    [nodes, links],
  );

  if (links.length === 0) return null;

  const renderNode = (props: SankeyNodeProps) => {
    const { x, y, width, height: h, index, payload } = props;
    const color = colors[index] ?? FALLBACK;
    const onLeftHalf = (depths[index] ?? 0) < maxDepth / 2;
    const value = Number(payload.value ?? 0);
    const pct = incomeTotal > 0 ? Math.round((value / incomeTotal) * 100) : null;
    const tx = onLeftHalf ? x - 8 : x + width + 8;
    const anchor = onLeftHalf ? "end" : "start";
    const cy = y + h / 2;
    return (
      <Layer key={`node-${index}`}>
        <Rectangle
          x={x}
          y={y}
          width={width}
          height={Math.max(h, 2)}
          radius={3}
          fill={color}
          fillOpacity={0.95}
          isAnimationActive={false}
        />
        <text x={tx} y={cy - 2.5} textAnchor={anchor} fontSize={12} fontWeight={600} fill="#22201d">
          {payload.name}
        </text>
        <text x={tx} y={cy + 10.5} textAnchor={anchor} fontSize={11} fill="#7d7b76">
          {fmtMoney(value, currency, { decimals: false })}
          {pct != null ? ` · ${pct}%` : ""}
        </text>
      </Layer>
    );
  };

  const renderLink = (props: SankeyLinkProps) => {
    const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index } = props;
    // Link order is preserved, so the input link at `index` gives the target.
    const color = colors[links[index]?.target ?? -1] ?? FALLBACK;
    const gid = `pn-sankey-${uid}-${index}`;
    return (
      <Layer key={`link-${index}`}>
        <defs>
          <linearGradient
            id={gid}
            gradientUnits="userSpaceOnUse"
            x1={sourceX}
            y1={sourceY}
            x2={targetX}
            y2={targetY}
          >
            <stop offset="0%" stopColor={LINK_GRAY} />
            <stop offset="100%" stopColor={color} />
          </linearGradient>
        </defs>
        <path
          d={`M${sourceX},${sourceY}C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`}
          fill="none"
          stroke={`url(#${gid})`}
          strokeOpacity={0.35}
          strokeWidth={Math.max(1, linkWidth)}
        />
      </Layer>
    ) as ReactElement<SVGProps<SVGPathElement>>;
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <Sankey
        data={data}
        node={renderNode}
        link={renderLink}
        nodeWidth={12}
        nodePadding={24}
        iterations={40}
        margin={{ top: 14, right: 155, bottom: 14, left: 155 }}
      >
        <Tooltip
          formatter={(v, name) => [fmtMoney(Number(v), currency, { decimals: false }), String(name)]}
          contentStyle={{
            borderRadius: 10,
            border: "1px solid #eae8e3",
            fontSize: 12.5,
            boxShadow: "0 4px 16px rgba(34,32,29,.14)",
          }}
        />
      </Sankey>
    </ResponsiveContainer>
  );
}
