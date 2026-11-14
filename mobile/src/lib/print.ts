import * as Print from "expo-print";

import { prepareHtmlForPrint } from "./print-html";

/**
 * Web 画面から頼まれた印刷を、OS の印刷機能 (AirPrint / Android の印刷サービス) で行う。
 * 利用者が印刷画面を閉じたときも例外になるので、失敗は呼び出し元へ返すだけにする。
 */
export async function printHtml(html: string, baseUrl: string): Promise<boolean> {
  try {
    await Print.printAsync({ html: prepareHtmlForPrint(html, baseUrl) });
    return true;
  } catch {
    return false;
  }
}
