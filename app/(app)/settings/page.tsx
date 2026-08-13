import { Badge, Card, LinkButton, PageHeader, Table } from "@/components/ui";
import { StaffManager } from "@/components/master-managers";
import { ProductFieldSettings } from "@/components/product-field-settings";
import { ReminderSettings } from "@/components/reminder-settings";
import { RichMenuSetup } from "@/components/richmenu-setup";
import { UserManager } from "@/components/user-manager";
import { ensureReminderRules } from "@/lib/reminders";
import { RANK_RULES } from "@/lib/apparel";
import { DEFAULT_STAFF_FEATURES, FEATURES, getSessionUser } from "@/lib/auth";
import { MULTI_STORE } from "@/lib/config";
import { prisma } from "@/lib/db";
import { formatPercent, formatYen } from "@/lib/format";
import { isLineConfigured, lineConfig } from "@/lib/line";
import { ensureProductFields } from "@/lib/product-fields";

export const dynamic = "force-dynamic";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-lg bg-ink-900 px-4 py-3 text-xs leading-relaxed text-ink-100">
      <code>{children}</code>
    </pre>
  );
}

export default async function SettingsPage() {
  const sessionUser = await getSessionUser();
  const isAdmin = sessionUser?.role === "ADMIN";

  const [stores, seasons, staff, brands, categories, appUsers] = await Promise.all([
    prisma.store.findMany({ orderBy: { code: "asc" }, include: { _count: { select: { sales: true } } } }),
    prisma.season.findMany({
      orderBy: [{ year: "desc" }, { term: "asc" }],
      include: { _count: { select: { products: true } } },
    }),
    prisma.staff.findMany({
      orderBy: { code: "asc" },
      include: { store: true, _count: { select: { sales: true, movements: true } } },
    }),
    prisma.brand.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { products: true } } },
    }),
    prisma.category.findMany({
      orderBy: { code: "asc" },
      include: { _count: { select: { products: true } } },
    }),
    isAdmin ? prisma.appUser.findMany({ orderBy: { createdAt: "asc" } }) : Promise.resolve([]),
  ]);

  // 商品の基本情報に表示する項目 (組み込み + カスタム) の設定
  const productFields = isAdmin
    ? await ensureProductFields().then((fields) =>
        prisma.productField.findMany({
          where: { id: { in: fields.map((f) => f.id) } },
          include: { _count: { select: { values: true } } },
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
        }),
      )
    : [];

  // LINE 自動リマインドの設定と、テンプレートごとの累計送信数
  const reminderRules = await ensureReminderRules();
  const reminderCounts = await prisma.lineMessageLog.groupBy({
    by: ["template"],
    where: { direction: "OUTBOUND", template: { startsWith: "REMINDER_" }, status: "SENT" },
    _count: true,
  });
  const sentCountOf = (key: string) =>
    reminderCounts.find((row) => row.template === `REMINDER_${key}`)?._count ?? 0;

  const lineReady = isLineConfigured();
  const { pushEnabled } = lineConfig();
  const posKeySet = Boolean(process.env.POS_API_KEY);

  return (
    <>
      <PageHeader title="設定 / 連携" description="マスタの確認と、POSレジ・LINE公式アカウントの連携設定" />

      <Card
        title="リマインド設定 (LINE 自動配信)"
        className="mb-4"
        action={
          isAdmin ? (
            <LinkButton href="/settings/reminder-test">テスト配信</LinkButton>
          ) : undefined
        }
      >
        <ReminderSettings
          rules={reminderRules.map(({ def, rule }) => ({
            key: def.key,
            label: def.label,
            description: def.describe(rule.days),
            enabled: rule.enabled,
            days: rule.days,
            daysEditable: def.daysEditable,
            sentCount: sentCountOf(def.key),
          }))}
        />
      </Card>

      {isAdmin && sessionUser && (
        <Card title="ユーザーと権限" className="mb-4">
          <p className="mb-3 text-sm text-ink-600">
            ログインユーザーごとに使える機能を制限できます。管理者は全機能、スタッフは
            チェックした機能のページだけ表示・アクセスできます。
          </p>
          <UserManager
            users={appUsers.map((u) => ({
              id: u.id,
              username: u.username,
              displayName: u.displayName,
              role: u.role,
              features: u.features,
              isActive: u.isActive,
            }))}
            features={FEATURES.map((f) => ({ key: f.key, label: f.label }))}
            currentUserId={sessionUser.uid}
            defaultStaffFeatures={DEFAULT_STAFF_FEATURES}
          />
        </Card>
      )}

      <div className={`mt-4 grid gap-4 ${MULTI_STORE ? "lg:grid-cols-2" : ""}`}>
        {/* 単店舗運用では店舗マスタの表示を省く */}
        {MULTI_STORE && (
          <Card title="店舗">
            <Table head={["コード", "店舗名", "電話", "取引数"]}>
              {stores.map((store) => (
                <tr key={store.id} className="border-b border-ink-100 last:border-0">
                  <td className="tabular px-2 py-2 text-xs text-ink-400">{store.code}</td>
                  <td className="px-2 py-2 font-medium text-ink-800">{store.name}</td>
                  <td className="tabular px-2 py-2 text-xs text-ink-400">{store.phone ?? "—"}</td>
                  <td className="tabular px-2 py-2">{store._count.sales}</td>
                </tr>
              ))}
            </Table>
          </Card>
        )}

        <Card
          title="スタッフ"
          action={isAdmin ? <LinkButton href="/settings/staff-badges">名札バーコード</LinkButton> : undefined}
        >
          {isAdmin ? (
            <StaffManager
              staff={staff.map((person) => ({
                id: person.id,
                code: person.code,
                name: person.name,
                role: person.role,
                storeName: person.store?.name ?? null,
                isActive: person.isActive,
                hasHistory: person._count.sales > 0 || person._count.movements > 0,
              }))}
              stores={stores.map((store) => ({ id: store.id, name: store.name }))}
            />
          ) : (
            <Table head={["コード", "氏名", "所属", "権限"]}>
              {staff.map((person) => (
                <tr key={person.id} className="border-b border-ink-100 last:border-0">
                  <td className="tabular px-2 py-2 text-xs text-ink-400">{person.code}</td>
                  <td className="px-2 py-2 font-medium text-ink-800">{person.name}</td>
                  <td className="px-2 py-2 text-ink-600">{person.store?.name ?? "—"}</td>
                  <td className="px-2 py-2">
                    <Badge tone={person.role === "MANAGER" ? "info" : "neutral"}>{person.role}</Badge>
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </Card>
      </div>

      {isAdmin && (
        <Card title="商品の基本情報 項目" className="mt-4">
          <p className="mb-3 text-sm text-ink-600">
            商品の登録フォームと商品詳細に表示する項目をカスタマイズできます。
            項目を選択すると、名称・表示/非表示・選択肢 (ブランド / カテゴリ / シーズンのマスタを含む)
            の編集と、カスタム項目の削除をまとめて行えます。
          </p>
          <ProductFieldSettings
            fields={productFields.map((field) => ({
              id: field.id,
              builtinKey: field.builtinKey,
              label: field.label,
              isVisible: field.isVisible,
              options: field.options,
              valueCount: field._count.values,
            }))}
            brands={brands.map((brand) => ({
              id: brand.id,
              code: brand.code,
              name: brand.name,
              productCount: brand._count.products,
            }))}
            categories={categories.map((category) => ({
              id: category.id,
              code: category.code,
              name: category.name,
              productCount: category._count.products,
            }))}
            seasons={seasons.map((season) => ({
              id: season.id,
              code: season.code,
              name: season.name,
              productCount: season._count.products,
            }))}
          />
        </Card>
      )}

      <div className="mt-4">
      <Card title="会員ランクとポイント付与率">
        <Table head={["ランク", "累計購入額", "付与率"]}>
          {RANK_RULES.map((rule) => (
            <tr key={rule.rank} className="border-b border-ink-100 last:border-0">
              <td className="px-2 py-2">
                <Badge tone={rule.rank === "PLATINUM" ? "accent" : "neutral"}>{rule.label}</Badge>
              </td>
              <td className="tabular px-2 py-2 text-ink-600">{formatYen(rule.minSpent)} 以上</td>
              <td className="tabular px-2 py-2 font-medium">{formatPercent(rule.pointRate, 0)}</td>
            </tr>
          ))}
        </Table>
        <p className="mt-3 text-xs text-ink-400">
          ポイントは、ポイント利用分を差し引いた正味の支払額に対して付与されます (二重取り防止)。
        </p>
      </Card>

      </div>

      {/* 連携まわりの技術的な記載は普段使わないため、折りたたみでページ下部に置く */}
      <details className="mt-4 rounded-xl border border-ink-200 bg-white">
        <summary className="cursor-pointer px-5 py-3.5 text-sm font-semibold text-ink-800 select-none hover:bg-ink-50">
          🔌 POSレジ連携・LINE公式アカウント連携の設定
          <span className="ml-2 text-xs font-normal text-ink-400">
            API の使い方・環境変数・リッチメニューの適用
          </span>
        </summary>
        <div className="border-t border-ink-100 p-4">
          <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="POSレジ連携"
          action={
            posKeySet ? <Badge tone="success">APIキー設定済み</Badge> : <Badge tone="danger">未設定</Badge>
          }
        >
          <p className="mb-3 text-sm text-ink-600">
            既存の POS レジから取引を送信すると、在庫の減算・顧客実績の更新・ポイント付与・LINE
            通知までが自動で行われます。<code className="text-accent">externalId</code>{" "}
            で冪等性を担保しているため、通信エラー時はそのまま再送して構いません。
          </p>

          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-400">取引の送信</p>
              <CodeBlock>{`POST /api/pos/sales
X-API-Key: <POS_API_KEY>
Content-Type: application/json

{
  "externalId": "POS-SHIBUYA-000123",
  "storeCode": "SHIBUYA",
  "staffCode": "S002",
  "memberCode": "M10001",
  "soldAt": "2026-07-29T14:32:00+09:00",
  "type": "SALE",
  "paymentMethod": "CREDIT",
  "pointsUsed": 0,
  "lines": [
    { "sku": "26SS-SH-001-BLK-M", "quantity": 1, "unitPrice": 12800 },
    { "barcode": "4912345678", "quantity": 2, "unitPrice": 6800, "discount": 500 }
  ]
}`}</CodeBlock>
            </div>

            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-400">マスタ / 在庫 / 会員の照会</p>
              <CodeBlock>{`GET /api/pos/products?season=2026SS&updatedSince=2026-07-01T00:00:00Z
GET /api/pos/inventory?storeCode=SHIBUYA&sku=26SS-SH-001-BLK-M
GET /api/pos/customers?memberCode=M10001
POST /api/pos/customers   # レジでの新規会員登録`}</CodeBlock>
            </div>
          </div>

          <p className="mt-3 text-xs text-ink-400">
            APIキーは環境変数 <code>POS_API_KEY</code> で設定します。複数店舗で同じキーを共有せず、
            本番では店舗ごとに払い出すことを推奨します。
          </p>
        </Card>

        <Card
          title="LINE公式アカウント連携"
          action={
            lineReady ? (
              <Badge tone={pushEnabled ? "success" : "warning"}>
                {pushEnabled ? "連携中" : "送信オフ"}
              </Badge>
            ) : (
              <Badge tone="danger">未設定</Badge>
            )
          }
        >
          <p className="mb-3 text-sm text-ink-600">
            顧客詳細から発行した6桁の連携コードを、お客様が公式アカウントのトークへ送信すると会員情報が紐付きます。
            連携後はお買い上げ内容とポイント残高が自動で通知されます。
          </p>

          <div className="space-y-3">
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-400">Webhook URL (LINE Developers に登録)</p>
              <CodeBlock>{`POST /api/line/webhook`}</CodeBlock>
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium text-ink-400">必要な環境変数</p>
              <CodeBlock>{`LINE_CHANNEL_SECRET=...        # 署名検証に使用
LINE_CHANNEL_ACCESS_TOKEN=...  # メッセージ送信に使用
LINE_PUSH_ENABLED=true         # false で送信を停止 (ログのみ記録)`}</CodeBlock>
            </div>
          </div>

          <dl className="mt-4 space-y-2 border-t border-ink-100 pt-3 text-sm">
            <div className="flex justify-between">
              <dt className="text-ink-400">チャネルシークレット</dt>
              <dd>{process.env.LINE_CHANNEL_SECRET ? "設定済み" : "未設定"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">アクセストークン</dt>
              <dd>{process.env.LINE_CHANNEL_ACCESS_TOKEN ? "設定済み" : "未設定"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">自動プッシュ通知</dt>
              <dd>{pushEnabled ? "有効" : "無効"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">LIFF ID (直接遷移用)</dt>
              <dd>{process.env.LIFF_ID ? "設定済み" : "未設定"}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-ink-400">LIFF チャネルID</dt>
              <dd>{process.env.LIFF_CHANNEL_ID ? "設定済み" : "未設定"}</dd>
            </div>
          </dl>

          {!lineReady && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
              認証情報が未設定のため、LINE への送信はスキップされ、送信ログのみが記録されます。
              画面の動作確認はこの状態でも行えます。
            </p>
          )}

          {lineReady && isAdmin && <RichMenuSetup />}
        </Card>
      </div>
        </div>
      </details>
    </>
  );
}
