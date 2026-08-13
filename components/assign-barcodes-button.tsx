"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";

import { assignMissingBarcodes, type AssignBarcodesState } from "@/app/(app)/products/[id]/actions";
import { JanMonthInput } from "@/components/jan-month-input";

const INITIAL: AssignBarcodesState = { status: "idle", message: "" };

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex items-center rounded-lg bg-ink-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
    >
      {pending ? "採番中..." : `JANコードを採番 (${count}件)`}
    </button>
  );
}

/** JAN 未設定の SKU に一括採番するボタン。採番後は画面が再検証されて反映される */
export function AssignBarcodesButton({
  productId,
  missingCount,
}: {
  productId: string;
  missingCount: number;
}) {
  const [state, formAction] = useActionState(
    assignMissingBarcodes.bind(null, productId),
    INITIAL,
  );
  const now = new Date();
  const defaultMonth = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-2">
      {state.status === "error" && <span className="text-xs text-rose-700">{state.message}</span>}
      {state.status === "success" && (
        <span className="text-xs text-emerald-700">{state.message}</span>
      )}
      {/* 採番ルール: 490 + 年月(YYMM) + 連番5桁 + チェックデジット */}
      <span className="flex items-center gap-1.5 text-xs text-ink-500">
        採番年月
        <JanMonthInput name="janYearMonth" defaultValue={defaultMonth} />
      </span>
      <SubmitButton count={missingCount} />
    </form>
  );
}
