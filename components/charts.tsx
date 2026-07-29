/**
 * ダッシュボードのグラフ。
 *
 * 以前はグラフ描画ライブラリをクライアント側で動かしていたため、
 * この画面だけ JavaScript が 114KB 増え、スマートフォンでは
 * 読み込み後にさらに 1〜2 秒の描画待ちが発生していた。
 * 現在はサーバー側で HTML と SVG を組み立てているため、
 * グラフのための JavaScript は 0 になっている。
 *
 * 目盛りやラベルは HTML で描き、図形だけを SVG にすることで、
 * 画面幅が変わっても文字がつぶれないようにしている。
 */

const compactYen = new Intl.NumberFormat("ja-JP", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const fullYen = new Intl.NumberFormat("ja-JP", {
  style: "currency",
  currency: "JPY",
  maximumFractionDigits: 0,
});

/** 軸の上限を切りのいい値に丸める */
function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const scaled = value / magnitude;
  const step = scaled <= 1 ? 1 : scaled <= 2 ? 2 : scaled <= 5 ? 5 : 10;
  return step * magnitude;
}

function shortDate(value: string): string {
  const [, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}`;
}

/** 売上(棒)と客数(折れ線)の日次推移 */
export function SalesTrendChart({
  data,
}: {
  data: { date: string; sales: number; orders: number }[];
}) {
  if (data.length === 0) return null;

  const salesMax = niceMax(Math.max(...data.map((d) => d.sales), 1));
  const ordersMax = niceMax(Math.max(...data.map((d) => d.orders), 1));
  const ticks = [1, 0.75, 0.5, 0.25, 0];

  // 棒の幅と間隔 (viewBox 内の相対値)
  const slot = 100 / data.length;
  const barWidth = slot * 0.62;

  const linePoints = data
    .map((d, i) => `${slot * i + slot / 2},${100 - (d.orders / ordersMax) * 100}`)
    .join(" ");

  // 画面が狭いときはラベルを間引く
  const labelStep = Math.ceil(data.length / 8);

  return (
    <figure className="m-0">
      <div className="flex gap-2">
        {/* 売上軸 */}
        <div className="flex h-[220px] w-12 flex-col justify-between text-right text-[10px] text-ink-400">
          {ticks.map((t) => (
            <span key={t} className="tabular leading-none">
              {compactYen.format(salesMax * t)}
            </span>
          ))}
        </div>

        <div className="relative h-[220px] flex-1">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full"
            role="img"
            aria-label="日別の売上と客数の推移"
          >
            {ticks.map((t) => (
              <line
                key={t}
                x1="0"
                x2="100"
                y1={100 - t * 100}
                y2={100 - t * 100}
                stroke="#ebebee"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ))}

            {data.map((d, i) => {
              const height = Math.max(0, (d.sales / salesMax) * 100);
              return (
                <rect
                  key={d.date}
                  x={slot * i + (slot - barWidth) / 2}
                  y={100 - height}
                  width={barWidth}
                  height={height}
                  fill="#b4544a"
                >
                  <title>
                    {shortDate(d.date)} 売上 {fullYen.format(d.sales)} / 客数 {d.orders} 件
                  </title>
                </rect>
              );
            })}

            <polyline
              points={linePoints}
              fill="none"
              stroke="#26262e"
              strokeWidth="1.5"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>

        {/* 客数軸 */}
        <div className="flex h-[220px] w-6 flex-col justify-between text-[10px] text-ink-400">
          {ticks.map((t) => (
            <span key={t} className="tabular leading-none">
              {Math.round(ordersMax * t)}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-1.5 flex gap-2">
        <div className="w-12" />
        <div className="flex flex-1 justify-between text-[10px] text-ink-400">
          {data.map((d, i) =>
            i % labelStep === 0 ? (
              <span key={d.date} className="tabular">
                {shortDate(d.date)}
              </span>
            ) : null,
          )}
        </div>
        <div className="w-6" />
      </div>

      <figcaption className="mt-2 flex items-center gap-4 text-[11px] text-ink-400">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-accent" />
          売上
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3.5 bg-ink-800" />
          客数
        </span>
      </figcaption>
    </figure>
  );
}

/** カラー別販売構成。実際の色をバーに反映する */
export function ColorMixChart({
  data,
}: {
  data: { name: string; hex: string | null; quantity: number }[];
}) {
  if (data.length === 0) return null;
  const max = Math.max(...data.map((d) => d.quantity), 1);

  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {data.map((entry) => (
        <li key={entry.name} className="flex items-center gap-2">
          <span className="w-16 shrink-0 text-xs text-ink-600">{entry.name}</span>
          <span className="h-3.5 flex-1 overflow-hidden rounded-sm bg-ink-100">
            <span
              className="block h-full rounded-sm border border-ink-200"
              style={{
                width: `${(entry.quantity / max) * 100}%`,
                backgroundColor: entry.hex ?? "#8a8a99",
              }}
            />
          </span>
          <span className="tabular w-12 shrink-0 text-right text-xs text-ink-400">
            {entry.quantity} 点
          </span>
        </li>
      ))}
    </ul>
  );
}

/** サイズ別販売構成 */
export function SizeMixChart({ data }: { data: { name: string; quantity: number }[] }) {
  if (data.length === 0) return null;
  const max = niceMax(Math.max(...data.map((d) => d.quantity), 1));

  return (
    <div className="flex h-[180px] items-end gap-2">
      {data.map((entry) => (
        <div key={entry.name} className="flex h-full flex-1 flex-col justify-end gap-1">
          <span className="tabular text-center text-[10px] text-ink-400">{entry.quantity}</span>
          <span
            className="w-full rounded-t-sm bg-ink-600"
            style={{ height: `${(entry.quantity / max) * 100}%` }}
            title={`${entry.name}: ${entry.quantity} 点`}
          />
          <span className="border-t border-ink-200 pt-1 text-center text-xs text-ink-600">
            {entry.name}
          </span>
        </div>
      ))}
    </div>
  );
}
