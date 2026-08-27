# CLAUDE.md — care-tools 作業ガイド

このファイルは、AI アシスタント（Claude Code 等）がこのリポジトリで作業するときの前提と規約をまとめたものです。
コードを1行でも触る前に、まず「1. 最重要」を読んでください。

---

## 1. 最重要 — ここは**公開**リポジトリです

`TH-su/care-tools` は **public** リポジトリで、GitHub Pages で
`https://th-su.github.io/care-tools/` として実際に配信されています。
`.nojekyll` があるのはそのためです（Jekyll 処理を止めて素の HTML を配る）。

### 1-1. ローカルの作業ディレクトリは WordPress テーマ本体でもある

開発者の手元では、このディレクトリは公開リポジトリの作業ツリーであると同時に
WordPress テーマのディレクトリでもあります。つまり **公開してよいファイルと、絶対に公開してはいけない
ファイルが同じディレクトリに同居している**。

そのため `.gitignore` は「全部除外 → 公開対象だけを1行ずつ許可する」**ホワイトリスト方式**です。

```gitignore
/*                      # まず全て除外
!/index.html            # 公開対象のみ明示 opt-in
!/care-schedule.html
...
```

**この方式を絶対に崩さないこと。**

- 新しい公開アプリを足すときだけ、`.gitignore` に `!/新ファイル.html` を1行追加する（明示 opt-in）。
- `/*` の除外を消したり、`!` の行をワイルドカード（`!/*.html` 等）に広げたりしない。
  広げた瞬間に、テーマ本体の PHP・`design/`・実在氏名を含む JSON が公開リポジトリへ流れ込む。
- `git add -A` / `git add .` は、このホワイトリストがあるから安全に打てる。安全装置はここ1箇所しかない。

### 1-2. 公開してはいけないもの（`.gitignore` の末尾に一覧あり）

| 対象 | 理由 |
|---|---|
| `*.php`, `assets/`, `design/` | WordPress テーマ本体・設計ドキュメント |
| `.claude/`, `CLAUDE.md`※ | harness・作業ドキュメント |
| `ws-master*.json`, `data/` | **実在入居者名**を含む |
| `demo-data.json`, `staff-roster.json`, `shiftapp-backup-*.json` | **実在職員名**を含む |
| `visiting-medical-app/` | 訪問診療＝要配慮個人情報 |
| `gas/`（`master.gs` / `med-api.gs` / `moushiokuri-api.gs` 他） | サーバ側コードと合言葉の取り扱い。正本はテーマ側のローカル git |
| `haiben-record.html`, `gas/haiben-api.gs` | 正本は別リポジトリ `TH-su/haiben-record` |

※ `CLAUDE.md` は元々「非公開」側に分類されていました。本ファイルは**公開リポジトリの内容だけを説明する
ように書かれており、個人情報・施設固有の運用情報を含みません**。ローカルのテーマ側に別の（非公開の）
`CLAUDE.md` がある場合、同じパスで衝突します。運用の詳細は「11. このファイル自身の扱い」を参照。

### 1-3. 個人情報の鉄則

- **実在の氏名・生年月日・処方内容・記録本文を、コードにもコミットにも書かない。**
  スクリーンショット・テストデータ・コメントの例示も同じ。
- 氏名や記録を表示する HTML には必ず次の2つを入れる（既存ファイルはすべて入っている）。
  ```html
  <meta http-equiv="Cache-Control" content="no-store">
  <meta name="robots" content="noindex,nofollow">
  ```
  `index.html` は一覧ページ＝全ツールへの入口になるので `noindex` に加えて **`nofollow` も必須**。
- 要配慮情報（申し送り本文・バイタル等）は **localStorage に保存しない**。
  例: `moushiokuri-viewer.html` はメモリ上にだけ持ち、保存するのは接続設定と UI 状態だけ。
- 資格情報（合言葉／トークン）を、同期対象のデータ塊に載せない。
  例: `weight-record.html` は URL を三層バックアップするが、合言葉は専用キーにしか置かない。
