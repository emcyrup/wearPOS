/**
 * Google Gemini API (REST)。
 * AI考察の討論相手として使う。SDK を増やさず fetch で直接呼ぶ。
 */

export function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

export async function geminiGenerate(params: {
  system: string;
  prompt: string;
  maxOutputTokens?: number;
}): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY が設定されていません");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: params.system }] },
        contents: [{ role: "user", parts: [{ text: params.prompt }] }],
        generationConfig: {
          maxOutputTokens: params.maxOutputTokens ?? 2048,
          temperature: 0.7,
        },
      }),
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw new Error(`Gemini API エラー (${res.status}): ${detail}`);
  }

  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text =
    data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
  if (!text.trim()) throw new Error("Gemini から応答が得られませんでした");
  return text.trim();
}
