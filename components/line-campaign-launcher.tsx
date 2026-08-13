"use client";

import { useState } from "react";

import { LineCampaign } from "@/components/line-campaign";

/** 顧客一覧のヘッダーから LINE 一斉配信をモーダルで起動するボタン */
export function LineCampaignLauncher() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium text-ink-600 hover:bg-ink-50"
      >
        📣 LINE 一斉配信
      </button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="LINE 一斉配信"
          onClick={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-ink-900">LINE 一斉配信</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="閉じる"
                className="rounded-lg px-2 py-1 text-sm text-ink-400 hover:bg-ink-50 hover:text-ink-600"
              >
                ✕
              </button>
            </div>
            <LineCampaign />
          </div>
        </div>
      )}
    </>
  );
}
