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

### 帳票の紙（架空データ）

接続先なしの画面だけを撮ると、帳票（ケアマネ一覧など）は中身が空のままで、帳票を直しても比べられません。
そこで `check/fixtures/<画面名>.mjs` がある画面は、架空の入居者を読ませて帳票の紙も撮ります（2026-10-26〜）。

- 撮るもの: `<画面>__<帳票>.print.png`（印刷部品 SUPrint で準備した紙の見た目）と、帳票ごとの印刷ページ数
- 結果の行: `帳票の印刷（架空データ）: 2枚すべて画素一致`。`--allow <画面>` で、その画面の帳票も「変えてよい」になる
- 直した後で帳票が撮れなくなったら失敗にする（撮れないまま「一致」と言わない）
- 通信は撮影の間だけ横取りして材料の決まった応答を返す（ネットへは出ない）。画面のコードは変えない
- 材料は道具の側から読むので、直す前（main）も同じ架空データで撮る
- 今ある材料: `resident-master.mjs`（入居者マスタのケアマネ一覧・介護度別・架空の16名）・`care-schedule.mjs`（週間計画の A3 週間予定表・架空の1名）
- SUPrint を使わない画面の帳票は、材料の `sheets` に `prepare`（ページの中で紙を組む関数・真を返せば撮る）と `arg` を書く。`prepare` の無い材料の撮り方は変わらない（2026-11-02）

材料を足す時は、`.gitignore` の許可（`!/check/fixtures/*.mjs`）に入る名前で置き、氏名・居宅名・電話は実在しない見本の語にします（CLAUDE.md §2-1）。

## それぞれの道具

| 道具 | 出す言葉 | 何をするか |
|---|---|---|
| `snap.mjs` | （材料） | 全画面を PC・iPhone 100%・iPhone 200%・印刷で撮り、PDF のページ数と横はみ出しを `metrics.json` に残す。時計は固定。`fixtures/` に材料がある画面は帳票の紙も撮る |
| `fixtures/*.mjs` | — | 帳票の紙を撮るための架空データ（画面ごと） |
| `compare.mjs` | 画素一致／印刷Nページ一致 | base と head の PNG を1画素ずつ比べる（Chromium の canvas。画像ライブラリは使わない） |
| `jscheck.mjs` | JS構文 OK | .js と HTML 内 `<script>` の構文だけ読む（実行しない） |
| `name-guard.mjs` | 実名ガード exit 0 | 実名の一覧（リポジトリには置かない）が変更行に無いか確かめる |
| `run.mjs` | まとめ | 上を順に回して `summary.md` を書く |
| `ci-allow.mjs` | — | PR の自動チェックで「違ってよい画面」を決める |
| `annot-render.mjs` | — | 「画面の指摘」の Issue 本文から配置図（文字を塗りつぶした画面の形）を PNG にする（`--body issue.txt --out x.png`） |
| `serve.mjs` | — | 配布物を手元で開く |
| `export_e2e.mjs` | 全データの書き出しの通し試験 | 使える人の管理の「全データの書き出し」を、ログイン・データベース・GAS を偽物にして画面のボタンから回し、既定の暗号化（.suenc）を戻して架空のデータと突き合わせる・暗号化しない時の理由・画面で開く方も確かめる（外へは通信しない） |
| `import_e2e.mjs` | 全データの書き出しの戻す試験 | 手元に使い捨ての PostgreSQL を立てて care-backend の移行を流し（`--backend <care-backend のパス>`）、架空の事業者 A を書き出し→暗号化→復号→別の DB の事業者 B へ戻して、表ごとの件数を目録と比べる。DB は終わったら消す（外へは通信しない） |
| `menu_sync_stale_e2e.mjs` | メニューの写しが止まっている時の札の通し試験 | メニューを開き、ログインとデータベースを偽物にして、管理者＋古い成功で入居者マスタのタイルに札が出る・新しい成功／事務所や現場のアカウントでは出ない・現場端末ではログインの部品と写しの記録を読みに行かないことを確かめる（外へは通信しない） |
| `export-decrypt.mjs` | — | 暗号化した全データの書き出しを元の ZIP に戻す（`node check/export-decrypt.mjs <file.suenc> [-o 出力.zip]`。パスフレーズは端末で聞く・表示しない） |
| `fail-inject/observe.mjs` | 失敗を起こして数える | 偽の GAS（統合KV・入居者マスタ）と手元の試験用 Supabase への中継で、台本の回だけ時間切れ・断り・競合・応答なし・届かない・遅いを起こし、使い捨ての Chrome の2つの文脈で「失敗の表示・偽の保存しました・後から届いた・巻き戻り」を数える。HTTP の成否と ok:false は別に数える（下の「失敗を起こして数える」） |
| `fail-inject/serve.mjs`・`fail-inject/gas-script.mjs` | — | 上の配信サーバー（同じオリジンの /__fake-gas/・/__sb/）と台本のエンジン（純関数・応答の形は本物の .gs から写した行を注釈に残す）。試験は check/unit/fail_inject_*_test.js |

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

## 画面の指摘（管理者だけ）

管理者として（Google＋2段階認証）ログインしている端末では、「不具合を報告」の枠に **「画面の場所を指して報告」** が出ます。

1. 押すと画面の上に帯が出ます。直してほしい部品を押し、一言書いて「決める」（何か所でも。「外側を選ぶ」で一回り大きい枠にできます）
2. 「できた」を押すと報告の枠に戻り、指摘の一覧と配置図の絵が出ます（文字は塗りつぶし）。「そのまま送信」で送ります
3. 受け口が Issue（ラベル「画面の指摘」）を作り、数分後に GitHub Actions（`.github/workflows/report-image.yml`）が配置図の絵をコメントで付けます

