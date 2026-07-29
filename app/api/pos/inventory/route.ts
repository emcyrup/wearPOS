import { NextResponse } from "next/server";

import { authorizePosRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 店舗別の在庫照会。他店在庫の取り寄せ判断にも使う。
 *
 * GET /api/pos/inventory?storeCode=SHIBUYA&sku=26SS-SH-001-BLK-M
 * GET /api/pos/inventory?sku=26SS-SH-001-BLK-M   (全店の在庫を返す)
 * Header: X-API-Key: <POS_API_KEY>
 */
export async function GET(request: Request) {
  const unauthorized = authorizePosRequest(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const storeCode = url.searchParams.get("storeCode");
  const sku = url.searchParams.get("sku");
  const barcode = url.searchParams.get("barcode");
  const styleCode = url.searchParams.get("styleCode");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 2000);

  if (!sku && !barcode && !styleCode && !storeCode) {
    return NextResponse.json(
      { error: "storeCode / sku / barcode / styleCode のいずれかを指定してください" },
      { status: 400 },
    );
  }

  const inventory = await prisma.inventory.findMany({
    where: {
      ...(storeCode ? { store: { code: storeCode } } : {}),
      ...(sku || barcode || styleCode
        ? {
            variant: {
              ...(sku ? { sku } : {}),
              ...(barcode ? { barcode } : {}),
              ...(styleCode ? { product: { styleCode } } : {}),
            },
          }
        : {}),
    },
    include: { store: true, variant: { include: { product: true } } },
    orderBy: [{ store: { code: "asc" } }, { variant: { sku: "asc" } }],
    take: limit,
  });

  return NextResponse.json({
    count: inventory.length,
    inventory: inventory.map((item) => ({
      storeCode: item.store.code,
      storeName: item.store.name,
      sku: item.variant.sku,
      barcode: item.variant.barcode,
      styleCode: item.variant.product.styleCode,
      productName: item.variant.product.name,
      colorName: item.variant.colorName,
      sizeName: item.variant.sizeName,
      /** 引当済みを除いた販売可能数 */
      available: Math.max(0, item.quantity - item.reserved),
      quantity: item.quantity,
      reserved: item.reserved,
      updatedAt: item.updatedAt,
    })),
  });
}
