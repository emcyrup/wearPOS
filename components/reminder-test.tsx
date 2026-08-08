"use client";

import { useEffect, useState, useTransition } from "react";

import {
  previewReminderMessage,
  searchTestCustomers,
  sendTestReminder,
  type TestCustomer,
} from "@/app/settings/reminder-test-actions";

type RuleOption = { key: string; label: string };

/**
 * リマインドのテスト配信。
 * 顧客とルールを選び、実際に送られる文面のプレビューと本人の LINE へのテスト送信ができる。
 */
export function ReminderTest({ rules }: { rules: RuleOption[] }) {
  const [query, setQuery] = useState("");
  const [customers, setCustomers] = useState<TestCustomer[]>([]);
  const [selected, setSelected] = useState<TestCustomer | null>(null);
  const [ruleKey, setRuleKey] = useState(rules[0]?.key ?? "PURCHASE_FOLLOW");
  const [preview, setPreview] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(
    null,
  );
  const [searching, startSearch] = useTransition();
  const [working, startWork] = useTransition();

  // 初期表示は LINE 連携済みの顧客を出しておく
  useEffect(() => {
    startSearch(async () => {
      setCustomers(await searchTestCustomers(""));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const search = () =>
    startSearch(async () => {
      setCustomers(await searchTestCustomers(query));
    });

  const selectCustomer = (customer: TestCustomer) => {
    setSelected(customer);
    setPreview(null);
    setNotice(null);
  };

  const doPreview = () =>
    startWork(async () => {
      if (!selected) return;
      setNotice(null);
      const result = await previewReminderMessage({ key: ruleKey, customerId: selected.id });
      if (result.ok && result.body) {
        setPreview(result.body);
      } else {
        setPreview(null);
        setNotice({ tone: "error", text: result.error ?? "プレビューに失敗しました" });
      }
    });

  const doSend = () =>
    startWork(async () => {
      if (!selected) return;
      setNotice(null);
      const result = await sendTestReminder({ key: ruleKey, customerId: selected.id });
      if (!result.ok) {
        setNotice({ tone: "error", text: result.error ?? "送信に失敗しました" });
      } else {
        setNotice({ tone: result.sent ? "ok" : "warn", text: result.message ?? "" });
      }
    });

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {/* 左: 顧客の選択 */}
      <div className="min-w-0 rounded-xl border border-ink-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-ink-400">1. テスト対象の顧客を選ぶ</p>
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            search();
          }}
        >
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="会員番号・氏名で検索 (空欄でLINE連携済み一覧)"
            className="w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
          />
          <button
            type="submit"
            disabled={searching}
            className="shrink-0 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-50"
          >
            検索
          </button>
        </form>

        <ul className="mt-3 divide-y divide-ink-100 rounded-lg border border-ink-100">
          {customers.length === 0 && (
            <li className="px-3 py-4 text-center text-sm text-ink-400">
              {searching ? "検索中..." : "該当する顧客がいません"}
            </li>
          )}
          {customers.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => selectCustomer(customer)}
                className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-ink-50 ${
                  selected?.id === customer.id ? "bg-ink-50" : ""
                }`}
              >
                <span>
                  <span className="font-medium text-ink-800">{customer.name}</span>
                  <span className="tabular ml-2 text-xs text-ink-400">{customer.memberCode}</span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${
                    customer.lineFollowing
                      ? "bg-emerald-50 text-emerald-700"
                      : customer.lineLinked
                        ? "bg-rose-50 text-rose-700"
                        : "bg-ink-100 text-ink-500"
                  }`}
                >
                  {customer.lineFollowing ? "LINE連携済" : customer.lineLinked ? "ブロック中" : "未連携"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* 右: ルール選択とプレビュー・送信 */}
      <div className="min-w-0 rounded-xl border border-ink-200 bg-white p-4">
        <p className="mb-2 text-xs font-medium text-ink-400">2. ルールを選んで確認</p>
        <div className="flex flex-wrap gap-1.5">
          {rules.map((rule) => (
            <button
              key={rule.key}
              type="button"
              onClick={() => {
                setRuleKey(rule.key);
                setPreview(null);
                setNotice(null);
              }}
              className={`rounded-lg border px-2.5 py-1 text-sm transition-colors ${
                ruleKey === rule.key
                  ? "border-ink-900 bg-ink-900 text-white"
                  : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
              }`}
            >
              {rule.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={doPreview}
            disabled={!selected || working}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-40"
          >
            {working ? "作成中..." : "文面をプレビュー"}
          </button>
          <button
            type="button"
            onClick={doSend}
            disabled={!selected || !selected.lineFollowing || working}
            title={
              selected && !selected.lineFollowing ? "LINE 連携済みの顧客のみ送信できます" : undefined
            }
            className="rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
          >
            本人の LINE へテスト送信
          </button>
        </div>
        {!selected && (
          <p className="mt-2 text-xs text-ink-400">左の一覧から顧客を選択してください</p>
        )}

        {notice && (
          <p
            className={`mt-3 rounded-lg px-3 py-2 text-sm ${
              notice.tone === "ok"
                ? "bg-emerald-50 text-emerald-800"
                : notice.tone === "warn"
                  ? "bg-amber-50 text-amber-800"
                  : "bg-rose-50 text-rose-800"
            }`}
          >
            {notice.text}
          </p>
        )}

        {preview && (
          <div className="mt-3">
            <p className="mb-1.5 text-xs text-ink-400">
              送信される文面 (テスト送信時は先頭に「【テスト配信】」が付きます)
            </p>
            {/* LINE のトーク風の吹き出しで表示 */}
            <div className="rounded-xl bg-[#8cabd9]/20 p-3">
              <div className="w-fit max-w-full rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap text-ink-800 shadow-sm">
                {preview}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
