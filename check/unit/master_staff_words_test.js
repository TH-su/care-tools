/* master_staff_words_test.js — 入居者マスタ：職員に見える文から技術の言葉を減らし、接続先が無い時に次にすることを出す（2026-11-02 品質改善 便4）
 *
 * 確かめること
 *   1. 言い換えた文の古い形（GAS・トークン・Apps Script・HTTP・e.message をそのまま出す形）が残っていない
 *   2. 言い換えた後の文がある（設定の窓の見出し・接続テスト・薬の変更候補・薬情の取り込み・食形態一覧・一括編集・AI の断り）
 *   3. 接続先が無い時の文が9か所すべて同じ文で入っていて、技術の言葉を含まない
 *   4. rmErrWords_ を vm で動かす: 英語の例外文は出さずに記録へ回す・日本語の断りはそのまま・NO_URL などの印は言葉にする
 *   5. rmNoUrlGuide_ を vm で動かす: 接続設定（connection-settings.html）へのリンクと「何が足りないか・次にすること」の文が出る
 *   6. 一覧が空で接続先が無い時（現場端末を除く）に案内を添える・詳細画面でも添える（innerHTML の代入文そのものは変えない＝点検表どおり）
 *   7. 既存の試験・他の画面と文をそろえているため変えない文が、そのまま残っている（消されないように）
 * 架空データ・本番データは使わない（公開ファイルのソースだけを読む）。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const FILE = process.env.MASTER_HTML || path.join(ROOT, 'resident-master.html');
const S = fs.readFileSync(FILE, 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info === undefined ? '' : '  → ' + String(JSON.stringify(info)).slice(0, 600))); }
}
function count(s, w) { let n = 0, i = 0; while ((i = s.indexOf(w, i)) >= 0) { n++; i += w.length; } return n; }
function grabFn(src, name) {
  const start = src.indexOf('\nfunction ' + name + '(');
  if (start < 0) return '';
  let depth = 0, seen = false;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return src.slice(start, i + 1); }
  }
  return '';
}
const TECH = /GAS|トークン|token|JSON|Supabase|HTTP|Apps Script|デプロイ|スクリプトプロパティ|Web App|\/exec|NO_URL|undefined|null/;

console.log('\n【1】古い形が残っていない');
[
  '<label>GAS Web App URL</label>',
  '<label>アクセストークン</label>',
  'GASのスクリプトプロパティと一致させる',
  'URL・トークンはこの端末',
  "toast('⚠️ 接続失敗: '+e.message)",
  "toast('⚠️ 一覧の取得に失敗: '+e.message)",
  '入居者マスタGASの貼り替えがまだ',
  '入居者マスタGASの貼り替えが必要',
  '入居者マスタGASに届きません',
  '入居者マスタGASの更新がまだ',
  "'\\n\\n※ 家族情報と薬剤情報の一括編集は、入居者マスタのGAS",
  "'\\n\\n※ 氏名の一括編集は、入居者マスタのGAS",
  'Apps Script プロジェクト・ファイル med-dict',
  '専用GAS）にAIのキー',
  '計画書の専用GASから',
  "（HTTP '+code",
  "'同期設定のURLが未設定です'",
  "toast('保存できませんでした：'+String((e&&e.message)||e)",
  "toast('保存できたか確認できませんでした：'+String((e&&e.message)||e)",
  "cur.msg='読み込めませんでした: '+String(e&&e.message||e)",
  "'反映できませんでした（'+m+'）'",
  "'残せませんでした（'+m+'）'",
  "'残せたか確かめられませんでした（'+m+'）'",
  "'最後の1件は何も書いていません（'+m+'）'",
  "再デプロイ"
].forEach(w => t('「' + w + '」が無い', S.indexOf(w) < 0, w));

console.log('\n【2】言い換えた後の文がある');
const SRV_OLD = "var RM_SRV_OLD='管理者に連絡してください（入居者マスタの Google の受け口の更新が必要です）';";
t('Google の受け口が古い時の文（職員がすること＝管理者に連絡）を1つに置く', count(S, SRV_OLD) === 1);
t('その文に技術の言葉が無い', !TECH.test(SRV_OLD.replace(/^var RM_SRV_OLD=/, '')));
[
  ['設定の窓: 接続先のURL', '<label>接続先のURL</label>'],
  ['設定の窓: 合言葉', '<label>合言葉</label>'],
  ['設定の窓: 合言葉の入れ方', 'placeholder="管理者から伝えられた合言葉"'],
  ['設定の窓: 端末に残す物の説明', 'URL・合言葉はこの端末にのみ保存され'],
  ['接続テストの失敗', "toast('⚠️ つながりませんでした（'+rmErrWords_(e,'接続テスト')+'）。URLと合言葉を確かめてください')"],
  ['一覧の取得の失敗', "toast('⚠️ 一覧の取得に失敗しました（'+(typeof rmErrWords_==='function'?rmErrWords_(e,'一覧の取得'):'通信がうまくいきませんでした')+'）。少し待ってから、もう一度お試しください')"],
  ['薬効辞書: 古い時', "('薬効辞書はまだ使えません。'+RM_SRV_OLD)"],
  ['薬効辞書: 外す指示が反映されない', "'管理者に連絡してください（薬効辞書の Google の受け口の更新が必要です）'"],
  ['変更候補: 古い時の帯', "note='まだ使えません。'+RM_SRV_OLD;"],
  ['変更候補・薬情: 反映が古い時（2か所）', "('まだ反映できません。'+RM_SRV_OLD)"],
  ['変更候補: 残せない時', "('まだ残せません。'+RM_SRV_OLD)"],
  ['薬情: 古い時の帯', "まだ反映はできません（読み込み・振り分け・確認表は見られます）。'+RM_SRV_OLD+'。</p>'"],
  ['薬情: 届かない時の帯', '⚠ 入居者マスタの Google の受け口に届きません。少し待って開き直してください。'],
  ['AI: キーが無い', 'サーバー（個別機能訓練計画書の Google の受け口）にAIのキーが入っていません。管理者に連絡してください'],
  ['AI: 中継の応答が正しくない', '個別機能訓練計画書の Google の受け口から正しい応答がありませんでした。もう一度お試しください'],
  ['AI: 応答の番号', "（応答の番号 '+code.slice(8)+'）"],
  ['食形態一覧: 読めない（古い時）', "'食形態一覧を読めません。'+RM_SRV_OLD+'（管理者向け：手順書「DEPLOY-食形態一覧.md」のとおり貼り替えて公開し直してください）'"],
  ['食形態一覧: 保存できない（古い時）', "alert('保存できませんでした。1文字も書き込んでいません。\\n'+"],
  ['一括編集: 家族・薬剤が古い時', "'\\n\\n※ 家族情報と薬剤情報の一括編集は、まだ使えません。データは1文字も変わっていません。'"],
  ['一括編集: 氏名が古い時', "'\\n\\n※ 氏名の一括編集は、まだ使えません。氏名以外の項目は従来どおり保存できます。'"]
].forEach(([n, w]) => t(n, S.indexOf(w) >= 0, w));
t('変更候補・薬情の反映が古い時の文は2か所', count(S, "('まだ反映できません。'+RM_SRV_OLD)") === 2);
t('e.message をそのまま出していた所は rmErrWords_ を通す（呼び出し12か所以上）', count(S, 'rmErrWords_(') >= 12, count(S, 'rmErrWords_('));

console.log('\n【3】接続先が無い時の文');
const NOURL = '入居者マスタの接続先が入っていません。接続設定の「入居者マスタ・フェイスシート」にURLと合言葉を入れてください（画面下の「☁️ 同期設定」からも入れられます）';
/* 欄の名前は接続設定の実際の見出しに合わせる（connection-settings.html の id:'master' の title）・同期設定のボタンは画面下の固定のメニュー（.bnav）にある */
{
  const CS = fs.readFileSync(path.join(ROOT, 'connection-settings.html'), 'utf8');
  const m = CS.match(/\{ id:'master', title:'([^']+)'/);
  t('接続設定の見出し「' + (m && m[1]) + '」を文に使う', !!m && NOURL.indexOf('「' + m[1] + '」') >= 0, m && m[1]);
  t('同期設定のボタンは画面下のメニュー（.bnav）にある', /<nav class="bnav">[\s\S]{0,600}data-sc="sync"/.test(S));
  t('文は「画面下の『☁️ 同期設定』」と言い、「上の／この画面の」と言わない', /画面下の「☁️ 同期設定」/.test(NOURL) && !/(上|この画面)の「☁️ 同期設定」/.test(S));
}
t('9か所すべて同じ文', count(S, "'" + NOURL + "'") === 6 && count(S, "toast('⚠️ " + NOURL + "')") === 3, [count(S, "'" + NOURL + "'"), count(S, "toast('⚠️ " + NOURL + "')")]);
t('文に技術の言葉が無い', !TECH.test(NOURL));
[['入居日', "admErr='" + NOURL + "'"], ['帳票の控え', "bkErr='" + NOURL + "'"], ['家族・病歴の一覧', "fullErr='" + NOURL + "'"],
 ['薬効辞書', "mdErr='" + NOURL + "'"], ['薬効辞書の保存', "toast('" + NOURL + "',false)"], ['食形態一覧', "mealSetMsg_('" + NOURL + "')"]]
  .forEach(([n, w]) => t('接続先が無い時: ' + n, S.indexOf(w) >= 0, w));
