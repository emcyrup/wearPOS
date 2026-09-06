/**
 * 返品金額の計算。
 *
 * 画面 (返品プレビュー) とサーバー (実際の返品処理) の両方から同じ計算を使うため、
 * DB に依存しない純粋な関数だけをここに置く。
 */

/** 返品可能な明細の状態 */
export type ReturnableLine = {
  lineId: string;
  /** 商品名 (手入力商品は入力された名称) */
  name: string;
  sku: string | null;
  colorName: string | null;
  sizeName: string | null;
  variantId: string | null;
  /** 手入力商品の表示名 (通常商品は null) */
  note: string | null;
  taxRate: number;
  quantity: number;
  /** すでに返品済みの点数 */
  returnedQuantity: number;
  /** これから返せる点数 */
  returnableQuantity: number;
  unitPrice: number;
  discount: number;
  lineTotal: number;
  listPriceAtSale: number;
  /** 未返品ぶんの明細金額 (税抜)。全部返すときはこの額がそのまま戻る */
  remainingLineTotal: number;
};

/** 元伝票の金額 */
export type SaleTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  pointsUsed: number;
  pointsEarned: number;
};

/** 返品済みの累計 (元伝票に対して) */
export type ReturnedTotals = {
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  /** 返還済みの利用ポイント */
  pointsRefunded: number;
  /** 取消済みの獲得ポイント */
  pointsRevoked: number;
  /** これまでに作成した返品伝票の数 */
  count: number;
  /**
   * 明細を特定できない返品伝票 (originalLineId を持たない旧データ) がある。
   * この場合は伝票まるごとの返品として扱う。
   */
  legacyFullReturn: boolean;
};

/** 返品する明細と点数の指定 */
export type ReturnLineInput = { lineId: string; quantity: number };

/** 1回の返品で戻す金額の内訳 */
export type ReturnAmounts = {
  lines: {
    lineId: string;
    variantId: string | null;
    quantity: number;
    unitPrice: number;
    discount: number;
    lineTotal: number;
    listPriceAtSale: number;
    note: string | null;
  }[];
  subtotal: number;
  /** 伝票値引きのうち、今回の返品に按分される額 */
  discount: number;
  tax: number;
  /** 返金する総額 (税込) */
  total: number;
  /** 返還する利用ポイント */
  pointsRefunded: number;
  /** 取り消す獲得ポイント */
  pointsRevoked: number;
  /** 現金や決済端末で返す額 (総額 - 返還ポイント) */
  refundNet: number;
  /** この返品で伝票のすべてが返品済みになるか */
  isFinal: boolean;
  /** 返品する点数の合計 */
  itemCount: number;
};

/**
 * 返品する金額を計算する。
 *
 * 端数の扱い:
 * 途中の返品は元伝票に対する按分 (四捨五入) で求め、**最後の返品では残額をそのまま戻す**。
 * これにより、何回に分けて返しても合計は必ず元伝票と一致する。
 */
