/**
 * リダイレクト先の URL を、ブラウザから見えているアドレスで組み立てる。
 *
 * リバースプロキシ (nginx) の内側では、request.url のホストは「アプリが待ち受けている
 * アドレス」になる。`next start -H 127.0.0.1` で起動すると Next.js はこれを
 * `localhost:8026` として扱い、`new URL("/login", request.url)` で作ったリダイレクトが
 * そのまま `https://localhost:8026/login` としてブラウザへ返ってしまう
 * (`-H 0.0.0.0` のときだけ相対パスに直されるので気づきにくい)。
 *
 * そこで request.url には頼らず、プロキシが渡してくる Host ヘッダから組み立てる。
 * middleware (Edge) からも使うため、Node 専用の API は使わない。
 */
export function publicUrl(path: string, request: Request): URL {
  const fallback = new URL(path, request.url);

  const host = firstValue(request.headers.get("x-forwarded-host")) ?? request.headers.get("host");
  if (!host) return appUrl(path) ?? fallback;

  try {
    return new URL(path, `${protocolFor(host, request, fallback)}://${host}`);
  } catch {
    // Host ヘッダが URL として成り立たない (不正なリクエスト)
    return appUrl(path) ?? fallback;
  }
}

/** プロキシを何段か通ると "a, b" のように並ぶので、ブラウザに一番近い先頭を使う */
function firstValue(header: string | null): string | null {
  const value = header?.split(",")[0]?.trim();
  return value ? value : null;
}

function protocolFor(host: string, request: Request, fallback: URL): string {
  // 公開 URL (APP_URL) と同じホストなら、その設定を正とする (本番は https)。
  // X-Forwarded-Proto は当てにしきれない: プロキシが渡さなかった場合、Next.js が
  // 自分で "http" を補うため、「プロキシが http と言った」のか区別がつかない
  const configured = appUrl("/");
  if (configured && configured.host === host) return configured.protocol.replace(":", "");

  const forwarded = firstValue(request.headers.get("x-forwarded-proto"));
  if (forwarded === "https" || forwarded === "http") return forwarded;

  return fallback.protocol.replace(":", "");
}

function appUrl(path: string): URL | null {
  const base = process.env.APP_URL;
  if (!base) return null;
  try {
    return new URL(path, base);
  } catch {
    return null;
  }
}
