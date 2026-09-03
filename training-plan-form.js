/* training-plan-form.js — 個別機能訓練計画書（別紙様式３－３・R3施設改変版）の印刷様式ジェネレータ
   ─────────────────────────────────────────────────────────────────────
   役割（L0計画 §1-1・§3-8・D14）
     ・Excel 原本の構造（62列×66行・行高pt・セル結合・罫線・フォントpt）を table で機械再現する
     ・A4縦1枚に必ず収める（層A〜D。transform:scale は使わない）
     ・{{field}} は plan の同名フィールドで置換する（様式の固定文言は原本のまま）
   公開API
     TP_FORM.buildSheet(plan, opts) -> HTMLElement（div.sheet.tp-sheet）
     TP_FORM.fitSheet(el, opts)     -> {scale, shrunkFields, minFontPx, ...}
     TP_FORM.toWareki(iso) / warekiEra(iso) / PAGE_CSS / TEMPLATE / VERSION
   前提・注意
     ・fitSheet は「表示されている要素」でしか測れない（非表示だと offsetHeight=0 で
       “収まった”と誤判定する。facesheet.html fitBdaySheet の教訓）。非表示なら measured:false で戻る
     ・文字幅はフォント読込後でないと確定しない。呼び出し側は document.fonts.ready の後に fitSheet する
     ・@page（層A）は呼び出し側が印刷直前に注入・終了後に外す（既存ツールの作法）。TP_FORM.PAGE_CSS を使う
     ・個人情報は一切ログに出さない（console 呼び出しをこのファイルに置かない）
     ・DOM は createElement / textContent のみで組む（innerHTML への文字列代入なし）
   ────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var VERSION = '2026-09-02.1';

  /* ── 用紙・寸法 ───────────────────────────────────────────────── */
  var MM_PER_PT = 25.4 / 72;          /* 1pt = 0.3528mm */
  var PX_PER_PT = 96 / 72;            /* 1pt = 1.3333px（CSS 96dpi） */
  var PAGE_W_MM = 194;                /* A4縦 210mm − 余白8mm×2 */
  var PAGE_H_MM = 281;                /* A4縦 297mm − 余白8mm×2 */
  var SAFE = 0.99;                    /* 層D: 印字可能寸法の99%を超えたら zoom */
  var SHEET_W_PT = 620;               /* 原本の総幅（62列×10pt） */
  var BORDER_PX = 1;                  /* 細罫線（thin）の描画幅 */
  var MIN_FONT_PX = 5;                /* 層C の下限 */
  var STEP_PX = 0.25;                 /* 層C の縮小刻み */
  var OVF_TOL = 0.5;                  /* はみ出し判定の許容（scrollHeight・clientHeight は整数に丸められる） */
  var SIGN_ROW_PT = 14;               /* D14 署名行の行高（原本の最終行 5.25pt を置き換える） */

  var FONT_STACK = '"ＭＳ 明朝","MS Mincho","Hiragino Mincho ProN","Yu Mincho","YuMincho",serif';
  var PAGE_CSS = '@page{size:A4 portrait;margin:8mm}';

  /* 非折返しの単セル見出し。Excel と同じく右へはみ出させる（colspan 拡張は右罫線を落とすため使わない） */
  var OVERFLOW_CELLS = {
    A11: 1, O11: 1, A19: 1, A27: 1, A30: 1, A31: 1, A38: 1, A58: 1, AF59: 1
  };

  /* 目標達成度の欄（A32／AF32）。行の高さは 13.5pt（1行ぶん）しか無いので、
     見出しは常に1行で出し、達成度は見出しの中の該当語を○で囲って表す（値の行を作らない）。
     原本の Excel も同じ 1行ぶんの行高に3行の文字列を入れていて、2行目以降は表示していない。
     この2セルは層Cの縮小対象から外す（.tp-nofit＝見出しを縮めない）。
     見出しは全角32文字で、原本の 11pt では欄幅の 1.14倍になり1行に入らない（実測 402px / 欄 352.6px）。
     1行に収まる最大の整数ptが 9pt（実測 329px・欄の92.5%）なので、この2セルだけ pt を 9 にしている。
     囲む語は「（達成・一部・未達）」の中だけを見る（『目標達成度』の『達成』を囲わないため） */
  var ACHIEVE_CELLS = { A32: 'shortAchievement', AF32: 'longAchievement' };
  var ACHIEVE_GROUP = '（達成・一部・未達）';
  var ACHIEVEMENTS = ['達成', '一部', '未達'];

  /* ○囲みを付けるセル（該当文字だけを ::after の楕円で囲う） */
  var CIRCLE_CELLS = { A8: 'bedridden', AF8: 'dementia', V6: 'birthEra' };

  /* 自立度の正規化コード（これ以外は○を付けない＝勝手に解釈しない） */
  var BEDRIDDEN = ['自立', 'J1', 'J2', 'A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
  var DEMENTIA = ['自立', 'Ⅰ', 'Ⅱa', 'Ⅱb', 'Ⅲa', 'Ⅲb', 'Ⅳ', 'M'];

  /* ── 様式テンプレート（form_template.json から機械生成して埋め込み。手打ち転記はしない） ── */
  var TEMPLATE = {
    sheet: "R7.2", nrows: 66, ncols: 62,
    row_pt: [13.5, 4.5, 15, 4.5, 19.5, 19.5, 15, 14, 4.5, 3.75, 13.5, 13.5, 14, 25.25, 13.5, 14, 18, 6, 14, 17.25, 16.5, 16.5, 16.5, 16.5, 14, 21, 11.25, 6, 3, 13.5, 13.5, 13.5, 30, 30, 30, 21, 5.25, 13.5, 13.5, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 11.25, 15, 5.25, 14, 8.25, 19.5, 5.25, 13.5, 13.5, 14, 38.5, 24, 5.25, 13.5, 14, 5.25],
    cells: [
      {a1:"A1", r:0, c:0, rs:1, cs:10, v:"別紙様式３－３", pt:12, bold:false, h:1, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A3", r:2, c:0, rs:1, cs:62, v:"【個別機能訓練計画書】", pt:12, bold:true, h:2, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A5", r:4, c:0, rs:1, cs:21, v:"作成日：{{createdDateWareki}}", field:"createdDate", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"V5", r:4, c:21, rs:1, cs:21, v:"前回作成日：{{prevDateWareki}}", field:"prevDate", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AQ5", r:4, c:42, rs:1, cs:20, v:"初回作成日：{{firstDateWareki}}", field:"firstDate", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A6", r:5, c:0, rs:2, cs:17, v:"ふりがな  {{kana}}\n氏名 {{name}}", field:"nameKana", pt:10, bold:false, h:1, vert:1, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"R6", r:5, c:17, rs:1, cs:4, v:"性別", pt:10, bold:false, h:2, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"V6", r:5, c:21, rs:1, cs:16, v:"大正　　/　　昭和", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"AL6", r:5, c:37, rs:2, cs:5, v:"要介護度\n{{careLevel}}", field:"careLevel", pt:9, bold:false, h:2, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AQ6", r:5, c:42, rs:1, cs:20, v:"計画作成者：{{planner}}", field:"planner", pt:10, bold:false, h:1, vert:1, wrap:false, indent:1, bL:1, bR:1, bT:1, bB:0},
      {a1:"R7", r:6, c:17, rs:1, cs:4, v:"{{gender}}", field:"gender", pt:11, bold:false, h:2, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"V7", r:6, c:21, rs:1, cs:16, v:"{{birthWarekiYMD}}生", field:"birth", pt:8, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"AQ7", r:6, c:42, rs:1, cs:20, v:"職種：{{plannerJob}}", field:"plannerJob", pt:10, bold:false, h:1, vert:1, wrap:false, indent:1, bL:1, bR:1, bT:0, bB:0},
      {a1:"A8", r:7, c:0, rs:1, cs:31, v:"障害高齢者の日常生活自立度: 自立 J1 J2 A1 A2 B1 B2 C1 C2", pt:9, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AF8", r:7, c:31, rs:1, cs:31, v:"認知症高齢者の日常生活自立度: 自立  Ⅰ Ⅱa  Ⅱb  Ⅲa  Ⅲb  Ⅳ M", pt:8, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A9", r:8, c:0, rs:1, cs:1, v:"", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"A11", r:10, c:0, rs:1, cs:1, v:"Ⅰ　利用者の基本情報", pt:10, bold:true, h:0, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"O11", r:10, c:14, rs:1, cs:1, v:"※別紙様式３－１・別紙様式３－２を別途活用すること。", pt:9, bold:false, h:1, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A12", r:11, c:0, rs:1, cs:31, v:"利用者本人の希望", pt:10, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:0, bT:1, bB:0},
      {a1:"AF12", r:11, c:31, rs:1, cs:31, v:"家族の希望", pt:10, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"A13", r:12, c:0, rs:2, cs:31, v:"{{hopeSelf}}", field:"hopeSelf", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"AF13", r:12, c:31, rs:2, cs:31, v:"{{hopeFamily}}", field:"hopeFamily", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"A15", r:14, c:0, rs:1, cs:31, v:"利用者本人の社会参加の状況", pt:10, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"AF15", r:14, c:31, rs:1, cs:31, v:"利用者の居宅の環境（環境因子）", pt:10, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"A16", r:15, c:0, rs:2, cs:31, v:"{{socialParticipation}}", field:"socialParticipation", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"AF16", r:15, c:31, rs:2, cs:31, v:"{{homeEnvironment}}", field:"homeEnvironment", pt:10, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"A19", r:18, c:0, rs:1, cs:1, v:"健康状態・経過", pt:10, bold:false, h:0, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A20", r:19, c:0, rs:1, cs:62, v:"病名：{{diagnosis}} 発症日・受傷日：{{onsetDate}} 直近の入院日：{{lastHospitalization}}\n\n", field:"health", pt:10, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A21", r:20, c:0, rs:2, cs:62, v:"治療経過（手術がある場合は手術日・術式等）\n{{treatmentCourse}}", field:"treatmentCourse", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A23", r:22, c:0, rs:2, cs:62, v:"疾患・コントロール状態\n{{diseaseControl}}", field:"diseaseControl", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A25", r:24, c:0, rs:2, cs:62, v:"機能訓練実施上の留意事項（開始前・訓練中の留意事項、運動強度・負荷量等）\n{{precautions}}", field:"precautions", pt:11, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A27", r:26, c:0, rs:1, cs:1, v:"※①～⑤に加えて、介護支援専門員から、居宅サービス計画上の利用者本人等の意向、総合的な支援方針等について確認すること。", pt:8, bold:false, h:1, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A30", r:29, c:0, rs:1, cs:1, v:"Ⅱ　個別機能訓練の目標・個別機能訓練項目の設定", pt:10, bold:true, h:0, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A31", r:30, c:0, rs:1, cs:1, v:"個別機能訓練の目標", pt:10, bold:false, h:0, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"AA31", r:30, c:26, rs:1, cs:1, v:"", pt:8, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:1},
      {a1:"A32", r:31, c:0, rs:1, cs:31, v:"機能訓練の短期目標（今後３ヶ月）　目標達成度（達成・一部・未達）", field:"shortAchievement", pt:9, bold:false, h:2, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"AF32", r:31, c:31, rs:1, cs:31, v:"機能訓練の長期目標　　　　　　　　目標達成度（達成・一部・未達）", field:"longAchievement", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"A33", r:32, c:0, rs:1, cs:31, v:"{{shortGoalFunction}}", field:"shortGoalFunction", pt:9, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:0},
      {a1:"AF33", r:32, c:31, rs:1, cs:31, v:"{{longGoalFunction}}", field:"longGoalFunction", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:0},
      {a1:"A34", r:33, c:0, rs:1, cs:31, v:"{{shortGoalActivity}}", field:"shortGoalActivity", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:0},
      {a1:"AF34", r:33, c:31, rs:1, cs:31, v:"{{longGoalActivity}}", field:"longGoalActivity", pt:9, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:0},
      {a1:"A35", r:34, c:0, rs:1, cs:31, v:"{{shortGoalParticipation}}", field:"shortGoalParticipation", pt:9, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"AF35", r:34, c:31, rs:1, cs:31, v:"{{longGoalParticipation}}", field:"longGoalParticipation", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:0, bR:1, bT:0, bB:1},
      {a1:"A36", r:35, c:0, rs:1, cs:62, v:"※目標設定方法の詳細や生活機能の構成要素の考え方は、通知本体を参照のこと。　※目標達成の目安となる期間についてもあわせて記載すること。\n※短期目標（長期目標を達成するために必要な行為）は、個別機能訓練計画書の訓練実施期間内に達成を目指す項目のみを記載することとして差し支えない。", pt:6, bold:false, h:1, vert:0, wrap:true, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"A38", r:37, c:0, rs:1, cs:1, v:"個別機能訓練項目", pt:10, bold:false, h:1, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"A39", r:38, c:0, rs:1, cs:31, v:"プログラム内容(何を目的に(～のために)～する)", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AF39", r:38, c:31, rs:1, cs:13, v:"留意点", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AS39", r:38, c:44, rs:1, cs:6, v:"頻度", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AY39", r:38, c:50, rs:1, cs:6, v:"時間", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"BE39", r:38, c:56, rs:1, cs:6, v:"主な実施者", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A40", r:39, c:0, rs:3, cs:2, v:"①", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"C40", r:39, c:2, rs:3, cs:29, v:"{{programs[0].content}}", field:"programs[0].content", pt:10, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AF40", r:39, c:31, rs:3, cs:13, v:"{{programs[0].caution}}", field:"programs[0].caution", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AS40", r:39, c:44, rs:3, cs:6, v:"{{programs[0].frequency}}", field:"programs[0].frequency", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AY40", r:39, c:50, rs:3, cs:6, v:"{{programs[0].duration}}", field:"programs[0].duration", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"BE40", r:39, c:56, rs:3, cs:6, v:"{{programs[0].staff}}", field:"programs[0].staff", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A43", r:42, c:0, rs:3, cs:2, v:"②", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"C43", r:42, c:2, rs:3, cs:29, v:"{{programs[1].content}}", field:"programs[1].content", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AF43", r:42, c:31, rs:3, cs:13, v:"{{programs[1].caution}}", field:"programs[1].caution", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AS43", r:42, c:44, rs:3, cs:6, v:"{{programs[1].frequency}}", field:"programs[1].frequency", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AY43", r:42, c:50, rs:3, cs:6, v:"{{programs[1].duration}}", field:"programs[1].duration", pt:10, bold:false, h:3, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"BE43", r:42, c:56, rs:3, cs:6, v:"{{programs[1].staff}}", field:"programs[1].staff", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A46", r:45, c:0, rs:3, cs:2, v:"③", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"C46", r:45, c:2, rs:3, cs:29, v:"{{programs[2].content}}", field:"programs[2].content", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AF46", r:45, c:31, rs:3, cs:13, v:"{{programs[2].caution}}", field:"programs[2].caution", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AS46", r:45, c:44, rs:3, cs:6, v:"{{programs[2].frequency}}", field:"programs[2].frequency", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AY46", r:45, c:50, rs:3, cs:6, v:"{{programs[2].duration}}", field:"programs[2].duration", pt:10, bold:false, h:3, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"BE46", r:45, c:56, rs:3, cs:6, v:"{{programs[2].staff}}", field:"programs[2].staff", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A49", r:48, c:0, rs:3, cs:2, v:"④", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"C49", r:48, c:2, rs:3, cs:29, v:"{{programs[3].content}}", field:"programs[3].content", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AF49", r:48, c:31, rs:3, cs:13, v:"{{programs[3].caution}}", field:"programs[3].caution", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AS49", r:48, c:44, rs:3, cs:6, v:"{{programs[3].frequency}}", field:"programs[3].frequency", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AY49", r:48, c:50, rs:3, cs:6, v:"{{programs[3].duration}}", field:"programs[3].duration", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"BE49", r:48, c:56, rs:3, cs:6, v:"{{programs[3].staff}}", field:"programs[3].staff", pt:10, bold:false, h:2, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A52", r:51, c:0, rs:1, cs:44, v:"※短期目標で設定した目標を達成するために必要な行為に対応するよう、訓練項目を具体的に設定すること。", pt:6, bold:false, h:1, vert:1, wrap:false, indent:0, bL:0, bR:1, bT:1, bB:0},
      {a1:"AS52", r:51, c:44, rs:1, cs:18, v:"プログラム立案者：{{programPlanner}}", field:"programPlanner", pt:10, bold:false, h:1, vert:1, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"A54", r:53, c:0, rs:1, cs:31, v:"利用者本人・家族等がサービス利用時間以外に実施すること", pt:8, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"AF54", r:53, c:31, rs:1, cs:31, v:"特記事項", pt:9, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"A55", r:54, c:0, rs:2, cs:31, v:"{{homeExercise}}", field:"homeExercise", pt:9, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"AF55", r:54, c:31, rs:2, cs:31, v:"{{remarks}}", field:"remarks", pt:9, bold:false, h:2, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"A58", r:57, c:0, rs:1, cs:1, v:"Ⅲ　個別機能訓練実施後の対応", pt:10, bold:true, h:0, vert:1, wrap:false, indent:0, bL:0, bR:0, bT:0, bB:0},
      {a1:"AL58", r:57, c:37, rs:1, cs:25, v:"", pt:10, bold:false, h:3, vert:1, wrap:false, indent:1, bL:0, bR:0, bT:0, bB:1},
      {a1:"A59", r:58, c:0, rs:1, cs:31, v:"個別機能訓練の実施による変化", pt:10, bold:false, h:1, vert:0, wrap:false, indent:0, bL:1, bR:1, bT:1, bB:0},
      {a1:"AF59", r:58, c:31, rs:1, cs:1, v:"個別機能訓練実施における課題とその要因", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:1, bR:0, bT:1, bB:0},
      {a1:"AG59", r:58, c:32, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AH59", r:58, c:33, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AI59", r:58, c:34, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AJ59", r:58, c:35, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AK59", r:58, c:36, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AL59", r:58, c:37, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AM59", r:58, c:38, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AN59", r:58, c:39, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AO59", r:58, c:40, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AP59", r:58, c:41, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AQ59", r:58, c:42, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AR59", r:58, c:43, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AS59", r:58, c:44, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AT59", r:58, c:45, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AU59", r:58, c:46, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AV59", r:58, c:47, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AW59", r:58, c:48, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AX59", r:58, c:49, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AY59", r:58, c:50, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"AZ59", r:58, c:51, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BA59", r:58, c:52, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BB59", r:58, c:53, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BC59", r:58, c:54, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BD59", r:58, c:55, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BE59", r:58, c:56, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BF59", r:58, c:57, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BG59", r:58, c:58, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BH59", r:58, c:59, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BI59", r:58, c:60, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"BJ59", r:58, c:61, rs:1, cs:1, v:"", pt:10, bold:false, h:0, vert:0, wrap:false, indent:0, bL:0, bR:1, bT:1, bB:0},
      {a1:"A60", r:59, c:0, rs:2, cs:31, v:"{{changes}}", field:"changes", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"AF60", r:59, c:31, rs:2, cs:31, v:"{{issues}}", field:"issues", pt:9, bold:false, h:1, vert:0, wrap:true, indent:0, bL:1, bR:1, bT:0, bB:1},
      {a1:"A62", r:61, c:0, rs:1, cs:62, v:"※個別機能訓練の実施結果等をふまえ、個別機能訓練の目標の見直しや訓練項目の変更等を行った場合は、個別機能訓練計画書の再作成又は更新等を行い、個別機能訓練の目標・訓練項目等に係る最新の情報が把握できるようにすること。初回作成時にはⅢについては記載不要である。", pt:8, bold:false, h:1, vert:0, wrap:true, indent:0, bL:0, bR:0, bT:1, bB:0},
      {a1:"A64", r:63, c:0, rs:2, cs:32, v:"デイサービスセンター　せせらぎ　事業所No.4370112437\n熊本市東区八反田3-23-13　電話096-285-4020　", pt:10, bold:false, h:2, vert:1, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1},
      {a1:"AG64", r:63, c:32, rs:2, cs:30, v:"　　　説明日：　{{explainedDateWareki}}　\n　　　説明者：　{{explainer}}", field:"explained", pt:10, bold:false, h:1, vert:1, wrap:true, indent:0, bL:1, bR:1, bT:1, bB:1}
    ]
  };

  /* ── {{field}} の対応表 ────────────────────────────────────────── */
  var PH_TEXT = {
    kana: 'basic.kana', name: 'basic.name', gender: 'basic.gender', careLevel: 'basic.careLevel',
    planner: 'planner', plannerJob: 'plannerJob', programPlanner: 'programPlanner',
    hopeSelf: 'hopeSelf', hopeFamily: 'hopeFamily',
    socialParticipation: 'socialParticipation', homeEnvironment: 'homeEnvironment',
    diagnosis: 'health.diagnosis',
    treatmentCourse: 'treatmentCourse', diseaseControl: 'diseaseControl', precautions: 'precautions',
    shortAchievement: 'shortAchievement', longAchievement: 'longAchievement',
    shortGoalFunction: 'shortGoalFunction', shortGoalActivity: 'shortGoalActivity',
    shortGoalParticipation: 'shortGoalParticipation',
    longGoalFunction: 'longGoalFunction', longGoalActivity: 'longGoalActivity',
    longGoalParticipation: 'longGoalParticipation',
    homeExercise: 'homeExercise', remarks: 'remarks', changes: 'changes', issues: 'issues',
    explainer: 'explained.explainer'
  };
  var PH_WAREKI = {                    /* 和暦（年月日）に変換して出す欄 */
    createdDateWareki: 'planDate', prevDateWareki: 'prevPlanDate',
    firstDateWareki: 'firstPlanDate', explainedDateWareki: 'explained.date'
  };
  var PH_DATEISH = {                   /* 日付形式なら和暦・それ以外は入力どおり出す欄 */
    onsetDate: 'health.onsetDate', lastHospitalization: 'health.lastHospitalization'
  };
  var PROG_KEYS = { content: 1, caution: 1, frequency: 1, duration: 1, staff: 1 };

  /* ── 和暦 ─────────────────────────────────────────────────────── */
  var ERAS = [
    { name: '令和', from: '2019-05-01', y0: 2019 },
    { name: '平成', from: '1989-01-08', y0: 1989 },
    { name: '昭和', from: '1926-12-25', y0: 1926 },
    { name: '大正', from: '1912-07-30', y0: 1912 },
    { name: '明治', from: '1868-10-23', y0: 1868 }
  ];

  function parseIso(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso == null ? '' : iso).trim());
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    var dt = new Date(y, mo - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
    return { y: y, m: mo, d: d, iso: m[0] };
  }

  /* 'YYYY-MM-DD' → '令和8年9月2日' / '昭和9年2月15日'。元年は「元年」。不正値は '' */
  function toWareki(iso) {
    var p = parseIso(iso);
    if (!p) return '';
    for (var i = 0; i < ERAS.length; i++) {
      if (p.iso >= ERAS[i].from) {
        var n = p.y - ERAS[i].y0 + 1;
        return ERAS[i].name + (n === 1 ? '元' : n) + '年' + p.m + '月' + p.d + '日';
      }
    }
    return p.y + '年' + p.m + '月' + p.d + '日';   /* 明治より前は西暦のまま（情報を落とさない） */
  }

  /* 'YYYY-MM-DD' → '昭和' 等。範囲外・不正値は '' */
  function warekiEra(iso) {
    var p = parseIso(iso);
    if (!p) return '';
    for (var i = 0; i < ERAS.length; i++) if (p.iso >= ERAS[i].from) return ERAS[i].name;
    return '';
  }

  /* ── 値の取り出し ─────────────────────────────────────────────── */
  function pick(obj, path) {
    if (!obj || !path) return '';
    var parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.');
    var cur = obj;
    for (var i = 0; i < parts.length; i++) {
      if (cur == null) return '';
      cur = cur[parts[i]];
    }
    return (cur == null) ? '' : String(cur);
  }

  function resolvePh(name, plan) {
    if (PH_TEXT[name]) return pick(plan, PH_TEXT[name]);
    if (PH_WAREKI[name]) return toWareki(pick(plan, PH_WAREKI[name]));
    if (PH_DATEISH[name]) {
      var raw = pick(plan, PH_DATEISH[name]);
      return parseIso(raw) ? toWareki(raw) : raw;
    }
    if (name === 'birthWarekiYMD') return toWareki(pick(plan, 'basic.birthDate'));
    var m = /^programs\[(\d+)\]\.([A-Za-z]+)$/.exec(name);
    if (m && PROG_KEYS[m[2]]) return pick(plan, 'programs.' + m[1] + '.' + m[2]);
    return '';                                    /* 未知のプレースホルダは空にする（生の {{...}} を紙に出さない） */
  }

  function fillTemplate(v, plan) {
    var s = String(v == null ? '' : v);
    if (s.indexOf('{{') < 0) return s;
    return s.replace(/\{\{([A-Za-z0-9_.\[\]]+)\}\}/g, function (all, name) {
      return resolvePh(name, plan);
    });
  }

  /* 置換後に残った末尾の改行を落とす（原本には空欄前提の余り改行がある） */
  function stripTailNewlines(s) { return String(s).replace(/[\r\n]+[ \t　]*$/, ''); }

  /* ── 表示ヘルパ ───────────────────────────────────────────────── */
  function alignOf(h) { return (h === 2 || h === 6) ? 'center' : (h === 3 ? 'right' : (h === 7 ? 'justify' : 'left')); }
  function justifyOf(vert) { return vert === 1 ? 'center' : (vert === 2 ? 'flex-end' : 'flex-start'); }
  function r2(n) { return Math.round(n * 100) / 100; }

  /* 半角スペース・全角スペースで区切って「完全一致するトークン」だけを○で囲う。
     （部分一致にすると『日常生活自立度』の中の『自立』を囲ってしまう） */
  function circleFragment(doc, text, target) {
    var frag = doc.createDocumentFragment();
    if (!target) { frag.appendChild(doc.createTextNode(text)); return frag; }
    var parts = String(text).split(/(\s+)/);
    var done = false;
    for (var i = 0; i < parts.length; i++) {
      if (!done && parts[i] === target) {
        var sp = doc.createElement('span');
        sp.className = 'tp-circ';
        sp.textContent = parts[i];
        frag.appendChild(sp);
        done = true;
      } else if (parts[i] !== '') {
        frag.appendChild(doc.createTextNode(parts[i]));
      }
    }
    return frag;
  }

  function circleTargetOf(kind, plan) {
    var v, i;
    if (kind === 'bedridden') {
      v = String(pick(plan, 'basic.bedriddenRank')).trim();
      for (i = 0; i < BEDRIDDEN.length; i++) if (BEDRIDDEN[i] === v) return v;
      return '';
    }
    if (kind === 'dementia') {
      v = String(pick(plan, 'basic.dementiaRank')).trim();
      for (i = 0; i < DEMENTIA.length; i++) if (DEMENTIA[i] === v) return v;
      return '';
    }
    if (kind === 'birthEra') {
      var era = warekiEra(pick(plan, 'basic.birthDate'));
      return (era === '大正' || era === '昭和') ? era : '';   /* 様式にあるのは大正/昭和だけ */
    }
    return '';
  }

  /* 見出し「…目標達成度（達成・一部・未達）」の括弧の中の該当語だけを○で囲う。
     括弧の外は素通しにするので『目標達成度』の『達成』は囲われない */
  function achieveFragment(doc, text, target) {
    var frag = doc.createDocumentFragment();
    var at = target ? String(text).indexOf(ACHIEVE_GROUP) : -1;
    if (at < 0) { frag.appendChild(doc.createTextNode(text)); return frag; }
    frag.appendChild(doc.createTextNode(text.slice(0, at)));
    var parts = ACHIEVE_GROUP.split(/([・（）])/), done = false, i;
    for (i = 0; i < parts.length; i++) {
      if (parts[i] === '') continue;
      if (!done && parts[i] === target) {
        var sp = doc.createElement('span');
        sp.className = 'tp-circ';
        sp.textContent = parts[i];
        frag.appendChild(sp);
        done = true;
      } else {
        frag.appendChild(doc.createTextNode(parts[i]));
      }
    }
    frag.appendChild(doc.createTextNode(text.slice(at + ACHIEVE_GROUP.length)));
    return frag;
  }

  /* 達成度の値（達成／一部／未達のいずれか）。空・想定外は '' ＝どこにも○を付けない */
  function achieveTargetOf(name, plan) {
    var v = String(resolvePh(name, plan)).trim(), i;
    for (i = 0; i < ACHIEVEMENTS.length; i++) if (ACHIEVEMENTS[i] === v) return v;
    return '';
  }

  /* ── スタイル（印刷様式は Excel 再現優先。tokens.css の対象外＝計画 D10） ────── */
  var CSS = [
    '.tp-sheet{position:relative;box-sizing:border-box;margin:0;padding:0;background:#fff;color:#000;',
    '  flex:0 0 auto;', /* 固定寸法の用紙は flex 項目で潰れる（care-tools-html.md の落とし穴） */
    '  font-family:var(--tp-font,' + FONT_STACK + ');',
    '  -webkit-print-color-adjust:exact;print-color-adjust:exact;',
    '  break-inside:avoid;page-break-inside:avoid}',
    '.tp-sheet .tp-tbl{table-layout:fixed;border-collapse:collapse;width:100%;margin:0}',
    '.tp-sheet .tp-tbl td{padding:0;margin:0;vertical-align:top;border-style:solid;border-color:#000;border-width:0}',
    '.tp-sheet .tp-in{display:flex;flex-direction:column;box-sizing:border-box;overflow:hidden;',
    '  padding:0 1px;line-height:1.125;letter-spacing:0}',
    '.tp-sheet .tp-in.tp-ovf{overflow:visible;padding:0}',
    '.tp-sheet .tp-in.tp-nofit{overflow:visible}',
    '.tp-sheet .tp-tx{width:100%;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}',
    '.tp-sheet .tp-in.tp-nowrap>.tp-tx{white-space:pre;overflow-wrap:normal}',
    '.tp-sheet .tp-circ{position:relative;display:inline-block;white-space:pre}',
    '.tp-sheet .tp-circ::after{content:"";position:absolute;left:-.22em;right:-.22em;top:-.14em;bottom:-.14em;',
    '  border:1px solid #000;border-radius:50%;pointer-events:none}'
  ].join('\n');

  function ensureStyle(doc) {
    doc = doc || root.document;
    if (!doc || doc.getElementById('tp-form-style')) return;
    var st = doc.createElement('style');
    st.id = 'tp-form-style';
    st.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(st);
  }

  /* 行境界（0..nrows）に細罫線があるか。border-collapse では罫線が境界にまたがるので、
     罫線を宣言していない側の行も半幅ぶん背が伸びる。両側の行から半幅を引いて相殺する */
  var _lines = null;
  function borderLines() {
    if (_lines) return _lines;
    var L = [], i;
    for (i = 0; i <= TEMPLATE.nrows; i++) L.push(0);
    for (i = 0; i < TEMPLATE.cells.length; i++) {
      var cl = TEMPLATE.cells[i];
      if (cl.bT) L[cl.r] = 1;
      if (cl.bB) L[cl.r + cl.rs] = 1;
    }
    _lines = L;
    return L;
  }
  function bfixOf(r0, r1) {
    var L = borderLines();
    return (L[r0] ? BORDER_PX / 2 : 0) + (L[r1 + 1] ? BORDER_PX / 2 : 0);
  }

  /* ── 行高（署名行だけ原本の最終行を置き換える＝D14） ─────────────────── */
  function rowPtOf(r, sign) {
    var last = TEMPLATE.nrows - 1;
    if (sign && r === last) return Math.max(TEMPLATE.row_pt[r], SIGN_ROW_PT);
    return TEMPLATE.row_pt[r];
  }
  function totalPt(sign) {
    var t = 0;
    for (var r = 0; r < TEMPLATE.nrows; r++) t += rowPtOf(r, sign);
    return t;
  }
  /* 原本の行高から求める初期縮尺（層B）。fitSheet が実測で補正する */
  function nominalScale(sign) {
    return Math.min(PAGE_W_MM / (SHEET_W_PT * MM_PER_PT), PAGE_H_MM / (totalPt(sign) * MM_PER_PT));
  }

  /* ── 生成 ─────────────────────────────────────────────────────── */
  function makeCellTd(doc, cl, plan, sign) {
    var td = doc.createElement('td');
    if (cl.cs > 1) td.colSpan = cl.cs;
    if (cl.rs > 1) td.rowSpan = cl.rs;
    td.className = 'tp-cell';
    td.setAttribute('data-a1', cl.a1);
    if (cl.field) td.setAttribute('data-field', cl.field);
    td.style.borderLeftWidth = cl.bL ? BORDER_PX + 'px' : '0';
    td.style.borderRightWidth = cl.bR ? BORDER_PX + 'px' : '0';
    td.style.borderTopWidth = cl.bT ? BORDER_PX + 'px' : '0';
    td.style.borderBottomWidth = cl.bB ? BORDER_PX + 'px' : '0';

    var isOvf = !!OVERFLOW_CELLS[cl.a1];
    var achName = ACHIEVE_CELLS[cl.a1] || '';       /* 達成度の見出し欄（層Cで縮めない） */
    var isField = !!cl.field;
    var inn = doc.createElement('div');
    inn.className = 'tp-in' + (isOvf ? ' tp-ovf' : (achName ? ' tp-nofit' : ' tp-fit')) +
      /* {{field}} 欄は必ず折返す。固定文言は原本の折返し設定に従う */
      ((!isField && !cl.wrap) || isOvf || achName ? ' tp-nowrap' : '');
    var hpt = 0;
    for (var k = 0; k < cl.rs; k++) hpt += rowPtOf(cl.r + k, sign);
    /* 罫線半幅の補正（自分が罫線を持たなくても隣接セルの罫線で行が伸びるため境界で判定する） */
    var bfix = bfixOf(cl.r, cl.r + cl.rs - 1);
    inn.setAttribute('data-hpt', hpt);
    inn.setAttribute('data-fpt', cl.pt);
    inn.setAttribute('data-bfix', bfix);
    inn.style.justifyContent = justifyOf(cl.vert);
    inn.style.textAlign = alignOf(cl.h);
    if (cl.bold) inn.style.fontWeight = 'bold';
    if (cl.indent) inn.style.paddingLeft = '0.9em';

    var tx = doc.createElement('div');
    tx.className = 'tp-tx';
    var text = stripTailNewlines(fillTemplate(cl.v, plan));
    if (achName) {
      tx.appendChild(achieveFragment(doc, text, achieveTargetOf(achName, plan)));
    } else if (CIRCLE_CELLS[cl.a1]) {
      tx.appendChild(circleFragment(doc, text, circleTargetOf(CIRCLE_CELLS[cl.a1], plan)));
    } else {
      tx.textContent = text;
    }
    inn.appendChild(tx);
    td.appendChild(inn);
    return td;
  }

  function makeFillerTd(doc, r, cspan, sign, signCell) {
    var td = doc.createElement('td');
    if (cspan > 1) td.colSpan = cspan;
    td.className = 'tp-cell';
    var inn = doc.createElement('div');
    inn.className = 'tp-in tp-fit';
    inn.setAttribute('data-hpt', rowPtOf(r, sign));
    inn.setAttribute('data-fpt', signCell ? 10 : 1);
    inn.setAttribute('data-bfix', bfixOf(r, r));
    if (signCell) {
      /* D14: 説明日欄（AG64）の真下・様式からの唯一の意図的逸脱 */
      td.setAttribute('data-a1', 'SIGN');
      inn.style.justifyContent = 'center';
      inn.style.textAlign = 'left';
      var tx = doc.createElement('div');
      tx.className = 'tp-tx';
      tx.textContent = '利用者・家族 署名：＿＿＿＿＿＿';
      inn.appendChild(tx);
    }
    td.appendChild(inn);
    return td;
  }

  /**
   * 計画1件から印刷様式（A4縦1枚）の DOM を作る。
   * @param {Object} plan  training_plan スキーマの plans[i]
   * @param {Object} [opts] {signature:boolean=true, scale:number, fontStack:string, doc:Document}
   * @returns {HTMLElement} div.sheet.tp-sheet（呼び出し側が任意の親に append する）
   */
  function buildSheet(plan, opts) {
    opts = opts || {};
    var doc = opts.doc || root.document;
    ensureStyle(doc);
    plan = plan || {};
    var sign = opts.signature !== false;
    var nr = TEMPLATE.nrows, nc = TEMPLATE.ncols;

    /* 占有グリッド（結合セルの内側にダミー td を出さないため） */
    var occ = [], starts = [], r, c, i;
    for (r = 0; r < nr; r++) { occ.push([]); starts.push({}); }
    for (i = 0; i < TEMPLATE.cells.length; i++) {
      var cl = TEMPLATE.cells[i];
      starts[cl.r][cl.c] = cl;
      for (r = cl.r; r < cl.r + cl.rs && r < nr; r++) {
        for (c = cl.c; c < cl.c + cl.cs && c < nc; c++) occ[r][c] = 1;
      }
    }

    var sheet = doc.createElement('div');
    sheet.className = 'sheet tp-sheet';
    if (opts.fontStack) sheet.style.setProperty('--tp-font', opts.fontStack);
    sheet.setAttribute('data-tp-version', VERSION);
    sheet.setAttribute('data-tp-sign', sign ? '1' : '0');

    var tbl = doc.createElement('table');
    tbl.className = 'tp-tbl';
    var cg = doc.createElement('colgroup');
    for (c = 0; c < nc; c++) {
      var col = doc.createElement('col');
      col.style.width = (100 / nc) + '%';
      cg.appendChild(col);
    }
    tbl.appendChild(cg);
    var tb = doc.createElement('tbody');

    for (r = 0; r < nr; r++) {
      var tr = doc.createElement('tr');
      tr.setAttribute('data-r', r);
      tr.setAttribute('data-hpt', rowPtOf(r, sign));
      c = 0;
      while (c < nc) {
        var here = starts[r][c];
        if (here) { tr.appendChild(makeCellTd(doc, here, plan, sign)); c += here.cs; continue; }
        if (occ[r][c]) { c += 1; continue; }               /* 上からの結合で埋まっている */
        var run = 0;
        while (c + run < nc && !occ[r][c + run] && !starts[r][c + run]) run++;
        /* 署名行（最終行）だけは AG64 と同じ列位置（c=32）で区切る */
        var isSignRow = sign && r === nr - 1;
        if (isSignRow && c < 32 && c + run > 32) {
          tr.appendChild(makeFillerTd(doc, r, 32 - c, sign, false));
          run -= (32 - c); c = 32;
        }
        tr.appendChild(makeFillerTd(doc, r, run, sign, isSignRow && c === 32));
        c += run;
      }
      tb.appendChild(tr);
    }
    tbl.appendChild(tb);
    sheet.appendChild(tbl);
    applyScale(sheet, (typeof opts.scale === 'number' && opts.scale > 0) ? opts.scale : nominalScale(sign));
    return sheet;
  }

  /* ── 層B: 固定比率グリッドの縮尺適用 ─────────────────────────────── */
  function applyScale(sheet, s) {
    sheet.style.width = r2(SHEET_W_PT * s * PX_PER_PT) + 'px';
    sheet.setAttribute('data-tp-scale', r2(s * 10000) / 10000);
    var trs = sheet.querySelectorAll('tr[data-hpt]'), i;
    for (i = 0; i < trs.length; i++) {
      trs[i].style.height = r2(+trs[i].getAttribute('data-hpt') * s * PX_PER_PT) + 'px';
    }
    var ins = sheet.querySelectorAll('.tp-in'), inn, h;
    for (i = 0; i < ins.length; i++) {
      inn = ins[i];
      h = +inn.getAttribute('data-hpt') * s * PX_PER_PT - (+inn.getAttribute('data-bfix'));
      inn.style.height = r2(Math.max(0, h)) + 'px';
      inn.style.fontSize = r2(+inn.getAttribute('data-fpt') * s * PX_PER_PT) + 'px';
      inn.removeAttribute('data-shrunk');
    }
  }

  function overflows(inn) {
    return (inn.scrollHeight > inn.clientHeight + OVF_TOL) ||
           (inn.scrollWidth > inn.clientWidth + OVF_TOL);
  }

  /* ── 層C: 欄単位の文字縮小（下限5px・下限到達は戻り値で知らせる＝紙には出さない） ── */
  function shrinkCells(sheet, out) {
    var ins = sheet.querySelectorAll('.tp-in.tp-fit'), i, inn, base, f, guard;
    for (i = 0; i < ins.length; i++) {
      inn = ins[i];
      if (!overflows(inn)) continue;
      base = parseFloat(inn.style.fontSize) || 0;
      f = base; guard = 0;
      while (overflows(inn) && f - STEP_PX >= MIN_FONT_PX && guard < 200) {
        f = r2(f - STEP_PX);
        inn.style.fontSize = f + 'px';
        guard++;
      }
      if (f < base) {
        var td = inn.parentNode;
        var rec = {
          a1: td.getAttribute('data-a1') || '',
          field: td.getAttribute('data-field') || '',
          fromPx: base, toPx: f, floor: overflows(inn)   /* 縮めきってもはみ出す＝紙で切れる */
        };
        inn.setAttribute('data-shrunk', f);
        (rec.field ? out.shrunkFields : out.shrunkFixed).push(rec);
        if (rec.floor) out.floorHit.push(rec);
        if (out.minFontPx == null || f < out.minFontPx) out.minFontPx = f;
      }
    }
  }

  /**
   * A4縦1枚に収める（層B→C→D）。表示されている要素でのみ測る。
   * @param {HTMLElement} el buildSheet が返した要素
   * @returns {Object} {measured, scale, zoom, widthMm, heightMm, fits,
   *                    shrunkFields[], shrunkFixed[], floorHit[], minFontPx}
   */
  function fitSheet(el, opts) {
    opts = opts || {};
    var out = {
      measured: false, scale: null, zoom: 1, widthMm: null, heightMm: null, fits: false,
      shrunkFields: [], shrunkFixed: [], floorHit: [], minFontPx: null, reason: ''
    };
    if (!el || !el.querySelector) { out.reason = 'no-element'; return out; }
    /* ★非表示のときは測らない（offsetHeight が 0 になり「収まった」と誤判定する） */
    if (!el.offsetParent) { out.reason = 'hidden'; return out; }
    var tbl = el.querySelector('.tp-tbl');
    if (!tbl) { out.reason = 'no-table'; return out; }

    var sign = el.getAttribute('data-tp-sign') !== '0';
    el.style.zoom = '';
    var s = (typeof opts.scale === 'number' && opts.scale > 0) ? opts.scale : nominalScale(sign);
    applyScale(el, s);

    /* 実測 → 縮尺を補正（罫線・丸めで原本比から僅かにずれるため。拡大はしない） */
    var wmm = tbl.offsetWidth / PX_PER_PT * MM_PER_PT;
    var hmm = tbl.offsetHeight / PX_PER_PT * MM_PER_PT;
    var k = Math.min(1, PAGE_W_MM * SAFE / (wmm || 1), PAGE_H_MM * SAFE / (hmm || 1));
    if (k < 0.9999) { s = s * k; applyScale(el, s); }
    out.scale = r2(s * 10000) / 10000;

    shrinkCells(el, out);

    wmm = tbl.offsetWidth / PX_PER_PT * MM_PER_PT;
    hmm = tbl.offsetHeight / PX_PER_PT * MM_PER_PT;
    /* 層D: 最後の保険。印字可能寸法の99%を超えたら zoom で押し込む（transform:scale は使わない） */
    if (hmm > PAGE_H_MM * SAFE || wmm > PAGE_W_MM * SAFE) {
      var z = Math.min(PAGE_H_MM * SAFE / (hmm || 1), PAGE_W_MM * SAFE / (wmm || 1));
      z = Math.floor(z * 10000) / 10000;
      if (z > 0 && z < 1) { el.style.zoom = z; out.zoom = z; wmm = wmm * z; hmm = hmm * z; }
    }
    out.widthMm = r2(wmm);
    out.heightMm = r2(hmm);
    out.fits = (wmm <= PAGE_W_MM + 0.01) && (hmm <= PAGE_H_MM + 0.01);
    out.measured = true;
    return out;
  }

  root.TP_FORM = {
    VERSION: VERSION,
    TEMPLATE: TEMPLATE,
    PAGE_CSS: PAGE_CSS,
    FONT_STACK: FONT_STACK,
    PAGE_W_MM: PAGE_W_MM,
    PAGE_H_MM: PAGE_H_MM,
    MIN_FONT_PX: MIN_FONT_PX,
    buildSheet: buildSheet,
    fitSheet: fitSheet,
    ensureStyle: ensureStyle,
    applyScale: applyScale,
    nominalScale: nominalScale,
    toWareki: toWareki,
    warekiEra: warekiEra,
    fillTemplate: fillTemplate,
    stripTailNewlines: stripTailNewlines
  };
  /* 手元テスト（node）から純関数を呼べるようにする。ブラウザでは無害 */
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TP_FORM;
})(typeof window !== 'undefined' ? window : this);