t('「同期設定のURLが未設定です」は点検表で固定された詳細画面の1か所だけ', count(S, '同期設定のURLが未設定です') === 1);

console.log('\n【4】rmErrWords_（例外の文を職員向けの言葉に・元の文は記録へ）');
{
  const src = grabFn(S, 'rmErrWords_');
  t('rmErrWords_ がある', !!src);
  const notes = [];
  const box = { rmNote_: (w, e) => notes.push([w, String((e && e.message) || e)]) };
  vm.createContext(box);
  if (src) vm.runInContext(src, box);
  const f = box.rmErrWords_ || (() => '');
  const cases = [
    [new Error('Failed to fetch'), '通信がうまくいきませんでした'],
    [new TypeError("Cannot read properties of undefined (reading 'x')"), '通信がうまくいきませんでした'],
    [new Error('NO_URL'), '接続先が入っていません'],
    [new Error('不明なaction: medCand'), 'Google の受け口が古い版です'],
    [new Error('認証エラー'), '合言葉が通りませんでした'],
    [new Error('この方の記録を読めませんでした'), 'この方の記録を読めませんでした'],
    ['保存できません（参照専用）', '保存できません（参照専用）'],
    [new Error('一覧から外す指示が反映されませんでした。管理者に連絡してください（薬効辞書の Google の受け口の更新が必要です）'),
      '一覧から外す指示が反映されませんでした。管理者に連絡してください（薬効辞書の Google の受け口の更新が必要です）'],
    [new Error(''), '通信がうまくいきませんでした']
  ];
  cases.forEach(([e, want]) => {
    const got = f(e, '試験');
    t('「' + String((e && e.message) || e) + '」→「' + want + '」', got === want, got);
    t('　出す文に技術の言葉・英語が無い', !TECH.test(got) && !/[A-Za-z]/.test(got.replace(/Google|URL/g, '')), got);
  });
  /* 通信の失敗（圏外・時間切れ）と接続先なし（NO_URL）は記録に流さない＝現場・圏外で自動の不具合報告を増やさない */
  const noted = notes.map(n => n[1]);
  t('通信の失敗・接続先なし以外の元の文は記録へ回す（7件・場所つき）', notes.length === 7 && notes.every(n => n[0] === '試験') && noted.indexOf("Cannot read properties of undefined (reading 'x')") >= 0, notes);
  t('Failed to fetch・NO_URL は記録に流さない', noted.indexOf('Failed to fetch') < 0 && noted.indexOf('NO_URL') < 0, noted);
  notes.length = 0;
  ['Failed to fetch', 'Load failed', 'NetworkError when attempting to fetch resource.', 'The operation was aborted.', 'タイムアウト', 'Google に届きませんでした']
    .forEach(m => f(new Error(m), '試験'));
  t('通信の失敗（Chrome・Safari・Firefox・中断・時間切れ・届かない）は6件とも記録に流さない', notes.length === 0, notes);
  t('時間切れ（タイムアウト）は出す文にも英語を出さない', !/[A-Za-z]/.test(f(new Error('Load failed'), '試験')));
}

