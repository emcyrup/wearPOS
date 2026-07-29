import { NextResponse } from "next/server";
import { z } from "zod";

import { authorizePosRequest } from "@/lib/api-auth";
import { pointRateForRank, rankLabel } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { fullName } from "@/lib/format";

export const dynamic = "force-dynamic";

/**
 * レジで会員を引き当てるための照会。
 *
 * GET /api/pos/customers?memberCode=M10001
 * GET /api/pos/customers?q=090-1234   (氏名・カナ・電話の部分一致)
 */
export async function GET(request: Request) {
  const unauthorized = authorizePosRequest(request);
  if (unauthorized) return unauthorized;

  const url = new URL(request.url);
  const memberCode = url.searchParams.get("memberCode");
  const q = url.searchParams.get("q")?.trim();

  if (!memberCode && !q) {
    return NextResponse.json({ error: "memberCode か q を指定してください" }, { status: 400 });
  }

  const customers = await prisma.customer.findMany({
    where: {
      isActive: true,
      ...(memberCode ? { memberCode } : {}),
      ...(q
        ? {
            OR: [
              { lastName: { contains: q } },
              { firstName: { contains: q } },
              { lastNameKana: { contains: q } },
              { firstNameKana: { contains: q } },
              { phone: { contains: q } },
            ],
          }
        : {}),
    },
    include: { lineAccount: { select: { isFollowing: true } } },
    take: 20,
  });

  return NextResponse.json({
    count: customers.length,
    customers: customers.map((customer) => ({
      memberCode: customer.memberCode,
      name: fullName(customer),
      phone: customer.phone,
      rank: customer.rank,
      rankLabel: rankLabel(customer.rank),
      pointRate: pointRateForRank(customer.rank),
      points: customer.points,
      totalSpent: customer.totalSpent,
      visitCount: customer.visitCount,
      lastVisitAt: customer.lastVisitAt,
      lineLinked: Boolean(customer.lineAccount?.isFollowing),
    })),
  });
}

const createSchema = z.object({
  memberCode: z.string().min(1).optional(),
  lastName: z.string().min(1),
  firstName: z.string().min(1),
  lastNameKana: z.string().optional(),
  firstNameKana: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  birthday: z.string().optional(),
  gender: z.enum(["FEMALE", "MALE", "OTHER", "UNKNOWN"]).optional(),
  storeCode: z.string().optional(),
});

/**
 * レジでの新規会員登録。
 * memberCode 未指定なら M+連番で自動採番する。
 */
export async function POST(request: Request) {
  const unauthorized = authorizePosRequest(request);
  if (unauthorized) return unauthorized;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON の解析に失敗しました" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ") },
      { status: 400 },
    );
  }

  const input = parsed.data;

  const store = input.storeCode
    ? await prisma.store.findUnique({ where: { code: input.storeCode } })
    : null;
  if (input.storeCode && !store) {
    return NextResponse.json({ error: `店舗が見つかりません: ${input.storeCode}` }, { status: 404 });
  }

  let memberCode = input.memberCode;
  if (!memberCode) {
    const last = await prisma.customer.findFirst({
      orderBy: { memberCode: "desc" },
      select: { memberCode: true },
    });
    const lastNumber = Number(last?.memberCode?.replace(/\D/g, "") ?? 10000);
    memberCode = `M${lastNumber + 1}`;
  }

  const duplicate = await prisma.customer.findUnique({ where: { memberCode } });
  if (duplicate) {
    return NextResponse.json({ error: `会員番号が重複しています: ${memberCode}` }, { status: 409 });
  }

  const customer = await prisma.customer.create({
    data: {
      memberCode,
      lastName: input.lastName,
      firstName: input.firstName,
      lastNameKana: input.lastNameKana,
      firstNameKana: input.firstNameKana,
      phone: input.phone,
      email: input.email,
      birthday: input.birthday ? new Date(input.birthday) : undefined,
      gender: input.gender,
      storeId: store?.id,
    },
  });

  return NextResponse.json(
    {
      memberCode: customer.memberCode,
      name: fullName(customer),
      rank: customer.rank,
      points: customer.points,
    },
    { status: 201 },
  );
}