export function calcReturnAmounts(
  sale: SaleTotals,
  state: { lines: ReturnableLine[]; returned: ReturnedTotals },
  input: ReturnLineInput[],
): { ok: true; amounts: ReturnAmounts } | { ok: false; error: string } {
  const stateById = new Map(state.lines.map((line) => [line.lineId, line]));

  const requested = input.filter((row) => row.quantity > 0);
  if (requested.length === 0) return { ok: false, error: "返品する商品を選んでください" };

  const lines: ReturnAmounts["lines"] = [];
  for (const row of requested) {
    const line = stateById.get(row.lineId);
    if (!line) return { ok: false, error: "返品する明細が見つかりません" };
    if (!Number.isInteger(row.quantity) || row.quantity < 0) {
      return { ok: false, error: "返品する点数が不正です" };
    }
    if (row.quantity > line.returnableQuantity) {
      return {
        ok: false,
        error: `${line.name} は残り ${line.returnableQuantity} 点までしか返品できません`,
      };
    }

    const isLineFinal = row.quantity === line.returnableQuantity;
    // 明細を全部返すときは残額をそのまま戻す (按分の端数が消えない)
    const lineTotal = isLineFinal
      ? line.remainingLineTotal
      : Math.round((line.lineTotal * row.quantity) / line.quantity);
    const discount = isLineFinal
      ? Math.max(
          0,
          line.discount - Math.round((line.discount * line.returnedQuantity) / line.quantity),
        )
      : Math.round((line.discount * row.quantity) / line.quantity);

    lines.push({
      lineId: line.lineId,
      variantId: line.variantId,
      quantity: row.quantity,
      unitPrice: line.unitPrice,
      discount,
      lineTotal,
      listPriceAtSale: line.listPriceAtSale,
      note: line.note,
    });
  }

  // この返品ですべての明細が返品済みになるか
  const isFinal = state.lines.every((line) => {
    const asked = requested.find((row) => row.lineId === line.lineId)?.quantity ?? 0;
    return line.returnableQuantity - asked === 0;
  });

  const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);

  let slipDiscount: number;
  let tax: number;
  let total: number;
  if (isFinal) {
    // 最後の返品は残りをそのまま戻す
    slipDiscount = Math.max(0, sale.discount - state.returned.discount);
    tax = Math.max(0, sale.tax - state.returned.tax);
    total = Math.max(0, sale.total - state.returned.total);
  } else {
    slipDiscount =
      sale.subtotal === 0 ? 0 : Math.round((sale.discount * subtotal) / sale.subtotal);
    const taxableBase = Math.max(0, subtotal - slipDiscount);
    const rateByLine = new Map(state.lines.map((line) => [line.lineId, line.taxRate]));
    const weightedTaxRate =
      subtotal === 0
        ? 0.1
        : lines.reduce(
            (sum, line) => sum + (rateByLine.get(line.lineId) ?? 0.1) * line.lineTotal,
            0,
          ) / subtotal;
    tax = Math.round(taxableBase * weightedTaxRate);
    total = taxableBase + tax;
  }

  // ポイントは返金額の割合で按分し、最後の返品で残りを精算する
  const remainingPointsUsed = Math.max(0, sale.pointsUsed - state.returned.pointsRefunded);
  const remainingPointsEarned = Math.max(0, sale.pointsEarned - state.returned.pointsRevoked);
  const ratio = sale.total > 0 ? total / sale.total : 0;
  const pointsRefunded = isFinal
    ? remainingPointsUsed
    : Math.min(remainingPointsUsed, Math.round(sale.pointsUsed * ratio));
  const pointsRevoked = isFinal
    ? remainingPointsEarned
    : Math.min(remainingPointsEarned, Math.round(sale.pointsEarned * ratio));

  return {
    ok: true,
    amounts: {
      lines,
      subtotal,
      discount: slipDiscount,
      tax,
      total,
      pointsRefunded,
      pointsRevoked,
      refundNet: Math.max(0, total - pointsRefunded),
      isFinal,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    },
  };
}

/** 返金の内訳 (支払方法ごと) */
export type RefundPayment = { method: string; amount: number; note?: string };

/**
 * 「元の支払い方法どおり」に返す場合の内訳を作る。
 * 元伝票の支払内訳の比率で按分し、端数は最後の行に寄せて合計を一致させる。
 */
export function refundByOriginalPayments(
  payments: { method: string; amount: number }[],
  fallbackMethod: string,
  refundNet: number,
): RefundPayment[] {
  if (refundNet <= 0) return [];

  const paidTotal = payments.reduce((sum, payment) => sum + payment.amount, 0);
  if (payments.length === 0 || paidTotal <= 0) {
    return [{ method: fallbackMethod, amount: refundNet }];
  }

  const rows = payments.map((payment) => ({
    method: payment.method,
    amount: Math.round((payment.amount * refundNet) / paidTotal),
  }));
  // 按分の端数を最後の行で調整する
  const diff = refundNet - rows.reduce((sum, row) => sum + row.amount, 0);
  if (diff !== 0) rows[rows.length - 1].amount += diff;

  return rows.filter((row) => row.amount > 0);
}