指している間は画面全体に透明の板が敷かれるので、画面のボタンを押しても保存や通信は起きません。配置図は四角の位置・大きさ・色と文字の帯の長さだけで、
文字・入力の値・画像の中身は入りません。絵はブランチ `report-images` に置かれます（取り込まないブランチです）。

## 施設の差し替えの確かめ（check/facility-swap.mjs・2026-11-02〜）

facility-profile.json を差し替えるだけで全アプリ（20画面）が動くかを、開いて確かめます。手順は根の `施設の導入手順.md`。

```bash
node check/facility-swap.mjs                                          # 2つ目の架空の施設（fixtures/facility-profile.alt.mjs）で配って20画面を開く
node check/facility-swap.mjs --profile facility-profile.sample.json   # 見本で配る＝(a) が落ちることで守りが働くのを確かめる
node check/facility-swap.mjs --pages index.html,daycare-roster.html   # 画面を絞る
```

- 配る施設情報は手元の配信のメモリだけで差し替える（`lib.mjs` の `startServer(dir, port, { facilityProfile })`。ファイルは書かない）。外への通信は全部止め、使い捨てのプロファイルのヘッドレス Chrome で開く
- 1画面1行で (a)(b)(c) を出す。(a) 見本の法人名・施設名・事業所名・正式名・問い合わせ先・医療機関の名前が、見出し・本文（隠れた所も含む）・入力欄の値に0件
  (b) 画面のスクリプトの例外（pageerror）0件。snap.mjs と同じく pageerror を数え、加えて CSP で止められたスクリプトも数える。404（ws-master.json など）・止めた外への要求は pageerror ではないので数えず、「除いたもの」として行に書く
  (c) 施設情報を読む画面（su-facility.js を読み込む）は読んだ施設名が配った施設のもの、名前を出す画面（メニュー・デイ利用表）は配った施設の名前が見える文字に出ている（消耗品管理・入居調整は、隠れた部品の文字に配った施設の名前が入っている）。どちらでもない画面は「対象外」と理由を出す（画面の表は `facility-swap.mjs` の PAGES）
- 終了コード: 全部合格 0／1つでも不合格 1／Chrome を起動できない・画面を開けない等で確かめられない 2。詳しい結果は `check/out/facility-swap.json`
- 20画面を開くので約2分かかる。`check/unit/run-all.mjs` には入れていない（軽い確かめは `check/unit/facility_swap_test.js`：手順書と道具が公開の許可にある・2つ目の施設情報が見本と名前を共有しない・表に20画面がある）
- 画面のスクリプトを直して CSP の指紋を作り直していないと、(b) が「CSP で止まった」で落ちる（`node check/csp.mjs --write` の後に回す）

## 失敗を起こして数える（check/fail-inject/・2026-10-31〜）

画面のコードは変えず、通信の相手の側で失敗を起こして、画面が職員にどう見せたかを数えます。データは架空の見本だけです。

```bash
node check/fail-inject/observe.mjs --ls-keys check/fail-inject/ls-keys.sample.json            # GAS の道だけ（ワークスケジュール・入居者マスタ）
SU_FI_SB_KEY=<試験用の公開鍵> node check/fail-inject/observe.mjs --ls-keys check/fail-inject/ls-keys.sample.json \
  --sb http://127.0.0.1:55421 --sb-accounts <試験用アカウントのファイル>                         # 試験用 Supabase の道と RLS の断りも
```

- 台本は `{entry, nth, kind, times, ms}` の配列。entry は GAS の action（`put`・`saveResident` など）か `sb:rpc/kv_put` のような Supabase の入口。台本に無い要求は素通し。任意の `key`（正規表現・例 `"^wsday_"`）を書くと、キーが合う要求だけを数える
- 中継先は手元（127.0.0.1・localhost）だけ。su-auth.js と su-backend.json の差し替えは配る時のメモリの中だけ（ファイルは変えない）
- RLS の断りは、既存のポリシーで断られる組み合わせ（現場アカウント×kv_put）で起こす。ポリシーの SQL は流さない
- 接続先の localStorage の鍵は画面ごとに `--ls-keys` で渡す（推測しない）。結果は `check/out/fail-inject/<日時>.json`
- 単独で配信サーバーだけ立てる時は `node check/fail-inject/serve.mjs --script 台本.json`（URL を1行出して待つ・止めると記録を書く）
  - nth は起動してからの通し番号なので、画面の読み込みの時の自動の保存（ワークスケジュールは開くだけで put が2〜4回走る）も数える。
    保存の操作に当てる時は、画面を開いて「✓ 同期済み」になってから `curl -X POST --data '[{"entry":"put","nth":1,"kind":"deny"}]' <URL>/__fail-inject/script` で台本を入れ直す（回数が0に戻る）→ 保存の操作 → `curl <URL>/__fail-inject/report` で fired と times を見る
  - 公開リポジトリに無い ws-master.json は `{}` で返す（画面は「無い」時と同じ分岐に落ちる。読み込みのたびの 404 のエラーを出さない）
- 本物の .gs と写した行の照合は、`SU_GAS_SRC`（統合KV の Code.gs）・`SU_GAS_SRC_MASTER`（入居者マスタの master.gs）を渡した時だけ試験が行う
