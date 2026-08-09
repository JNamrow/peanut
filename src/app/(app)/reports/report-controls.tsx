"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Calendar, Funnel, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonCls, inputCls } from "@/components/ui";
import { useDismiss } from "@/components/category-picker";
import { shortDate } from "@/lib/format";

export interface ReportParams {
  tab: string;
  from?: string;
  to?: string;
  by?: string;
  cats?: string;
  merchants?: string;
  accounts?: string;
  amin?: string;
  amax?: string;
}

const PARAM_KEYS = [
  "tab",
  "from",
  "to",
  "by",
  "cats",
  "merchants",
  "accounts",
  "amin",
  "amax",
] as const;

/** Merge a patch over the current params and build the /reports URL.
 *  Legacy `range` is never carried (it isn't in ReportParams). */
function mergedUrl(
  current: ReportParams,
  patch: { [K in keyof ReportParams]?: string | undefined },
): string {
  const next = { ...current, ...patch };
  const q = new URLSearchParams();
  for (const k of PARAM_KEYS) {
    const v = next[k];
    if (v) q.set(k, v);
  }
  const s = q.toString();
  return `/reports${s ? `?${s}` : ""}`;
}

function ymdLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function splitList(v?: string): string[] {
  return v ? v.split(",").filter(Boolean) : [];
}

function splitMerchants(v?: string): string[] {
  if (!v) return [];
  return v
    .split("~")
    .filter(Boolean)
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    });
}

// ------------------------------------------------------------------- dates

interface DatePreset {
  name: string;
  from: string;
  to: string;
}

function datePresets(): DatePreset[] {
  const now = new Date();
  const today = ymdLocal(now);
  const daysAgo = (n: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - n);
    return ymdLocal(d);
  };
  const y = now.getFullYear();
  const m = now.getMonth();
  return [
    { name: "Last 7 days", from: daysAgo(6), to: today },
    { name: "Last 30 days", from: daysAgo(29), to: today },
    {
      name: "This month",
      from: ymdLocal(new Date(y, m, 1)),
      to: ymdLocal(new Date(y, m + 1, 0)),
    },
    {
      name: "Last month",
      from: ymdLocal(new Date(y, m - 1, 1)),
      to: ymdLocal(new Date(y, m, 0)),
    },
    { name: "This year", from: `${y}-01-01`, to: `${y}-12-31` },
    { name: "Last year", from: `${y - 1}-01-01`, to: `${y - 1}-12-31` },
  ];
}

type LastUnit = "day" | "week" | "month" | "quarter" | "year";

const LAST_UNITS: { value: LastUnit; label: string }[] = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "quarter", label: "Quarter" },
  { value: "year", label: "Year" },
];

function lastRange(n: number, unit: LastUnit): { from: string; to: string } {
  const now = new Date();
  const d = new Date(now);
  if (unit === "day") d.setDate(d.getDate() - n);
  else if (unit === "week") d.setDate(d.getDate() - n * 7);
  else if (unit === "month") d.setMonth(d.getMonth() - n);
  else if (unit === "quarter") d.setMonth(d.getMonth() - n * 3);
  else d.setFullYear(d.getFullYear() - n);
  return { from: ymdLocal(d), to: ymdLocal(now) };
}

function rangeLabel(presets: DatePreset[], from?: string, to?: string): string {
  if (from && to) {
    const hit = presets.find((p) => p.from === from && p.to === to);
    if (hit) return hit.name;
    return `${shortDate(from)} – ${shortDate(to)}`;
  }
  if (from) return `From ${shortDate(from)}`;
  if (to) return `Until ${shortDate(to)}`;
  return "All time";
}

const railItemCls = (active: boolean) =>
  cn(
    "cursor-pointer rounded-md px-2 py-1.5 text-left text-[13px]",
    active
      ? "bg-accent-soft/60 font-medium text-ink"
      : "text-ink-soft hover:bg-hover",
  );

const fieldLabelCls =
  "text-[11px] font-medium uppercase tracking-wide text-faint";