- 診断ログ・エラーメッセージに氏名を出さない（件数だけ出せば切り分けには足りる）。

---

## 2. リポジトリの構成

```
care-tools/
├── index.html                  # 介護ツール メニュー（全アプリの入口）
├── connection-settings.html    # 接続設定（7系統の GAS URL と合言葉を1画面で設定）
│
│  ── 職員 ──
├── shift-app.html              # シフト作成・管理（最大級・約10,500行）
├── work-schedule.html          # ワークスケジュール（1日の支援割り振り・約12,700行）
├── shift-analyzer.html         # 過去シフト分析（実働・常勤換算の集計）
│
│  ── 入居者 ──
├── resident-master.html        # 入居者マスタ（★共有名簿の唯一の書き手）
├── facesheet.html              # フェイスシート（基本情報・医療・服薬）
├── care-schedule.html          # 週間計画（週間ケア計画の作成）
├── daycare-roster.html         # 通所せせらぎ 利用表（★su-data.js 採用済み）
├── weight-record.html          # 体重管理（Chart.js 使用）
├── genogram.html               # ジェノグラム作成（Konva 同梱）
├── moushiokuri-viewer.html     # 申送ビューア（入居者別）
├── patch-calendar.html         # 貼り薬カレンダー（背中8箇所ローテーション）
├── visit-overview.html         # 訪問 週間俯瞰（読み取り専用ビュー）
├── support-overview.html       # 全支援 週間俯瞰（読み取り専用ビュー）
├── overview-compare.html       # 訪問／全支援 左右比較（iframe シェル）
│
│  ── 共有 JS（各アプリが <script src> で読む）──
├── su-data.js                  # 共通データアクセス契約（Phase 0）
├── su-data-gas.js              # 現行 GAS を叩くドライバ
├── meds-effect-dict.js         # 薬効辞書（薬剤名 → 効能分類）
│
├── mailer/                     # SilverMail — ローカルメールクライアント（Node + React）
├── universe-sandbox/           # 太陽系シミュレータ（PWA・three.js）※介護業務とは無関係
├── .gitignore                  # ★公開ホワイトリスト（1章参照）
└── .nojekyll
```

---

## 3. 介護ツール（ルートの HTML）のアーキテクチャ

### 3-1. 1ファイル完結・ビルドなし

各アプリは **HTML + CSS + JS を1ファイルに収めた単一 HTML** です。ルートに `package.json` も
バンドラも lint 設定もありません。**ビルドツールを導入しないこと**が明示された不変条件です
（`su-data.js` 冒頭「Phase 0 の不変条件」）。

- 編集はそのファイルを直接触る。ファイルは大きい（1万行超もある）ので、
  Read は範囲指定、変更は Edit でのピンポイント置換を基本にする。
- 動作確認は**ブラウザでそのファイルを開くだけ**。サーバもビルドも要らない。
- 外部依存は原則ゼロ。唯一の CDN は `weight-record.html` の Chart.js 4.4.1 です。
  同梱ライブラリは Konva 9.3.22（`genogram.html`）、LZString（`shift-app.html` / `work-schedule.html`）、
  three.js（`universe-sandbox/vendor/`）。**新しい CDN 依存を増やさない**（現場端末がオフラインでも動く必要がある）。

### 3-2. 共有 JS の読み込みとキャッシュ破棄

```html
<script src="su-data.js?v=2026-08-13"></script>
<script src="su-data-gas.js?v=2026-08-13"></script>   <!-- 契約 → ドライバの順 -->
<script src="meds-effect-dict.js?v=2026-08-11"></script>
```

**`?v=` は必須**。HTML の `no-store` はサブリソースに効かないため、付けないと
「新しい HTML × 古い JS」の組合せが現場端末に残ります。**共有 JS の契約を変えた日に `?v=` を更新する**。

