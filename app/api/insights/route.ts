import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { endOfDay, startOfDay } from "@/lib/analytics";
import { geminiGenerate, isGeminiConfigured } from "@/lib/gemini";
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

const GEMINI_SYSTEM_PROMPT = `あなたは Gemini。アパレル小売に詳しい経営分析者として、Claude の考察を批判的に検証する討論者です。
- 与えられた POS データの数値を根拠に、Claude が見落としている点・別の解釈・打ち手のリスクを指摘する
- 同意できる点があれば短く認めた上で、必ず1つは異なる視点を出す
- 200文字程度 (最大300文字)。見出しや箇条書きは使わず、短い文章で
- 専門用語は噛み砕いた言葉に言い換える`;

/**
 * 期間データをもとに Claude と Gemini に討論させ、結果をストリーミングで返す。
 *
 * POST /api/insights
 * Body: { from, to, messages? }
 * Response: NDJSON のストリーム。1行ごとに以下のイベント:
 *   {e:"start", s:"claude"|"gemini"} 発言の開始
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

  const data = await buildInsightData(range);
  const dataText = `対象期間の POS 集計データ (JSON):\n${JSON.stringify(data)}`;
  const client = new Anthropic();
  const encoder = new TextEncoder();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: Record<string, unknown>) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      /** Claude の1発言をストリーミングで流し、全文を返す */
      const claudeTurn = async (
        conversation: { role: "user" | "assistant"; content: string }[],
        extraSystem = "",
      ): Promise<string> => {
        emit({ e: "start", s: "claude" });
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
            "\n\n続きの質問には、これまでの討論内容を踏まえて答えてください。",
          );
        } else {
          // ---- 討論モード ----
          const geminiAvailable = isGeminiConfigured();

          // 1. Claude の考察
          const opening =
            "この期間の実績を分析してください。いちばん大事な気づきと、明日からできる打ち手を述べてください。";
          const claudeView = await claudeTurn(
            [{ role: "user", content: opening }],
            geminiAvailable
              ? "\n\nあなたは Claude として Gemini と討論します。まず自分の考察を述べてください。"
              : "",
          );

          if (!geminiAvailable) {
            emit({
              e: "note",
              t: "GEMINI_API_KEY が未設定のため、Claude 単独の考察を表示しています。設定すると Claude × Gemini の討論になります。",
            });
            controller.close();
            return;
          }

          // 2. Gemini の反論・別視点
          let geminiView: string;
          try {
            geminiView = await geminiGenerate({
              system: GEMINI_SYSTEM_PROMPT,
              prompt: `${dataText}\n\n【Claude の考察】\n${claudeView}\n\nこの考察を批判的に検証し、反論や補足を述べてください。`,
            });
          } catch (error) {
            emit({
              e: "note",
              t: `Gemini に接続できなかったため、Claude の考察のみ表示しています (${
                error instanceof Error ? error.message : "接続エラー"
              })`,
            });
            controller.close();
            return;
          }
          emit({ e: "start", s: "gemini" });
          emit({ e: "t", t: geminiView });
          emit({ e: "end" });

          // 3. Claude が指摘を踏まえて統合・最終結論
          await claudeTurn(
            [
              { role: "user", content: opening },
              { role: "assistant", content: claudeView },
              {
                role: "user",
                content: `Gemini から次の指摘がありました。\n\n${geminiView}\n\n同意できる点・同意できない点を整理した上で、最終結論と明日からの打ち手を200文字程度でまとめてください。`,
              },
            ],
            "\n\nあなたは Claude として Gemini と討論しています。最後のまとめ役です。",
          );
        }
      } catch (error) {
        const message =
          error instanceof Anthropic.APIError
            ? `AI との通信でエラーが発生しました (${error.status})`
            : "AI との通信でエラーが発生しました";
        emit({ e: "note", t: message });
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
