"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import {
  adjustPoints,
  createLineLinkToken,
  INITIAL_STATE,
  sendLineMessage,
  updateCustomerProfile,
  type ActionState,
} from "@/app/customers/actions";

function StateMessage({ state }: { state: ActionState }) {
  if (state.status === "idle") return null;
  return (
    <p
      className={`mt-2 rounded-lg px-3 py-2 text-sm ${
        state.status === "success" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"
      }`}
    >
      {state.message}
    </p>
  );
}

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/** LINE 連携コードの発行 */
export function LineLinkForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState(createLineLinkToken, INITIAL_STATE);
  return (
    <form action={formAction}>
      <input type="hidden" name="customerId" value={customerId} />
      <p className="mb-3 text-sm text-ink-600">
        連携コードを発行し、お客様に公式アカウントのトークへ送信していただくと紐付けが完了します。
      </p>
      <Submit label="連携コードを発行" pendingLabel="発行中..." />
      <StateMessage state={state} />
    </form>
  );
}

/** LINE 個別メッセージ送信 */
export function LineMessageForm({ customerId, disabled }: { customerId: string; disabled: boolean }) {
  const [state, formAction] = useActionState(sendLineMessage, INITIAL_STATE);

  if (disabled) {
    return (
      <p className="text-sm text-ink-400">
        LINE 未連携のため送信できません。先に連携コードを発行してください。
      </p>
    );
  }

  return (
    <form action={formAction}>
      <input type="hidden" name="customerId" value={customerId} />
      <textarea
        name="body"
        rows={4}
        required
        placeholder="お取り置きのご連絡や、新作入荷のご案内など"
        className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
      />
      <div className="mt-2">
        <Submit label="LINE で送信" pendingLabel="送信中..." />
      </div>
      <StateMessage state={state} />
    </form>
  );
}

/** 接客メモ・好みタグ */
export function ProfileForm({
  customerId,
  note,
  tags,
}: {
  customerId: string;
  note: string | null;
  tags: string | null;
}) {
  const [state, formAction] = useActionState(updateCustomerProfile, INITIAL_STATE);
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="customerId" value={customerId} />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-400">好みタグ (カンマ区切り)</span>
        <input
          name="tags"
          defaultValue={tags ?? ""}
          placeholder="きれいめ, モノトーン, Mサイズ"
          className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-400">接客メモ</span>
        <textarea
          name="note"
          rows={4}
          defaultValue={note ?? ""}
          placeholder="サイズ感の好み、来店のきっかけ、ご家族構成など"
          className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
        />
      </label>
      <Submit label="保存する" pendingLabel="保存中..." />
      <StateMessage state={state} />
    </form>
  );
}

/** ポイントの手動調整 */
export function PointAdjustForm({ customerId }: { customerId: string }) {
  const [state, formAction] = useActionState(adjustPoints, INITIAL_STATE);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="customerId" value={customerId} />
      <label className="flex flex-col gap-1">
        <span className="text-xs text-ink-400">増減ポイント</span>
        <input
          name="points"
          type="number"
          required
          defaultValue={100}
          className="tabular w-32 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
        />
      </label>
      <label className="flex flex-1 flex-col gap-1">
        <span className="text-xs text-ink-400">理由</span>
        <input
          name="note"
          placeholder="お詫び付与 / 有効期限切れ など"
          className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
        />
      </label>
      <Submit label="調整する" pendingLabel="処理中..." />
      <div className="w-full">
        <StateMessage state={state} />
      </div>
    </form>
  );
}
