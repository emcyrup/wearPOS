import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { endOfDay, startOfDay } from "@/lib/analytics";
import { chatGptGenerate, isChatGptConfigured } from "@/lib/chatgpt";
import { isChatGptEnabled } from "@/lib/insight-policy";
import { buildInsightData, INSIGHT_SYSTEM_PROMPT } from "@/lib/insights";

export const dynamic = "force-dynamic";
// 討論はモデル呼び出しを3回直列に行うため余裕を持たせる
export const maxDuration = 300;

const requestSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 壁打ちの会話履歴。空なら初回の討論を生成 */
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
      }),
    )
    .max(20)
    .default([]),
});

const CHATGPT_SYSTEM_PROMPT = `あなたは ChatGPT。アパレル小売に詳しい経営分析者として、Claude の考察を批判的に検証する討論者です。
- 与えられた POS データの数値を根拠に、Claude が見落としている点・別の解釈・打ち手のリスクを指摘する
- 指摘は1点に絞る。同意する部分は「〜は同意」と一言で済ませる
- **120文字以内**。前置き・挨拶は書かず、指摘から始める
- 専門用語は噛み砕いた言葉に言い換える`;

/**
 * 期間データをもとに Claude と ChatGPT に討論させ、結果をストリーミングで返す。
 *
 * POST /api/insights
 * Body: { from, to, messages? }
 * Response: NDJSON のストリーム。1行ごとに以下のイベント:
 *   {e:"start", s:"claude"|"chatgpt", final?} 発言の開始 (final は結論)
 *   {e:"t", t:"..."}                 発言本文の断片
 *   {e:"end"}                        発言の終了
 *   {e:"note", t:"..."}              補足 (フォールバック案内など)
 */
export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "ANTHROPIC_API_KEY が設定されていません。ホスティング側の環境変数に Anthropic の API キーを追加すると、AI考察が使えるようになります。",
      },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = requestSchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "JSON の解析に失敗しました" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "リクエスト形式が不正です" }, { status: 400 });
  }

  const { from, to, messages } = parsed.data;
  const range = {
    from: startOfDay(new Date(`${from}T00:00:00`)),
    to: endOfDay(new Date(`${to}T00:00:00`)),
  };
  if (Number.isNaN(range.from.getTime()) || Number.isNaN(range.to.getTime()) || range.from > range.to) {
    return NextResponse.json({ error: "期間の指定が不正です" }, { status: 400 });
  }

  const { data, staffAliases } = await buildInsightData(range);
  // スタッフ氏名は data に含まれない (「スタッフA」等に置換済み)。対応表は送らない
  const dataText = `対象期間の POS 集計データ (JSON):\n${JSON.stringify(data)}`;
  const client = new Anthropic();
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      // 「スタッフA」→ 実名 の対応表。AI には送らず、画面表示のときだけ使う
      if (staffAliases.length > 0) {
        emit({ e: "aliases", aliases: staffAliases });
      }

      /** Claude の1発言をストリーミングで流し、全文を返す */
      const claudeTurn = async (
        conversation: { role: "user" | "assistant"; content: string }[],
        extraSystem = "",
        /** 討論の締め (結論) かどうか。UI で主役として表示する */
        isConclusion = false,
      ): Promise<string> => {
        emit({ e: "start", s: "claude", ...(isConclusion ? { final: true } : {}) });
        const stream = client.beta.messages.stream({
          model: "claude-opus-5",
          // 発言は200文字程度に絞っているため、出力上限も小さくてよい
          max_tokens: 2000,
          // 安全分類器が申告を拒否した場合に別モデルへ自動で引き継ぐ
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          system: [
            { type: "text", text: INSIGHT_SYSTEM_PROMPT + extraSystem },
            { type: "text", text: dataText },
          ],
          messages: conversation,
        } as Parameters<typeof client.beta.messages.stream>[0]);

        let full = "";
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            full += event.delta.text;
            emit({ e: "t", t: event.delta.text });
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          emit({ e: "t", t: "\n(この内容には回答できませんでした)" });
        }
        emit({ e: "end" });
        return full;
      };

      try {
        if (messages.length > 0) {
          // 壁打ちの追加質問: 討論の文脈を踏まえて Claude が答える
          const conversation =
            messages[0].role !== "user"
              ? [
                  {
                    role: "user" as const,
                    content: "この期間の実績について討論してください。",
                  },
                  ...messages,
                ]
              : messages;
          await claudeTurn(
            conversation,
            "\n\n続きの質問には、これまでの討論内容を踏まえて、次の形式ちょうどで簡潔に答えてください。前置きや装飾は不要です。\n\n考察: (質問への答え。150文字以内)\n提案: (次に試すとよい取り組みがあれば1文・60文字以内。無ければこの行は省略)",
          );
        } else {
          // ---- 討論モード ----
          // 設定で ChatGPT への送信を止めている場合は Claude 単独で考察する
          const chatGptAvailable = isChatGptConfigured() && (await isChatGptEnabled());

          // 1. Claude の考察
          const opening =
            "この期間の実績で、いちばん大事な気づきを1つだけ、120文字以内で述べてください。";
          const claudeView = await claudeTurn(
            [{ role: "user", content: opening }],
            chatGptAvailable
              ? "\n\nあなたは Claude として ChatGPT と討論します。まず自分の考察を述べてください。"
              : "",
          );

          if (!chatGptAvailable) {
            emit({
              e: "note",
              t: isChatGptConfigured()
                ? "設定で ChatGPT への送信をオフにしているため、Claude 単独の考察を表示しています。"
                : "OPENAI_API_KEY が未設定のため、Claude 単独の考察を表示しています。設定すると Claude × ChatGPT の討論になります。",
            });
            controller.close();
            return;
          }

          // 2. ChatGPT の反論・別視点
          let chatGptView: string;
          try {
            chatGptView = await chatGptGenerate({
              system: CHATGPT_SYSTEM_PROMPT,
              prompt: `${dataText}\n\n【Claude の考察】\n${claudeView}\n\nこの考察を批判的に検証し、反論や補足を述べてください。`,
            });
          } catch (error) {
            emit({
              e: "note",
              t: `ChatGPT に接続できなかったため、Claude の考察のみ表示しています (${
                error instanceof Error ? error.message : "接続エラー"
              })`,
            });
            controller.close();
            return;
          }
          emit({ e: "start", s: "chatgpt" });
          emit({ e: "t", t: chatGptView });
          emit({ e: "end" });

          // 3. Claude が指摘を踏まえて統合・最終結論
          await claudeTurn(
            [
              { role: "user", content: opening },
              { role: "assistant", content: claudeView },
              {
                role: "user",
                content: `ChatGPT から次の指摘がありました。\n\n${chatGptView}\n\n両者の意見を踏まえた結論を、次の形式ちょうどで書いてください。前置きや見出しの装飾は不要です。\n\n考察: (両者の意見を踏まえた結論。1文・60文字以内)\n打ち手: (誰が何をするか1文・50文字以内)\n打ち手: (2つ目があれば。無ければこの行は省略)\n提案: (すぐの打ち手より一歩先の、次に試すとよい取り組みの提案。1文・60文字以内)`,
              },
            ],
            "\n\nあなたは Claude として ChatGPT と討論しています。最後のまとめ役です。",
            true,
          );
        }
      } catch (error) {
        // 原因の切り分けができるよう、エラーの本文をそのまま見せてログにも残す
        console.error("AI考察の生成に失敗しました", error);
        const detail =
          error instanceof Anthropic.APIError
            ? `${error.status}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error);
        emit({ e: "note", t: `AI との通信でエラーが発生しました (${detail})` });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
