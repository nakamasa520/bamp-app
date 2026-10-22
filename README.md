# BAMP! 当日タスク管理（10/24・25）

スマホ優先のWebアプリ。名前を入れると、工程表をもとにした **自分専用のリアルタイム予定** を表示します。
`管理者` と入力すると、メンバーの予定変更・コメント送信ができます。

- 白ベース **Liquid Glass UI**（すりガラス・光沢・バネ系アニメーション）／全画面スケルトンローディング
- 現在時刻（JST）のスロットを自動追従：残り時間バー・次の予定・チーム・Captain・エリア地図
- 名前検索は完全一致不要（誤字・一部・かな読み・異体字(髙/高 舩/船)・ローマ字は Workers AI で補完）
- 管理者の変更はメンバー画面へ約5秒で反映（トースト通知）／電波が弱くても直前の予定を表示（オフライン対応）

## 構成
```
public/   フロント（ビルド不要の ES Modules / CSS）  index.html, js/app.js, js/model.js, css/app.css, sw.js
src/      Cloudflare Worker（API）                    worker.js, search.js
migrations/ D1 スキーマ     seed/ 初期データ(匿名サンプル)   scripts/ 工程表→SQL 変換
tests/    実ブラウザ E2E (Playwright)
```

## 使い方
```bash
npm i
# 1) 工程表を data/schedule.xlsx に置く（Gitには含めない）
npm run seed                # -> seed/real.sql
npm run db:local            # ローカルD1に反映
npm run dev                 # http://localhost:8787
```
リハーサル用に時刻を固定できます: `http://localhost:8787/?t=2026-10-24T13:10`（JST、以降は実時間で進行）

### Cloudflare へデプロイ
```bash
npx wrangler login
npx wrangler d1 create bamp-task            # 出力された database_id を wrangler.jsonc に記入
npm run db:remote                           # マイグレーション + 工程表データ投入
npx wrangler secret put ADMIN_PIN           # 任意。設定すると「管理者」入力後にPINを要求
npm run deploy
```
`main` へのpushで自動デプロイしたい場合は、リポジトリの Secrets に `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` を設定（`.github/workflows/deploy.yml`）。

### テスト
```bash
python3 -m pip install playwright && python3 -m playwright install chromium
npm run seed && npm test     # 約3分。サーバーは自動起動・DBは毎回初期化
```
スマホ画面(390px/360px)のChromiumで、起動〜名前検索〜確認〜予定表示〜時刻切替〜管理者編集〜リアルタイム反映〜権限〜オフラインまでを操作します。

## 技術選定の理由
| 技術 | 採った理由 |
|---|---|
| **Cloudflare Workers + 静的アセット** | 指定のとおり。フロントとAPIを1デプロイで配信でき、エッジ配信で山間の弱い回線でも初回表示が速い。無料枠で足りる規模 |
| **D1 (SQLite)** | 予定・コメントは「人×時間」の表形式で、更新は少量・整合性が重要。KVより編集の原子性（batch）が取りやすく、工程表をそのままSQL化できる。Durable Objects/WebSocketは当日30人規模には過剰 |
| **Workers AI** | ①名前検索でルールで拾えない入力（ローマ字・読み違い）の補完 ②管理者コメントの整形。どちらも「確実に動く本体＋AIは補助」とし、AIが落ちても検索・送信は成立。モデルは `AI_MODEL` 変数で差し替え可 |
| **ビルド不要の素のJS（ES Modules）** | 画面数が少なく、依存ゼロで初回転送量が小さい。ビルド・フレームワークの更新リスクが当日運用に不要。ロジックは `model.js` に分離 |
| **ポーリング(5秒) + `?since=` 差分** | 変更が無い時は数十バイトの応答で済む。WebSocketより実装が単純で、回線が不安定でも自動復帰する |
| **Service Worker + localStorage キャッシュ** | 現地は電波が不安定な想定。最後に取得した予定をオフラインでも表示 |
| **独自のあいまい検索 (`src/search.js`)** | 編集距離・2-gram・文字重なり・異体字正規化・姓の読みを併用。決定的で速く、テスト可能。足りない時だけAIへ |
| **Playwright（実Chromium）** | 要件の「実際にブラウザを操作して検証」を自動化し、再実行可能にするため |
| **データ非公開設計** | 工程表には氏名・移動手段が含まれるため、リポジトリには匿名化サンプル(`seed/sample.sql`)のみ置き、実データは `.gitignore` |

## 工程表の解釈（要確認）
- 24日 `I〜U`、25日 `W〜AF` を各時間枠として取込。25日の `AE`（見出し「18:00」）は 17:45–18:00 の枠（24日 `R` と同じ役割）と解釈
- セルが空欄の枠は「予定なし」と表示
- Captain：`Captain-Pentagon / Circle / Hexagon-Ⅰ / Triangle / Hexagon-Ⅱ`（建築・全体把握グループ）。**Square の Captain は工程表に記載なし → 「未設定」表示**。演出グループの `Captain-Circle`（余傳）は領域Captainとしては扱わない
- Pentagon の枠には Captain だけが入っているため、Pentagon のメンバー＝Captain一覧になる

## セキュリティ
- 仕様どおり「管理者」と入力するだけで入れます。公開URLで運用する場合は `ADMIN_PIN` の設定を推奨（書き込みAPIはPIN由来トークン必須になる）
- 名簿は URL を知る人なら取得可能です。URLの共有範囲に注意