export function DateFilterButton({ current }: { current: ReportParams }) {
  const router = useRouter();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const presets = useMemo(() => datePresets(), []);

  // mode: "last" | "range" | a preset name
  const [mode, setMode] = useState<string>("range");
  const [draft, setDraft] = useState({ from: "", to: "" });
  const [lastN, setLastN] = useState(30);
  const [lastUnit, setLastUnit] = useState<LastUnit>("day");

  useDismiss(anchorRef, open, () => setOpen(false));

  function openPopover() {
    const from = current.from ?? "";
    const to = current.to ?? "";
    const hit = presets.find((p) => p.from === from && p.to === to);
    setMode(hit ? hit.name : "range");
    setDraft({ from, to });
    setOpen(true);
  }

  function selectLast(n = lastN, unit = lastUnit) {
    setMode("last");
    setDraft(lastRange(n, unit));
  }

  function apply() {
    router.push(
      mergedUrl(current, {
        from: draft.from || undefined,
        to: draft.to || undefined,
      }),
    );
    setOpen(false);
  }

  function clear() {
    router.push(mergedUrl(current, { from: undefined, to: undefined }));
    setOpen(false);
  }

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        className={buttonCls("secondary")}
        onClick={() => (open ? setOpen(false) : openPopover())}
      >
        <Calendar size={14} />
        {rangeLabel(presets, current.from, current.to)}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 flex max-h-[70vh] w-[460px] flex-col rounded-card border border-line bg-card shadow-pop">
          <div className="grid min-h-0 flex-1 grid-cols-[150px_minmax(0,1fr)] grid-rows-[minmax(0,1fr)]">
            <div className="flex flex-col gap-0.5 overflow-y-auto border-r border-line p-2">
              <button
                type="button"
                className={railItemCls(mode === "last")}
                onClick={() => selectLast()}
              >
                Last
              </button>
              <button
                type="button"
                className={railItemCls(mode === "range")}
                onClick={() => setMode("range")}
              >
                Range
              </button>
              <div className="my-1 border-t border-line" />
              {presets.map((p) => (
                <button
                  key={p.name}
                  type="button"
                  className={railItemCls(mode === p.name)}
                  onClick={() => {
                    setMode(p.name);
                    setDraft({ from: p.from, to: p.to });
                  }}
                >
                  {p.name}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto p-3">
              {mode === "last" ? (
                <div className="flex flex-col gap-2.5">
                  <div>
                    <label className={cn(fieldLabelCls, "mb-1 block")}>
                      Number
                    </label>
                    <input
                      type="number"
                      min={1}
                      value={lastN}
                      onChange={(e) => {
                        const n = Math.max(
                          1,
                          Math.floor(Number(e.target.value) || 1),
                        );
                        setLastN(n);
                        selectLast(n, lastUnit);
                      }}
                      className={cn(inputCls, "h-8 text-[13px]")}
                    />
                  </div>
                  <div>
                    <span className={cn(fieldLabelCls, "mb-1 block")}>
                      Unit
                    </span>
                    <div className="flex flex-col gap-0.5">
                      {LAST_UNITS.map((u) => (
                        <label
                          key={u.value}
                          className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-hover"
                        >
                          <input
                            type="radio"
                            name="report-last-unit"
                            checked={lastUnit === u.value}
                            onChange={() => {
                              setLastUnit(u.value);
                              selectLast(lastN, u.value);
                            }}
                            className="accent-accent"
                          />
                          {u.label}
                        </label>
                      ))}
                    </div>
                  </div>
                  <p className="text-[12px] text-muted">
                    {draft.from ? shortDate(draft.from) : ""} –{" "}
                    {draft.to ? shortDate(draft.to) : ""}
                  </p>
                </div>
              ) : mode === "range" ? (
                <div className="flex flex-col gap-2.5">
                  <div>
                    <label className={cn(fieldLabelCls, "mb-1 block")}>
                      From
                    </label>
                    <input
                      type="date"
                      value={draft.from}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, from: e.target.value }))
                      }
                      className={cn(inputCls, "h-8 text-[13px]")}
                    />
                  </div>
                  <div>
                    <label className={cn(fieldLabelCls, "mb-1 block")}>
                      To
                    </label>
                    <input
                      type="date"
                      value={draft.to}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, to: e.target.value }))
                      }
                      className={cn(inputCls, "h-8 text-[13px]")}
                    />
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
            <button
              type="button"
              className={buttonCls("ghost", "sm")}
              onClick={clear}
            >
              Clear
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={buttonCls("ghost", "sm")}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonCls("primary", "sm")}
                onClick={apply}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------- filters

