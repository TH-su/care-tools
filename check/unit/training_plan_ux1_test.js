/* training_plan_ux1_test.js — 個別機能訓練計画書（training-plan.html）の使いやすさの改善 第1段（2026-10-16 本人承認）。
   1. 毎日使う一覧・編集画面の文言から、システムの用語（索引・JSON・rephrase・Claude Code・設定のキー名など）をなくす
   2. 計画を追加する入口を「新しい期の作成日（今日が入っている）＋この日付で計画を追加」の1つにする
   3. 管理者向けの操作（一覧を作り直す・ファイルから取り込む・まとめて取り込む）を一覧から設定画面へ移す。
      一覧の行はどこを押しても開ける。一覧の情報が未更新の方がいる時は一覧に帯で知らせる
   対象HTMLは環境変数 TP_HTML で差し替えられる。
     TP_HTML=/path/to/training-plan.html node check/unit/training_plan_ux1_test.js
   ★データはすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.TP_HTML || path.join(__dirname, '..', '..', 'training-plan.html');
const S = fs.readFileSync(HTML, 'utf8');

let pass = 0, fail = 0;
function t(n, c, e) {
  if (c) { pass++; console.log('  ✓ ' + n); }
  else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); }
}
const grab = (re) => (S.match(re) || [])[0] || '';
const section = (id) => grab(new RegExp('<section id="' + id + '"[\\s\\S]*?</section>'));
const LIST = section('scr-list'), EDIT = section('scr-edit'), SET = section('scr-settings');
/* 画面に出る文言だけを見る（説明のコメントには旧名が残ってよい） */
const VIS = S.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
  .filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');

console.log('\n【0】画面を切り出せた');
t('一覧・編集・設定の画面がある', LIST.length > 200 && EDIT.length > 200 && SET.length > 200, [LIST.length, EDIT.length, SET.length]);

