"use client";

import { useActionState, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";

import {
  adjustPoints,
  createLineLinkToken,
  draftRecommendMessage,
  draftRevisitMessage,
  saveCustomerReminderSettings,
  sendLineMessage,
  updateCustomerProfile,
  type ActionState,
} from "@/app/customers/actions";

const INITIAL_STATE: ActionState = { status: "idle", message: "" };

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

/** LINE 個別メッセージ送信。再来店・おすすめ商品の下書きを自動生成できる */
export function LineMessageForm({ customerId, disabled }: { customerId: string; disabled: boolean }) {
  const [state, formAction] = useActionState(sendLineMessage, INITIAL_STATE);
  const [body, setBody] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);
  const [drafting, startDrafting] = useTransition();

  if (disabled) {
    return (
      <p className="text-sm text-ink-400">
        LINE 未連携のため送信できません。先に連携コードを発行してください。
      </p>
    );
  }

  const applyDraft = (kind: "revisit" | "recommend") =>
    startDrafting(async () => {
      setDraftError(null);
      const result =
        kind === "revisit"
          ? await draftRevisitMessage(customerId)
          : await draftRecommendMessage(customerId);
      if (result.ok && result.draft) {
        setBody(result.draft);
      } else {
        setDraftError(result.error ?? "下書きを作成できませんでした");
      }
    });

  return (
    <form action={formAction}>
      <input type="hidden" name="customerId" value={customerId} />
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-400">文面を作成:</span>
        <button
          type="button"
          disabled={drafting}
          onClick={() => applyDraft("revisit")}
          className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-50"
        >
          再来店の呼びかけ
        </button>
        <button
          type="button"
          disabled={drafting}
          onClick={() => applyDraft("recommend")}
          className="rounded-lg border border-ink-200 bg-white px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50 disabled:opacity-50"
        >
          おすすめ商品の提案
        </button>
        {drafting && <span className="text-xs text-ink-400">作成中...</span>}
      </div>
      {draftError && <p className="mb-2 text-xs text-rose-700">{draftError}</p>}
      <textarea
        name="body"
        rows={8}
        required
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="お取り置きのご連絡や、新作入荷のご案内など。上のボタンで購買傾向に合わせた下書きを作れます"
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

export type CustomerReminderRule = {
  key: string;
  label: string;
  /** 店舗全体設定で有効になっているか */
  globalEnabled: boolean;
};

/**
 * このお客様へのリマインド設定。
 * 店舗全体の設定 (設定 → リマインド設定) をベースに、お客様ごとにルール単位で停止できる。
 */
export function CustomerReminderSettings({
  customerId,
  optOut,
  disabledKeys,
  rules,
}: {
  customerId: string;
  optOut: boolean;
  disabledKeys: string[];
  rules: CustomerReminderRule[];
}) {
  const [currentOptOut, setCurrentOptOut] = useState(optOut);
  const [disabled, setDisabled] = useState<string[]>(disabledKeys);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: { optOut?: boolean; disabledKeys?: string[] }) =>
    startTransition(async () => {
      setError(null);
      const payload = {
        customerId,
        optOut: next.optOut ?? currentOptOut,
        disabledKeys: next.disabledKeys ?? disabled,
      };
      const result = await saveCustomerReminderSettings(payload);
      if (!result.ok) {
        setError(result.error ?? "保存に失敗しました");
        setCurrentOptOut(optOut);
        setDisabled(disabledKeys);
      }
    });

  const toggleRule = (key: string, enabled: boolean) => {
    const next = enabled ? disabled.filter((k) => k !== key) : [...disabled, key];
    setDisabled(next);
    save({ disabledKeys: next });
  };

  return (
    <div className="space-y-2">
      {rules.map((rule) => {
        const on = !disabled.includes(rule.key);
        const effective = on && !currentOptOut && rule.globalEnabled;
        return (
          <label
            key={rule.key}
            className={`flex items-center justify-between gap-3 text-sm ${
              currentOptOut ? "opacity-50" : ""
            }`}
          >
            <span className="flex items-center gap-2 text-ink-700">
              <input
                type="checkbox"
                checked={on}
                disabled={pending || currentOptOut}
                onChange={(event) => toggleRule(rule.key, event.target.checked)}
                className="h-4 w-4 accent-ink-900"
              />
              {rule.label}
            </span>
            <span className="shrink-0 text-xs text-ink-400">
              {!rule.globalEnabled ? "店舗設定で停止中" : effective ? "配信対象" : "停止中"}
            </span>
          </label>
        );
      })}

      <label className="mt-1 flex items-center gap-2 border-t border-ink-100 pt-2.5 text-sm text-ink-600">
        <input
          type="checkbox"
          checked={currentOptOut}
          disabled={pending}
          onChange={(event) => {
            setCurrentOptOut(event.target.checked);
            save({ optOut: event.target.checked });
          }}
          className="h-4 w-4 accent-ink-900"
        />
        すべての自動リマインドを停止する
        <span className="text-xs text-ink-400">(購入通知・手動送信は対象外)</span>
      </label>
      {error && <p className="text-xs text-rose-700">{error}</p>}
    </div>
  );
}
