"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const AXIS = { fontSize: 11, fill: "#8a8a99" };
const GRID = "#ebebee";

const compactYen = new Intl.NumberFormat("ja-JP", { notation: "compact", maximumFractionDigits: 1 });
const fullYen = new Intl.NumberFormat("ja-JP", { style: "currency", currency: "JPY", maximumFractionDigits: 0 });

function shortDate(value: string) {
  const [, m, d] = value.split("-");
  return `${Number(m)}/${Number(d)}`;
}

export function SalesTrendChart({
  data,
}: {
  data: { date: string; sales: number; orders: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={shortDate} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis
          yAxisId="sales"
          tickFormatter={(v) => compactYen.format(v)}
          tick={AXIS}
          tickLine={false}
          axisLine={false}
          width={52}
        />
        <YAxis yAxisId="orders" orientation="right" tick={AXIS} tickLine={false} axisLine={false} width={32} />
        <Tooltip
          formatter={(value, name) =>
            name === "売上" ? fullYen.format(Number(value)) : `${Number(value)} 件`
          }
          labelFormatter={(label) => String(label)}
          contentStyle={{
            borderRadius: 8,
            border: "1px solid #ebebee",
            fontSize: 12,
            boxShadow: "0 4px 12px rgba(22,22,28,0.08)",
          }}
        />
        <Bar yAxisId="sales" dataKey="sales" name="売上" fill="#b4544a" radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Line
          yAxisId="orders"
          type="monotone"
          dataKey="orders"
          name="客数"
          stroke="#26262e"
          strokeWidth={1.5}
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

/** カラー別販売構成。実際の色をバーに反映する */
export function ColorMixChart({
  data,
}: {
  data: { name: string; hex: string | null; quantity: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis type="category" dataKey="name" tick={AXIS} tickLine={false} axisLine={false} width={72} />
        <Tooltip
          formatter={(value) => `${Number(value)} 点`}
          contentStyle={{ borderRadius: 8, border: "1px solid #ebebee", fontSize: 12 }}
        />
        <Bar dataKey="quantity" name="販売点数" radius={[0, 3, 3, 0]} maxBarSize={20}>
          {data.map((entry) => (
            <Cell key={entry.name} fill={entry.hex ?? "#8a8a99"} stroke="#d6d6dc" />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** サイズ別販売構成 */
export function SizeMixChart({ data }: { data: { name: string; quantity: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="name" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} width={32} />
        <Tooltip
          formatter={(value) => `${Number(value)} 点`}
          contentStyle={{ borderRadius: 8, border: "1px solid #ebebee", fontSize: 12 }}
        />
        <Bar dataKey="quantity" name="販売点数" fill="#4b4b57" radius={[3, 3, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ResponsiveContainer>
  );
}
