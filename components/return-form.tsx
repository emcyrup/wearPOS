"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import { returnSale } from "@/app/(app)/sales/[id]/actions";
import { Card } from "@/components/ui";
import { formatYen } from "@/lib/format";
import {
  calcReturnAmounts,
  refundByOriginalPayments,
  type ReturnableLine,
  type ReturnedTotals,
  type SaleTotals,
} from "@/lib/return-calc";

type RefundRow = { key: string; method: string; amount: string };

let refundKeySeq = 0;
const newRefundKey = () => `refund-${refundKeySeq++}`;

/**
 * 返品の入力フォーム。
 * 明細ごとに返す点数を決め、返金の内訳 (元の支払い方法どおり / 指定) を選べる。
 * 金額はサーバーと同じ計算 (lib/return-calc.ts) をその場で回してプレビューする。
 */
export function ReturnForm({
  saleId,
  sale,
  state,
  paymentMethods,
  originalPayments,
  fallbackMethod,
}: {
  saleId: string;
  sale: SaleTotals;
  state: { lines: ReturnableLine[]; returned: ReturnedTotals };
  paymentMethods: { code: string; label: string }[];
  originalPayments: { method: string; amount: number }[];
  fallbackMethod: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // 既定は「返せるものをすべて返す」= これまでの伝票まるごとの返品と同じ挙動
  const [quantities, setQuantities] = useState<Record<string, number>>(() =>
    Object.fromEntries(state.lines.map((line) => [line.lineId, line.returnableQuantity])),
  );
  const [refundMode, setRefundMode] = useState<"ORIGINAL" | "CUSTOM">("ORIGINAL");
  const [refundRows, setRefundRows] = useState<RefundRow[]>([]);

  const calculated = useMemo(
    () =>
      calcReturnAmounts(
        sale,
        state,
        state.lines.map((line) => ({ lineId: line.lineId, quantity: quantities[line.lineId] ?? 0 })),
      ),
    [sale, state, quantities],
  );
  const amounts = calculated.ok ? calculated.amounts : null;

  const autoRefund = useMemo(
    () =>
      amounts
        ? refundByOriginalPayments(originalPayments, fallbackMethod, amounts.refundNet)
        : [],
    [amounts, originalPayments, fallbackMethod],
  );

  const labelOf = (code: string) =>
    paymentMethods.find((method) => method.code === code)?.label ?? code;

  const customTotal = refundRows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const customRemaining = (amounts?.refundNet ?? 0) - customTotal;
  const refundReady = refundMode === "ORIGINAL" || customRemaining === 0;

  const setQuantity = (lineId: string, value: number, max: number) =>
    setQuantities((prev) => ({ ...prev, [lineId]: Math.max(0, Math.min(max, value)) }));

  /** 「返金方法を指定する」へ切り替えたら、按分の結果を初期値として入れておく */
  const enableCustomRefund = () => {
    setRefundMode("CUSTOM");
    setRefundRows(
      autoRefund.length > 0
        ? autoRefund.map((row) => ({
            key: newRefundKey(),
            method: row.method,
            amount: String(row.amount),
          }))
        : [{ key: newRefundKey(), method: paymentMethods[0]?.code ?? "CASH", amount: "" }],
    );
  };

  const submit = () => {
    if (!amounts || pending) return;
    const refunds =
      refundMode === "CUSTOM"
        ? refundRows
            .map((row) => ({ method: row.method, amount: Number(row.amount) || 0 }))
            .filter((row) => row.amount > 0)
        : undefined;

    const ok = window.confirm(
      `${amounts.itemCount} 点を返品します。\n返金額 ${formatYen(amounts.refundNet)}${
        amounts.pointsRefunded > 0 ? `（ほかにポイント ${amounts.pointsRefunded} pt を返還）` : ""
      }\n在庫の戻し入れと会員実績の巻き戻しを行います。よろしいですか？`,
    );
    if (!ok) return;

    startTransition(async () => {
      const result = await returnSale({
        saleId,
        lines: state.lines.map((line) => ({
          lineId: line.lineId,
          quantity: quantities[line.lineId] ?? 0,
        })),
        refunds,
      });
      if (result.ok) {
        setError(null);
        router.push(`/sales/${result.returnSaleId}`);
        router.refresh();
      } else {
        setError(result.error);
      }
    });
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="返品する商品と点数" className="lg:col-span-2">
        <div className="space-y-2">
          {state.lines.map((line) => {
            const max = line.returnableQuantity;
            const value = quantities[line.lineId] ?? 0;
            return (
              <div
                key={line.lineId}
                className={`rounded-lg border p-3 ${
                  max === 0 ? "border-ink-100 bg-ink-50/60" : "border-ink-200"
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-ink-800">{line.name}</span>
                    <span className="mt-0.5 block text-xs text-ink-400">
                      {line.sku ? `${line.sku} · ` : ""}
                      {line.colorName ? `${line.colorName} / ${line.sizeName} · ` : ""}
                      {formatYen(line.unitPrice)} × {line.quantity} 点
                      {line.returnedQuantity > 0 && (
                        <span className="ml-1 text-amber-700">
                          （返品済み {line.returnedQuantity} 点）
                        </span>
                      )}
                    </span>
                  </span>

                  {max === 0 ? (
                    <span className="text-xs font-medium text-ink-400">返品済み</span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`${line.name} の返品数量を減らす`}
                        onClick={() => setQuantity(line.lineId, value - 1, max)}
                        className="h-8 w-8 rounded-lg border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min={0}
                        max={max}
                        value={value}
                        aria-label={`${line.name} の返品数量`}
                        onChange={(event) =>
                          setQuantity(line.lineId, Number(event.target.value) || 0, max)
                        }
                        className="tabular w-16 rounded-lg border border-ink-200 px-2 py-1.5 text-center text-sm outline-none focus:border-ink-400"
                      />
                      <button
                        type="button"
                        aria-label={`${line.name} の返品数量を増やす`}
                        onClick={() => setQuantity(line.lineId, value + 1, max)}
                        className="h-8 w-8 rounded-lg border border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                      >
                        ＋
                      </button>
                      <span className="text-xs whitespace-nowrap text-ink-400">/ {max} 点</span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              setQuantities(
                Object.fromEntries(
                  state.lines.map((line) => [line.lineId, line.returnableQuantity]),
                ),
              )
            }
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            すべて返品する
          </button>
          <button
            type="button"
            onClick={() =>
              setQuantities(Object.fromEntries(state.lines.map((line) => [line.lineId, 0])))
            }
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
          >
            選択をクリア
          </button>
        </div>
      </Card>

      <div className="space-y-4">
        <Card title="返金額">
          <dl className="space-y-2.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">返品点数</dt>
              <dd className="tabular">{amounts?.itemCount ?? 0} 点</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">小計 (税抜)</dt>
              <dd className="tabular">{formatYen(amounts?.subtotal ?? 0)}</dd>
            </div>
            {(amounts?.discount ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">伝票値引きの戻し</dt>
                <dd className="tabular text-accent">-{formatYen(amounts?.discount ?? 0)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-400">消費税</dt>
              <dd className="tabular">{formatYen(amounts?.tax ?? 0)}</dd>
            </div>
            <div className="flex justify-between border-t border-ink-200 pt-2.5 text-base font-semibold">
              <dt>返品額 (税込)</dt>
              <dd className="tabular">{formatYen(amounts?.total ?? 0)}</dd>
            </div>
            {(amounts?.pointsRefunded ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">ポイントで返還</dt>
                <dd className="tabular text-emerald-700">
                  {amounts?.pointsRefunded ?? 0} pt
                </dd>
              </div>
            )}
            {(amounts?.pointsRevoked ?? 0) > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">取り消す獲得ポイント</dt>
                <dd className="tabular text-rose-700">-{amounts?.pointsRevoked ?? 0} pt</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-ink-100 pt-2.5 font-medium">
              <dt>お客様へお返しする額</dt>
              <dd className="tabular">{formatYen(amounts?.refundNet ?? 0)}</dd>
            </div>
          </dl>
          {amounts && !amounts.isFinal && (
            <p className="mt-3 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
              一部返品です。残りは後日あらためて返品できます。
            </p>
          )}
        </Card>

        <Card title="返金の方法">
          <div className="space-y-2">
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 p-3 text-sm">
              <input
                type="radio"
                name="refundMode"
                checked={refundMode === "ORIGINAL"}
                onChange={() => setRefundMode("ORIGINAL")}
                className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
              />
              <span className="min-w-0">
                <span className="block font-medium text-ink-800">元の支払い方法どおりに返す</span>
                <span className="mt-1 block text-xs text-ink-400">
                  {autoRefund.length > 0
                    ? autoRefund
                        .map((row) => `${labelOf(row.method)} ${formatYen(row.amount)}`)
                        .join(" ／ ")
                    : "返金額がありません"}
                </span>
              </span>
            </label>

            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-ink-200 p-3 text-sm">
              <input
                type="radio"
                name="refundMode"
                checked={refundMode === "CUSTOM"}
                onChange={enableCustomRefund}
                className="mt-0.5 h-4 w-4 shrink-0 accent-ink-900"
              />
              <span className="min-w-0">
                <span className="block font-medium text-ink-800">返金方法を指定する</span>
                <span className="mt-0.5 block text-xs text-ink-400">
                  クレジットの取消ができないときに現金で返す、などの場合に使います
                </span>
              </span>
            </label>
          </div>

          {refundMode === "CUSTOM" && (
            <div className="mt-3 space-y-2">
              {refundRows.map((row, index) => (
                <div key={row.key} className="flex flex-wrap items-center gap-2">
                  <select
                    value={row.method}
                    aria-label={`返金${index + 1} の支払方法`}
                    onChange={(event) =>
                      setRefundRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, method: event.target.value } : r,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400"
                  >
                    {paymentMethods.map((method) => (
                      <option key={method.code} value={method.code}>
                        {method.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={0}
                    value={row.amount}
                    aria-label={`返金${index + 1} の金額`}
                    onChange={(event) =>
                      setRefundRows((prev) =>
                        prev.map((r) =>
                          r.key === row.key ? { ...r, amount: event.target.value } : r,
                        ),
                      )
                    }
                    className="tabular w-28 rounded-lg border border-ink-200 px-2.5 py-1.5 text-right text-sm outline-none focus:border-ink-400"
                  />
                  <button
                    type="button"
                    aria-label={`返金${index + 1} を削除`}
                    onClick={() => setRefundRows((prev) => prev.filter((r) => r.key !== row.key))}
                    className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-sm text-ink-500 hover:bg-ink-50"
                  >
                    ×
                  </button>
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setRefundRows((prev) => [
                      ...prev,
                      {
                        key: newRefundKey(),
                        method: paymentMethods[0]?.code ?? "CASH",
                        amount: String(Math.max(0, customRemaining)),
                      },
                    ])
                  }
                  className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
                >
                  + 返金先を追加
                </button>
                <span
                  className={`tabular text-xs ${
                    customRemaining === 0 ? "text-emerald-700" : "text-rose-700"
                  }`}
                >
                  {customRemaining === 0
                    ? "内訳が返金額と一致しています"
                    : customRemaining > 0
                      ? `あと ${formatYen(customRemaining)}`
                      : `${formatYen(-customRemaining)} 超過`}
                </span>
              </div>
            </div>
          )}
        </Card>

        {(error || !calculated.ok) && (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">
            {error ?? (calculated.ok ? "" : calculated.error)}
          </p>
        )}

        <button
          type="button"
          onClick={submit}
          disabled={pending || !amounts || !refundReady}
          className="w-full rounded-xl bg-rose-700 px-4 py-3 text-base font-semibold text-white hover:bg-rose-800 disabled:opacity-40"
        >
          {pending ? "返品処理中..." : `${amounts?.itemCount ?? 0} 点を返品する`}
        </button>
      </div>
    </div>
  );
}
