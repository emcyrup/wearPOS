"use client";

import Link from "next/link";
import { useCallback, useMemo, useRef, useState } from "react";

import { checkout, lookupMember, type CheckoutResult, type MemberSummary } from "@/app/register/actions";
import { ScanButton } from "@/components/barcode-scanner";
import { MemberSearchModal, ProductSearchModal } from "@/components/register-search";

type StoreOption = { code: string; name: string };
type StaffOption = { code: string; name: string; storeCode: string | null };

type CartLine = {
  /** 行の識別子。通常商品は SKU、手入力商品は free-N */
  key: string;
  sku?: string;
  /** 手入力 (未登録) 商品かどうか */
  isFree: boolean;
  productName: string;
  colorName: string;
  sizeName: string;
  /** 税抜単価 */
  unitPrice: number;
  listPrice: number;
  taxRate: number;
  quantity: number;
  /** 明細値引き (税抜・明細合計に対する額) */
  discount: number;
  /** % 値引きモードのときの割合。¥ 指定なら null */
  discountPct: number | null;
};

type DiscountMode = "yen" | "pct";

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

/** 明細金額 (値引き前・税抜) */
function lineAmount(line: CartLine): number {
  return line.unitPrice * line.quantity;
}

/** % 値引きの額を計算する (端数は四捨五入) */
function pctDiscount(amount: number, pct: number): number {
  return Math.round((amount * pct) / 100);
}

/** 数量変更に合わせて明細値引きを再計算する (%: 割合維持 / ¥: 明細金額でキャップ) */
function withQuantity(line: CartLine, quantity: number): CartLine {
  const next = { ...line, quantity };
  const amount = lineAmount(next);
  next.discount =
    next.discountPct !== null
      ? Math.min(amount, pctDiscount(amount, next.discountPct))
      : Math.min(amount, next.discount);
  return next;
}

/**
 * 店頭レジ。
 * バーコード / SKU で商品をカートに追加し、会員・支払方法を選んで会計する。
 * 会計は POS 連携 API と同じロジック (在庫減算・ポイント・LINE通知) を通る。
 * ログインなしでも使えるため、担当者はスタッフバーコードの読み取りでも選べる。
 */
