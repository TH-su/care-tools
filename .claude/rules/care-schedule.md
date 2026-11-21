---
paths:
  - "care-schedule.html"
  - "check/unit/care_schedule_*"
  - "check/care_schedule_*"
  - "check/unit/care_a3_sheet_test.js"
  - "check/unit/care_edited_by_test.js"
  - "check/unit/care_field_merge_test.js"
  - "check/unit/care_namecut_test.js"
  - "check/fixtures/care-schedule.mjs"
---
# 週間計画 の決まり（CLAUDE.md §3 から移した・文は一字一句そのまま）

このファイルは、上の paths のファイルを Read・Edit・Write した時に読まれる。grep・sed だけで触る時は、触る前にこのファイルを読む。全画面に効く決まり（§1・§2・§4〜§10 と §3 の横断の項目）は CLAUDE.md にある。

（CLAUDE.md §3「部品・画面ごとの決まり（2026-10 の開発の記録から集めたもの・2026-10-26 にここへ移した）」の中にあった項目）
  - 週間計画は、裏に隠れている画面を描き直さず、見えた時に1回だけ描く。
  - 週間計画の介護度は入居者マスタを正にする（居室と同じ）。入居者マスタとつながっている方（masterId のある方）は、マスタの介護度が入っていればいつも週間計画をそれにそろえ、週間計画の中（介護情報の窓・一括編集）では介護度を直せないようにして「介護度は入居者マスタで直してください」と出す（代表者の決定 2026-11-02「マスタを正にする」）。
