"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { saveHiddenSections } from "@/app/dashboard-actions";
import { DASHBOARD_SECTIONS } from "@/lib/dashboard";

/**
 * ダッシュボードの表示項目カスタマイズ。
 * チェックを外したセクションはユーザーごとに非表示として保存される。
 */
export function DashboardCustomizer({ hidden }: { hidden: string[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hiddenKeys, setHiddenKeys] = useState<string[]>(hidden);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // パネル外クリックで閉じる
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const toggle = (key: string, visible: boolean) =>
    setHiddenKeys((prev) => (visible ? prev.filter((k) => k !== key) : [...prev, key]));

  const save = () =>
    startTransition(async () => {
      setError(null);
      const result = await saveHiddenSections(hiddenKeys);
      if (!result.ok) {
        setError(result.error ?? "保存に失敗しました");
        return;
      }
      setOpen(false);
      router.refresh();
    });

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-ink-200 bg-white px-3 py-1 text-sm text-ink-600 hover:bg-ink-50"
      >
        表示項目
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-1.5 w-64 rounded-xl border border-ink-200 bg-white p-3 shadow-lg">
          <p className="mb-2 text-xs font-medium text-ink-400">表示するセクション</p>
          <div className="space-y-1.5">
            {DASHBOARD_SECTIONS.map((section) => (
              <label key={section.key} className="flex items-center gap-2 text-sm text-ink-700">
                <input
                  type="checkbox"
                  checked={!hiddenKeys.includes(section.key)}
                  onChange={(event) => toggle(section.key, event.target.checked)}
                  className="h-4 w-4 accent-ink-900"
                />
                {section.label}
              </label>
            ))}
          </div>
          {error && <p className="mt-2 text-xs text-rose-700">{error}</p>}
          <button
            type="button"
            onClick={save}
            disabled={pending}
            className="mt-3 w-full rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {pending ? "保存中..." : "保存"}
          </button>
        </div>
      )}
    </div>
  );
}
