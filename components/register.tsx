"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { checkout, lookupMember, type CheckoutResult, type MemberSummary } from "@/app/register/actions";
import { ScanButton } from "@/components/barcode-scanner";

type StoreOption = { code: string; name: string };
type StaffOption = { code: string; name: string; storeCode: string | null };

type CartLine = {
  sku: string;
  productName: string;
  colorName: string;
  sizeName: string;
  /** 税抜単価 */
  unitPrice: number;
  listPrice: number;
  taxRate: number;
  quantity: number;
};

const PAYMENT_METHODS = [
  { value: "CASH", label: "現金" },
  { value: "CREDIT", label: "クレジット" },
  { value: "E_MONEY", label: "電子マネー" },
  { value: "QR", label: "QR決済" },
] as const;

const RANK_LABEL: Record<string, string> = {
  REGULAR: "レギュラー",
  SILVER: "シルバー",
  GOLD: "ゴールド",
  PLATINUM: "プラチナ",
};

const yen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

/**
 * 店頭レジ。
 * バーコード / SKU で商品をカートに追加し、会員・支払方法を選んで会計する。
 * 会計は POS 連携 API と同じロジック (在庫減算・ポイント・LINE通知) を通る。
 */
export function Register({ stores, staff }: { stores: StoreOption[]; staff: StaffOption[] }) {
  const [storeCode, setStoreCode] = useState(stores[0]?.code ?? "");
  const [staffCode, setStaffCode] = useState("");
  const [lines, setLines] = useState<CartLine[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  const [discount, setDiscount] = useState(0);
  const [pointsUsed, setPointsUsed] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("CASH");
  const [tendered, setTendered] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<(CheckoutResult & { ok: true; change: number | null }) | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const storeStaff = staff.filter((s) => !s.storeCode || s.storeCode === storeCode);

  // 合計の計算はサーバー (ingestPosSale) と同じ式で見積もる
  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0);
    const taxableBase = Math.max(0, subtotal - discount);
    const weightedTaxRate =
      subtotal === 0
        ? 0.1
        : lines.reduce((sum, line) => sum + line.taxRate * line.unitPrice * line.quantity, 0) /
          subtotal;
    const tax = Math.round(taxableBase * weightedTaxRate);
    const total = taxableBase + tax;
    const payable = Math.max(0, total - pointsUsed);
    return { subtotal, tax, total, payable };
  }, [lines, discount, pointsUsed]);

  const addByCode = useCallback(
    async (raw: string) => {
      const code = raw.trim();
      if (!code || adding) return;
      setAdding(true);
      setError(null);
      try {
        const response = await fetch(`/api/barcode-lookup?code=${encodeURIComponent(code)}`);
        if (!response.ok) {
          setError(`商品が見つかりません: ${code}`);
          return;
        }
        const item = (await response.json()) as {
          sku: string;
          productName: string;
          colorName: string;
          sizeName: string;
          price: number;
          listPrice: number;
          taxRate: number;
        };
        setLines((prev) => {
          const index = prev.findIndex((line) => line.sku === item.sku);
          if (index >= 0) {
            return prev.map((line, i) =>
              i === index ? { ...line, quantity: line.quantity + 1 } : line,
            );
          }
          return [
            ...prev,
            {
              sku: item.sku,
              productName: item.productName,
              colorName: item.colorName,
              sizeName: item.sizeName,
              unitPrice: item.price,
              listPrice: item.listPrice,
              taxRate: item.taxRate,
              quantity: 1,
            },
          ];
        });
        setCodeInput("");
        codeRef.current?.focus();
      } catch {
        setError("商品の照会に失敗しました");
      } finally {
        setAdding(false);
      }
    },
    [adding],
  );

  const changeQuantity = (sku: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((line) =>
          line.sku === sku ? { ...line, quantity: line.quantity + delta } : line,
        )
        .filter((line) => line.quantity > 0),
    );
  };

  const attachMember = async () => {
    setMemberError(null);
    const result = await lookupMember(memberInput);
    if (result.found) {
      setMember(result);
      setMemberInput("");
    } else {
      setMemberError(`会員番号「${memberInput.trim()}」が見つかりません`);
    }
  };

  const detachMember = () => {
    setMember(null);
    setPointsUsed(0);
  };

  const maxPoints = Math.min(member?.points ?? 0, totals.total);

  const submit = async () => {
    if (lines.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await checkout({
        storeCode,
        staffCode: staffCode || undefined,
        memberCode: member?.memberCode,
        paymentMethod,
        discount,
        pointsUsed,
        lines: lines.map((line) => ({
          sku: line.sku,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
        })),
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      const tenderedValue = paymentMethod === "CASH" ? Number(tendered) || 0 : null;
      const change =
        tenderedValue !== null && tenderedValue >= result.total - result.pointsUsed
          ? tenderedValue - (result.total - result.pointsUsed)
          : null;
      setDone({ ...result, change });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setLines([]);
    setMember(null);
    setDiscount(0);
    setPointsUsed(0);
    setTendered("");
    setPaymentMethod("CASH");
    setError(null);
    setDone(null);
  };

  // ---- 会計完了画面 ----
  if (done) {
    return (
      <div className="mx-auto max-w-md">
        <div className="rounded-xl border border-ink-200 bg-white p-6 text-center">
          <p className="text-sm font-medium text-emerald-700">会計が完了しました</p>
          <p className="tabular mt-1 text-xs text-ink-400">{done.receiptNo}</p>
          <p className="tabular mt-4 text-3xl font-semibold">{yen.format(done.total)}</p>
          <dl className="mt-4 space-y-1.5 border-t border-ink-100 pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">小計 (税抜)</dt>
              <dd className="tabular">{yen.format(done.subtotal)}</dd>
            </div>
            {done.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">値引き</dt>
                <dd className="tabular text-rose-700">-{yen.format(done.discount)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-ink-400">消費税</dt>
              <dd className="tabular">{yen.format(done.tax)}</dd>
            </div>
            {done.pointsUsed > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">ポイント利用</dt>
                <dd className="tabular text-rose-700">-{yen.format(done.pointsUsed)}</dd>
              </div>
            )}
            {done.change !== null && (
              <div className="flex justify-between font-medium">
                <dt className="text-ink-400">お釣り</dt>
                <dd className="tabular text-ink-900">{yen.format(done.change)}</dd>
              </div>
            )}
            {done.pointsEarned > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">獲得ポイント</dt>
                <dd className="tabular text-emerald-700">+{done.pointsEarned} pt</dd>
              </div>
            )}
          </dl>
          <div className="mt-6 flex flex-col gap-2">
            <a
              href={`/sales/${done.saleId}/receipt`}
              target="_blank"
              className="rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800"
            >
              レシートを印刷
            </a>
            <Link
              href={`/sales/${done.saleId}`}
              className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 hover:bg-ink-50"
            >
              伝票詳細を見る
            </Link>
            <button
              type="button"
              onClick={reset}
              className="rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 hover:bg-ink-50"
            >
              次の会計へ
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- レジ画面 ----
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
      {/* 左: カート */}
      <div className="min-w-0 space-y-4 lg:col-span-3">
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void addByCode(codeInput);
            }}
          >
            <input
              ref={codeRef}
              value={codeInput}
              onChange={(event) => setCodeInput(event.target.value)}
              placeholder="JAN コード / SKU をスキャンまたは入力"
              autoComplete="off"
              autoFocus
              className="tabular w-full rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
            />
            <ScanButton onDetect={(value) => void addByCode(value)} />
            <button
              type="submit"
              disabled={adding}
              className="shrink-0 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:opacity-50"
            >
              追加
            </button>
          </form>
          {error && <p className="mt-2 text-sm text-rose-700">{error}</p>}
        </div>

        <div className="rounded-xl border border-ink-200 bg-white">
          <header className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-ink-800">カート</h2>
            <span className="tabular text-xs text-ink-400">
              {lines.reduce((sum, line) => sum + line.quantity, 0)} 点
            </span>
          </header>
          {lines.length === 0 ? (
            <p className="px-4 py-10 text-center text-sm text-ink-400">
              商品をスキャンするとここに追加されます
            </p>
          ) : (
            <ul>
              {lines.map((line) => (
                <li
                  key={line.sku}
                  className="flex items-center gap-3 border-b border-ink-100 px-4 py-3 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink-800">{line.productName}</p>
                    <p className="truncate text-xs text-ink-400">
                      {line.colorName} / {line.sizeName} · {line.sku}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.sku, -1)}
                      aria-label="1点減らす"
                      className="h-7 w-7 rounded-lg border border-ink-200 text-sm text-ink-600 hover:bg-ink-50"
                    >
                      −
                    </button>
                    <span className="tabular w-6 text-center text-sm font-medium">{line.quantity}</span>
                    <button
                      type="button"
                      onClick={() => changeQuantity(line.sku, 1)}
                      aria-label="1点増やす"
                      className="h-7 w-7 rounded-lg border border-ink-200 text-sm text-ink-600 hover:bg-ink-50"
                    >
                      ＋
                    </button>
                  </div>
                  <div className="w-20 shrink-0 text-right sm:w-24">
                    <p className="tabular text-sm font-medium">
                      {yen.format(line.unitPrice * line.quantity)}
                    </p>
                    {line.unitPrice < line.listPrice && (
                      <p className="tabular text-[11px] text-rose-700">セール価格</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 右: 会員・支払 */}
      <div className="min-w-0 space-y-4 lg:col-span-2">
        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">店舗</span>
              <select
                value={storeCode}
                onChange={(event) => {
                  setStoreCode(event.target.value);
                  setStaffCode("");
                }}
                className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-ink-400"
              >
                {stores.map((store) => (
                  <option key={store.code} value={store.code}>
                    {store.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">担当スタッフ</span>
              <select
                value={staffCode}
                onChange={(event) => setStaffCode(event.target.value)}
                className="rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-ink-400"
              >
                <option value="">未指定</option>
                {storeStaff.map((s) => (
                  <option key={s.code} value={s.code}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-ink-800">会員</h2>
          {member ? (
            <div className="mt-2 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-ink-800">{member.name} 様</p>
                <p className="tabular mt-0.5 text-xs text-ink-400">
                  {member.memberCode} · {RANK_LABEL[member.rank ?? ""] ?? member.rank} ·{" "}
                  {member.points?.toLocaleString("ja-JP")} pt
                </p>
              </div>
              <button
                type="button"
                onClick={detachMember}
                className="shrink-0 rounded-lg border border-ink-200 px-2.5 py-1 text-xs text-ink-600 hover:bg-ink-50"
              >
                解除
              </button>
            </div>
          ) : (
            <form
              className="mt-2 flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                void attachMember();
              }}
            >
              <input
                value={memberInput}
                onChange={(event) => setMemberInput(event.target.value)}
                placeholder="会員番号 (例: M-100001)"
                autoComplete="off"
                className="tabular w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
              />
              <button
                type="submit"
                disabled={!memberInput.trim()}
                className="shrink-0 rounded-lg border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-50 disabled:opacity-40"
              >
                照会
              </button>
            </form>
          )}
          {memberError && <p className="mt-2 text-xs text-rose-700">{memberError}</p>}
          {member && maxPoints > 0 && (
            <label className="mt-3 flex items-center justify-between gap-3 border-t border-ink-100 pt-3">
              <span className="text-xs text-ink-400">ポイント利用 (最大 {maxPoints.toLocaleString("ja-JP")})</span>
              <input
                type="number"
                min={0}
                max={maxPoints}
                value={pointsUsed || ""}
                onChange={(event) =>
                  setPointsUsed(Math.max(0, Math.min(maxPoints, Number(event.target.value) || 0)))
                }
                placeholder="0"
                className="tabular w-24 rounded-lg border border-ink-200 px-2 py-1 text-right text-sm outline-none focus:border-ink-400"
              />
            </label>
          )}
        </div>

        <div className="rounded-xl border border-ink-200 bg-white p-4">
          <h2 className="text-sm font-semibold text-ink-800">お会計</h2>
          <dl className="mt-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">小計 (税抜)</dt>
              <dd className="tabular">{yen.format(totals.subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-ink-400">値引き (税抜)</dt>
              <dd>
                <input
                  type="number"
                  min={0}
                  max={totals.subtotal}
                  value={discount || ""}
                  onChange={(event) =>
                    setDiscount(
                      Math.max(0, Math.min(totals.subtotal, Number(event.target.value) || 0)),
                    )
                  }
                  placeholder="0"
                  className="tabular w-24 rounded-lg border border-ink-200 px-2 py-1 text-right text-sm outline-none focus:border-ink-400"
                />
              </dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">消費税</dt>
              <dd className="tabular">{yen.format(totals.tax)}</dd>
            </div>
            {pointsUsed > 0 && (
              <div className="flex justify-between">
                <dt className="text-ink-400">ポイント利用</dt>
                <dd className="tabular text-rose-700">-{yen.format(pointsUsed)}</dd>
              </div>
            )}
            <div className="flex justify-between border-t border-ink-100 pt-2 text-base font-semibold">
              <dt>お支払い</dt>
              <dd className="tabular">{yen.format(totals.payable)}</dd>
            </div>
          </dl>

          <div className="mt-3 grid grid-cols-2 gap-1.5">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method.value}
                type="button"
                onClick={() => setPaymentMethod(method.value)}
                className={`rounded-lg border px-2 py-1.5 text-sm font-medium transition-colors ${
                  paymentMethod === method.value
                    ? "border-ink-900 bg-ink-900 text-white"
                    : "border-ink-200 bg-white text-ink-600 hover:bg-ink-50"
                }`}
              >
                {method.label}
              </button>
            ))}
          </div>

          {paymentMethod === "CASH" && (
            <label className="mt-3 flex items-center justify-between gap-3">
              <span className="text-xs text-ink-400">お預かり</span>
              <input
                type="number"
                min={0}
                value={tendered}
                onChange={(event) => setTendered(event.target.value)}
                placeholder={String(totals.payable)}
                className="tabular w-32 rounded-lg border border-ink-200 px-2 py-1 text-right text-sm outline-none focus:border-ink-400"
              />
            </label>
          )}
          {paymentMethod === "CASH" && Number(tendered) >= totals.payable && totals.payable > 0 && (
            <p className="tabular mt-1.5 text-right text-sm text-ink-600">
              お釣り {yen.format(Number(tendered) - totals.payable)}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={lines.length === 0 || busy}
            className="mt-4 w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {busy ? "処理中..." : `会計する (${yen.format(totals.payable)})`}
          </button>
        </div>
      </div>
    </div>
  );
}
