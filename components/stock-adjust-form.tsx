"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { MULTI_STORE } from "@/lib/config";

import { adjustStock, type AdjustState } from "@/app/(app)/inventory/actions";
import { ScanButton } from "@/components/barcode-scanner";

const INITIAL: AdjustState = { status: "idle", message: "" };

const TYPES = [
  { value: "INBOUND", label: "入荷 (差分で加算)" },
  { value: "ADJUSTMENT", label: "在庫調整 (差分。マイナス可)" },
  { value: "STOCKTAKE", label: "棚卸 (実棚数で上書き)" },
];

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
    >
      {pending ? "登録中..." : "登録する"}
    </button>
  );
}

export function StockAdjustForm({
  stores,
  staff,
  sku,
  onSkuChange,
}: {
  stores: { id: string; name: string }[];
  staff: { id: string; name: string; storeId: string | null }[];
  /** 指定すると SKU 入力を外部制御にする (在庫一覧のラジオ選択から流し込む用) */
  sku?: string;
  onSkuChange?: (next: string) => void;
}) {
  const [state, formAction] = useActionState(adjustStock, INITIAL);
  const [internalSku, setInternalSku] = useState("");
  const skuValue = sku ?? internalSku;
  const setSkuValue = onSkuChange ?? setInternalSku;

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {/* 単店舗運用では店舗選択を出さず、先頭の店舗へ登録する */}
        {MULTI_STORE ? (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">店舗</span>
            <select
              name="storeId"
              required
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <input type="hidden" name="storeId" value={stores[0]?.id ?? ""} />
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">区分</span>
          <select
            name="type"
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
          >
            {TYPES.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">SKU / JANコード</span>
          <span className="flex gap-2">
            <input
              name="skuOrBarcode"
              required
              placeholder="26SS-SH-001-BLK-M"
              autoComplete="off"
              value={skuValue}
              onChange={(event) => setSkuValue(event.target.value)}
              className="tabular w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
            <ScanButton onDetect={setSkuValue} />
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">数量</span>
          <input
            name="quantity"
            type="number"
            required
            defaultValue={1}
            className="tabular rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">担当スタッフ (任意)</span>
          <select
            name="staffId"
            defaultValue=""
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
          >
            <option value="">指定なし</option>
            {staff.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">理由 (任意)</span>
          <input
            name="reason"
            placeholder="追加入荷分 / 検品不良 など"
            className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
          />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <SubmitButton />
        {state.status !== "idle" && (
          <p
            className={`text-sm ${state.status === "success" ? "text-emerald-700" : "text-rose-700"}`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}
