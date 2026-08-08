"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Speaker = "claude" | "gemini" | "user" | "note";
type DebateMessage = { speaker: Speaker; content: string };
type ApiMessage = { role: "user" | "assistant"; content: string };

const SPEAKER_META: Record<"claude" | "gemini", { label: string; chip: string }> = {
  claude: { label: "Claude", chip: "bg-accent-soft text-accent" },
  gemini: { label: "Gemini", chip: "bg-sky-50 text-sky-700" },
};

/**
 * AI考察パネル。
 * 表示中の期間データについて Claude と Gemini が討論し、その経過と結論を表示する。
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
          let event: { e: string; s?: string; t?: string };
          try {
            event = JSON.parse(line);
          } catch {
            return;
          }
          if (event.e === "start") {
            current = { speaker: event.s === "gemini" ? "gemini" : "claude", content: "" };
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
      .map((turn) => `【${turn.speaker === "gemini" ? "Gemini" : "Claude"}】\n${turn.content}`)
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
    return (
      <div key={index}>
        <span
          className={`mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${meta.chip}`}
        >
          {meta.label}
        </span>
        <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
          {message.content}
        </div>
      </div>
    );
  };

  return (
    <section className="rounded-xl border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">AI考察 (Claude × Gemini 討論)</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {from.replaceAll("-", "/")} 〜 {to.replaceAll("-", "/")} の実績を2つのAIが討論して考察します
          </p>
        </div>
        <button
          type="button"
          onClick={() => void start()}
          disabled={loading}
          className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {loading && messages.length === 0
            ? "討論中..."
            : started
              ? "討論をやり直す"
              : "討論を開始"}
        </button>
      </header>

      <div className="px-5 py-4">
        {!started && !error && (
          <p className="text-sm text-ink-400">
            「討論を開始」を押すと、この期間の実績について Claude が考察し、Gemini
            が別の視点から検証、最後に Claude が結論をまとめます。生成後は追加の質問もできます。
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
        )}

        {(messages.length > 0 || streaming) && (
          <div className="space-y-4">
            {messages.map(renderMessage)}
            {streaming && (
              <div>
                <span
                  className={`mb-1 inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
                    SPEAKER_META[streaming.speaker === "gemini" ? "gemini" : "claude"].chip
                  }`}
                >
                  {SPEAKER_META[streaming.speaker === "gemini" ? "gemini" : "claude"].label}
                </span>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                  {streaming.content}
                  <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-ink-400 align-text-bottom" />
                </div>
              </div>
            )}
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
