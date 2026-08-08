/**
 * OpenAI API (Chat Completions, REST)。
 * AI考察の討論相手 (ChatGPT) として使う。SDK を増やさず fetch で直接呼ぶ。
 */

export function isChatGptConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function chatGptGenerate(params: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY が設定されていません");
  const model = process.env.OPENAI_MODEL ?? "gpt-5-mini";

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
      // 推論系モデルは思考にもトークンを使うため、出力200字に対して余裕を持たせる
      max_completion_tokens: params.maxOutputTokens ?? 4096,
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`OpenAI API エラー (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    choices?: { message?: { content?: string | null } }[];
  };
  const text = data.choices?.[0]?.message?.content ?? "";
  if (!text.trim()) throw new Error("ChatGPT から応答が得られませんでした");
  return text.trim();
}
