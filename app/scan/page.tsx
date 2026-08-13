import { redirect } from "next/navigation";

/** スキャンは商品一覧ページ (/products) に埋め込んだ。ブックマーク互換のため転送する */
export default function ScanRedirectPage() {
  redirect("/products");
}