export function Register({ stores, staff }: { stores: StoreOption[]; staff: StaffOption[] }) {
  const [storeCode, setStoreCode] = useState(stores[0]?.code ?? "");
  const [staffCode, setStaffCode] = useState("");
  const [staffError, setStaffError] = useState<string | null>(null);
  const [lines, setLines] = useState<CartLine[]>([]);
  const [codeInput, setCodeInput] = useState("");
  const [adding, setAdding] = useState(false);
  const [member, setMember] = useState<MemberSummary | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [memberError, setMemberError] = useState<string | null>(null);
  /** 伝票値引き。mode=pct のときは value を割合(%)として扱う */
  const [discountMode, setDiscountMode] = useState<DiscountMode>("yen");
  const [discountValue, setDiscountValue] = useState(0);
  /** 明細値引きの入力欄を開いている行 */
  const [discountOpen, setDiscountOpen] = useState<Record<string, boolean>>({});
  const [pointsUsed, setPointsUsed] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]["value"]>("CASH");
  const [tendered, setTendered] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** 現金以外で決済完了を確認するダイアログ */
  const [confirmingPayment, setConfirmingPayment] = useState(false);
  /** バーコードが読めないとき用の検索モーダル */
  const [searchingProduct, setSearchingProduct] = useState(false);
  const [searchingMember, setSearchingMember] = useState(false);
  /** 未登録商品の手入力フォーム */
  const [freeItemOpen, setFreeItemOpen] = useState(false);
  const [freeName, setFreeName] = useState("");
  const [freePrice, setFreePrice] = useState("");
  const freeSeq = useRef(0);
  const [done, setDone] = useState<(CheckoutResult & { ok: true; change: number | null }) | null>(null);
  const codeRef = useRef<HTMLInputElement | null>(null);

  const storeStaff = staff.filter((s) => !s.storeCode || s.storeCode === storeCode);

  // 合計の計算はサーバー (ingestPosSale) と同じ式で見積もる
  const totals = useMemo(() => {
    const subtotal = lines.reduce((sum, line) => sum + lineAmount(line) - line.discount, 0);
    const voucherDiscount = Math.max(
      0,
      Math.min(
        subtotal,
        discountMode === "pct" ? pctDiscount(subtotal, discountValue) : discountValue,
      ),
    );
    const taxableBase = Math.max(0, subtotal - voucherDiscount);
    const weightedTaxRate =
      subtotal === 0
        ? 0.1
        : lines.reduce(
            (sum, line) => sum + line.taxRate * (lineAmount(line) - line.discount),
            0,
          ) / subtotal;
    const tax = Math.round(taxableBase * weightedTaxRate);
    const total = taxableBase + tax;
    const payable = Math.max(0, total - pointsUsed);
    return { subtotal, voucherDiscount, tax, total, payable };
  }, [lines, discountMode, discountValue, pointsUsed]);

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
              i === index ? withQuantity(line, line.quantity + 1) : line,
            );
          }
          return [
            ...prev,
            {
              key: item.sku,
              sku: item.sku,
              isFree: false,
              productName: item.productName,
              colorName: item.colorName,
              sizeName: item.sizeName,
              unitPrice: item.price,
              listPrice: item.listPrice,
              taxRate: item.taxRate,
              quantity: 1,
              discount: 0,
              discountPct: null,
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

  const changeQuantity = (key: string, delta: number) => {
    setLines((prev) =>
      prev
        .map((line) => (line.key === key ? withQuantity(line, line.quantity + delta) : line))
        .filter((line) => line.quantity > 0),
    );
  };

  /** 明細値引きの変更。mode=pct なら value は割合、yen なら金額 */
  const setLineDiscount = (key: string, mode: DiscountMode, value: number) => {
    setLines((prev) =>
      prev.map((line) => {
        if (line.key !== key) return line;
        const amount = lineAmount(line);
        if (mode === "pct") {
          const pct = Math.max(0, Math.min(100, value));
          return { ...line, discountPct: pct, discount: Math.min(amount, pctDiscount(amount, pct)) };
        }
        return { ...line, discountPct: null, discount: Math.max(0, Math.min(amount, value)) };
      }),
    );
  };

  const addFreeItem = () => {
    const name = freeName.trim();
    const price = Number(freePrice);
    if (!name || !Number.isFinite(price) || price < 0) return;
    freeSeq.current += 1;
    setLines((prev) => [
      ...prev,
      {
        key: `free-${freeSeq.current}`,
        isFree: true,
        productName: name,
        colorName: "",
        sizeName: "",
        unitPrice: Math.round(price),
        listPrice: Math.round(price),
        taxRate: 0.1,
        quantity: 1,
        discount: 0,
        discountPct: null,
      },
    ]);
    setFreeName("");
    setFreePrice("");
    setFreeItemOpen(false);
  };

  /** スタッフバーコード (スタッフコードの Code128) を読み取って担当者をセットする */
  const attachStaffByCode = (raw: string) => {
    const code = raw.trim();
    if (!code) return;
    const hit = staff.find((s) => s.code.toLowerCase() === code.toLowerCase());
    if (!hit) {
      setStaffError(`スタッフコード「${code}」が見つかりません`);
      return;
    }
    setStaffError(null);
    // 他店舗所属のスタッフなら店舗も合わせて切り替える
    if (hit.storeCode && hit.storeCode !== storeCode) setStoreCode(hit.storeCode);
    setStaffCode(hit.code);
  };

  const attachMember = async (code?: string) => {
    const value = (code ?? memberInput).trim();
    if (!value) return;
    setMemberError(null);
    const result = await lookupMember(value);
    if (result.found) {
      setMember(result);
      setMemberInput("");
    } else {
      setMemberError(`会員番号「${value}」が見つかりません`);
    }
  };

  const detachMember = () => {
    setMember(null);
    setPointsUsed(0);
  };

  const maxPoints = Math.min(member?.points ?? 0, totals.total);

  // ---- 会計前のチェック ----
  const isCash = paymentMethod === "CASH";
  const tenderedValue = Number(tendered);
  const tenderedEntered = tendered.trim() !== "" && Number.isFinite(tenderedValue);
  const shortage = tenderedEntered ? Math.max(0, totals.payable - tenderedValue) : totals.payable;
  // 現金は預かり金の入力が必須。ポイントで全額充当された場合 (支払0円) は不要
  const cashReady = !isCash || totals.payable === 0 || (tenderedEntered && shortage === 0);
  const canCheckout = lines.length > 0 && !busy && cashReady;

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
        discount: totals.voucherDiscount,
        pointsUsed,
        lines: lines.map((line) => ({
          sku: line.isFree ? undefined : line.sku,
          name: line.isFree ? line.productName : undefined,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          discount: line.discount,
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
      setConfirmingPayment(false);
    }
  };

  /**
   * 会計ボタン。
   * 現金はそのまま会計、それ以外は決済端末での処理が済んだかを確認してから会計する。
   */
  const requestCheckout = () => {
    if (!canCheckout) return;
    if (isCash) {
      void submit();
      return;
    }
    setConfirmingPayment(true);
  };

  const reset = () => {
    setLines([]);
    setMember(null);
    setDiscountMode("yen");
    setDiscountValue(0);
    setDiscountOpen({});
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            <button
              type="button"
              onClick={() => setSearchingProduct(true)}
              className="text-xs text-accent hover:underline"
            >
              バーコードが読み取れない場合は商品名で検索
            </button>
            <button
              type="button"
              onClick={() => setFreeItemOpen(true)}
              className="text-xs text-accent hover:underline"
            >
              未登録商品を手入力で追加
            </button>
          </div>
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
                <li key={line.key} className="border-b border-ink-100 px-4 py-3 last:border-0">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink-800">{line.productName}</p>
                      <p className="truncate text-xs text-ink-400">
                        {line.isFree
                          ? "手入力 (未登録商品)"
                          : `${line.colorName} / ${line.sizeName} · ${line.sku}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => changeQuantity(line.key, -1)}
                        aria-label="1点減らす"
                        className="h-7 w-7 rounded-lg border border-ink-200 text-sm text-ink-600 hover:bg-ink-50"
                      >
                        −
                      </button>
                      <span className="tabular w-6 text-center text-sm font-medium">{line.quantity}</span>
                      <button
                        type="button"
                        onClick={() => changeQuantity(line.key, 1)}
                        aria-label="1点増やす"
                        className="h-7 w-7 rounded-lg border border-ink-200 text-sm text-ink-600 hover:bg-ink-50"
                      >
                        ＋
                      </button>
                    </div>
                    <div className="w-20 shrink-0 text-right sm:w-24">
                      <p className="tabular text-sm font-medium">
                        {yen.format(lineAmount(line) - line.discount)}
                      </p>
                      {line.discount > 0 ? (
                        <p className="tabular text-[11px] text-rose-700">
                          値引き -{yen.format(line.discount)}
                        </p>
                      ) : (
                        line.unitPrice < line.listPrice && (
                          <p className="tabular text-[11px] text-rose-700">セール価格</p>
                        )
                      )}
                    </div>
                  </div>
                  {discountOpen[line.key] || line.discount > 0 ? (
                    <div className="mt-2 flex items-center justify-end gap-1.5">
                      <span className="text-xs text-ink-400">明細値引き</span>
                      <input
                        type="number"
                        min={0}
                        max={line.discountPct !== null ? 100 : lineAmount(line)}
                        value={
                          (line.discountPct !== null ? line.discountPct : line.discount) || ""
                        }
                        onChange={(event) =>
                          setLineDiscount(
                            line.key,
                            line.discountPct !== null ? "pct" : "yen",
                            Number(event.target.value) || 0,
                          )
                        }
                        placeholder="0"
                        aria-label={`${line.productName} の明細値引き`}
                        className="tabular w-20 rounded-lg border border-ink-200 px-2 py-1 text-right text-sm outline-none focus:border-ink-400"
                      />
                      <div className="flex overflow-hidden rounded-lg border border-ink-200">
                        {(
                          [
                            ["yen", "¥"],
                            ["pct", "%"],
                          ] as const
                        ).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            onClick={() =>
                              setLineDiscount(
                                line.key,
                                mode,
                                // モード切替時は入力し直す前提で 0 にリセットしない
                                mode === "pct"
                                  ? (line.discountPct ??
                                      (lineAmount(line) > 0
                                        ? Math.round((line.discount / lineAmount(line)) * 100)
                                        : 0))
                                  : line.discount,
                              )
                            }
                            className={`px-2 py-1 text-xs font-medium ${
                              (mode === "pct") === (line.discountPct !== null)
                                ? "bg-ink-900 text-white"
                                : "bg-white text-ink-600 hover:bg-ink-50"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-1 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setDiscountOpen((prev) => ({ ...prev, [line.key]: true }))
                        }
                        className="text-[11px] text-ink-400 hover:text-accent hover:underline"
                      >
                        この明細を値引き
                      </button>
                    </div>
                  )}
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
            <div className="flex flex-col gap-1">
              <span className="text-xs text-ink-400">担当スタッフ</span>
              <div className="flex gap-1.5">
                <select
                  value={staffCode}
                  onChange={(event) => {
                    setStaffCode(event.target.value);
                    setStaffError(null);
                  }}
                  aria-label="担当スタッフ"
                  className="w-full min-w-0 rounded-lg border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-ink-400"
                >
                  <option value="">未指定</option>
                  {storeStaff.map((s) => (
                    <option key={s.code} value={s.code}>
                      {s.name}
                    </option>
                  ))}
                </select>
                {/* スタッフバーコード (名札) を読み取って担当者を選べる */}
                <ScanButton onDetect={attachStaffByCode} />
              </div>
            </div>
          </div>
          {staffError && <p className="mt-2 text-xs text-rose-700">{staffError}</p>}
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
                placeholder="会員番号 (例: M10001)"
                autoComplete="off"
                className="tabular w-full rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
              />
              {/* お客様の LINE に表示した会員証バーコードをそのままスキャンできる */}
              <ScanButton
                onDetect={(value) => {
                  setMemberInput(value);
                  void attachMember(value);
                }}
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
          {!member && (
            <button
              type="button"
              onClick={() => setSearchingMember(true)}
              className="mt-2 text-xs text-accent hover:underline"
            >
              会員証がない場合はお名前・電話番号で検索
            </button>
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
            <div className="flex items-center justify-between gap-2">
              <dt className="text-ink-400">伝票値引き (税抜)</dt>
              <dd className="flex items-center gap-1.5">
                <input
                  type="number"
                  min={0}
                  max={discountMode === "pct" ? 100 : totals.subtotal}
                  value={discountValue || ""}
                  onChange={(event) => setDiscountValue(Math.max(0, Number(event.target.value) || 0))}
                  placeholder="0"
                  aria-label="伝票値引き"
                  className="tabular w-20 rounded-lg border border-ink-200 px-2 py-1 text-right text-sm outline-none focus:border-ink-400"
                />
                <div className="flex overflow-hidden rounded-lg border border-ink-200">
                  {(
                    [
                      ["yen", "¥"],
                      ["pct", "%"],
                    ] as const
                  ).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setDiscountMode(mode);
                        setDiscountValue(0);
                      }}
                      className={`px-2 py-1 text-xs font-medium ${
                        discountMode === mode
                          ? "bg-ink-900 text-white"
                          : "bg-white text-ink-600 hover:bg-ink-50"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </dd>
            </div>
            {totals.voucherDiscount > 0 && (
              <div className="flex justify-between text-xs">
                <dt className="text-ink-400">値引き額</dt>
                <dd className="tabular text-rose-700">-{yen.format(totals.voucherDiscount)}</dd>
              </div>
            )}
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

          {isCash && totals.payable > 0 && (
            <>
              <label className="mt-3 flex items-center justify-between gap-3">
                <span className="text-xs text-ink-400">
                  お預かり <span className="text-rose-600">*</span>
                </span>
                <input
                  type="number"
                  min={0}
                  value={tendered}
                  onChange={(event) => setTendered(event.target.value)}
                  placeholder={String(totals.payable)}
                  aria-label="お預かり金額"
                  className={`tabular w-32 rounded-lg border px-2 py-1 text-right text-sm outline-none ${
                    tenderedEntered && shortage > 0
                      ? "border-rose-400 focus:border-rose-500"
                      : "border-ink-200 focus:border-ink-400"
                  }`}
                />
              </label>
              {!tenderedEntered ? (
                <p className="mt-1.5 text-right text-xs text-ink-400">
                  お預かり金額を入力すると会計できます
                </p>
              ) : shortage > 0 ? (
                <p className="tabular mt-1.5 text-right text-sm text-rose-700">
                  {yen.format(shortage)} 不足しています
                </p>
              ) : (
                <p className="tabular mt-1.5 text-right text-sm text-ink-600">
                  お釣り {yen.format(tenderedValue - totals.payable)}
                </p>
              )}
            </>
          )}

          <button
            type="button"
            onClick={requestCheckout}
            disabled={!canCheckout}
            title={!cashReady ? "お預かり金額を入力してください" : undefined}
            className="mt-4 w-full rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
          >
            {busy ? "処理中..." : `会計する (${yen.format(totals.payable)})`}
          </button>
        </div>
      </div>

      {/* バーコードが読めないとき: 商品名などで検索してカートに追加 */}
      {searchingProduct && (
        <ProductSearchModal
          storeCode={storeCode}
          onSelect={(sku) => {
            setSearchingProduct(false);
            void addByCode(sku);
          }}
          onClose={() => setSearchingProduct(false)}
        />
      )}

      {/* 会員証・会員番号が分からないとき: 氏名などで検索して紐付ける */}
      {searchingMember && (
        <MemberSearchModal
          onSelect={(memberCode) => {
            setSearchingMember(false);
            void attachMember(memberCode);
          }}
          onClose={() => setSearchingMember(false)}
        />
      )}

      {/* 未登録商品: 商品名と価格を手打ちしてカートに追加 (在庫は動かさない) */}
      {freeItemOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="未登録商品の手入力"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink-900">未登録商品を追加</h2>
            <p className="mt-1 text-xs leading-relaxed text-ink-400">
              バーコードが読み取れず商品登録もされていないものを、名前と価格で直接カートに追加します。在庫数は変動しません。
            </p>
            <form
              className="mt-4 space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                addFreeItem();
              }}
            >
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-400">商品名</span>
                <input
                  value={freeName}
                  onChange={(event) => setFreeName(event.target.value)}
                  placeholder="例: ノベルティトートバッグ"
                  autoFocus
                  className="rounded-lg border border-ink-200 px-3 py-2 text-sm outline-none focus:border-ink-400"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ink-400">価格 (税抜)</span>
                <input
                  type="number"
                  min={0}
                  value={freePrice}
                  onChange={(event) => setFreePrice(event.target.value)}
                  placeholder="例: 1500"
                  className="tabular rounded-lg border border-ink-200 px-3 py-2 text-right text-sm outline-none focus:border-ink-400"
                />
              </label>
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setFreeItemOpen(false)}
                  className="flex-1 rounded-lg border border-ink-200 bg-white px-4 py-2 text-sm text-ink-600 hover:bg-ink-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={!freeName.trim() || !(Number(freePrice) >= 0) || freePrice.trim() === ""}
                  className="flex-1 rounded-lg bg-ink-900 px-4 py-2 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-40"
                >
                  カートに追加
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 現金以外: 決済端末での処理が完了したかを確認する */}
      {confirmingPayment && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-label="決済の確認"
        >
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-ink-900">決済は完了しましたか？</h2>
            <p className="mt-2 text-sm leading-relaxed text-ink-600">
              {`${PAYMENT_METHODS.find((method) => method.value === paymentMethod)?.label}でのお支払いが決済端末で完了したことを確認してから、会計を確定してください。`}
            </p>
            <dl className="mt-4 space-y-1.5 rounded-lg bg-ink-50 px-4 py-3 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-400">支払方法</dt>
                <dd className="font-medium text-ink-800">
                  {PAYMENT_METHODS.find((method) => method.value === paymentMethod)?.label}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-400">お支払い金額</dt>
                <dd className="tabular text-base font-semibold text-ink-900">
                  {yen.format(totals.payable)}
                </dd>
              </div>
            </dl>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmingPayment(false)}
                disabled={busy}
                className="flex-1 rounded-lg border border-ink-200 bg-white px-4 py-2.5 text-sm font-medium text-ink-600 hover:bg-ink-50 disabled:opacity-50"
              >
                戻る
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy}
                autoFocus
                className="flex-1 rounded-lg bg-ink-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink-800 disabled:opacity-50"
              >
                {busy ? "処理中..." : "決済完了・会計する"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