読み込めていないときは、`ReferenceError` でトップレベルを止めない（画面が無反応になる）。
必ず存在チェックしてから使い、読めていないことを画面に出して残りの処理は続ける
（`daycare-roster.html` の `SU_DATA_READY`、`resident-master.html` の薬効辞書ガードが手本）。

### 3-3. バックエンドは Google Apps Script

各アプリは GAS ウェブアプリ（`https://script.google.com/macros/s/.../exec`）へ
`fetch` して同期します。GAS 側のコードはこのリポジトリにはありません（非公開）。

通信の形は**全アプリで同一に保つこと**（`su-data-gas.js` に切り出し済み）。

```js
fetch(endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'text/plain;charset=utf-8' },  // CORS preflight を起こさない
  body: JSON.stringify({ ...payload, token }),
  redirect: 'follow'                                        // GAS は 302 を返す
})
```

`Content-Type` を `application/json` にすると preflight（OPTIONS）が発生し、
**GAS は OPTIONS に応答しないので全通信が壊れます**。1バイトでも形を変えないこと。

ページを閉じる直前の最終送信だけ `navigator.sendBeacon`（`fetch` は unload で中断されるため）。
Blob の type も同じ理由で `text/plain`。応答は受け取れないので、これを唯一の保存手段にしない。

### 3-4. rev による楽観ロックと競合リベース

KV ストア GAS は `{ok, data, rev, error}` を返します。`put` には手元の `rev` を添えて送り、
サーバ側の `rev` が進んでいたら競合として拒否されます。

競合時は **pull → リベース（サーバ版を土台にローカル編集をID単位で再適用）→ 再 push**。
再 push は **1回だけ**（`_rebasing` フラグで無限ループを防ぐ）。
2重競合は再 push せず未送信として保持し、次回の編集か手動送信に委ねます。

リベースは「利用者直下のスカラーはサーバ側のまま温存」する設計です。そのため
退去・入院・復帰のような**スカラーのトグル操作は、push 後に必ず再反映（applyPatch）を入れる**こと。
入れないと競合1回でユーザーの操作が黙って巻き戻ります（`care-schedule.html` に実例と対策あり）。

### 3-5. 非同期 API は同期 throw しない

呼び出し側は `busy = true; api().then(...).catch(...)` の形で書かれています。
同期に throw すると `.catch` が付く前に抜け、**busy フラグが立ちっぱなしでその機能がセッション中ずっと止まります**。
エラーは必ず `Promise.reject()` で返すこと（`su-data.js` の `call()` がその形）。

---

## 4. データ契約（共有 localStorage キー）

同一オリジン（`th-su.github.io`）の全アプリが localStorage を共有します。ここが実質的な結合部なので、
**キーの追加・改名・書き手の変更は破壊的変更**として扱ってください。

### 4-1. 共有キー

| キー | 形 | 書き手 | 読み手 |
|---|---|---|---|
| `su_sync_common` | `{endpoint, token, updatedAt}` | ワースケ／シフト／週間計画／接続設定 | 週間計画・ワースケ・シフト・デイ利用表・両俯瞰・入居者マスタ・フェイスシート |
| `su_residents_common` | `{residents:[...]}` | **`resident-master.html` のみ** | 週間計画・体重管理・フェイスシート・ジェノグラム・申送ビューア |
| `su_device_role` | `'office'` \| `'field'` | 端末セットアップ時 | ほぼ全アプリ（画面の出し分け・起動ブロック） |
| `su_backend` | `'gas'`（既定） \| `'supabase'` | 手動（移行の安全弁） | `su-data.js` |

**`su_residents_common` の唯一の書き手は `resident-master.html`。**
他のアプリは **読むだけ**。ここへ書くコードを足さないこと（複数の書き手ができた時点で名簿が壊れます）。
マスタ由来の値は「master 常勝」で取り込みますが、**空欄補完のみ**にするフィールドがあります
（介護度・週間計画対象など。全面上書きにするとアプリ側の編集を巻き戻します）。

### 4-2. アプリ固有キー（抜粋）