console.log('\n【5】rmNoUrlGuide_（接続設定へのリンクつきの案内）');
{
  const src = grabFn(S, 'rmNoUrlGuide_');
  t('rmNoUrlGuide_ がある', !!src);
  function El(tag) { return { tag, kids: [], style: {}, className: '', href: '', textContent: '', appendChild(c) { this.kids.push(c); return c; } }; }
  const document = { createElement: El, createTextNode: s => ({ tag: '#text', textContent: s }) };
  const box = { document };
  vm.createContext(box);
  if (src) vm.runInContext(src, box);
  const d = box.rmNoUrlGuide_ ? box.rmNoUrlGuide_() : El('div');
  const text = d.kids.map(k => k.textContent).join('');
  const a = d.kids.find(k => k.tag === 'a');
  t('接続設定へのリンクがある', !!a && a.href === 'connection-settings.html' && a.textContent === '接続設定', a);
  t('何が足りないか（入居者マスタの接続先）を言う', /入居者マスタの接続先が入っていません/.test(text), text);
  t('次にすること（接続設定の「入居者マスタ・フェイスシート」にURLと合言葉を入れる）を言う', /接続設定の「入居者マスタ・フェイスシート」にURLと合言葉を入れてください/.test(text), text);
  t('同期設定のボタンの場所は「画面下」', /画面下の「☁️ 同期設定」/.test(text) && !/上の「☁️ 同期設定」/.test(text), text);
  t('案内に技術の言葉が無い', !TECH.test(text), text);
  t('外からの値を入れない（innerHTML を使わない）', !/innerHTML/.test(src));
}

