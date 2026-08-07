"use client";

import { useState, useTransition } from "react";

import { runRemindersNow, updateReminderRule } from "@/app/settings/reminder-actions";

type RuleView = {
  key: "PURCHASE_FOLLOW" | "REVISIT" | "DORMANT" | "BIRTHDAY";
  label: string;
  description: string;
  enabled: boolean;
  days: number;
  daysEditable: boolean;
  /** 直近の送信件数 (テンプレートごとの送信ログ数) */
  sentCount: number;
};

type RunResult = {
  key: string;
  label: string;
  enabled: boolean;
  targeted: number;
  sent: number;
  failed: number;
};

function Toggle({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${
        checked ? "bg-emerald-600" : "bg-ink-200"
      }`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
          checked ? "left-[22px]" : "left-0.5"
        }`}
      />
    </button>
  );
}

function RuleRow({ rule, index }: { rule: RuleView; index: number }) {
  const [enabled, setEnabled] = useState(rule.enabled);
  const [days, setDays] = useState(rule.days);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const save = (next: { enabled?: boolean; days?: number }) =>
    startTransition(async () => {
      setError(null);
      const payload = { key: rule.key, enabled: next.enabled ?? enabled, days: next.days ?? days };
      const result = await updateReminderRule(payload);
      if (!result.ok) {
        setError(result.error ?? "保存に失敗しました");
        // 失敗したら表示を元に戻す
        setEnabled(rule.enabled);
        setDays(rule.days);
      }
    });

  return (
    <li className="flex items-start gap-3 px-4 py-3.5">
      <span className="tabular mt-0.5 shrink-0 rounded-md bg-ink-100 px-2 py-0.5 text-xs font-semibold text-ink-600">
        R{index + 1}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink-900">{rule.label}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-500">{rule.description}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {rule.daysEditable && (
            <label className="flex items-center gap-1 text-xs text-ink-500">
              経過日数
              <input
                type="number"
                min={1}
                max={730}
                value={days}
                disabled={pending}
                onChange={(event) => setDays(Number(event.target.value) || 1)}
                onBlur={() => days !== rule.days && save({ days })}
                className="tabular w-16 rounded-md border border-ink-200 px-1.5 py-0.5 text-right text-xs outline-none focus:border-ink-400"
              />
              日
            </label>
          )}
          {rule.sentCount > 0 && (
            <span className="tabular text-xs text-ink-400">累計送信 {rule.sentCount} 件</span>
          )}
          {error && <span className="text-xs text-rose-700">{error}</span>}
        </div>
      </div>
      <span className="mt-0.5 shrink-0 rounded-md bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        LINE
      </span>
      <Toggle
        checked={enabled}
        disabled={pending}
        label={`${rule.label}を有効にする`}
        onChange={(next) => {
          setEnabled(next);
          save({ enabled: next });
        }}
      />
    </li>
  );
}

/**
 * LINE 自動リマインドの設定 (店舗全体)。
 * 有効にしたルールは毎日 10:00 (JST) に条件を満たした顧客へ自動送信される。
 */
export function ReminderSettings({ rules }: { rules: RuleView[] }) {
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, startRunning] = useTransition();

  const runNow = () =>
    startRunning(async () => {
      setError(null);
      const result = await runRemindersNow();
      if (result.ok && result.results) {
        setResults(result.results);
      } else {
        setError(result.error ?? "実行に失敗しました");
      }
    });

  return (
    <div>
      <p className="mb-3 text-sm text-ink-600">
        店舗全体の自動配信設定です。条件を満たしたお客様へ LINE で自動送信されます
        (毎日 10:00 JST)。お客様ごとの停止は各顧客詳細の「自動リマインドを停止」で変更できます。
      </p>
      <ul className="divide-y divide-ink-100 rounded-lg border border-ink-100">
        {rules.map((rule, index) => (
          <RuleRow key={rule.key} rule={rule} index={index} />
        ))}
      </ul>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
        >
          {running ? "実行中..." : "今すぐ実行して確認"}
        </button>
        <span className="text-xs text-ink-400">
          有効なルールをその場で評価します (二重送信は自動で防止されます)
        </span>
      </div>
      {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
      {results && (
        <div className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-600">
          {results.map((result) => (
            <p key={result.key} className="tabular">
              {result.label}:{" "}
              {result.enabled
                ? `対象 ${result.targeted} 名 / 送信 ${result.sent} / 失敗・スキップ ${result.failed}`
                : "無効"}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
