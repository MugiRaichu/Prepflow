# Prepflow — 開発規約

作り置きで平日の食事を無思考化するローカルファースト PWA。要件・設計判断の一次資料は Obsidian vault
`G:\マイドライブ\副業\Prepflow\`（入口は `00 地図.md`）。コードとの食い違いがあればコードを正とし、vault を直す。

## スタック
Vite + React 19 + TypeScript / Tailwind v4 + shadcn/ui（自然素材の色・ライト既定）/ Dexie.js / vite-plugin-pwa / WebLLM（Worker）

## 守ること
- ユーザー固有値（人・器具・容器・予算・キー）をコードにハードコードしない。`src/db/seed.ts` に入れてよいのは参照データと既定設定だけ
- IndexedDB のインデックス対象の真偽値は `Bool`(0|1)。`boolean` はインデックスに載せられない
- スキーマ変更は `src/db/db.ts` に `version(n+1)` を追記する。過去の `version()` を消さない
- UI は `src/db/repositories/` を経由して DB にアクセスする。コンポーネントから `db.*` を直接呼ばない
- LLM の出力は `src/ai/validate.ts` の zod スキーマを通してから DB に入れる。生 JSON を信用しない
- 色は「自然素材」の範囲に留める。地は生成り、文字は墨、差し色は茜1色。彩度の高い色を使わない
- 食材の色（`--food-*`）はイラスト専用。一覧で種類を見分けるためで、装飾には使わない
- 秘密情報（APIキー等）は `secrets` テーブルのみ。エクスポート機能は `secrets` を必ず除外する
- 通信を伴う推論は `src/ai/router.ts` を通す。直接 fetch しない

## コマンド
`npm run dev` / `npm run build` / `npm run typecheck` / `npm run icons`（SVG→PNG 再生成）

## フェーズ
1 基盤・スキーマ（完了）→ 2 設定・ダッシュボード UI → 3 AI 推論層 → 4 LINE/GAS 通知
