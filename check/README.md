# check/ — 検証道具

コミット文の「検証:」に書く言葉（CLAUDE.md §6）を、人の目ではなく機械で出すための道具です。
配布物ではありません。画面の動き・保存・印刷には一切触れません。架空データ（接続先なし）だけで動きます。

## 準備（手元の Mac／Windows・初回だけ）

```bash
cd check
npm install                 # playwright が入る
npx playwright install chromium
```

クラウドの作業環境では playwright が最初から入っているので、準備は不要です。

## 使い方（リポジトリの根から）

```bash
node check/run.mjs                              # origin/main と今の作業ツリーを撮って見比べる（全画面）
node check/run.mjs --pages resident-master.html,facesheet.html   # 画面を絞る
node check/run.mjs --allow resident-master.html # 「この画面は変えてよい」（PC・印刷の違いを失敗にしない）
node check/run.mjs --hide-report                # 「不具合を報告」ボタンを消して撮る（ボタン以外の画素一致を確かめる時）
```

結果は `check/out/summary.md` に、コミット文へそのまま貼れる行で出ます。

```
・PC の画面: 24画面すべて画素一致
・印刷の見た目: 24画面すべて画素一致
・印刷ページ数: 全38ページ一致
・sim-check: iPhone 100%／200% とも横はみ出し 0
・JS構文 OK
・画面のエラー: 直す前から増えていない
・実名ガード exit 0
```

違いがあった画面は `check/out/compare/<画面>.<pc|print|ph100|ph200>.diff.png` に赤で出ます。

## それぞれの道具

| 道具 | 出す言葉 | 何をするか |
|---|---|---|
| `snap.mjs` | （材料） | 全画面を PC・iPhone 100%・iPhone 200%・印刷で撮り、PDF のページ数と横はみ出しを `metrics.json` に残す。時計は固定 |
| `compare.mjs` | 画素一致／印刷Nページ一致 | base と head の PNG を1画素ずつ比べる（Chromium の canvas。画像ライブラリは使わない） |
| `jscheck.mjs` | JS構文 OK | .js と HTML 内 `<script>` の構文だけ読む（実行しない） |
| `name-guard.mjs` | 実名ガード exit 0 | 実名の一覧（リポジトリには置かない）が変更行に無いか確かめる |
| `run.mjs` | まとめ | 上を順に回して `summary.md` を書く |
| `ci-allow.mjs` | — | PR の自動チェックで「違ってよい画面」を決める |
| `serve.mjs` | — | 配布物を手元で開く |

### 実名ガードの一覧

公開リポジトリなので、実名の表は置きません。次のどちらかに置くと使われます（1行1語）。

- 環境変数 `SU_NAME_GUARD_FILE` で指すファイル
- `check/.names.local`（.gitignore で除外済み）

一覧が無い時は「一覧なし（未実施）」（終了コード 2）と出て、○○様・○○さん の形だけを当て推量で警告します。
「実名ガード exit 0」と言えるのは、一覧を置いた端末・環境で回した時だけです。クラウドの作業環境には一覧が無いので、
そこでの結果は「未実施」のまま summary.md に入ります（事実と違う行を書かないため）。

## PR ごとの自動チェック（画素の見比べ）

main へ向けた PR を出すと、GitHub Actions が自動で `run.mjs` と同じ比較を全画面で回します（`.github/workflows/pixel-check.yml`）。

- **違ってよい画面**: その PR で中身を変えた画面（`ci-allow.mjs` が自動で決める）と、PR 本文に1行書いた画面
  ```
  画素の違いを許す: resident-master.html, facesheet.html
  ```
- **それ以外の画面**の PC・印刷に違いが出たら、チェックが赤い×になります（取り込みは止めません）
- 結果は PR に1つのコメントで出ます（実行のたびに書き換え）。差分画像と、違った画面の前・後の撮影は、その実行の成果物「pixel-diff」に入ります（14日で消えます）
- PR 本文を直して保存すると、もう一度比べます
- 色の差が 2 以内の画素は同じとみなします（角の丸みのにじみが撮るたびに 1 だけずれるため）。結果の文にもそう書かれます。`--tol 0` で完全一致だけを見ます
- 撮影は文字の位置を画素の格子に揃えて描きます（入力欄の文字が撮るたびに1画素未満ずれるのを防ぐため）。それでもまれに揺れる画面のために、1回目に違いが出た画面だけ、直す前・後とも5回ずつ撮り直し、多数派の絵で比べ直します。撮り直した時は結果の文に「揺れの確かめ」の行が出ます。本当の違いは撮り直しても残ります
- 実名ガードは、リポジトリの秘密の設定（Settings → Secrets and variables → Actions）に `SU_NAME_GUARD_LIST`（1行1語）を入れた時だけ本当に行います。見つけても語そのものは記録に出しません

## 現場からの報告の受け口

`check/gas/` に、全画面の「不具合を報告」ボタンと自動報告を GitHub の Issue にする受け口（Google Apps Script）と、
その置き方があります。夜の定期タスクの指示書は `check/routine/nightly-fix.md` です。
