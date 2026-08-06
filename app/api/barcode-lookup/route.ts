import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 店頭スキャン用の商品照会。
 * 画面 (/scan) から使う内部 API のため、他の画面と同様に認証は POS_API_KEY の外にある。
 *
 * GET /api/barcode-lookup?code=<JAN または SKU>
 */
export async function GET(request: Request) {
  const code = new URL(request.url).searchParams.get("code")?.trim();
  if (!code) {
    return NextResponse.json({ error: "code を指定してください" }, { status: 400 });
  }

  const variant = await prisma.productVariant.findFirst({
    where: { OR: [{ barcode: code }, { sku: code }] },
    include: {
      product: { include: { season: true } },
      inventory: { include: { store: true }, orderBy: { store: { code: "asc" } } },
    },
  });

  if (!variant) {
    return NextResponse.json({ found: false }, { status: 404 });
  }

  return NextResponse.json({
    found: true,
    productId: variant.productId,
    productName: variant.product.name,
    styleCode: variant.product.styleCode,
    seasonCode: variant.product.season.code,
    price: variant.priceOverride ?? variant.product.currentPrice,
    listPrice: variant.product.listPrice,
    taxRate: variant.product.taxRate,
    sku: variant.sku,
    barcode: variant.barcode,
    colorName: variant.colorName,
    sizeName: variant.sizeName,
    stock: variant.inventory.map((inv) => ({
      storeName: inv.store.name,
      quantity: inv.quantity,
    })),
  });
}
