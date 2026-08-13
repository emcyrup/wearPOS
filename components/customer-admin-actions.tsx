"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteCustomer, unlinkCustomerLine } from "@/app/customers/actions";

/** 顧客詳細ページの削除ボタン。履歴の有無で削除 / 無効化が変わる */
export function CustomerDeleteButton({
  customerId,
  name,
  hasSales,
}: {
  customerId: string;
  name: string;
  hasSales: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    const message = hasSales
      ? `${name} 様には購入履歴があるため、削除の代わりに無効化されます (一覧や配信対象から外れます)。よろしいですか？`
      : `${name} 様を削除しますか？ポイントや LINE 連携も削除され、元に戻せません。`;
    if (!window.confirm(message)) return;
    startTransition(async () => {
      const result = await deleteCustomer(customerId);
      if (result.status === "error") {
        setError(result.message);
        return;
      }
      router.push("/customers");
    });
  };

  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center rounded-lg border border-rose-200 bg-white px-3 py-1.5 text-sm font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        {pending ? "処理中..." : hasSales ? "顧客を無効化" : "顧客を削除"}
      </button>
      {error && <span className="mt-1 text-xs text-rose-700">{error}</span>}
    </span>
  );
}

/** 店側からの LINE 連携解除ボタン */
export function LineUnlinkButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const run = () => {
    if (
      !window.confirm(
        "LINE 連携を解除しますか？お買い上げ通知やリマインドは届かなくなります。再連携には連携コードの再発行が必要です。",
      )
    )
      return;
    startTransition(async () => {
      const result = await unlinkCustomerLine(customerId);
      setMessage(result.message);
      if (result.status === "success") router.refresh();
    });
  };

  return (
    <div>
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
      >
        {pending ? "処理中..." : "LINE 連携を解除"}
      </button>
      {message && <p className="mt-1.5 text-xs text-ink-500">{message}</p>}
    </div>
  );
}