`ws_settings` / `ws_sync_revs` / `wsday_<date>`（ワースケ）、`care_schedule_v2`（週間計画）、
`shiftapp:v1:*`（シフト）、`shiftanalyzer:v1:*`、`wtmgr_v1` / `wtmgr_v1_bak` / `wtmgr_v1_bak2` / `wtmgr_api_url` / `wtmgr_api_token`（体重管理）、
`msk_cfg` / `msk_view` / `msk_days`（申送ビューア）、`genogram:*`、`dcr_hidden`（デイ利用表）、
`rmaster_cfg`（入居者マスタ）、`hbcr_api_url` / `hbcr_api_token`（排泄ケア記録）、
`apc_start` / `apc2_*`（貼り薬カレンダー）。

**圧縮の約束**: `wsday_*` と `shiftapp:v1:*` は LZString（`compressToUTF16`）で圧縮され、
先頭に制御文字 `String.fromCharCode(1)`（LZ_MAGIC）が付きます。
**共有キー（`su_*` / `ws_settings` / `ws_sync_revs` / `care_schedule_v2`）は他アプリが平文 JSON で読むため
必ず平文のまま**にしてください。他アプリのキーを読むときは両対応のデコーダを通します。

### 4-3. localStorage の書き込み作法

```js
localStorage.setItem(k, json);
if (localStorage.getItem(k) !== json) { /* 失敗として扱う */ }   // 必ず読み戻して検証
```

- 破損値は「空扱い」にして安全側へ倒す。配列が来たら弾く（`typeof o === 'object'` は配列も通す。実際に踏んだ罠）。
- オブジェクト形のキーは必ず **read-modify-write**（他アプリが入れた項目を消さない）。
- 空欄は「変更しない」＝既存値を消さない。
- localStorage が使えない環境（Safari プライベート等）でも既定値で動くこと。`try/catch` を省かない。

### 4-4. 端末ロール（`su_device_role`）

- `'field'`（現場端末）では、氏名・生年月日・合言葉を扱う画面を起動時にブロックします
  （`applyXxxDeviceGuard()` が `#suDeviceBlock` オーバーレイを出す）。
- `index.html` は `data-office-only` 属性のタイルを非表示にします（`<body>` より前に class を付けてちらつきを防ぐ）。
- **これは保護ではなく誤タップ対策**です。`display:none` でも href はソースに残るし、
  localStorage が消えればガードも外れます。実質の防御は「現場端末に接続 URL・合言葉を配らない」という運用側にあります。
  この前提を「セキュリティ機能」として説明し直さないこと。

---

## 5. 接続設定（`connection-settings.html`）

新しい端末のセットアップで、7系統ぶんの GAS URL と合言葉を1画面で設定します。

| id | 系統 | キー |
|---|---|---|
| `ws` | 週間計画・ワースケ・シフト（＋デイ利用表・両俯瞰・マスタ・フェイスシート） | `su_sync_common` |
| `master` | 入居者マスタ・フェイスシート | `rmaster_cfg` |
| `haiben` | 排泄ケア記録 | `hbcr_api_url` / `hbcr_api_token` |
| `weight` | 体重管理 | `wtmgr_api_url` / `wtmgr_api_token` |
| `msk` | 申送ビューア | `msk_cfg` |
| `geno` | ジェノグラム（合言葉なし） | `genogram:cloudCfg` |
| `analyzer` | 過去シフト分析 | `shiftanalyzer:v1:cloud` |

**設計上の約束**:

- この画面は「設定を書く場所」を1つにするだけで、**キーの一本化はしない**。
  新キーへ移すと全端末を同時に再設定する必要が生じ、1台でも取り残すとその端末が全断するため。
- URL 検査の正規表現は、`su_sync_common` **だけ**は所有アプリと文字どおり同じ式（`RE_GAS_EXEC`）を使う。
  ここを緩めると誤 URL が共通キー経由で6アプリへ伝播します。
