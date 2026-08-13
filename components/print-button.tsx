"use client";

/** レシートをサイドメニューのない別ウィンドウで開くボタン */
export function ReceiptWindowButton({ saleId }: { saleId: string }) {
  return (
    <button
      type="button"
      onClick={() =>
        window.open(`/sales/${saleId}/receipt`, "wearpos-receipt", "popup=yes,width=480,height=780")
      }
      className="rounded-lg bg-ink-900 px-3.5 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
    >
      レシート印刷
    </button>
  );
}

/** レシート用の別ウィンドウを閉じるボタン。通常タブで開いた場合は何もしないことがある */
export function CloseWindowButton() {
  return (
    <button
      type="button"
      onClick={() => window.close()}
      className="rounded-lg border border-ink-200 px-4 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
    >
      閉じる
    </button>
  );
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
    >
      印刷する
    </button>
  );
}
