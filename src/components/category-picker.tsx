"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import { Check, Ellipsis, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonCls, inputCls } from "@/components/ui";
import type { Category } from "@/lib/types";
import { updateCategory } from "@/app/(app)/actions";

const SWATCHES = [
  "#63b3d9",
  "#1a9a5c",
  "#ee6a3c",
  "#8f7ad6",
  "#e8b93c",
  "#d96aa8",
  "#4f8f8b",
  "#a3a19e",
];

/** Close a popover on outside click or Escape. Shared by picker + filters. */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, open, onClose]);
}

interface EditDraft {
  name: string;
  name_he: string;
  icon: string;
  color: string | null;
}

export function CategoryPicker({
  categories,
  value,
  onSelect,
  disabled = false,
}: {
  categories: Category[];
  value: string; // category id or "" for uncategorized
  onSelect: (categoryId: string) => void;
  disabled?: boolean;
}) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditDraft>({
    name: "",
    name_he: "",
    icon: "",
    color: null,
  });
  const [editError, setEditError] = useState<string | null>(null);
  // Optimistic edits so the picker reflects a save before the server refresh.
  const [patched, setPatched] = useState<Record<string, Partial<Category>>>({});
  const [saving, startSaving] = useTransition();

  function close() {
    setOpen(false);
    setQ("");
    setEditingId(null);
    setEditError(null);
  }
  useDismiss(rootRef, open, close);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  const cats = useMemo(
    () =>
      [...categories]
        .sort((a, b) => a.display_order - b.display_order)
        .map((c) => ({ ...c, ...patched[c.id] })),
    [categories, patched],
  );
  const current = cats.find((c) => c.id === value);

  const groups = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = needle
      ? cats.filter(
          (c) =>
            c.name.toLowerCase().includes(needle) ||
            (c.name_he ?? "").toLowerCase().includes(needle),
        )
      : cats;
    const m = new Map<string, Category[]>();
    for (const c of filtered) {
      const arr = m.get(c.group) ?? [];
      arr.push(c);
      m.set(c.group, arr);
    }
    return [...m.entries()];
  }, [cats, q]);

  function startEdit(c: Category) {
    setEditingId(c.id);
    setEditError(null);
    setDraft({
      name: c.name,
      name_he: c.name_he ?? "",
      icon: c.icon ?? "",
      color: c.color ?? null,
    });
  }

  function saveEdit(categoryId: string) {
    const patch = {
      name: draft.name.trim(),
      name_he: draft.name_he.trim() || null,
      icon: draft.icon.trim() || null,
      color: draft.color,
    };
    if (!patch.name) {
      setEditError("Name is required");
      return;
    }
    startSaving(async () => {
      const res = await updateCategory(categoryId, patch);
      if (res.error) {
        setEditError(res.error);
        return;
      }
      setPatched((p) => ({ ...p, [categoryId]: patch }));
      setEditingId(null);
      setEditError(null);
      router.refresh();
    });
  }

  function pick(id: string) {
    onSelect(id);
    close();
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        disabled={disabled}
        onClick={() => (open ? close() : setOpen(true))}
        className="flex h-7 max-w-full cursor-pointer items-center gap-1.5 truncate rounded-full border border-transparent bg-active px-2.5 text-[12.5px] font-medium outline-none hover:border-line-strong disabled:opacity-50"
      >
        {current ? (
          <>
            {current.icon ? (
              <span className="text-[12px] leading-none">{current.icon}</span>
            ) : null}
            <span className="truncate" dir="auto">
              {current.name}
            </span>
            {current.name_he ? (
              <span className="truncate text-[12px] font-normal text-muted" dir="auto">
                · {current.name_he}
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-muted">Uncategorized</span>
        )}
      </button>

      {open ? (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-80 w-72 overflow-y-auto rounded-card border border-line bg-card shadow-pop">
          <div className="sticky top-0 z-10 border-b border-line bg-card p-2">
            <div className="relative">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint"
              />
              <input
                ref={searchRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search categories"
                dir="auto"
                className={cn(inputCls, "h-8 pl-7.5 text-[13px]")}
              />
            </div>
          </div>

          <div className="p-1.5">
            <div className="group/citem flex items-center gap-1 rounded-md hover:bg-hover">
              <button
                type="button"
                onClick={() => pick("")}
                className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pl-2 pr-2 text-left"
              >
                <span className="text-[13px] text-muted">Uncategorized</span>
                {!value ? (
                  <Check size={13} className="ml-auto shrink-0 text-accent" />
                ) : null}
              </button>
            </div>

            {groups.length === 0 ? (
              <p className="px-2 py-4 text-center text-[12.5px] text-muted">
                No categories match.
              </p>
            ) : (
              groups.map(([group, list]) => (
                <div key={group}>
                  <div
                    className="px-2 pb-0.5 pt-2 text-[11px] font-medium uppercase tracking-wide text-faint"
                    dir="auto"
                  >
                    {group}
                  </div>
                  {list.map((c) => (
                    <div key={c.id}>
                      <div className="group/citem flex items-center gap-1 rounded-md hover:bg-hover">
                        <button
                          type="button"
                          onClick={() => pick(c.id)}
                          className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pl-2 text-left"
                        >
                          <span className="w-4 shrink-0 text-center text-[13px] leading-none">
                            {c.icon ?? ""}
                          </span>
                          <span className="truncate text-[13px]" dir="auto">
                            {c.name}
                          </span>
                          {c.name_he ? (
                            <span
                              className="truncate text-[12px] text-muted"
                              dir="auto"
                            >
                              {c.name_he}
                            </span>
                          ) : null}
                          {c.id === value ? (
                            <Check
                              size={13}
                              className="ml-auto shrink-0 text-accent"
                            />
                          ) : null}
                        </button>
                        <button
                          type="button"
                          title="Edit category"
                          onClick={(e) => {
                            e.stopPropagation();
                            startEdit(c);
                          }}
                          className="mr-1 shrink-0 cursor-pointer rounded p-1 text-faint opacity-0 hover:text-ink group-hover/citem:opacity-100"
                        >
                          <Ellipsis size={14} />
                        </button>
                      </div>

                      {editingId === c.id ? (
                        <div className="mx-1 mb-1.5 mt-0.5 flex flex-col gap-2 rounded-lg border border-line bg-bg p-2.5">
                          <div className="flex gap-2">
                            <input
                              value={draft.icon}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, icon: e.target.value }))
                              }
                              placeholder="🙂"
                              className={cn(inputCls, "h-8 w-12 px-0 text-center")}
                            />
                            <input
                              value={draft.name}
                              onChange={(e) =>
                                setDraft((d) => ({ ...d, name: e.target.value }))
                              }
                              placeholder="English name"
                              className={cn(inputCls, "h-8 flex-1 text-[13px]")}
                            />
                          </div>
                          <input
                            value={draft.name_he}
                            onChange={(e) =>
                              setDraft((d) => ({ ...d, name_he: e.target.value }))
                            }
                            placeholder="Hebrew name"
                            dir="auto"
                            className={cn(inputCls, "h-8 text-[13px]")}
                          />
                          <div className="flex items-center gap-1.5 px-0.5">
                            {SWATCHES.map((col) => (
                              <button
                                key={col}
                                type="button"
                                title={col}
                                onClick={() =>
                                  setDraft((d) => ({ ...d, color: col }))
                                }
                                style={{ background: col }}
                                className={cn(
                                  "h-5 w-5 cursor-pointer rounded-full transition-transform hover:scale-110",
                                  draft.color === col &&
                                    "ring-2 ring-ink ring-offset-1",
                                )}
                              />
                            ))}
                          </div>
                          {editError ? (
                            <p className="text-[12px] text-neg">{editError}</p>
                          ) : null}
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              className={buttonCls("ghost", "sm")}
                              onClick={() => {
                                setEditingId(null);
                                setEditError(null);
                              }}
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              className={buttonCls("primary", "sm")}
                              disabled={saving}
                              onClick={() => saveEdit(c.id)}
                            >
                              {saving ? "Saving…" : "Save"}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
