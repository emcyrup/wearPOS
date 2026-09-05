"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Speaker = "claude" | "chatgpt" | "user" | "note";
/** 「スタッフA」→ 実名 の対応表 (AI には氏名を送らず、画面で戻す) */
type StaffAlias = { alias: string; name: string };
type DebateMessage = { speaker: Speaker; content: string; final?: boolean };
type ApiMessage = { role: "user" | "assistant"; content: string };

const SPEAKER_META: Record<"claude" | "chatgpt", { label: string; chip: string }> = {
  claude: { label: "Claude", chip: "bg-accent-soft text-accent" },
  chatgpt: { label: "ChatGPT", chip: "bg-emerald-50 text-emerald-700" },
};

/**
 * AI考察パネル。
 * 表示中の期間データについて Claude と ChatGPT が討論し、その経過と結論を表示する。
 * 追加の質問は討論の文脈を踏まえて Claude が答える (壁打ち)。
 */
export function AiInsights({ from, to }: { from: string; to: string }) {
  const [messages, setMessages] = useState<DebateMessage[]>([]);
  /** サーバーへ送る会話履歴 (討論はまとめて1つの assistant 発言として持つ) */
  const [apiMessages, setApiMessages] = useState<ApiMessage[]>([]);
  const [streaming, setStreaming] = useState<DebateMessage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  /** AI に送るときに伏せたスタッフ名を、画面表示で元に戻すための対応表 */
  const [aliases, setAliases] = useState<StaffAlias[]>([]);
  /** 「AIに送るデータ」のプレビュー (個人情報が含まれないことを画面で確認できる) */
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 期間が変わったら会話をリセット (前の期間の討論と混ざらないように)
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setApiMessages([]);
    setStreaming(null);
    setError(null);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    if (loading || streaming) {
      bottomRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [loading, streaming, messages.length]);

  /** NDJSON ストリームを読み、討論メッセージとして反映する。完了した発言一覧を返す */
  const run = useCallback(
    async (history: ApiMessage[], baseMessages: DebateMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      setStreaming(null);

      const finished: DebateMessage[] = [];
      let collected = [...baseMessages];

      try {
        const response = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, messages: history }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(
            data?.error ??
              (response.status === 503
                ? "AI考察は未設定です。"
                : "考察の生成に失敗しました。時間をおいて再度お試しください。"),
          );
          return null;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let current: DebateMessage | null = null;

        const handleLine = (line: string) => {
          if (!line.trim()) return;
          let event: {
            e: string;
            s?: string;
            t?: string;
            final?: boolean;
            aliases?: StaffAlias[];
          };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.e === "aliases") {
            setAliases(event.aliases ?? []);
          } else if (event.e === "start") {
            current = {
              speaker: event.s === "chatgpt" ? "chatgpt" : "claude",
              content: "",
              final: event.final === true,
            };
            setStreaming({ ...current });
          } else if (event.e === "t" && current) {
            current.content += event.t ?? "";
            setStreaming({ ...current });
          } else if (event.e === "end" && current) {
            finished.push(current);
            collected = [...collected, current];
            setMessages(collected);
            setStreaming(null);
            current = null;
          } else if (event.e === "note") {
            const note: DebateMessage = { speaker: "note", content: event.t ?? "" };
            collected = [...collected, note];
            setMessages(collected);
          }
        };

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          lines.forEach(handleLine);
        }
        handleLine(buffer);
        setStreaming(null);
        return finished;
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("通信エラーが発生しました。時間をおいて再度お試しください。");
        }
        return null;
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [from, to],
  );

  /** 討論の発言一覧を、追加質問用の会話履歴 (assistant 1件) に変換する */
  const toTranscript = (turns: DebateMessage[]): string =>
    turns
      .map((turn) => `【${turn.speaker === "chatgpt" ? "ChatGPT" : "Claude"}】\n${turn.content}`)
      .join("\n\n");

  const start = useCallback(async () => {
    setMessages([]);
    setApiMessages([]);
    const finished = await run([], []);
    if (finished && finished.length > 0) {
      setApiMessages([{ role: "assistant", content: toTranscript(finished) }]);
    }
  }, [run]);

  const followUp = useCallback(async () => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const history: ApiMessage[] = [...apiMessages, { role: "user", content: trimmed }];
    const base: DebateMessage[] = [...messages, { speaker: "user", content: trimmed }];
    setMessages(base);
    setQuestion("");
    const finished = await run(history, base);
    if (finished && finished.length > 0) {
      setApiMessages([
        ...history,
        { role: "assistant", content: finished.map((turn) => turn.content).join("\n") },
      ]);
    }
  }, [apiMessages, loading, messages, question, run]);

  const started = messages.length > 0 || loading;

  // 討論を「結論」と「経過」に分ける。結論を主役として大きく見せる
  const conclusionIndex = messages.findLastIndex((m) => m.final);
  const conclusion = conclusionIndex >= 0 ? messages[conclusionIndex] : null;
  const debateTurns = messages.filter(
    (m, i) => i !== conclusionIndex && (m.speaker === "claude" || m.speaker === "chatgpt"),
  );
  const otherMessages = messages.filter(
    (m) => m.speaker === "user" || m.speaker === "note",
  );

  /**
   * AI から返ってきた「スタッフA」を実名に戻す。
   * 送信時に伏せているだけなので、画面では従来どおり誰のことか分かる。
   */
  const withRealNames = (text: string) =>
    aliases.reduce((acc, entry) => acc.split(entry.alias).join(entry.name), text);

  /** 「考察(結論): 〜 / 打ち手: 〜 / 提案: 〜」の行を拾って構造化する */
  const parseConclusion = (text: string) => {
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    const summary = lines
      .filter((line) => /^(考察|結論)/.test(line))
      .map((line) => line.replace(/^(考察|結論)[:：]?\s*/, ""))
      .join(" ");
    const actions = lines
      .filter((line) => line.startsWith("打ち手"))
      .map((line) => line.replace(/^打ち手[:：]?\s*/, ""));
    const proposals = lines
      .filter((line) => line.startsWith("提案"))
      .map((line) => line.replace(/^提案[:：]?\s*/, ""));
    // 形式どおりでなければ本文をそのまま考察として扱う
    if (!summary && actions.length === 0 && proposals.length === 0) {
      return { summary: text.trim(), actions: [], proposals: [] };
    }
    return { summary, actions, proposals };
  };

  /** セクション見出し (【考察】【提案】) */
  const SectionLabel = ({ children }: { children: string }) => (
    <p className="mb-1 text-xs font-semibold tracking-wide text-ink-400">{children}</p>
  );

  const renderMessage = (message: DebateMessage, index: number) => {
    if (message.speaker === "user") {
      return (
        <p
          key={index}
          className="ml-auto w-fit max-w-[85%] rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-800"
        >
          {message.content}
        </p>
      );
    }
    if (message.speaker === "note") {
      return (
        <p key={index} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
          {message.content}
        </p>
      );
    }
    const meta = SPEAKER_META[message.speaker];
    // 「考察: / 提案:」形式の回答は【考察】【提案】のセクションに分けて表示する
    const shownContent = withRealNames(message.content);
    const { summary, actions, proposals } = parseConclusion(shownContent);
    const structured =
      message.speaker === "claude" && summary !== shownContent.trim() && summary !== "";
    return (
      <div key={index}>
        <span
          className={`mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${meta.chip}`}
        >
          {meta.label}
        </span>
        {structured ? (
          <div className="rounded-lg border border-ink-100 bg-ink-50/40 p-3">
            <SectionLabel>【考察】</SectionLabel>
            <p className="text-sm leading-relaxed text-ink-800">{summary}</p>
            {actions.length > 0 && (
              <ul className="mt-2 space-y-1.5">
                {actions.map((action, i) => (
                  <li key={i} className="flex gap-2 text-sm text-ink-700">
                    <span className="shrink-0 text-accent">→</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            )}
            {proposals.length > 0 && (
              <div className="mt-3 border-t border-ink-100 pt-3">
                <SectionLabel>【提案】</SectionLabel>
                <ul className="space-y-1.5">
                  {proposals.map((proposal, i) => (
                    <li key={i} className="flex gap-2 text-sm text-ink-700">
                      <span className="shrink-0">💡</span>
                      <span>{proposal}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
            {shownContent}
          </div>
        )}
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">AI考察 (Claude × ChatGPT 討論)</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {from.replaceAll("-", "/")} 〜 {to.replaceAll("-", "/")} の実績を2つのAIが討論して考察します
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* 何が外部に送られるかを、実物のデータで確認できるようにする */}
          <button
            type="button"
            onClick={() => {
              if (preview) {
                setPreview(null);
                return;
              }
              setPreviewLoading(true);
              void fetch(`/api/insights/preview?from=${from}&to=${to}`)
                .then(async (response) => {
                  const json = (await response.json()) as { data?: unknown; error?: string };
                  setPreview(
                    json.data ? JSON.stringify(json.data, null, 2) : (json.error ?? "取得できませんでした"),
                  );
                })
                .catch(() => setPreview("取得できませんでした"))
                .finally(() => setPreviewLoading(false));
            }}
            className="rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm whitespace-nowrap text-ink-600 hover:bg-ink-50"
          >
            {previewLoading ? "読み込み中..." : preview ? "送信データを閉じる" : "🔍 AIに送るデータを見る"}
          </button>
          <button
            type="button"
            onClick={() => void start()}
            disabled={loading}
            className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-ink-800 disabled:opacity-50"
          >
            {loading && messages.length === 0
              ? "討論中..."
              : started
                ? "討論をやり直す"
                : "討論を開始"}
          </button>
        </div>
      </header>

      {/* 送信データのプレビュー */}
      {preview && (
        <div className="border-b border-ink-100 bg-ink-50/60 px-5 py-4">
          <p className="text-xs text-ink-600">
            下記が AI に送っている内容のすべてです。
            <span className="font-medium">
              顧客の氏名・カナ・電話番号・メール・住所・誕生日・個別の購入履歴は含まれません
            </span>
            （顧客は会員数などの統計のみ）。スタッフ名も「スタッフA」等に置き換えて送っています。
          </p>
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-white p-3 text-[11px] leading-relaxed text-ink-700">
            {preview}
          </pre>
        </div>
      )}

      <div className="px-5 py-4">
        {!started && !error && (
          <p className="text-sm text-ink-400">
            「討論を開始」を押すと、Claude と ChatGPT がこの期間の実績について議論し、
            結論と打ち手だけを短くまとめます。経過はあとから開いて確認できます。
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
        )}

        {/* 結論を【考察】と【提案】に分けて主役として表示する */}
        {conclusion && (() => {
          const { summary, actions, proposals } = parseConclusion(withRealNames(conclusion.content));
          return (
            <div className="rounded-xl border border-ink-200 bg-ink-50/60 p-4">
              <SectionLabel>【考察】</SectionLabel>
              <p className="text-[15px] leading-relaxed font-medium text-ink-900">{summary}</p>
              {actions.length > 0 && (
                <ul className="mt-2 space-y-1.5">
                  {actions.map((action, index) => (
                    <li key={index} className="flex gap-2 text-sm text-ink-700">
                      <span className="shrink-0 text-accent">→</span>
                      <span>{action}</span>
                    </li>
                  ))}
                </ul>
              )}
              {/* すぐの打ち手より一歩先の提案 */}
              {proposals.length > 0 && (
                <div className="mt-3 border-t border-ink-200 pt-3">
                  <SectionLabel>【提案】</SectionLabel>
                  <ul className="space-y-1.5">
                    {proposals.map((proposal, index) => (
                      <li key={index} className="flex gap-2 text-sm text-ink-700">
                        <span className="shrink-0">💡</span>
                        <span>{proposal}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })()}

        {/* 討論の経過は折りたたむ (結論が出るまでは開いた状態で流す) */}
        {debateTurns.length > 0 && (
          <details className={conclusion ? "mt-3" : "mt-0"} open={!conclusion}>
            <summary className="cursor-pointer list-none text-xs text-ink-400 hover:text-ink-600">
              討論の経過を{conclusion ? "見る" : "表示中"} ({debateTurns.length}件)
            </summary>
            <div className="mt-3 space-y-4 border-l-2 border-ink-100 pl-3">
              {debateTurns.map(renderMessage)}
            </div>
          </details>
        )}

        {/* 追加質問とその回答 */}
        {(otherMessages.length > 0 || (conclusion && messages.some((m) => m.speaker === "user"))) && (
          <div className="mt-4 space-y-4">
            {messages
              .filter(
                (m, i) =>
                  m.speaker === "user" ||
                  m.speaker === "note" ||
                  // 追加質問への回答 (討論より後の Claude 発言)
                  (i > conclusionIndex && conclusionIndex >= 0 && m.speaker === "claude"),
              )
              .map(renderMessage)}
          </div>
        )}

        {streaming && (
          <div className="mt-4">
            <span
              className={`mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                SPEAKER_META[streaming.speaker === "chatgpt" ? "chatgpt" : "claude"].chip
              }`}
            >
              {SPEAKER_META[streaming.speaker === "chatgpt" ? "chatgpt" : "claude"].label}
              {streaming.final && <span className="ml-1 font-normal">· まとめ</span>}
            </span>
            <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
              {withRealNames(streaming.content)}
              <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-ink-400 align-text-bottom" />
            </div>
          </div>
        )}

        {loading && !streaming && (
          <p className="mt-2 animate-pulse text-sm text-ink-400">
            {messages.length === 0 ? "データを読み込んで考えています..." : "考えています..."}
          </p>
        )}

        {messages.length > 0 && !loading && (
          <form
            className="mt-4 flex gap-2 border-t border-ink-100 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void followUp();
            }}
          >
            <input
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例: 客単価を上げるには何から手を付けるべき？"
              className="w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
            />
            <button
              type="submit"
              disabled={!question.trim()}
              className="shrink-0 rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-40"
            >
              質問する
            </button>
          </form>
        )}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
