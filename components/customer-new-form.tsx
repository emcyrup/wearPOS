"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { createCustomer } from "@/app/customers/actions";

const inputClass =
  "rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400";

/** 店頭・電話で聞き取った情報から顧客を登録するフォーム。会員番号は自動採番 */
export function CustomerNewForm({ stores }: { stores: { id: string; name: string }[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (formData: FormData) => {
    setError(null);
    startTransition(async () => {
      const result = await createCustomer({
        lastName: String(formData.get("lastName") ?? ""),
        firstName: String(formData.get("firstName") ?? ""),
        lastNameKana: String(formData.get("lastNameKana") ?? ""),
        firstNameKana: String(formData.get("firstNameKana") ?? ""),
        phone: String(formData.get("phone") ?? ""),
        email: String(formData.get("email") ?? ""),
        birthday: String(formData.get("birthday") ?? ""),
        gender: String(formData.get("gender") ?? "") as
          | ""
          | "FEMALE"
          | "MALE"
          | "OTHER"
          | "UNKNOWN",
        storeId: String(formData.get("storeId") ?? ""),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/customers/${result.customerId}`);
    });
  };

  return (
    <form action={submit} className="max-w-xl rounded-xl border border-ink-200 bg-white p-5">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">
            姓 <span className="text-rose-600">*</span>
          </span>
          <input name="lastName" required placeholder="山田" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">名</span>
          <input name="firstName" placeholder="花子" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">セイ (カナ)</span>
          <input name="lastNameKana" placeholder="ヤマダ" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">メイ (カナ)</span>
          <input name="firstNameKana" placeholder="ハナコ" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">電話番号</span>
          <input name="phone" type="tel" placeholder="090-1234-5678" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">メールアドレス</span>
          <input name="email" type="email" placeholder="hanako@example.com" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">誕生日</span>
          <input name="birthday" type="date" className={inputClass} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-400">性別</span>
          <select name="gender" defaultValue="" className={inputClass}>
            <option value="">未設定</option>
            <option value="FEMALE">女性</option>
            <option value="MALE">男性</option>
            <option value="OTHER">その他</option>
            <option value="UNKNOWN">回答しない</option>
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1">
          <span className="text-xs text-ink-400">担当店舗</span>
          <select name="storeId" defaultValue="" className={inputClass}>
            <option value="">未設定</option>
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="mt-3 text-sm text-rose-700">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
      >
        {pending ? "登録中..." : "顧客を登録する"}
      </button>
      <p className="mt-2 text-center text-xs text-ink-400">会員番号は自動で採番されます</p>
    </form>
  );
}
