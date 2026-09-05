"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { isChatGptConfigured } from "@/lib/chatgpt";
import { setChatGptEnabled } from "@/lib/insight-policy";

export type AiSettingState = { status: "idle" | "success" | "error"; message: string };

/** ChatGPT (OpenAI) へデータを送るかどうかを切り替える */
export async function updateChatGptEnabled(enabled: boolean): Promise<AiSettingState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ実行できます" };
  }
  await setChatGptEnabled(enabled);
  revalidatePath("/settings");
  revalidatePath("/");
  return {
    status: "success",
    message: enabled
      ? "ChatGPT との討論を有効にしました"
      : "ChatGPT への送信を停止しました (Claude 単独の考察になります)",
  };
}

export type AiConnectionResult = {
  provider: "Claude (Anthropic)" | "ChatGPT (OpenAI)";
  configured: boolean;
  ok: boolean;
  /** 応答までのミリ秒 */
  ms: number | null;
  /** 失敗したときはエラーの本文をそのまま出す (IP 制限などの切り分け用) */
  detail: string;
};

/**
 * AI の接続テスト。
 * キーの有無・疎通・応答時間・エラー本文をその場で確認できるようにする
 * (「IPは使えません」のような提供元のエラーをそのまま表示するため)。
 */
export async function testAiConnection(): Promise<AiConnectionResult[] | null> {
  if (!(await requireAdmin())) return null;

  const results: AiConnectionResult[] = [];

  // ---- Claude ----
  const anthropicKey = Boolean(process.env.ANTHROPIC_API_KEY);
  if (!anthropicKey) {
    results.push({
      provider: "Claude (Anthropic)",
      configured: false,
      ok: false,
      ms: null,
      detail: "ANTHROPIC_API_KEY が設定されていません",
    });
  } else {
    const startedAt = Date.now();
    try {
      const client = new Anthropic();
      await client.messages.create({
        model: "claude-opus-5",
        max_tokens: 16,
        messages: [{ role: "user", content: "ping" }],
      });
      results.push({
        provider: "Claude (Anthropic)",
        configured: true,
        ok: true,
        ms: Date.now() - startedAt,
        detail: "正常に応答しました",
      });
    } catch (error) {
      console.error("Claude への接続テストに失敗しました", error);
      results.push({
        provider: "Claude (Anthropic)",
        configured: true,
        ok: false,
        ms: Date.now() - startedAt,
        detail:
          error instanceof Anthropic.APIError
            ? `${error.status}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }

  // ---- ChatGPT ----
  if (!isChatGptConfigured()) {
    results.push({
      provider: "ChatGPT (OpenAI)",
      configured: false,
      ok: false,
      ms: null,
      detail: "OPENAI_API_KEY が設定されていません (Claude 単独の考察になります)",
    });
  } else {
    const startedAt = Date.now();
    try {
      const response = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      });
      const body = await response.text();
      results.push({
        provider: "ChatGPT (OpenAI)",
        configured: true,
        ok: response.ok,
        ms: Date.now() - startedAt,
        detail: response.ok ? "正常に応答しました" : `${response.status}: ${body.slice(0, 300)}`,
      });
    } catch (error) {
      console.error("ChatGPT への接続テストに失敗しました", error);
      results.push({
        provider: "ChatGPT (OpenAI)",
        configured: true,
        ok: false,
        ms: Date.now() - startedAt,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return results;
}
