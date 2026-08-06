import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";

import { endOfDay, startOfDay } from "@/lib/analytics";
import { buildInsightData, INSIGHT_SYSTEM_PROMPT } from "@/lib/insights";

export const dynamic = "force-dynamic";
// 考察の生成はモデルの思考時間を含めて数十秒かかることがある
export const maxDuration = 300;

const requestSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** 壁打ちの会話履歴。空なら初回の考察生成 */
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(4000),
      }),
    )
    .max(20)
    .default([]),
});

/**
 * 期間データをもとに Claude へ考察を依頼し、テキストをストリーミングで返す。
 *
 * POST /api/insights
 * Body: { from, to, messages? }
 * Response: text/plain のストリーム
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

  const client = new Anthropic();

  const initialPrompt = {
    role: "user" as const,
    content:
      "この期間の実績を分析してください。良い点・悪い点・注目すべき変化を挙げ、明日から実行できる具体的な打ち手を提案してください。",
  };
  // 会話は user から始まる必要がある。クライアントは初回の依頼文を持たないので、
  // 履歴が assistant 始まりの場合はここで補う
  const conversation =
    messages.length === 0 || messages[0].role !== "user"
      ? [initialPrompt, ...messages]
      : messages;

  const stream = client.beta.messages.stream({
    model: "claude-opus-5",
    // 考察は200文字程度に絞っているため、出力上限も小さくてよい
    max_tokens: 2000,
    // 安全分類器が申告を拒否した場合に別モデルへ自動で引き継ぐ
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: [
      { type: "text", text: INSIGHT_SYSTEM_PROMPT },
      {
        type: "text",
        text: `対象期間の POS 集計データ (JSON):\n${JSON.stringify(data)}`,
      },
    ],
    messages: conversation,
  } as Parameters<typeof client.beta.messages.stream>[0]);

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of stream) {
          if (
            event.type === "content_block_delta" &&
            event.delta.type === "text_delta"
          ) {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") {
          controller.enqueue(
            encoder.encode(
              "\n\n(この内容には回答できませんでした。質問を変えてお試しください)",
            ),
          );
        } else if (final.stop_reason === "max_tokens") {
          controller.enqueue(encoder.encode("\n\n(長くなったため途中で打ち切りました)"));
        }
      } catch (error) {
        const message =
          error instanceof Anthropic.APIError
            ? `AI との通信でエラーが発生しました (${error.status})`
            : "AI との通信でエラーが発生しました";
        controller.enqueue(encoder.encode(`\n\n${message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
