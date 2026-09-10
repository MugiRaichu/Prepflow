# プレノラ（Plenora）

暮らしを育む。

週末に指示どおり買って、指示どおり作り置きするだけで、平日の食事・PFC・食費管理を無思考化する PWA。
サーバーなし・全データ端末内・オフライン動作。

## セットアップ

```bash
npm install
npm run icons     # public/icons/icon.svg から PNG アイコン一式を生成
npm run dev
```

shadcn/ui のコンポーネント追加:

```bash
npx shadcn@latest add button card input tabs
```

## 構成

```
src/
  db/            Dexie スキーマ・シード・リポジトリ
  features/      画面単位（dashboard / profiles / planner / shopping / cook / containers / settings）
  ai/            クラウド／ローカル LLM とルーター、プロンプト、出力検証
  workers/       WebLLM Worker
  notify/        GAS 連携
  components/    ui（shadcn 生成物）/ shared
```

設計資料は Obsidian vault（`G:\マイドライブ\副業\Prepflow\`）。
