import { redirect } from "next/navigation";

/** スキャンは商品一覧ページに埋め込んだため、ここは転送のみ */
export default function ScanRedirectPage() {
  redirect("/products");
}
