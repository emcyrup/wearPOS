"use client";

import { useState, useTransition } from "react";

import {
  addPaymentMethod,
  deletePaymentMethod,
  movePaymentMethod,
  updatePaymentMethod,
  type PaymentMethodActionState,
} from "@/app/(app)/settings/payment-method-actions";
import { Badge } from "@/components/ui";

export type ManagedPaymentMethod = {
  code: string;
  label: string;
  allowSplit: boolean;
  allowChange: boolean;
  isBuiltin: boolean;
  isActive: boolean;
  /** この支払方法が使われている取引の件数 */
  usedCount: number;
};

const inputClass =
  "rounded-lg border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-ink-400";

const IDLE: PaymentMethodActionState = { status: "idle", message: "" };

/** 1行ぶんの編集フォーム。変更があったときだけ保存ボタンを出す */
function MethodRow({
  method,
  index,
  total,
  pending,
  run,
}: {
  method: ManagedPaymentMethod;
  index: number;
  total: number;
  pending: boolean;
  run: (fn: () => Promise<PaymentMethodActionState>) => void;
}) {
  const [label, setLabel] = useState(method.label);
  const [allowSplit, setAllowSplit] = useState(method.allowSplit);
  const [allowChange, setAllowChange] = useState(method.allowChange);
  const [isActive, setIsActive] = useState(method.isActive);

  const dirty =
    label !== method.label ||
    allowSplit !== method.allowSplit ||
    allowChange !== method.allowChange ||
    isActive !== method.isActive;

  return (
    <div className="rounded-lg border border-ink-200 p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="flex shrink-0 flex-col">
          <button
            type="button"
            onClick={() => run(() => movePaymentMethod(method.code, "up"))}
            disabled={pending || index === 0}
            aria-label={`${method.label} を上へ`}
            className="h-4 w-5 text-[10px] leading-none text-ink-400 hover:text-ink-900 disabled:opacity-20"
          >
            ▲
          </button>
          <button
            type="button"
            onClick={() => run(() => movePaymentMethod(method.code, "down"))}
            disabled={pending || index === total - 1}
            aria-label={`${method.label} を下へ`}
            className="h-4 w-5 text-[10px] leading-none text-ink-400 hover:text-ink-900 disabled:opacity-20"
          >
            ▼
          </button>
        </span>

        <input
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          aria-label={`${method.code} の名称`}
          className={`${inputClass} w-32 sm:w-40`}
        />
        <span className="tabular text-xs text-ink-400">{method.code}</span>
        {method.isBuiltin ? (
          <Badge tone="neutral">組み込み</Badge>
        ) : (
          <Badge tone="info">追加</Badge>
        )}
        {method.usedCount > 0 && (
          <span className="text-xs text-ink-400">{method.usedCount} 件で使用中</span>
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(event) => setIsActive(event.target.checked)}
            className="h-4 w-4 accent-ink-900"
          />
          レジに表示
        </label>
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600">
          <input
            type="checkbox"
            checked={allowSplit}
            onChange={(event) => setAllowSplit(event.target.checked)}
            className="h-4 w-4 accent-ink-900"
          />
          分割決済に使える
        </label>
        <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600">
          <input
            type="checkbox"
            checked={allowChange}
            onChange={(event) => setAllowChange(event.target.checked)}
            className="h-4 w-4 accent-ink-900"
          />
          お釣りを出せる
        </label>

        <span className="ml-auto flex items-center gap-2">
          {dirty && (
            <button
              type="button"
              onClick={() =>
                run(() =>
                  updatePaymentMethod({
                    code: method.code,
                    label,
                    allowSplit,
                    allowChange,
                    isActive,
                  }),
                )
              }
              disabled={pending || !label.trim()}
              className="rounded-lg bg-ink-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              保存
            </button>
          )}
          {!method.isBuiltin && (
            <button
              type="button"
              onClick={() => {
                const warn =
                  method.usedCount > 0
                    ? `「${method.label}」は ${method.usedCount} 件の取引で使われています。過去の伝票の表示を保つため、削除せずレジ非表示にします。よろしいですか？`
                    : `支払方法「${method.label}」を削除しますか？`;
                if (!window.confirm(warn)) return;
                run(() => deletePaymentMethod(method.code));
              }}
              disabled={pending}
              className="rounded-lg border border-ink-200 bg-white px-2.5 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-40"
            >
              削除
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

/**
 * レジの支払方法の管理。
 * 組み込みの5種に加えて、ギフト券・商品券などを店舗ごとに追加できる。
 */
export function PaymentMethodSettings({ methods }: { methods: ManagedPaymentMethod[] }) {
  const [feedback, setFeedback] = useState<PaymentMethodActionState>(IDLE);
  const [pending, startTransition] = useTransition();
  const [newCode, setNewCode] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [newAllowSplit, setNewAllowSplit] = useState(true);
  const [newAllowChange, setNewAllowChange] = useState(false);

  const run = (fn: () => Promise<PaymentMethodActionState>) =>
    startTransition(async () => setFeedback(await fn()));

  return (
    <div>
      <div className="space-y-2">
        {methods.map((method, index) => (
          <MethodRow
            key={`${method.code}-${method.label}-${method.isActive}-${method.allowSplit}-${method.allowChange}`}
            method={method}
            index={index}
            total={methods.length}
            pending={pending}
            run={run}
          />
        ))}
      </div>

      <form
        className="mt-4 border-t border-ink-100 pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          startTransition(async () => {
            const result = await addPaymentMethod({
              code: newCode.trim().toUpperCase(),
              label: newLabel,
              allowSplit: newAllowSplit,
              allowChange: newAllowChange,
            });
            setFeedback(result);
            if (result.status === "success") {
              setNewCode("");
              setNewLabel("");
              setNewAllowSplit(true);
              setNewAllowChange(false);
            }
          });
        }}
      >
        <p className="mb-2 text-xs font-medium text-ink-400">支払方法を追加</p>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-ink-400">名称</span>
            <input
              value={newLabel}
              onChange={(event) => setNewLabel(event.target.value)}
              placeholder="例: ギフト券"
              className={`${inputClass} w-full sm:w-40`}
            />
          </label>
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
            <span className="text-xs text-ink-400">コード (半角英大文字)</span>
            <input
              value={newCode}
              onChange={(event) => setNewCode(event.target.value.toUpperCase())}
              placeholder="例: GIFT_CERT"
              className={`${inputClass} tabular w-full sm:w-44`}
            />
          </label>
          <button
            type="submit"
            disabled={pending || !newCode.trim() || !newLabel.trim()}
            className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            追加
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
          <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600">
            <input
              type="checkbox"
              checked={newAllowSplit}
              onChange={(event) => setNewAllowSplit(event.target.checked)}
              className="h-4 w-4 accent-ink-900"
            />
            分割決済に使える
          </label>
          <label className="flex items-center gap-1.5 text-sm whitespace-nowrap text-ink-600">
            <input
              type="checkbox"
              checked={newAllowChange}
              onChange={(event) => setNewAllowChange(event.target.checked)}
              className="h-4 w-4 accent-ink-900"
            />
            お釣りを出せる
          </label>
        </div>
        <p className="mt-1.5 text-xs text-ink-400">
          コードは伝票に記録される識別子です。後から変更できないため、英大文字で分かりやすい名前を付けてください
          (例: GIFT_CERT / MALL_POINT)。
        </p>
      </form>

      {feedback.status !== "idle" && (
        <p
          className={`mt-2 text-xs ${
            feedback.status === "success" ? "text-emerald-700" : "text-rose-700"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
