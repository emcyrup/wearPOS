"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { returnSale } from "@/app/(app)/sales/[id]/actions";

/**
 * 伝票詳細の「返品する」ボタン。
 * 確認ダイアログを挟んでから返品処理 (在庫戻し・ポイント巻き戻し) を実行する。
 */
export function ReturnSaleButton({ saleId, receiptNo }: { saleId: string; receiptNo: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const handleClick = () => {
    const ok = window.confirm(
      `伝票 ${receiptNo} を返品します。\n在庫の戻し入れと、会員のポイント・購入実績の巻き戻しを行います。よろしいですか？`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await returnSale(saleId);
      if (result.ok) {
        setError(null);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <span className="flex items-center gap-2">
      {error && <span className="text-xs text-rose-700">{error}</span>}
      <button
        type="button"
        onClick={handleClick}
        disabled={pending}
        className="rounded-lg border border-rose-200 bg-white px-3.5 py-1.5 text-sm font-medium whitespace-nowrap text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        {pending ? "返品処理中..." : "返品する"}
      </button>
    </span>
  );
}
