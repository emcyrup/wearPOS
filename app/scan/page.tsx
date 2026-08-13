import { redirect } from "next/navigation";

/** スキャンは商品機能配下 (/products/scan) へ移動した。ブックマーク互換のため転送する */
export default function ScanRedirectPage() {
  redirect("/products/scan");
}
