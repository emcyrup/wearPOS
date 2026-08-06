import { barcodeSvg, type BarcodeSvgOptions } from "@/lib/barcode";

/**
 * バーコードをインライン SVG として描画する (サーバーコンポーネント)。
 * SVG は自前生成のためサニタイズ不要だが、コード値は生成側でエスケープ済み。
 */
export function Barcode({
  code,
  ...options
}: { code: string } & BarcodeSvgOptions) {
  let svg: string;
  try {
    svg = barcodeSvg(code, options);
  } catch {
    return <span className="text-xs text-rose-700">バーコード化できないコードです</span>;
  }
  return (
    <span
      className="inline-block max-w-full [&>svg]:h-auto [&>svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
