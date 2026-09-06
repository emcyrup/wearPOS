import Link from "next/link";
import { notFound } from "next/navigation";

import { ReturnForm } from "@/components/return-form";
import { Card, PageHeader } from "@/components/ui";
import { prisma } from "@/lib/db";
import { formatDateTime, formatYen } from "@/lib/format";
import { activePaymentMethods } from "@/lib/payment-methods";
import { summarizeReturns } from "@/lib/returns";

export const dynamic = "force-dynamic";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const sale = await prisma.sale.findUnique({
    where: { id },
    include: {
      lines: { include: { variant: { include: { product: true } } } },
      payments: true,
    },
  });
  if (!sale) notFound();

  const backLink = (
    <div className="mb-2">
      <Link href={`/sales/${sale.id}`} className="text-sm text-ink-400 hover:text-ink-600">
        ← 伝票 {sale.receiptNo}
      </Link>
    </div>
  );

  if (sale.type !== "SALE") {
    return (
      <>
        {backLink}
        <PageHeader title="返品" description={sale.receiptNo} />
        <Card>
          <p className="text-sm text-ink-600">返品伝票をさらに返品することはできません。</p>
        </Card>
      </>
    );
  }

  const summary = await summarizeReturns(sale);
  const methods = await activePaymentMethods();

  if (!summary.hasReturnable) {
    return (
      <>
        {backLink}
        <PageHeader title="返品" description={sale.receiptNo} />
        <Card>
          <p className="text-sm text-ink-600">この取引はすべて返品済みです。</p>
        </Card>
      </>
    );
  }

  const originalPayments = sale.payments
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((payment) => ({ method: payment.method, amount: payment.amount }));

  return (
    <>
      {backLink}
      <PageHeader
        title="返品する"
        description={`${sale.receiptNo} · ${formatDateTime(sale.soldAt)} · 合計 ${formatYen(sale.total)}`}
      />

      {summary.returned.count > 0 && (
        <p className="mb-4 rounded-lg bg-amber-50 px-4 py-2.5 text-sm text-amber-800">
          この伝票はすでに {summary.returned.count} 件の返品があります（返品済み合計{" "}
          {formatYen(summary.returned.total)}）。残っているぶんだけ返品できます。
        </p>
      )}

      <ReturnForm
        saleId={sale.id}
        sale={{
          subtotal: sale.subtotal,
          discount: sale.discount,
          tax: sale.tax,
          total: sale.total,
          pointsUsed: sale.pointsUsed,
          pointsEarned: sale.pointsEarned,
        }}
        state={{ lines: summary.lines, returned: summary.returned }}
        paymentMethods={methods.map((method) => ({ code: method.code, label: method.label }))}
        originalPayments={originalPayments}
        fallbackMethod={sale.paymentMethod}
      />
    </>
  );
}
