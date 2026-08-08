"use client";

import { useState, useTransition } from "react";

import { submitSignup, type SignupResult } from "@/app/signup/actions";

const inputClass =
  "w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400";

/**
 * LINE から開く会員登録フォーム。
 * 送信すると顧客が作成され、その LINE アカウントと自動で連携される。
 */
export function SignupForm({ token }: { token: string }) {
  const [lastName, setLastName] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastNameKana, setLastNameKana] = useState("");
  const [firstNameKana, setFirstNameKana] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [gender, setGender] = useState("UNKNOWN");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<(SignupResult & { ok: true }) | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () =>
    startTransition(async () => {
      setError(null);
      const result = await submitSignup({
        token,
        lastName,
        firstName,
        lastNameKana,
        firstNameKana,
        phone,
        email,
        birthday,
        gender,
      });
      if (result.ok) {
        setDone(result);
      } else {
        setError(result.error);
      }
    });

  if (done) {
    return (
      <div className="rounded-xl border border-ink-200 bg-white p-6 text-center">
        <p className="text-sm font-medium text-emerald-700">
          {done.alreadyRegistered ? "すでに登録済みです" : "会員登録が完了しました🎉"}
        </p>
        <p className="mt-2 text-base font-semibold text-ink-900">{done.name} 様</p>
        <p className="tabular mt-1 text-sm text-ink-600">会員番号: {done.memberCode}</p>
        <a
          href={done.cardUrl}
          className="mt-5 block w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800"
        >
          デジタル会員証を表示
        </a>
        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          お会計の際に会員証のバーコードをレジでご提示ください。
          LINE のトークに「会員証」と送信するといつでも表示できます。
        </p>
      </div>
    );
  }

  return (
    <form
      className="space-y-4 rounded-xl border border-ink-200 bg-white p-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">
            姓 <span className="text-rose-600">*</span>
          </span>
          <input
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
            required
            placeholder="山田"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">名</span>
          <input
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
            placeholder="花子"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">セイ</span>
          <input
            value={lastNameKana}
            onChange={(event) => setLastNameKana(event.target.value)}
            placeholder="ヤマダ"
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">メイ</span>
          <input
            value={firstNameKana}
            onChange={(event) => setFirstNameKana(event.target.value)}
            placeholder="ハナコ"
            className={inputClass}
          />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">電話番号</span>
        <input
          type="tel"
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="090-1234-5678"
          className={inputClass}
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-ink-500">メールアドレス</span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="hanako@example.com"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">誕生日</span>
          <input
            type="date"
            value={birthday}
            onChange={(event) => setBirthday(event.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs text-ink-500">性別</span>
          <select
            value={gender}
            onChange={(event) => setGender(event.target.value)}
            className={`${inputClass} bg-white`}
          >
            <option value="UNKNOWN">回答しない</option>
            <option value="FEMALE">女性</option>
            <option value="MALE">男性</option>
            <option value="OTHER">その他</option>
          </select>
        </label>
      </div>

      {error && <p className="text-sm text-rose-700">{error}</p>}

      <button
        type="submit"
        disabled={pending || !lastName.trim()}
        className="w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
      >
        {pending ? "登録中..." : "登録する"}
      </button>
      <p className="text-center text-[11px] leading-relaxed text-ink-400">
        ご入力いただいた情報は、ポイント管理とご案内の送付にのみ利用します。
      </p>
    </form>
  );
}
