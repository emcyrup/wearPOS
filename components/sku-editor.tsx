"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { updateVariantSku } from "@/app/(app)/products/[id]/actions";

/**
 * SKU 一覧の SKU コードをその場で書き換える小さなエディタ。
 * 管理者のみ編集ボタンを表示する (canEdit)。
 */
export function SkuEditor({
  variantId,
  sku,
  canEdit,
}: {
  variantId: string;
  sku: string;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(sku);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!canEdit) {
    return <span className="tabular text-xs text-ink-600">{sku}</span>;
  }

  if (!editing) {
    return (
      <span className="flex items-center gap-1.5">
        <span className="tabular text-xs text-ink-600">{sku}</span>
        <button
          type="button"
          aria-label={`SKU ${sku} を変更`}
          onClick={() => {
            setValue(sku);
            setError(null);
            setEditing(true);
          }}
          className="rounded px-1.5 py-1 text-xs text-ink-400 hover:bg-ink-100 hover:text-ink-600"
        >
          ✎
        </button>
      </span>
    );
  }

  const save = () => {
    startTransition(async () => {
      const result = await updateVariantSku({ variantId, sku: value });
      if (result.ok) {
        setEditing(false);
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <span className="flex flex-col gap-1">
      <span className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              save();
            }
            if (event.key === "Escape") setEditing(false);
          }}
          autoFocus
          aria-label="SKU コード"
          className="tabular w-40 rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-ink-400"
        />
        <button
          type="button"
          onClick={save}
          disabled={pending || !value.trim()}
          className="rounded bg-ink-900 px-2 py-1 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {pending ? "保存中..." : "保存"}
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="rounded px-1.5 py-1 text-xs text-ink-400 hover:text-ink-600"
        >
          取消
        </button>
      </span>
      {error && <span className="text-xs text-rose-700">{error}</span>}
    </span>
  );
}