- 多層保存のアプリ（排泄ケア記録・体重管理）は **URL の主キーだけ**を書く。
  両アプリとも起動時に主キーの値を全層へ書き戻すので、多層をここで真似すると二重管理でずれます。
- 同一オリジンの localStorage しか触れません。別オリジンのアプリはリンクを足しても効きません。
- この画面に氏名・記録・入居者データを**持ち込まない**（扱うのは URL と合言葉のみ）。

---

## 6. UI・アクセシビリティ規約

現場のタブレットと事務所 PC で、介護職員が日常的に使う業務ツールです。次は既存全ファイルで守られています。

### 6-1. 共通の CSS 変数体系

```css
:root {
  --pri: #0b57d0; --pri-l: #ecf3fe; --pri-d: #0842a0;
  --g0: #f8f9fa; --g1: #f1f3f4; --g2: #e8eaed; --g3: #dadce0;
  --g5: #9aa0a6; --g6: #80868b; --g7: #5f6368; --g9: #202124;
  --r: 12px;
  --sh: 0 1px 6px rgba(0,0,0,.12);
}
```
※ `care-schedule.html` だけ `--pri` が濃い方（他ツールの `--pri-d` 相当）で、標準の青は `--pri2` です。

### 6-2. 守ること

- **タップ領域は最小 44px**（HIG）。タイルは実測 96px（`--tile-min`）。
- **コントラスト比 AA（4.5:1）を割らない**。`--g6`(#80868b) は白地で 3.68:1 なので本文には使わず `--g7`(#5f6368)=5.96:1 を使う。
  白文字に `opacity` を掛けると背景と合成されて AA を割ります。
- **色だけに意味を持たせない**。必ず文言・記号を併記する（バッジ、外部リンクの「↗」、状態表示など）。
- **フォーカスリングを消さない**（`:focus-visible { outline: 3px solid var(--pri) }`）。キーボード到達性。
- `-webkit-tap-highlight-color: transparent` を切っている代わりに、`:active` で必ず手応えを返す。
  `prefers-reduced-motion` では transform を止め、色の変化で代替する。
- `env(safe-area-inset-*)` でノッチ端末に対応する。
- **画面切替を持つアプリは、リロードで現在地を失わない**ようにする（dev-principles 原則11）。
  誰を開いているのかを画面上部に必ず出す。

### 6-3. 印刷

多くのアプリが A4／A3 の帳票印刷を持ちます（`@media print` と `@page`）。

- `@page { size: A3 portrait; margin: 8mm; }` のような指定を使う。用紙が可変のものは JS で `@page` を書き換える。
- 背景色は既定で落ちるブラウザがあるため `print-color-adjust: exact` を指定する。
- 印刷用に一時的に足した style/class は**必ず後始末する**（レビュー指摘で実際に直した箇所あり）。
- 印刷体裁はヘッダ高さの `calc()` に依存している箇所があります。ヘッダに要素を足すと表示と印刷の両方が崩れます。

### 6-4. JS の書き方

- **`'use strict'` を付ける。**
- **旧 Safari 互換**: 冒頭に「旧Safari互換」と宣言しているファイル・モジュールでは
  `?.` / `??` / `replaceAll` / `structuredClone` / spread を**使わない**。
  宣言のないファイル（`weight-record.html` 等）は現代構文を使っています。
  **編集するファイル冒頭の宣言に従ってください。**
- HTML へ差し込む文字列は必ずエスケープする（`escHtml()` 相当が各ファイルにある）。
- 描画の失敗で運用を止めない。`try/catch` で握って画面は生かす。
- 日本語の並び順は `localeCompare('ja')`。氏名はふりがな（kana）優先で五十音順。

---

## 7. コメントの書き方（このリポジトリ独自）

このコードベースは**コメント密度が非常に高く、しかも「なぜ」を書く**のが規約です。周囲に合わせてください。

- `★` は「触る前に必ず読め」の印。不変条件・落とし穴・過去の事故をここに書く。
- **決定の理由と、破ったときに何が起きるかを書く。**
  例:「ここを緩めると6アプリが一斉に誤った接続先を向く」「busy フラグが立ちっぱなしになる」
- **裁定した日付と結論を残す**。例:「2026-08-05 代表裁定：…」「2026-08-13 意図的な差分として記録に残す」
- 設計ドキュメントの節番号を参照する（次章）。
- 変更しない判断も記録する（「ドットの大きさは現状維持と裁定。その旨をコード中に残す」というコミットが実在します）。

---

## 8. 参照されているが**このリポジトリには無い**ドキュメント

コード中のコメントは次を頻繁に参照します。いずれも非公開（`design/`）で、**このリポジトリには含まれません**。

| 参照 | 内容（コメントから読み取れる範囲） |
|---|---|
| `design/dev-principles.md` | 開発原則。**原則4**＝空欄は既存値を消さない。**原則11**＝リロードで現在地を失わない／誰を開いているか常に出す |
| `design/data-contracts.md` | アプリ間データ契約。§1-2, §2, §5（マスタ非空常勝）, §6-⑤/⑧/⑨, §9（鉄則3・4）, §10-5, §13 |
| `design/personal-info.md` | 個人情報規約（`no-store` の要求、ログに氏名を出さない 等） |
| 統合設計書 / Phase0-1 実装設計書 | `su-data.js` の Phase 0 不変条件（§8 / §3.1） |

**節番号を勝手に発明しない。** 内容を確認する必要があるときは、ユーザーに該当ドキュメントの提示を求めてください。

---

## 9. SilverMail（`mailer/`）

複数アカウント対応のローカルメールクライアント。**ここだけは Node のアプリで、ビルド手順があります。**
詳細は `mailer/README.md`（利用者向けとして十分に厚い）。

```bash
cd mailer
npm install            # 開発時（esbuild / React 込み）
npm start              # http://localhost:8744 が開く
npm run demo           # デモデータで起動（アカウント不要）
npm run build          # src/ → public/app.js  ★ビルド済みをコミットする運用
npm run watch          # 監視ビルド
npm run stop           # 別ターミナルから終了
npm run diag           # Google 連携の接続診断（画面の「接続を診断」と同じ判定）
npm run check:google   # invalid_client の読み分けが今も成り立つかを実 API で確認
```

- **Node 18 以上。** 依存は express / imapflow / mailparser / nodemailer の4つだけ（実行時）。
- **`src/` を編集したら必ず `npm run build` して `public/app.js` も一緒にコミットする。**
  ビルド済み成果物をコミットする運用なので、忘れると利用者に変更が届きません。
- サーバは `127.0.0.1` のみで待ち受け、Origin/Host をチェックします。この制約を緩めないこと。
- **認証情報はリポジトリに置かない設計**です。macOS キーチェーン（サービス名 `SilverMail`）と
  `~/.silvermail/`（0600）に保存されます。`.gitignore` で `mailer/node_modules/` と `mailer/data/` を明示除外済み。
- HTML メールはサンドボックス化した frame ＋ CSP で隔離し、リモート画像は既定でブロック（開封トラッキング対策）。
  `server/sanitize.js` の防御を弱めないこと。

構成（`mailer/README.md` の「開発」節に完全版あり）:

```
mailer/
├── server/    # index.js(本体) api.js imap.js smtp.js sanitize.js store.js
│              # calendar.js google.js ics.js tasks.js datetime.js
│              # schedule-extract.js(日本語日時の抽出) diagnose.js demo.js
├── src/       # React UI（Apple Mail 風3ペイン＋右サイドパネル）
├── public/    # 配信ファイル（ビルド済み app.js を含む）
└── scripts/   # build.mjs / stop.mjs / diag.mjs / check-google-errors.mjs
```

---

## 10. `universe-sandbox/`

太陽系シミュレータ（PWA）。**介護業務とは無関係**の独立したアプリです。

- `js/app.js`（描画・UI）/ `js/physics.js`（軌道計算）/ `js/data.js`（天体データ）
- three.js と OrbitControls を `vendor/` に同梱（CDN 依存なし）
- `sw.js` + `manifest.webmanifest` でオフライン動作・ホーム画面追加に対応
- 他のツールとは localStorage も CSS 変数体系も共有していません。介護ツール側の規約は適用されません。

---

## 11. Git 運用

- 既定ブランチは `main`。push すると GitHub Pages へそのまま反映されます
  （＝**現場が次に開いた瞬間に本番へ出る**。壊れたものを push しない）。
- **コミットメッセージは日本語で、「利用者から見て何が変わったか」を書く。**
  実例:
  - `週間名簿: 人数の上に区切り線を入れ、階ラベルを大きく左へ。居室が「未」に戻る不具合を直す`
  - `体重管理: 壊れた記録でアプリ全体が落ちるのを直し、ドットを2段の色に整理`
  - `シークレットを持つクライアントにPKCEを付けていたため接続できなかったのを直した (#7)`

  アプリ名のプレフィクス（`体重管理:` `申送ビューア:` 等）を付けると読みやすくなります。
  PR 経由なら末尾に `(#番号)` が付きます。
- **モデル名・AI の識別子をコミットメッセージ・PR・コード中に書かない。**
- 変更したファイルだけをステージし、`.gitignore` のホワイトリストを勝手に広げないこと（1章）。

---

## 12. このファイル自身の扱い

`.gitignore` の末尾コメントでは、`CLAUDE.md` は当初「テーマ本体・harness・docs」として
**公開対象外**に分類されていました。ローカルのテーマディレクトリに非公開の `CLAUDE.md` が
存在する場合、このファイルとパスが衝突します。

このファイルを公開リポジトリで管理し続ける場合の注意:

- 本ファイルは**公開済みのコードだけを説明**しています。氏名・処方内容・施設固有の運用情報・
  GAS のエンドポイント・合言葉は**1文字も書かないこと**。
- ローカルの非公開 `CLAUDE.md` を、このファイルへマージしないこと。
  非公開の内容が必要なら `design/` 側（非公開）に置き、ここからは**節番号で参照するだけ**にする。
- 追記するときは必ず「これは公開されてよいか？」を先に確認してください。

---

## 13. よくある落とし穴（チェックリスト）

作業を終える前に確認してください。

- [ ] `.gitignore` のホワイトリストを広げていないか。新規公開ファイルは `!/…` を1行足したか
- [ ] 実在の氏名・生年月日・処方内容・記録本文が、コード／コメント／コミットに入っていないか
- [ ] 氏名を表示する新規 HTML に `no-store` と `noindex,nofollow` を入れたか
- [ ] GAS への `fetch` の形（`text/plain` / `redirect:'follow'`）を変えていないか
- [ ] 共有 JS の契約を変えたなら、読み込み側の `?v=` を全ファイルで更新したか
- [ ] `su_residents_common` へ書いていないか（書き手は `resident-master.html` だけ）
- [ ] 共有キーを LZString で圧縮していないか（共有キーは平文 JSON のまま）
- [ ] localStorage への書き込みを読み戻して検証したか。空欄で既存値を消していないか
- [ ] 非同期 API が同期 throw していないか（busy フラグが固まる）
- [ ] 競合リベース後にスカラーのトグル操作を再反映（applyPatch）したか
- [ ] 編集したファイル冒頭の「旧Safari互換」宣言に構文を合わせたか
- [ ] コントラスト AA・44px・フォーカスリング・色以外の手がかりを守ったか
- [ ] 印刷用に足した style/class を後始末したか。ヘッダの高さを変えていないか
- [ ] `mailer/src/` を触ったなら `npm run build` して `public/app.js` もコミットしたか
- [ ] 新しい CDN 依存を増やしていないか
- [ ] 「なぜ」と「破ったら何が起きるか」をコメントに残したか
