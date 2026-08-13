import Link from "next/link";
import { notFound } from "next/navigation";

import {
  CustomerReminderSettings,
  LineLinkForm,
  LineMessageForm,
  PointAdjustForm,
  ProfileForm,
} from "@/components/customer-forms";
import { CustomerDeleteButton, LineUnlinkButton } from "@/components/customer-admin-actions";
import { Badge, Card, EmptyState, PageHeader, Table } from "@/components/ui";
import { DORMANT_DAYS, parseTags, PAYMENT_METHOD_LABEL, pointRateForRank, rankLabel, RANK_RULES } from "@/lib/apparel";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { ensureReminderRules } from "@/lib/reminders";
import { signMemberCardToken } from "@/lib/session";
import {
  daysSince,
  formatDate,
  formatDateTime,
  formatNumber,
  formatPercent,
  formatYen,
  fullName,
  fullNameKana,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const customer = await prisma.customer.findUnique({
    where: { id },
    include: {
      store: true,
      lineAccount: true,
      lineLinkTokens: { where: { usedAt: null }, orderBy: { createdAt: "desc" }, take: 1 },
      pointEvents: { orderBy: { createdAt: "desc" }, take: 15 },
      lineMessages: { orderBy: { createdAt: "desc" }, take: 10 },
      sales: {
        orderBy: { soldAt: "desc" },
        include: {
          store: true,
          staff: true,
          lines: { include: { variant: { include: { product: true } } } },
        },
      },
    },
  });

  if (!customer) notFound();

  // 購買履歴から好みのサイズ・カラー・カテゴリを推定する
  const purchasedLines = customer.sales
    .filter((sale) => sale.type === "SALE")
    .flatMap((sale) => sale.lines);

  const tally = (key: (line: (typeof purchasedLines)[number]) => string) => {
    const map = new Map<string, number>();
    for (const line of purchasedLines) {
      const k = key(line);
      map.set(k, (map.get(k) ?? 0) + line.quantity);
    }
    return Array.from(map.entries())
      .map(([name, quantity]) => ({ name, quantity }))
      .sort((a, b) => b.quantity - a.quantity);
  };

  // 手入力商品 (variant なし) はサイズ・カラーの好み推定から除外する
  const favoriteSizes = tally((line) => line.variant?.sizeName ?? "").filter((t) => t.name).slice(0, 4);
  const favoriteColors = tally((line) => line.variant?.colorName ?? "").filter((t) => t.name).slice(0, 5);

  const totalItems = purchasedLines.reduce((sum, line) => sum + line.quantity, 0);
  const averageOrder = customer.visitCount ? Math.round(customer.totalSpent / customer.visitCount) : 0;
  const since = daysSince(customer.lastVisitAt);
  const dormant = since !== null && since >= DORMANT_DAYS;
  // LINE の「会員証」キーワードで返すものと同じデジタル会員証リンク
  const cardToken = await signMemberCardToken(customer.id);
  // このお客様へのリマインド個別設定に表示するルール一覧
  const reminderRules = await ensureReminderRules();

  const nextRank = RANK_RULES.slice()
    .reverse()
    .find((rule) => rule.minSpent > customer.totalSpent);
  const pendingToken = customer.lineLinkTokens[0];
  const tokenAlive = pendingToken && pendingToken.expiresAt > new Date();

  return (
    <>
      <div className="mb-2">
        <Link href="/customers" className="text-sm text-ink-400 hover:text-ink-600">
          ← 顧客一覧
        </Link>
      </div>

      <PageHeader
        title={fullName(customer)}
        description={`${customer.memberCode} · ${fullNameKana(customer) || "カナ未登録"}${
          MULTI_STORE && customer.store ? ` · 担当 ${customer.store.name}` : ""
        }`}
        action={
          // スマートフォンではバッジとボタンを折り返す (縮んで縦書きにならないように)
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={
                customer.rank === "PLATINUM" ? "accent" : customer.rank === "GOLD" ? "warning" : "neutral"
              }
            >
              {rankLabel(customer.rank)}
            </Badge>
            {customer.lineAccount ? (
              <Badge tone={customer.lineAccount.isFollowing ? "success" : "danger"}>
                {customer.lineAccount.isFollowing ? "LINE 連携済" : "LINE ブロック"}
              </Badge>
            ) : (
              <Badge tone="neutral">LINE 未連携</Badge>
            )}
            {dormant && <Badge tone="warning">休眠中</Badge>}
            <a
              href={`/card/${cardToken}`}
              target="_blank"
              className="inline-flex items-center rounded-lg border border-ink-200 bg-white px-3 py-1.5 text-sm font-medium whitespace-nowrap text-ink-600 hover:bg-ink-50"
            >
              会員証を表示
            </a>
            <CustomerDeleteButton
              customerId={customer.id}
              name={fullName(customer)}
              hasSales={customer.sales.length > 0}
            />
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">累計購入額</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatYen(customer.totalSpent)}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            {nextRank
              ? `${nextRank.label}まで あと ${formatYen(nextRank.minSpent - customer.totalSpent)}`
              : "最上位ランクです"}
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">来店回数</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">{customer.visitCount}</p>
          <p className="mt-1 text-xs text-ink-400">
            客単価 {formatYen(averageOrder)} · {totalItems} 点購入
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">保有ポイント</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatNumber(customer.points)} <span className="text-base font-normal text-ink-400">pt</span>
          </p>
          <p className="mt-1 text-xs text-ink-400">
            付与率 {formatPercent(pointRateForRank(customer.rank), 0)}
          </p>
        </div>
        <div className="rounded-xl border border-ink-200 bg-white px-5 py-4">
          <p className="text-xs font-medium text-ink-400">最終来店</p>
          <p className="tabular mt-1.5 text-2xl font-semibold tracking-tight">
            {formatDate(customer.lastVisitAt)}
          </p>
          <p className={`mt-1 text-xs ${dormant ? "text-amber-700" : "text-ink-400"}`}>
            {since === null ? "来店履歴なし" : `${since} 日前`}
            {customer.firstVisitAt && ` · 初回 ${formatDate(customer.firstVisitAt)}`}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="購買傾向" className="lg:col-span-2">
          {purchasedLines.length ? (
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-xs font-medium text-ink-400">よく買うサイズ</p>
                <div className="space-y-1.5">
                  {favoriteSizes.map((size) => (
                    <div key={size.name} className="flex items-center gap-2">
                      <span className="w-12 text-sm font-medium text-ink-800">{size.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className="h-full rounded-full bg-ink-600"
                          style={{ width: `${(size.quantity / favoriteSizes[0].quantity) * 100}%` }}
                        />
                      </div>
                      <span className="tabular w-10 text-right text-xs text-ink-400">
                        {size.quantity}点
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-ink-400">よく買うカラー</p>
                <div className="space-y-1.5">
                  {favoriteColors.map((color) => (
                    <div key={color.name} className="flex items-center gap-2">
                      <span className="w-16 text-sm font-medium text-ink-800">{color.name}</span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-100">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${(color.quantity / favoriteColors[0].quantity) * 100}%` }}
                        />
                      </div>
                      <span className="tabular w-10 text-right text-xs text-ink-400">
                        {color.quantity}点
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message="購買履歴がまだありません" />
          )}

          {parseTags(customer.tags).length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5 border-t border-ink-100 pt-4">
              {parseTags(customer.tags).map((tag) => (
                <Badge key={tag} tone="info">
                  {tag}
                </Badge>
              ))}
            </div>
          )}
        </Card>

        <Card title="基本情報">
          <dl className="space-y-2.5 text-sm">
            {[
              ["電話", customer.phone ?? "—"],
              ["メール", customer.email ?? "—"],
              ["生年月日", formatDate(customer.birthday)],
              ["郵便番号", customer.postalCode ?? "—"],
              ["住所", customer.address ?? "—"],
              ["登録日", formatDate(customer.createdAt)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3 border-b border-ink-100 pb-2">
                <dt className="shrink-0 text-ink-400">{label}</dt>
                <dd className="text-right break-all text-ink-800">{value}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="LINE 連携">
          {customer.lineAccount ? (
            <div className="space-y-3">
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-400">表示名</dt>
                  <dd className="text-ink-800">{customer.lineAccount.displayName ?? "—"}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-400">連携日</dt>
                  <dd className="tabular text-ink-800">{formatDate(customer.lineAccount.linkedAt)}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-ink-400">状態</dt>
                  <dd>
                    {customer.lineAccount.isFollowing ? (
                      <Badge tone="success">友だち登録中</Badge>
                    ) : (
                      <Badge tone="danger">ブロック済み</Badge>
                    )}
                  </dd>
                </div>
              </dl>
              <div className="border-t border-ink-100 pt-3">
                <p className="mb-2 text-xs font-medium text-ink-400">個別メッセージを送る</p>
                <LineMessageForm
                  customerId={customer.id}
                  disabled={!customer.lineAccount.isFollowing}
                />
              </div>
              <div className="border-t border-ink-100 pt-3">
                <LineUnlinkButton customerId={customer.id} />
                <p className="mt-1.5 text-xs text-ink-400">
                  お客様側からも、トークに「連携解除」と送信すると解除できます (「通知オフ」「通知オン」でお知らせ配信の切り替えもできます)
                </p>
              </div>
              <div className="border-t border-ink-100 pt-3">
                <p className="mb-2 text-xs font-medium text-ink-400">このお客様へのリマインド設定</p>
                <CustomerReminderSettings
                  customerId={customer.id}
                  optOut={customer.reminderOptOut}
                  disabledKeys={customer.reminderDisabledKeys}
                  rules={reminderRules.map(({ def, rule }) => ({
                    key: def.key,
                    label: def.label,
                    globalEnabled: rule.enabled,
                  }))}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {tokenAlive && (
                <div className="rounded-lg bg-accent-soft px-4 py-3">
                  <p className="text-xs text-ink-600">発行済みの連携コード</p>
                  <p className="tabular mt-1 text-2xl font-semibold tracking-widest text-accent">
                    {pendingToken.token}
                  </p>
                  <p className="mt-1 text-xs text-ink-400">
                    有効期限 {formatDateTime(pendingToken.expiresAt)}
                  </p>
                </div>
              )}
              <LineLinkForm customerId={customer.id} />
            </div>
          )}
        </Card>

        <Card title="ポイント履歴">
          <PointAdjustForm customerId={customer.id} />
          <div className="mt-4 border-t border-ink-100 pt-3">
            {customer.pointEvents.length ? (
              <Table head={["日時", "区分", "増減", "残高", "備考"]}>
                {customer.pointEvents.map((event) => (
                  <tr key={event.id} className="border-b border-ink-100 last:border-0">
                    <td className="tabular px-2 py-2 text-xs whitespace-nowrap text-ink-400">
                      {formatDate(event.createdAt)}
                    </td>
                    <td className="px-2 py-2">
                      <Badge
                        tone={
                          event.type === "EARN" ? "success" : event.type === "REDEEM" ? "info" : "neutral"
                        }
                      >
                        {{ EARN: "付与", REDEEM: "利用", EXPIRE: "失効", ADJUST: "調整" }[event.type] ??
                          event.type}
                      </Badge>
                    </td>
                    <td
                      className={`tabular px-2 py-2 font-medium ${
                        event.points < 0 ? "text-rose-700" : "text-emerald-700"
                      }`}
                    >
                      {event.points > 0 ? `+${event.points}` : event.points}
                    </td>
                    <td className="tabular px-2 py-2">{event.balance}</td>
                    <td className="px-2 py-2 text-xs text-ink-400">{event.note ?? "—"}</td>
                  </tr>
                ))}
              </Table>
            ) : (
              <EmptyState message="ポイント履歴がありません" />
            )}
          </div>
        </Card>
      </div>

      <Card title="接客メモ / 好みタグ" className="mt-4">
        <ProfileForm customerId={customer.id} note={customer.note} tags={customer.tags} />
      </Card>

      <Card title={`購買履歴 (${customer.sales.length} 件)`} className="mt-4">
        {customer.sales.length ? (
          <div className="space-y-3">
            {customer.sales.slice(0, 20).map((sale) => (
              <div key={sale.id} className="rounded-lg border border-ink-200 px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/sales/${sale.id}`}
                      className="tabular text-sm font-medium text-ink-900 hover:text-accent"
                    >
                      {sale.receiptNo}
                    </Link>
                    {sale.type === "RETURN" && <Badge tone="danger">返品</Badge>}
                    <span className="text-xs text-ink-400">
                      {formatDateTime(sale.soldAt)} · {sale.store.name}
                      {sale.staff && ` · ${sale.staff.name}`}
                    </span>
                  </div>
                  <div className="tabular text-sm font-semibold">
                    {formatYen(sale.total)}
                    <span className="ml-2 text-xs font-normal text-ink-400">
                      {PAYMENT_METHOD_LABEL[sale.paymentMethod] ?? sale.paymentMethod}
                    </span>
                  </div>
                </div>
                <ul className="mt-2 space-y-1 border-t border-ink-100 pt-2">
                  {sale.lines.map((line) => (
                    <li key={line.id} className="flex items-baseline justify-between gap-3 text-sm">
                      <span className="flex items-center gap-1.5">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-ink-200"
                          style={{ backgroundColor: line.variant?.colorHex ?? "transparent" }}
                        />
                        {line.variant ? (
                          <>
                            <Link
                              href={`/products/${line.variant.productId}`}
                              className="text-ink-800 hover:text-accent"
                            >
                              {line.variant.product.name}
                            </Link>
                            <span className="text-xs text-ink-400">
                              {line.variant.colorName} / {line.variant.sizeName}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="text-ink-800">{line.note ?? "手入力商品"}</span>
                            <span className="text-xs text-ink-400">手入力</span>
                          </>
                        )}
                      </span>
                      <span className="tabular shrink-0 text-ink-600">
                        {line.quantity}点 · {formatYen(line.lineTotal)}
                      </span>
                    </li>
                  ))}
                </ul>
                {(sale.pointsEarned > 0 || sale.pointsUsed > 0) && (
                  <p className="tabular mt-2 text-xs text-ink-400">
                    {sale.pointsUsed > 0 && `利用 ${sale.pointsUsed} pt`}
                    {sale.pointsUsed > 0 && sale.pointsEarned > 0 && " · "}
                    {sale.pointsEarned > 0 && `獲得 ${sale.pointsEarned} pt`}
                  </p>
                )}
              </div>
            ))}
            {customer.sales.length > 20 && (
              <p className="text-center text-xs text-ink-400">
                直近 20 件を表示しています（全 {customer.sales.length} 件）
              </p>
            )}
          </div>
        ) : (
          <EmptyState message="購買履歴がありません" />
        )}
      </Card>

      {customer.lineMessages.length > 0 && (
        <Card title="LINE 送受信ログ" className="mt-4">
          <Table head={["日時", "方向", "種別", "内容", "状態"]}>
            {customer.lineMessages.map((log) => (
              <tr key={log.id} className="border-b border-ink-100 last:border-0">
                <td className="tabular px-2 py-2 text-xs whitespace-nowrap text-ink-400">
                  {formatDateTime(log.createdAt)}
                </td>
                <td className="px-2 py-2">
                  <Badge tone={log.direction === "OUTBOUND" ? "info" : "neutral"}>
                    {log.direction === "OUTBOUND" ? "送信" : "受信"}
                  </Badge>
                </td>
                <td className="px-2 py-2 text-xs text-ink-400">{log.template ?? log.messageType}</td>
                <td className="px-2 py-2 text-sm whitespace-pre-wrap text-ink-600">
                  {log.body.length > 60 ? `${log.body.slice(0, 60)}…` : log.body}
                </td>
                <td className="px-2 py-2">
                  <Badge
                    tone={log.status === "SENT" ? "success" : log.status === "FAILED" ? "danger" : "neutral"}
                  >
                    {log.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </>
  );
}