console.log('\n【6】案内を出す場所');
{
  const rr = grabFn(S, 'renderRoster');
  t('一覧が空で接続先が無い時（現場端末を除く）に案内を添える',
    /if\(!roster\.length&&!CFG\.url&&getDeviceRole\(\)!=='field'\)\{ if\(box\.firstChild\) box\.firstChild\.appendChild\(rmNoUrlGuide_\(\)\); \}/.test(rr));
  t('一覧が空の時の innerHTML の代入文は変えない（点検表どおり）',
    rr.indexOf("box.innerHTML='<div class=\"empty\">'+(roster.length?'該当する入居者がいません':'入居者がいません。「同期設定」でURLを設定するか「新規」で登録してください')+'</div>';") >= 0);
  t('詳細画面でも接続先が無い時に案内を添える（現場端末では出さない＝接続設定は事務所専用）',
    S.indexOf("if(!CFG.url){$('viewBox').innerHTML='<div class=\"empty\">同期設定のURLが未設定です</div>';if(typeof rmNoUrlGuide_==='function'&&getDeviceRole()!=='field'&&$('viewBox').firstChild)$('viewBox').firstChild.appendChild(rmNoUrlGuide_());return}") >= 0);
  /* 画面を開く順（端末の用途の止め → ログインの役割の確かめ → 中身）は変えない */
  t('ログインの役割の確かめの後で始める形はそのまま', /window\.SUAppGate\.run\('resident-master',\{dirty:rmGateDirty_\}\)\.then\(function\(ok\)\{ if\(ok\) rmStart_\(\); \}\)/.test(S));
}

console.log('\n【7】変えない文（既存の試験・他の画面とそろえている）');
[
  ['取り違えの断り（3画面で一字一句同じ・非公開の試験が確かめる）', "var MASTER_WRONG_MSG='このURLは入居者マスタのGASではありません（薬学管理・申送など別のアプリのGASの可能性があります）';"],
  ['食形態一覧の取得の失敗（master_deviceguard が文を確かめる）', ": '取得に失敗しました: '+((e&&e.message)||e));"],
  ['入院・退院の失敗（master_hosptoggle が文を確かめる）', "'変更できていません: '+e.message+'。もう一度お試しください'"],
  ['食形態一覧の保存の古い版の見分け（master_confirm が見る）', 'if(/不明なaction/.test(m)){'],
  ['AI の未知の断り（master_ai_supa が形を見る）', "return 'AIに尋ねられませんでした（'+code+'）';"]
].forEach(([n, w]) => t(n, S.indexOf(w) >= 0, w));

console.log('\n結果: 成功 ' + pass + ' / 失敗 ' + fail);
process.exit(fail ? 1 : 0);
