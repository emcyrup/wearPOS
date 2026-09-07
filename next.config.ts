import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@prisma/client", ".prisma/client"],

  /**
   * 本番は nginx (https://wearpos.ai-labo.cloud) → このアプリ (:8026) のリバースプロキシ。
   * Server Actions は Origin と Host の一致を検証するため、公開ドメインを許可しておく。
   * (nginx が Host ヘッダを渡していれば不要だが、設定は御社管理のため保険として入れる)
   */
  experimental: {
    serverActions: {
      allowedOrigins: ["wearpos.ai-labo.cloud", "localhost:8026", "127.0.0.1:8026"],
    },
  },

  /**
   * セキュリティヘッダ。
   * 会員証やレシートを iframe に埋め込ませない・MIME 推測を止める・
   * 参照元 URL を外部へ渡しすぎない、といった基本のみを入れている。
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "geolocation=(), microphone=(), payment=()" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
