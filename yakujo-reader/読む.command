#!/bin/bash
# 薬情よみとり：事務所の Mac の中だけで、薬情・お薬手帳・調剤明細書の写真と PDF の文字を読む（ダブルクリックで動く）
# 置き場（初回に自動で作る）
#   ~/薬情よみとり/入れる … ここに写真・PDF を置く（読み終えた書類は、結果を書けた後に Mac のごみ箱へ移す・2026-10-23）
#   ~/薬情よみとり/結果   … 読んだ結果のファイルができる（24時間たつと、次に動かした時に消える）
#   ~/薬情よみとり/読む.command … この起動用ファイルへの近道（次からはここをダブルクリック）
set -u

# 近道から開かれても、本物の置き場（リポジトリの yakujo-reader/）を見つける
SELF="$0"
while [ -L "$SELF" ]; do
  L="$(readlink "$SELF")"
  case "$L" in /*) SELF="$L" ;; *) SELF="$(dirname "$SELF")/$L" ;; esac
done
HERE="$(cd "$(dirname "$SELF")" && pwd -P)"
SRC="$HERE/yakujo-reader.swift"

BASE="$HOME/薬情よみとり"
IN="$BASE/入れる"
OUT="$BASE/結果"
BIN_DIR="$BASE/.道具"
BIN="$BIN_DIR/yakujo-reader"

finish() { echo ""; read -r -p "Enterキーで閉じます..." _; exit "${1:-0}"; }

mkdir -p "$IN" "$OUT" "$BIN_DIR" || { echo "フォルダを作れませんでした。"; finish 1; }
chmod 700 "$BASE" "$OUT" "$BIN_DIR" 2>/dev/null

# 「薬情よみとり」フォルダを Time Machine の写しから外す（結果のファイル・写真が何か月も写しに残らないように）。
# 管理者の権限は要らない。外せなかった時は知らせるだけで、読み取りは続ける
if command -v tmutil >/dev/null 2>&1 && ! tmutil isexcluded "$BASE" 2>/dev/null | grep -q '\[Excluded\]'; then
  if tmutil addexclusion "$BASE" >/dev/null 2>&1; then echo "「薬情よみとり」フォルダを Time Machine の写しから外しました。"
  else echo "「薬情よみとり」フォルダを Time Machine の写しから外せませんでした（読み取りは続けます）。"; fi
fi

# 近道を作る。無い・行き先が消えた・別の置き場を指している時は、この置き場へ張り直す（ふつうのファイルなら触らない）
LINK="$BASE/読む.command"
if [ -L "$LINK" ]; then
  [ "$(readlink "$LINK")" = "$HERE/読む.command" ] || ln -sfn "$HERE/読む.command" "$LINK" 2>/dev/null
elif [ ! -e "$LINK" ]; then
  ln -s "$HERE/読む.command" "$LINK" 2>/dev/null
fi

# 24時間を過ぎた結果のファイルを消す（本人の決定 2026-10-22）
OLD=$(find "$OUT" -maxdepth 1 -type f -name '薬情よみとり_*.json' -mmin +1440 2>/dev/null | wc -l | tr -d ' ')
find "$OUT" -maxdepth 1 -type f -name '薬情よみとり_*.json' -mmin +1440 -delete 2>/dev/null
find "$OUT" -maxdepth 1 -type f -name '.薬情よみとり_*.json.tmp' -mmin +60 -delete 2>/dev/null
[ "$OLD" != "0" ] && echo "24時間を過ぎた結果のファイルを ${OLD} 件消しました。"

# 道具を用意する（初回と、道具が新しくなった時だけ作り直す）
if [ ! -f "$SRC" ]; then
  echo "道具の本体（yakujo-reader.swift）が見つかりません。"
  finish 1
fi
if [ ! -x "$BIN" ] || [ "$SRC" -nt "$BIN" ]; then
  # /usr/bin/swiftc は部品が無くても置かれている中継なので、本物があるかを xcrun で確かめる
  if ! xcode-select -p >/dev/null 2>&1 || ! xcrun --find swiftc >/dev/null 2>&1; then
    echo "道具を作るための Apple の部品（コマンドラインツール）がありません。"
    echo "ターミナルで xcode-select --install を実行してから、もう一度ダブルクリックしてください。"
    finish 1
  fi
  echo "道具を準備しています（初回と、道具が新しくなった時だけ・1分ほど）…"
  if ! xcrun swiftc -O "$SRC" -o "$BIN.new" 2>"$BIN_DIR/準備のエラー.txt"; then
    rm -f "$BIN.new"
    echo "道具を準備できませんでした。"
    echo "Xcode の利用許諾がまだの時は、ターミナルで「sudo xcodebuild -license」を実行してから、もう一度ダブルクリックしてください。"
    echo "（くわしい理由: 「薬情よみとり/.道具/準備のエラー.txt」）"
    finish 1
  fi
  rm -f "$BIN_DIR/準備のエラー.txt"
  mv -f "$BIN.new" "$BIN"
fi

# 入れるフォルダに書類があるか
N=$(find "$IN" -maxdepth 1 -type f ! -name '.*' 2>/dev/null | wc -l | tr -d ' ')
if [ "$N" = "0" ]; then
  echo "「入れる」フォルダに書類がありません。"
  echo "薬情・お薬手帳・調剤明細書の写真か PDF を入れてから、もう一度ダブルクリックしてください。"
  open "$IN"
  finish 0
fi

STAMP="$(date +%Y%m%d-%H%M%S)"
RES="$OUT/薬情よみとり_${STAMP}.json"
echo "読んでいます（${N} 件）。この Mac の中だけで読み、外へは送りません…"
if ! "$BIN" "$IN" "$RES"; then
  echo "読み取りが途中で止まりました。結果のファイルは作っていません。"
  finish 1
fi

echo ""
echo "できました。結果のファイル：薬情よみとり_${STAMP}.json（「結果」フォルダ）"
echo "・入居者マスタの「📥 薬情の取り込み」から、このファイルを開いてください。"
echo "・読み終えた書類は、Mac のごみ箱へ移ります（件数は上に出ています・ごみ箱から取り出せます）。"
echo "  「入れる」に残るのは、読めない所があった書類・文字が見つからなかった書類・読まなかった書類（上の※）です。"
echo "・結果のファイルは、24時間たつと、次にこの道具を動かした時に消えます。"
open "$OUT"
finish 0