interface FilterCategory {
  id: string;
  name: string;
  name_he: string | null;
  icon: string | null;
  group: string;
}

type Section = "categories" | "merchants" | "accounts" | "amount";

const SECTIONS: { key: Section; label: string }[] = [
  { key: "categories", label: "Categories" },
  { key: "merchants", label: "Merchants" },
  { key: "accounts", label: "Accounts" },
  { key: "amount", label: "Amount" },
];

interface FilterDraft {
  cats: Set<string>;
  merch: Set<string>;
  accts: Set<string>;
  amin: string;
  amax: string;
}

function draftFrom(current: ReportParams): FilterDraft {
  return {
    cats: new Set(splitList(current.cats)),
    merch: new Set(splitMerchants(current.merchants)),
    accts: new Set(splitList(current.accounts)),
    amin: current.amin ?? "",
    amax: current.amax ?? "",
  };
}

const checkRowCls =
  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[13px] hover:bg-hover";

export function FiltersButton({
  current,
  categories,
  merchants,
  accounts,
}: {
  current: ReportParams;
  categories: FilterCategory[];
  merchants: { name: string; total: number }[];
  accounts: { id: string; name: string }[];
}) {
  const router = useRouter();
  const anchorRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("categories");
  const [catQuery, setCatQuery] = useState("");
  const [merchQuery, setMerchQuery] = useState("");
  const [draft, setDraft] = useState<FilterDraft>(() => draftFrom(current));

  useDismiss(anchorRef, open, () => setOpen(false));

  const activeCount =
    splitList(current.cats).length +
    splitMerchants(current.merchants).length +
    splitList(current.accounts).length +
    (current.amin ? 1 : 0) +
    (current.amax ? 1 : 0);

  const grouped = useMemo(() => {
    const m = new Map<string, FilterCategory[]>();
    for (const c of categories) {
      const arr = m.get(c.group) ?? [];
      arr.push(c);
      m.set(c.group, arr);
    }
    return [...m.entries()];
  }, [categories]);

  const q = catQuery.trim().toLowerCase();
  const filteredGroups = grouped
    .map(
      ([group, cs]) =>
        [
          group,
          q
            ? cs.filter(
                (c) =>
                  c.name.toLowerCase().includes(q) ||
                  (c.name_he ?? "").toLowerCase().includes(q),
              )
            : cs,
        ] as const,
    )
    .filter(([, cs]) => cs.length > 0);
  const unVisible = !q || "uncategorized".includes(q);
  const visibleCatIds = [
    ...(unVisible ? ["un"] : []),
    ...filteredGroups.flatMap(([, cs]) => cs.map((c) => c.id)),
  ];

  const mq = merchQuery.trim().toLowerCase();
  const filteredMerchants = mq
    ? merchants.filter((m) => m.name.toLowerCase().includes(mq))
    : merchants;

  function openPopover() {
    setDraft(draftFrom(current));
    setSection("categories");
    setCatQuery("");
    setMerchQuery("");
    setOpen(true);
  }

  function toggleIn(key: "cats" | "merch" | "accts", value: string) {
    setDraft((d) => {
      const set = new Set(d[key]);
      if (set.has(value)) set.delete(value);
      else set.add(value);
      return { ...d, [key]: set };
    });
  }

  function setMany(key: "cats" | "merch" | "accts", values: string[], on: boolean) {
    setDraft((d) => {
      const set = new Set(d[key]);
      for (const v of values) {
        if (on) set.add(v);
        else set.delete(v);
      }
      return { ...d, [key]: set };
    });
  }

  function apply() {
    router.push(
      mergedUrl(current, {
        cats: draft.cats.size ? [...draft.cats].join(",") : undefined,
        merchants: draft.merch.size
          ? [...draft.merch].map(encodeURIComponent).join("~")
          : undefined,
        accounts: draft.accts.size ? [...draft.accts].join(",") : undefined,
        amin: draft.amin.trim() || undefined,
        amax: draft.amax.trim() || undefined,
      }),
    );
    setOpen(false);
  }

  const selectedCount =
    draft.cats.size +
    draft.merch.size +
    draft.accts.size +
    (draft.amin.trim() ? 1 : 0) +
    (draft.amax.trim() ? 1 : 0);

  const chips: { key: string; label: string; onRemove: () => void }[] = [];
  for (const id of draft.cats) {
    const c = categories.find((x) => x.id === id);
    chips.push({
      key: `cat:${id}`,
      label:
        id === "un"
          ? "Uncategorized"
          : c
            ? `${c.icon ? `${c.icon} ` : ""}${c.name}`
            : id,
      onRemove: () => toggleIn("cats", id),
    });
  }
  for (const name of draft.merch) {
    chips.push({
      key: `mer:${name}`,
      label: name,
      onRemove: () => toggleIn("merch", name),
    });
  }
  for (const id of draft.accts) {
    const a = accounts.find((x) => x.id === id);
    chips.push({
      key: `acc:${id}`,
      label: a?.name ?? "Account",
      onRemove: () => toggleIn("accts", id),
    });
  }
  if (draft.amin.trim()) {
    chips.push({
      key: "amin",
      label: `Min ${draft.amin.trim()}`,
      onRemove: () => setDraft((d) => ({ ...d, amin: "" })),
    });
  }
  if (draft.amax.trim()) {
    chips.push({
      key: "amax",
      label: `Max ${draft.amax.trim()}`,
      onRemove: () => setDraft((d) => ({ ...d, amax: "" })),
    });
  }

  const allVisibleSelected =
    visibleCatIds.length > 0 &&
    visibleCatIds.every((id) => draft.cats.has(id));

  return (
    <div ref={anchorRef} className="relative">
      <button
        type="button"
        className={buttonCls("secondary")}
        onClick={() => (open ? setOpen(false) : openPopover())}
      >
        <Funnel size={14} /> Filters
        {activeCount > 0 ? (
          <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10.5px] font-semibold text-white">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 flex max-h-[70vh] w-[640px] flex-col rounded-card border border-line bg-card shadow-pop">
          <div className="grid min-h-0 flex-1 grid-cols-[136px_minmax(0,1fr)_190px] grid-rows-[minmax(0,1fr)]">
            <div className="flex flex-col gap-0.5 overflow-y-auto border-r border-line p-2">
              {SECTIONS.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  className={railItemCls(section === s.key)}
                  onClick={() => setSection(s.key)}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <div className="overflow-y-auto p-2.5">
              {section === "categories" ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    value={catQuery}
                    onChange={(e) => setCatQuery(e.target.value)}
                    placeholder="Search categories"
                    dir="auto"
                    className={cn(inputCls, "h-8 text-[13px]")}
                  />
                  <label className={cn(checkRowCls, "font-medium")}>
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={() =>
                        setMany("cats", visibleCatIds, !allVisibleSelected)
                      }
                      className="accent-accent"
                    />
                    Select all
                  </label>
                  {unVisible ? (
                    <label className={checkRowCls}>
                      <input
                        type="checkbox"
                        checked={draft.cats.has("un")}
                        onChange={() => toggleIn("cats", "un")}
                        className="accent-accent"
                      />
                      <span className="text-[13px]">❓</span>
                      Uncategorized
                    </label>
                  ) : null}
                  {filteredGroups.map(([group, cs]) => {
                    const ids = cs.map((c) => c.id);
                    const allOn = ids.every((id) => draft.cats.has(id));
                    return (
                      <div key={group}>
                        <label className={cn(checkRowCls, "font-semibold")}>
                          <input
                            type="checkbox"
                            checked={allOn}
                            onChange={() => setMany("cats", ids, !allOn)}
                            className="accent-accent"
                          />
                          {group}
                        </label>
                        {cs.map((c) => (
                          <label
                            key={c.id}
                            className={cn(checkRowCls, "ml-5")}
                            dir="auto"
                          >
                            <input
                              type="checkbox"
                              checked={draft.cats.has(c.id)}
                              onChange={() => toggleIn("cats", c.id)}
                              className="accent-accent"
                            />
                            {c.icon ? (
                              <span className="text-[13px]">{c.icon}</span>
                            ) : null}
                            <span className="min-w-0 truncate">
                              {c.name}
                              {c.name_he ? (
                                <span className="text-muted">
                                  {" "}
                                  · {c.name_he}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ) : section === "merchants" ? (
                <div className="flex flex-col gap-1.5">
                  <input
                    value={merchQuery}
                    onChange={(e) => setMerchQuery(e.target.value)}
                    placeholder="Search merchants"
                    dir="auto"
                    className={cn(inputCls, "h-8 text-[13px]")}
                  />
                  {filteredMerchants.map((m) => (
                    <label key={m.name} className={checkRowCls}>
                      <input
                        type="checkbox"
                        checked={draft.merch.has(m.name)}
                        onChange={() => toggleIn("merch", m.name)}
                        className="accent-accent"
                      />
                      <span className="min-w-0 flex-1 truncate" dir="auto">
                        {m.name}
                      </span>
                      {/* Merchants span both currencies — show a bare number. */}
                      <span className="tnum shrink-0 text-[12px] text-muted">
                        {m.total.toLocaleString("en-US", { maximumFractionDigits: 0 })}
                      </span>
                    </label>
                  ))}
                  {filteredMerchants.length === 0 ? (
                    <p className="px-2 py-3 text-[12.5px] text-muted">
                      No merchants match.
                    </p>
                  ) : null}
                </div>
              ) : section === "accounts" ? (
                <div className="flex flex-col gap-0.5">
                  {accounts.map((a) => (
                    <label key={a.id} className={checkRowCls}>
                      <input
                        type="checkbox"
                        checked={draft.accts.has(a.id)}
                        onChange={() => toggleIn("accts", a.id)}
                        className="accent-accent"
                      />
                      <span className="min-w-0 truncate">{a.name}</span>
                    </label>
                  ))}
                </div>
              ) : (
                <div className="flex flex-col gap-2.5 p-1">
                  <div>
                    <label className={cn(fieldLabelCls, "mb-1 block")}>
                      Min amount
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.amin}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, amin: e.target.value }))
                      }
                      placeholder="0"
                      className={cn(inputCls, "h-8 text-[13px]")}
                    />
                  </div>
                  <div>
                    <label className={cn(fieldLabelCls, "mb-1 block")}>
                      Max amount
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={draft.amax}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, amax: e.target.value }))
                      }
                      placeholder="No limit"
                      className={cn(inputCls, "h-8 text-[13px]")}
                    />
                  </div>
                  <p className="text-[12px] text-muted">
                    Absolute amounts, any currency.
                  </p>
                </div>
              )}
            </div>

            <div className="overflow-y-auto border-l border-line p-2.5">
              <p className="px-1 pb-1.5 text-[12.5px] font-medium text-ink-soft">
                {selectedCount} filter{selectedCount === 1 ? "" : "s"} selected
              </p>
              <div className="flex flex-wrap gap-1.5">
                {chips.map((chip) => (
                  <span
                    key={chip.key}
                    className="inline-flex max-w-full items-center gap-1 rounded-full bg-active px-2 py-1 text-[12px] font-medium text-ink-soft"
                  >
                    <span className="truncate" dir="auto">
                      {chip.label}
                    </span>
                    <button
                      type="button"
                      title="Remove filter"
                      onClick={chip.onRemove}
                      className="shrink-0 cursor-pointer text-faint hover:text-ink"
                    >
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between border-t border-line px-3 py-2.5">
            <button
              type="button"
              className={buttonCls("ghost", "sm")}
              onClick={() =>
                setDraft({
                  cats: new Set(),
                  merch: new Set(),
                  accts: new Set(),
                  amin: "",
                  amax: "",
                })
              }
            >
              Clear
            </button>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={buttonCls("ghost", "sm")}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={buttonCls("primary", "sm")}
                onClick={apply}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
