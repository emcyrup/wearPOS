"use server";

import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { saveRegisterCode } from "@/lib/register-access";

export type RegisterAccessState = {
  status: "idle" | "success" | "error";
  message: string;
};

/**
 * レジ端末コードの設定 (管理者のみ)。
 * 店頭の端末は、このコードを一度入力するとログインなしでレジを使えるようになる。
 * 空にすると解除され、ログイン済みの人しかレジを使えなくなる。
 */
export async function updateRegisterCode(code: string): Promise<RegisterAccessState> {
  if (!(await requireAdmin())) {
    return { status: "error", message: "管理者のみ設定できます" };
  }

  const trimmed = code.trim();
  if (trimmed && trimmed.length < 4) {
    return { status: "error", message: "レジ端末コードは4文字以上にしてください" };
  }
  if (trimmed.length > 64) {
    return { status: "error", message: "レジ端末コードが長すぎます" };
  }

  await saveRegisterCode(trimmed);
  revalidatePath("/settings");
  revalidatePath("/register");

  return {
    status: "success",
    message: trimmed
      ? "レジ端末コードを設定しました。店頭の端末で一度入力してください"
      : "レジ端末コードを解除しました。レジはログインした人だけが使えます",
  };
}
