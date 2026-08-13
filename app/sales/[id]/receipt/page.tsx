import Link from "next/link";
import { notFound } from "next/navigation";

import { Barcode } from "@/components/barcode";
import { PrintButton } from "@/components/print-button";
import { PAYMENT_METHOD_LABEL } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { formatDateTime, formatYen, fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * レシートの印刷ページ。
 * レシートプリンタ (58mm) を想定した細長いレイアウトで、
 * ブラウザの印刷機能から出力する。
 */
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      store: true,
      staff: true,
      customer: true,
      lines: { include: { variant: { include: { product: true } } } },
    },
  });

  if (!sale) notFound();

  const itemCount = sale.lines.reduce((sum, line) => sum + line.quantity, 0);
  const payable = Math.max(0, sale.total - sale.pointsUsed);

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
        <Link href={`/sales/${sale.id}`} className="text-sm text-ink-400 hover:text-ink-600">
          ← 伝票詳細
        </Link>
        <PrintButton />
      </div>

      <div className="mx-auto w-[280px] rounded-lg border border-ink-200 bg-white px-4 py-5 text-[12px] leading-relaxed text-ink-900 print:w-[58mm] print:rounded-none print:border-0">
        <p className="text-center text-sm font-semibold tracking-wide">wearPOS</p>
        <p className="mt-0.5 text-center text-[11px] text-ink-600">{sale.store.name}</p>

        <div className="tabular mt-3 space-y-0.5 border-t border-dashed border-ink-300 pt-2 text-[11px] text-ink-600">
          <p>{formatDateTime(sale.soldAt)}</p>
          <p>
            伝票 {sale.receiptNo}
            {sale.staff ? ` / 担当 ${sale.staff.name}` : ""}
          </p>
          {sale.customer && <p>会員 {fullName(sale.customer)} 様</p>}
        </div>

        <div className="mt-2 border-t border-dashed border-ink-300 pt-2">
          {sale.lines.map((line) => (
            <div key={line.id} className="mb-1.5">
              {/* 手入力商品 (variant なし) は明細 note の商品名を印字する */}
              <p className="truncate">{line.variant?.product.name ?? line.note ?? "手入力商品"}</p>
              <div className="tabular flex justify-between text-[11px] text-ink-600">
                <span>
                  {line.variant ? `${line.variant.colorName}/${line.variant.sizeName} ` : ""}×
                  {line.quantity}
                </span>
                <span>{formatYen(line.lineTotal)}</span>
              </div>
            </div>
          ))}
        </div>

        <dl className="tabular mt-1 space-y-0.5 border-t border-dashed border-ink-300 pt-2">
          <div className="flex justify-between text-[11px] text-ink-600">
            <dt>小計 ({itemCount}点・税抜)</dt>
            <dd>{formatYen(sale.subtotal)}</dd>
          </div>
          {sale.discount > 0 && (
            <div className="flex justify-between text-[11px] text-ink-600">
              <dt>値引き</dt>
              <dd>-{formatYen(sale.discount)}</dd>
            </div>
          )}
          <div className="flex justify-between text-[11px] text-ink-600">
            <dt>消費税</dt>
            <dd>{formatYen(sale.tax)}</dd>
          </div>
          <div className="flex justify-between pt-1 text-sm font-semibold">
            <dt>合計</dt>
            <dd>{formatYen(sale.total)}</dd>
          </div>
          {sale.pointsUsed > 0 && (
            <div className="flex justify-between text-[11px] text-ink-600">
              <dt>ポイント利用</dt>
              <dd>-{formatYen(sale.pointsUsed)}</dd>
            </div>
          )}
          <div className="flex justify-between text-[11px] text-ink-600">
            <dt>お支払い ({PAYMENT_METHOD_LABEL[sale.paymentMethod] ?? sale.paymentMethod})</dt>
            <dd>{formatYen(payable)}</dd>
          </div>
          {sale.pointsEarned > 0 && (
            <div className="flex justify-between text-[11px] text-ink-600">
              <dt>獲得ポイント</dt>
              <dd>+{sale.pointsEarned} pt</dd>
            </div>
          )}
          {sale.customer && (
            <div className="flex justify-between text-[11px] text-ink-600">
              <dt>ポイント残高</dt>
              <dd>{sale.customer.points.toLocaleString("ja-JP")} pt</dd>
            </div>
          )}
        </dl>

        <div className="mt-3 flex justify-center border-t border-dashed border-ink-300 pt-3">
          <Barcode code={sale.receiptNo} moduleWidth={1.2} height={32} showText={false} />
        </div>
        <p className="mt-2 text-center text-[10px] text-ink-400">
          ご来店ありがとうございました
        </p>
      </div>
    </>
  );
}
