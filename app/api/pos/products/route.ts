import { NextResponse } from "next/server";

import { authorizePosRequest } from "@/lib/api-auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * POS レジ側へ商品マスタ (品番 + カラー×サイズ SKU) を配信する。
 *
 * GET /api/pos/products?updatedSince=2026-07-01T00:00:00Z&season=2026SS
 * Header: X-API-Key: <POS_API_KEY>
 */
export async function GET(request: Request) {
  const unauthorized = authorizePosRequest(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const updatedSince = url.searchParams.get("updatedSince");
  const season = url.searchParams.get("season");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 500), 1000);

  const since = updatedSince ? new Date(updatedSince) : undefined;
  if (since && Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: "updatedSince の日付形式が不正です" }, { status: 400 });
  }

  const products = await prisma.product.findMany({
    where: {
      status: "ACTIVE",
      ...(since ? { updatedAt: { gte: since } } : {}),
      ...(season ? { season: { code: season } } : {}),
    },
    include: {
      brand: true,
      category: true,
      season: true,
      variants: { where: { isActive: true }, orderBy: [{ colorCode: "asc" }, { sizeOrder: "asc" }] },
    },
    orderBy: { styleCode: "asc" },
    take: limit,
  });

  return NextResponse.json({
    count: products.length,
    products: products.map((product) => ({
      styleCode: product.styleCode,
      name: product.name,
      brand: product.brand.code,
      category: product.category.code,
      season: product.season.code,
      listPrice: product.listPrice,
      currentPrice: product.currentPrice,
      taxRate: product.taxRate,
      updatedAt: product.updatedAt,
      variants: product.variants.map((variant) => ({
        sku: variant.sku,
        barcode: variant.barcode,
        colorCode: variant.colorCode,
        colorName: variant.colorName,
        sizeCode: variant.sizeCode,
        sizeName: variant.sizeName,
        price: variant.priceOverride ?? product.currentPrice,
      })),
    })),
  });
}
