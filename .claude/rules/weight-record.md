---
paths:
  - "weight-record.html"
  - "su-weight-*"
  - "check/unit/weight_*"
  - "check/unit/xss_weight_record_test.js"
  - "check/weight_*"
  - "check/fixtures/weight-record.mjs"
  - "check/fail-inject/fixtures/weight-record.mjs"
---
# 体重管理 の決まり（CLAUDE.md §3 から移した・文は一字一句そのまま）

このファイルは、上の paths のファイルを Read・Edit・Write した時に読まれる。grep・sed だけで触る時は、触る前にこのファイルを読む。全画面に効く決まり（§1・§2・§4〜§10 と §3 の横断の項目）は CLAUDE.md にある。

（CLAUDE.md §3「部品・画面ごとの決まり（2026-10 の開発の記録から集めたもの・2026-10-26 にここへ移した）」の中にあった項目）
  - 体重管理の保存先は、スイッチ weight とデータベースの印（統合 0032 の weight_mode）で決める。印が写しの期間の間は Google、切り替えた後は Supabase へ書き、Google へは端末が順番どおりに写し返す（写し返しが残る間は Google へ直接読み書きしない）。ログインしていない端末では、スイッチが入なら読み書きを失敗にして端末に残す（Google へ流さない）。
  - 体重管理は、ログインしていない端末にだけ、見出しのすぐ下に「この端末はログインしていません。…」の帯を出す（画面だけ・印刷しない・ログインすると消える）。ログインの控えがある端末では、確かめて「ログインしていない」「使えないアカウント」と分かった時だけ出し、通信の失敗で確かめられない時は消す。戻るボタンで戻った時も確かめ直す（本人指示 2026-10-28）。
