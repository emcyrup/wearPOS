import Link from "next/link";

import { LineCampaign } from "@/components/line-campaign";
import { Badge, Card, EmptyState, PAGE_SIZE, PageHeader, Pagination, Table } from "@/components/ui";
import { DORMANT_DAYS, MEMBER_RANKS, parseTags, rankLabel } from "@/lib/apparel";
import { prisma } from "@/lib/db";
import { daysSince, formatDate, formatNumber, formatYen, fullName, fullNameKana } from "@/lib/format";

export const dynamic = "force-dynamic";
// LINE 一斉配信 (Server Action) は対象人数に応じて時間がかかるため上限を延ばす
export const maxDuration = 300;

type Search = { q?: string; rank?: string; line?: string; sort?: string; dormant?: string; page?: string };

const SORTS = {
  recent: { label: "最終来店が新しい順", order: { lastVisitAt: "desc" as const } },
  spent: { label: "累計購入額が多い順", order: { totalSpent: "desc" as const } },
  visits: { label: "来店回数が多い順", order: { visitCount: "desc" as const } },
  new: { label: "新規登録順", order: { createdAt: "desc" as const } },
};

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const sortKey = (params.sort && params.sort in SORTS ? params.sort : "recent") as keyof typeof SORTS;
  const dormantBefore = new Date(Date.now() - DORMANT_DAYS * 86_400_000);

  const page = Math.max(1, Number(params.page) || 1);

  const where = {
      isActive: true,
      ...(q
        ? {
            OR: [
              { lastName: { contains: q } },
              { firstName: { contains: q } },
              { lastNameKana: { contains: q } },
              { firstNameKana: { contains: q } },
              { memberCode: { contains: q } },
              { phone: { contains: q } },
              { email: { contains: q } },
              { tags: { contains: q } },
            ],
          }
        : {}),
      ...(params.rank ? { rank: params.rank } : {}),
      ...(params.line === "linked" ? { lineAccount: { isFollowing: true } } : {}),
      ...(params.line === "unlinked" ? { lineAccount: { is: null } } : {}),
      ...(params.dormant === "1" ? { lastVisitAt: { lt: dormantBefore } } : {}),
  };

  const [customers, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      include: { store: true, lineAccount: true },
      orderBy: SORTS[sortKey].order,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.customer.count({ where }),
  ]);

  return (
    <>
      <PageHeader
        title="顧客 (CRM)"
        description="購買履歴・ポイント・LINE 連携をまとめて管理します"
        action={<Badge tone="neutral">{total.toLocaleString("ja-JP")} 名</Badge>}
      />

      <Card title="LINE 一斉配信" className="mb-4">
        <LineCampaign />
      </Card>

      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-3" method="get">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">氏名・カナ・会員番号・電話・タグ</span>
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="佐藤 / サトウ / M10001"
              className="w-64 rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">会員ランク</span>
            <select
              name="rank"
              defaultValue={params.rank ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              <option value="">すべて</option>
              {MEMBER_RANKS.map((rank) => (
                <option key={rank} value={rank}>
                  {rankLabel(rank)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">LINE 連携</span>
            <select
              name="line"
              defaultValue={params.line ?? ""}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              <option value="">すべて</option>
              <option value="linked">連携済み</option>
              <option value="unlinked">未連携</option>
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-400">並び順</span>
            <select
              name="sort"
              defaultValue={sortKey}
              className="rounded-lg border border-ink-200 px-3 py-1.5 text-sm outline-none focus:border-ink-400"
            >
              {Object.entries(SORTS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 pb-2 text-sm text-ink-600">
            <input
              type="checkbox"
              name="dormant"
              value="1"
              defaultChecked={params.dormant === "1"}
              className="h-4 w-4 rounded border-ink-200"
            />
            休眠のみ ({DORMANT_DAYS}日以上)
          </label>

          <button
            type="submit"
            className="rounded-lg bg-ink-900 px-4 py-1.5 text-sm font-medium text-white hover:bg-ink-800"
          >
            絞り込む
          </button>
          <Link href="/customers" className="px-2 py-1.5 text-sm text-ink-400 hover:text-ink-600">
            クリア
          </Link>
        </form>
      </Card>

      <Card>
        {customers.length ? (
          <Table
            head={["会員番号", "氏名", "ランク", "累計購入", "来店", "最終来店", "ポイント", "LINE", "好み"]}
          >
            {customers.map((customer) => {
              const since = daysSince(customer.lastVisitAt);
              const dormant = since !== null && since >= DORMANT_DAYS;
              return (
                <tr key={customer.id} className="border-b border-ink-100 last:border-0 hover:bg-ink-50">
                  <td className="tabular px-2 py-2.5 text-xs text-ink-400">{customer.memberCode}</td>
                  <td className="px-2 py-2.5">
                    <Link
                      href={`/customers/${customer.id}`}
                      className="font-medium text-ink-900 hover:text-accent"
                    >
                      {fullName(customer)}
                    </Link>
                    <div className="text-xs text-ink-400">
                      {fullNameKana(customer)}
                      {customer.store && ` · ${customer.store.name}`}
                    </div>
                  </td>
                  <td className="px-2 py-2.5">
                    <Badge
                      tone={
                        customer.rank === "PLATINUM"
                          ? "accent"
                          : customer.rank === "GOLD"
                            ? "warning"
                            : "neutral"
                      }
                    >
                      {rankLabel(customer.rank)}
                    </Badge>
                  </td>
                  <td className="tabular px-2 py-2.5 font-medium">{formatYen(customer.totalSpent)}</td>
                  <td className="tabular px-2 py-2.5 text-ink-600">{customer.visitCount}</td>
                  <td className="px-2 py-2.5 whitespace-nowrap">
                    <span className={`tabular text-sm ${dormant ? "text-amber-700" : "text-ink-600"}`}>
                      {formatDate(customer.lastVisitAt)}
                    </span>
                    {since !== null && (
                      <div className="text-xs text-ink-400">{since}日前</div>
                    )}
                  </td>
                  <td className="tabular px-2 py-2.5">{formatNumber(customer.points)}</td>
                  <td className="px-2 py-2.5">
                    {customer.lineAccount ? (
                      customer.lineAccount.isFollowing ? (
                        <Badge tone="success">連携済</Badge>
                      ) : (
                        <Badge tone="danger">ブロック</Badge>
                      )
                    ) : (
                      <Badge tone="neutral">未連携</Badge>
                    )}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      {parseTags(customer.tags).slice(0, 2).map((tag) => (
                        <Badge key={tag} tone="info">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </td>
                </tr>
              );
            })}
          </Table>
        ) : (
          <EmptyState message="該当する顧客がいません" hint="検索条件を変えてお試しください" />
        )}
        <Pagination
          page={page}
          total={total}
          basePath="/customers"
          params={{
            q: params.q,
            rank: params.rank,
            line: params.line,
            sort: params.sort,
            dormant: params.dormant,
          }}
        />
      </Card>
    </>
  );
}
