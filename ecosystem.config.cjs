/**
 * PM2 の設定 (本番サーバー用)。
 *
 * 本番は nginx (御社管理) が https://wearpos.ai-labo.cloud を受け、
 * このアプリの 8026 番ポートへリバースプロキシする構成。
 * アプリ側は「割り当てられたポートで 0.0.0.0 に待ち受ける」だけでよい。
 *
 *   pm2 start ecosystem.config.cjs      # 初回
 *   pm2 reload wearpos                  # 更新時 (無停止で入れ替え)
 *   pm2 logs wearpos                    # ログ
 *
 * t3.small (2 GiB) のため 1 プロセスで動かす。
 * 台数を増やすより先に、DATABASE_POOL_MAX との積が Postgres の接続上限に収まるか確認すること。
 */
module.exports = {
  apps: [
    {
      name: "wearpos",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 8026 -H 0.0.0.0",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      // 環境変数は .env から読む (next start が自動で読み込む)。ここには秘密を書かない
      env: {
        NODE_ENV: "production",
        PORT: "8026",
      },
      // メモリが膨らんだら自動で再起動して、サーバー全体を巻き込まないようにする
      max_memory_restart: "700M",
      autorestart: true,
      // 起動直後に落ちる状態で無限に再起動しないようにする
      min_uptime: "10s",
      max_restarts: 10,
      restart_delay: 3000,
      // ログは日付付きで残す (pm2 logs で見られる)
      time: true,
      out_file: "logs/pm2-out.log",
      error_file: "logs/pm2-error.log",
      merge_logs: true,
    },
  ],
};
