"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ChatMessage = { role: "user" | "assistant"; content: string };

/**
 * AI 考察 (壁打ち) パネル。
 * 表示中の期間データをもとに /api/insights へ問い合わせ、
 * ストリーミングで考察を表示する。追加の質問で壁打ちを続けられる。
 */
export function AiInsights({ from, to }: { from: string; to: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 期間が変わったら会話をリセット (前の期間の考察と混ざらないように)
  useEffect(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreaming("");
    setError(null);
    setLoading(false);
  }, [from, to]);

  useEffect(() => {
    if (loading || streaming) {
      bottomRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [loading, streaming, messages.length]);

  const ask = useCallback(
    async (history: ChatMessage[]) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      setError(null);
      setStreaming("");

      try {
        const response = await fetch("/api/insights", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ from, to, messages: history }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as { error?: string } | null;
          setError(
            data?.error ??
              (response.status === 503
                ? "AI考察は未設定です。"
                : "考察の生成に失敗しました。時間をおいて再度お試しください。"),
          );
          return;
        }

        if (!response.body) {
          setError("応答の読み取りに失敗しました。");
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let text = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
          setStreaming(text);
        }
        text += decoder.decode();

        setMessages([...history, { role: "assistant", content: text }]);
        setStreaming("");
      } catch (err) {
        if ((err as Error).name !== "AbortError") {
          setError("通信エラーが発生しました。時間をおいて再度お試しください。");
        }
      } finally {
        if (abortRef.current === controller) {
          setLoading(false);
        }
      }
    },
    [from, to],
  );

  const start = useCallback(() => {
    setMessages([]);
    void ask([]);
  }, [ask]);

  const followUp = useCallback(() => {
    const trimmed = question.trim();
    if (!trimmed || loading) return;
    const history: ChatMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(history);
    setQuestion("");
    void ask(history);
  }, [ask, loading, messages, question]);

  const started = messages.length > 0 || loading;

  return (
    <section className="rounded-xl border border-ink-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">AI考察 (壁打ち)</h2>
          <p className="mt-0.5 text-xs text-ink-400">
            {from.replaceAll("-", "/")} 〜 {to.replaceAll("-", "/")} の売上・客数データをAIが分析します
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={loading}
          className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
        >
          {loading && messages.length === 0
            ? "分析中..."
            : started
              ? "考察をやり直す"
              : "考察を生成"}
        </button>
      </header>

      <div className="px-5 py-4">
        {!started && !error && (
          <p className="text-sm text-ink-400">
            「考察を生成」を押すと、この期間の実績から良い点・課題・打ち手をAIがまとめます。
            生成後は気になる点を追加で質問できます。
          </p>
        )}

        {error && (
          <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">{error}</p>
        )}

        {(messages.length > 0 || streaming) && (
          <div className="space-y-4">
            {messages.map((message, index) =>
              message.role === "user" ? (
                <p
                  key={index}
                  className="ml-auto w-fit max-w-[85%] rounded-lg bg-ink-100 px-3 py-2 text-sm text-ink-800"
                >
                  {message.content}
                </p>
              ) : (
                <div
                  key={index}
                  className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800"
                >
                  {message.content}
                </div>
              ),
            )}
            {streaming && (
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-ink-800">
                {streaming}
                <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-ink-400 align-text-bottom" />
              </div>
            )}
          </div>
        )}

        {loading && !streaming && (
          <p className="mt-2 animate-pulse text-sm text-ink-400">データを読み込んで考えています...</p>
        )}

        {messages.length > 0 && !loading && (
          <form
            className="mt-4 flex gap-2 border-t border-ink-100 pt-4"
            onSubmit={(event) => {
              event.preventDefault();
              followUp();
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
