"use client";

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