console.log('\n【1】画面の文言にシステムの用語を残さない');
t('コメントを除いた文言を作れた（元の半分以上が残る）', VIS.length > S.length * 0.5 && VIS.indexOf('function renderList') > 0, [VIS.length, S.length]);
[
  '索引を再構築', 'JSON取込', '（rephrase）', 'v4では', 'Claude Code', '（su_sync_common）', '（rmaster_cfg）',
  '欠落・前回日', '前回日不一致', '欠落台帳', '欠落として', '今回の計画を追加', '一覧の索引', '索引を読',
  '索引を保存', '索引を直せ', '索引を作り直', '索引を再構築中', '索引（職員の一覧）',
  'この端末が繋がっている計画書GASは古い版', 'この端末が繋がっているGASは古い版',
  '計画書【専用】GASのURL', 'サーバー（計画書の専用GAS）にAIのキーが無いか', '計画書の専用GASの合言葉が通りませんでした',
  '計画書の専用GASから正しい応答がありませんでした'
].forEach(function (w) {
  t('「' + w + '」が画面に出ない', VIS.indexOf(w) < 0, w);
});
t('言い換えた文言が入っている', [
  '一覧を作り直す', 'ファイルから取り込む', 'ファイルからまとめて取り込む', '言い回しも新しくする',
  '抜け・ずれ', '原本の抜け', '前回作成日のずれ', '管理者がまとめて作ります', 'いまはAIを使えません。管理者に伝えてください'
].every(function (w) { return VIS.indexOf(w) >= 0; }));
/* 入居者マスタの接続先の取り違えの案内は、gas/tests/master_target_verdict_test.js が文言を確かめている＝変えない */
t('入居者マスタの接続先の取り違えの案内は残す（gas 側の試験が確かめている）', S.indexOf("'入居者マスタの接続先が、入居者マスタ以外のGAS") >= 0);
/* 管理者向けの細かい理由は（管理者向け：…）に入れて、職員向けの短い案内を先に出す */
['AI_NO_KEY', 'AI_PROXY_OLD', 'AI_PROXY_AUTH'].forEach(function (k) {   /* AI_HTTP_401/403 は下で別に確かめる */
  const line = grab(new RegExp("if \\(m === '" + k + "'\\) return '[^\\n]*"));
  t(k + ' は短い案内が先・細かい理由は（管理者向け：…）', /^if \(m === '\w+'\) return '(いまはAIを使えません。|サーバーの合言葉が通りませんでした。)管理者に伝えてください（管理者向け：/.test(line), line);
});

t('AI のキー違いも短い案内が先', /if \(m === 'AI_HTTP_401' \|\| m === 'AI_HTTP_403'\) return 'いまはAIを使えません。管理者に伝えてください（管理者向け：/.test(S));
t('回数の上限の文は、設定のキー名を（管理者向け：…）に入れる', /if \(m === 'AI_LIMIT'\) return '今日のAIの利用回数の上限に達しました。明日もう一度お試しください（管理者向け：上限はサーバーの AI_DAILY_LIMIT/.test(S));
t('「言い回し」の言葉をそろえた（旧「言い回しも更新」が残らない）', VIS.indexOf('言い回しも更新') < 0 && (VIS.match(/言い回しも新しくする/g) || []).length >= 3);

console.log('\n【2】計画を追加する入口は1つ');
t('期の並びの「この期を作成」は残す', /el\('button', 'btn sm pri sp', 'この期を作成'\)/.test(S));
t('「今回の計画を追加」のボタンが無い', !/id="btnNewPlan"/.test(S) && !/\$\('btnNewPlan'\)/.test(S));
t('編集画面に「この日付で計画を追加」がある', /<button id="btnAddAt"[^>]*>この日付で計画を追加<\/button>/.test(EDIT));
t('新しい期の日付の欄の名前', /<label for="addAtDate">新しい期の作成日（今日が入っています）<\/label>/.test(EDIT));
t('選んでいる期の作成日は「計画（期）」の選択の横', /<select id="planSel"><\/select>\s*<\/div>\s*<!--[^>]*-->\s*<div><label for="fPlanDate">選んでいる期の作成日（変更できます）<\/label>/.test(EDIT));
t('作成日の欄は1つだけ', (S.match(/id="fPlanDate"/g) || []).length === 1 && (S.match(/id="addAtDate"/g) || []).length === 1);
{
  /* 新しい期の日付: 人が触っていなければ、押した時・別の方を開いた時・画面に戻った時の「今日」に入れ直す（審査 高1・低3）。
     作るのは addPlanAt（旧「今回の計画を追加」と同じ関数） */
  const RF = grab(/var addAtTouched = false;\nfunction refreshAddAtDate\(\) \{[\s\S]*?\n\}/);
  const H = grab(/\$\('btnAddAt'\)\.addEventListener\('click', function \(\) \{[\s\S]*?\n  \}\);/);
  t('日付の入れ直しとボタンの処理を切り出せた', RF.length > 50 && H.length > 50, [RF.length, H.length]);
  t('起動時に入れ直し、人が直したら印を付ける・画面に戻った時も入れ直す',
    /\n  refreshAddAtDate\(\);\n  \$\('addAtDate'\)\.addEventListener\('input', function \(\) \{ addAtTouched = true; \}\);\n  \$\('addAtDate'\)\.addEventListener\('change', function \(\) \{ addAtTouched = true; \}\);\n  document\.addEventListener\('visibilitychange', function \(\) \{ if \(!document\.hidden\) refreshAddAtDate\(\); \}\);/.test(S));
  const OR = grab(/function openResident\([^)]*\) \{[\s\S]*?\n\}/);
  t('別の方を開いた時は印を外して今日に戻す', OR.length > 200 && /addAtTouched = false; refreshAddAtDate\(\);/.test(OR), OR.length);
  const log = { toast: [], add: [], focus: 0 };
  const els = { addAtDate: { value: '', max: '', focus: () => { log.focus++; } } };
  const day = { v: '2026-10-16' };
  let h = null;
  const sb = {
    DOC: { plans: [] }, s_: (v) => (v == null ? '' : String(v)), todayYmd: () => day.v,
    toast: (m) => { log.toast.push(m); },
    $: (id) => (id === 'btnAddAt' ? { addEventListener: (ev, f) => { h = f; } } : els[id]),
    addPlanAt: (d) => { log.add.push(d); return d !== '2026-01-01'; }
  };
  vm.createContext(sb);
  try { vm.runInContext(RF + '\n' + H, sb); } catch (e) { t('ボタンの処理が動く', false, String(e)); }
  if (h && RF) try {
    vm.runInContext('refreshAddAtDate()', sb);
    t('起動時に今日と上限が入る', els.addAtDate.value === '2026-10-16' && els.addAtDate.max === '2026-10-16', els.addAtDate);
    h();
    t('★今日のまま押すと、今日で addPlanAt を呼ぶ', log.add.join() === '2026-10-16', log);
    day.v = '2026-10-17';   /* 翌日まで開いたまま */
    h();
    t('★★翌日まで開いたままでも、触っていなければ押した日の今日で作る', log.add[1] === '2026-10-17' && els.addAtDate.max === '2026-10-17', log);
    els.addAtDate.value = '2026-07-01'; sb.addAtTouched = true; vm.runInContext('addAtTouched = true', sb);
    h();
    t('人が入れた過去の日付で作り、作れた後は今日に戻す', log.add[2] === '2026-07-01' && els.addAtDate.value === '2026-10-17' && vm.runInContext('addAtTouched', sb) === false, log);
    els.addAtDate.value = '2026-01-01'; vm.runInContext('addAtTouched = true', sb);
    h();
    t('作れなかった時は入れた日付を残す', els.addAtDate.value === '2026-01-01');
    vm.runInContext('addAtTouched = false; refreshAddAtDate()', sb);
    t('★別の方を開いた時（印を外して入れ直す）は今日に戻る', els.addAtDate.value === '2026-10-17');
    els.addAtDate.value = ''; vm.runInContext('addAtTouched = true', sb);
    h();
    t('空なら作らず知らせる', log.add.length === 4 && log.toast[log.toast.length - 1] === '日付を入れてください' && log.focus === 1, log);
  } catch (e) { t('日付の処理が動く', false, String(e)); }
}

console.log('\n【3】管理者向けの操作は設定画面へ・一覧は行を押して開く');
['btnRebuildIdx', 'btnImport', 'btnBulk'].forEach(function (id) {
  t(id + ' は一覧に無く設定画面にある', LIST.indexOf('id="' + id + '"') < 0 && SET.indexOf('id="' + id + '"') >= 0);
});
t('設定画面に「データの管理（管理者向け）」の欄', /<h2>データの管理（管理者向け）<\/h2>/.test(SET));
t('移したボタンの処理はそのまま', /\$\('btnRebuildIdx'\)\.addEventListener\('click', rebuildIndex\);/.test(S) &&
  /\$\('btnImport'\)\.addEventListener\('click', function \(\) \{\s*if \(!CFG\.url\)[^\n]*\n\s*\$\('importFile'\)\.click\(\);/.test(S) &&
  /\$\('btnBulk'\)\.addEventListener\('click', function \(\) \{\s*if \(!CFG\.url\)[^\n]*\n\s*openBulkModal\(\);/.test(S));
t('一覧に「最新を読み込む」は残す', LIST.indexOf('id="btnReload"') >= 0 && LIST.indexOf('id="btnBatchAll"') >= 0);
{
  const RB = grab(/function renderBanners\(\) \{[\s\S]*?\n\}/);
  t('★一覧の情報が未更新の方がいる時は一覧に帯で知らせる', /var pend = Object\.keys\(IDX_PENDING\)\.length;\s*BANNER_PEND = pend;\s*if \(pend\) banner\(host, 'warn', '一覧の情報が ' \+ pend \+ '件、最新になっていません。/.test(RB));
  /* 帯を実際に作らせる */
  const box = { kids: [], appendChild(n) { this.kids.push(n); } };
  const sb = {
    $: () => box, clear: (h) => { h.kids = []; }, SU_READY: true, FORM_READY: true, CFG: { url: 'x' }, MASTER_MSG: '',
    ROSTER_SRC: 'master', DAY_MSG: '', renderBatchAllSummary: () => {}, IDX_PENDING: { tp0001: true, tp0002: true },
    banner: (h, k, txt) => { h.appendChild({ k: k, txt: txt }); }
  };
  vm.createContext(sb);
  try { vm.runInContext(RB + ';renderBanners();', sb); } catch (e) { t('帯の処理が動く', false, String(e)); }
  t('未更新2件の帯が出る', box.kids.length === 1 && box.kids[0].k === 'warn' && box.kids[0].txt.indexOf('2件') > 0, box.kids);
  sb.IDX_PENDING = {};
  vm.runInContext('renderBanners();', sb);
  t('未更新が無ければ帯は出ない', box.kids.length === 0, box.kids);
  /* 一覧を出している時に未更新の件数が変わったら帯を描き直す（起動時の自己修復の失敗でも一覧で分かる・審査 中2） */
  const RC = grab(/var BANNER_PEND = 0;[^\n]*\nfunction renderIndexChip\(\) \{[\s\S]*?\n\}/);
  t('renderIndexChip を切り出せた', RC.length > 100, RC.length);
  let shown = 'scr-list', busy = false, rb = 0;
  const btn = { textContent: '', classList: { toggle: () => {} } };
  const sb2 = {
    IDX_PENDING: {}, BULK: null, batchBusy: () => busy, renderBanners: () => { rb++; vm.runInContext('BANNER_PEND = Object.keys(IDX_PENDING).length', sb2); },
    $: (id) => (id === 'btnRebuildIdx' ? btn : { classList: { contains: (c) => c === 'on' && id === shown } })
  };
  vm.createContext(sb2);
  if (RC) try {
  vm.runInContext(RC, sb2);
  vm.runInContext('renderIndexChip()', sb2);
  t('件数が変わらなければ帯は描き直さない', rb === 0, rb);
  sb2.IDX_PENDING.tp0001 = true; vm.runInContext('renderIndexChip()', sb2);
  t('★未更新が増えたら一覧の帯を描き直す・ボタンにも件数', rb === 1 && btn.textContent === '一覧を作り直す（未更新1件）', [rb, btn.textContent]);
  vm.runInContext('renderIndexChip()', sb2);
  t('同じ件数のままなら二度描かない', rb === 1, rb);
  shown = 'scr-edit'; sb2.IDX_PENDING.tp0002 = true; vm.runInContext('renderIndexChip()', sb2);
  t('編集画面にいる時は描かない（一覧へ移った時に描く）', rb === 1, rb);
  shown = 'scr-list'; busy = true; vm.runInContext('renderIndexChip()', sb2);
  t('一括作成中は描かない', rb === 1, rb);
  busy = false; vm.runInContext('BULK = { running: true }; renderIndexChip()', sb2);
  t('まとめて取込の間は描かない', rb === 1, rb);
  vm.runInContext('BULK = null; renderIndexChip()', sb2);
  t('終わった後は描く', rb === 2, rb);
  } catch (e) { t('帯の描き直しが動く', false, String(e)); }
}
{
  const RL = grab(/function renderList\(\) \{[\s\S]*?\n\}/);
  t('★行を押すと開く（中のボタン・入力は除く・一括作成中は開かない）',
    /tr\.addEventListener\('click', function \(ev\) \{\s*if \(ev\.target && ev\.target\.closest && ev\.target\.closest\('button,a,input,select,textarea'\)\) return;\s*try \{[^\n]*\}\s*if \(batchBusy\(\)\) \{[^}]*\}\s*openResident\(this\.getAttribute\('data-id'\)\);/.test(RL));
  t('行の文字をなぞって選んだ時は開かない', /if \(window\.getSelection && String\(window\.getSelection\(\)\)\.length\) return;/.test(RL));
  t('「開く」ボタンも残す（キーボードで使う）', /el\('button', 'btn sm', '開く'\)/.test(RL) && /openResident\(this\.getAttribute\('data-id'\)\); \}\);\n\s*act\.appendChild\(b\);/.test(RL));
  t('一覧の下に余白（共通の「不具合を報告」ボタンに隠れないように）', /#scr-list\{padding-bottom:64px\}/.test(S));
}

console.log('\n【4】印刷様式には触れていない');
t('印刷用の様式の部品の読み込みはそのまま', /<script src="training-plan-form\.js[^"]*"><\/script>/.test(S));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
