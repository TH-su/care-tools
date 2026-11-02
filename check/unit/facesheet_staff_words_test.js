/* フェイスシート（facesheet.html）の「職員に見える文字から技術用語を減らす」「接続先が無い時に次にすることを出す」
   「一覧のカードを本物のボタンにする」のテスト。
   対象: 設定の窓の見出し・説明、一覧・詳細・食形態一覧・薬効辞書・接続テストの断りの文、fsNoCfgMsg_・fsErrWords_、
         openResident・mealLoad・fsMdFetch_・rcardHtml（実物のソースから切り出して vm に入れる。それ以外は偽物）
   実行: node "…/check/unit/facesheet_staff_words_test.js"
         FACESHEET_HTML=<別の版>/facesheet.html node "…/check/unit/facesheet_staff_words_test.js"
   直す前の版を渡すと落ちる（直す前は「GAS Web App URL」「アクセストークン」・英語の例外文の直出し・div のカード）。

   実データは含まない。値は全て架空。
   ★出力に console を使わない（個人情報を出力に流さないための決まり）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_PATH = process.env.FACESHEET_HTML || path.join(__dirname, '..', '..', 'facesheet.html');
const SRC = fs.readFileSync(HTML_PATH, 'utf8');

let ok = 0, ng = 0;
const say = m => process.stdout.write(m + '\n');
function group(n){ say('\n■ ' + n); }
function t(label, cond, info){ if(cond){ ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '\n    → ' + JSON.stringify(info) : '')); } }

/* 関数を名前で切り出す（facesheet_deviceguard_test.js と同じ作法） */
function grabFn(src, name){
  const start = src.indexOf('\nfunction ' + name + '(');
  if(start < 0) throw new Error('関数が見つかりません: ' + name);
  let depth = 0, seen = false, q = null;
  for(let i = start; i < src.length; i++){
    const c = src[i], p = src[i-1];
    if(q){ if(c === q && p !== '\\') q = null; continue; }
    if(c === "'" || c === '"'){ q = c; continue; }
    if(c === '{'){ depth++; seen = true; }
    else if(c === '}'){ depth--; if(seen && depth === 0) return src.slice(start, i + 1); }
  }
  throw new Error('関数の終わりが見つかりません: ' + name);
}
function grabVar(src, name){
  const start = src.indexOf('\nvar ' + name + '=');
  if(start < 0) throw new Error('変数が見つかりません: ' + name);
  return src.slice(start + 1, src.indexOf('\n', start + 1));
}
/* esc は1行の関数で、中の正規表現に ' があり括弧の数え方が狂うので行で切り出す */
function grabLine(src, head){
  const start = src.indexOf('\n' + head);
  if(start < 0) throw new Error('行が見つかりません: ' + head);
  return src.slice(start + 1, src.indexOf('\n', start + 1));
}
function tryGrab(fn){ try { return fn(); } catch(e){ return null; } }

/* 職員向けの文に出てはいけない語（大文字小文字を区別しない） */
const TECH = /GAS|Web App|トークン|token|JSON|Supabase|localStorage|fetch|\.js[^a-z]|TIMEOUT|undefined|null|action/i;
const LINK = '<a href="connection-settings.html">接続設定</a>';

/* ── A 設定の窓の文字 ── */
group('A 設定の窓（接続先・合言葉）の文字');
const modal = (SRC.match(/<div class="modal" id="mSync">[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/) || [''])[0];
t('A1 見出し「GAS Web App URL」が無い', modal && !/GAS Web App URL/.test(modal));
t('A2 見出し「接続先のURL（入居者マスタと共通）」がある', /<label>接続先のURL（入居者マスタと共通）<\/label>/.test(modal));
t('A3 見出し「アクセストークン」が無く「合言葉」がある', !/アクセストークン/.test(modal) && /<label>合言葉<\/label>/.test(modal));
t('A4 入力の例は「入居者マスタと同じ合言葉」', /placeholder="入居者マスタと同じ合言葉"/.test(modal) && !/同じトークン/.test(modal));
t('A5 説明は「接続先のURL・合言葉はこの端末にのみ保存します」', /接続先のURL・合言葉はこの端末にのみ保存します/.test(modal) && !/URL・トークン/.test(modal));

/* ── B 断りの文から例外の文の直出しを消した ── */
group('B 断りの文に例外の文をそのまま出さない');
t('B1 一覧の取得の失敗で e.message を出さない', !/一覧の取得に失敗: '\+e\.message/.test(SRC) && /一覧を取得できませんでした。通信の状態を確かめて/.test(SRC));
t('B2 接続テストの失敗で e.message を出さない', !/toast\('⚠️ '\+e\.message\)/.test(SRC) && /接続できませんでした。接続先のURLと合言葉が入居者マスタと同じかを確かめてください/.test(SRC));
t('B3 食形態一覧の失敗で e.message を出さない', !/取得に失敗しました: '\+\(\(e&&e\.message\)/.test(SRC));
t('B4 食形態一覧の紙の脚注に「GAS」を出さない', !/GASの一括取得/.test(SRC) && /1人ずつ取得（入居者マスタの一括取得がまだ使えません）/.test(SRC));
t('B5 接続テストで URL が空の時の文', !/toast\('URLを入力してください'\)/.test(SRC) && /接続先のURLを入力してください（入居者マスタと同じ値です）/.test(SRC));
t('B6 薬効辞書の部品の文にファイル名を出さない', !/meds-effect-dict\.js）が古いか/.test(SRC));
t('B8 接続テスト・保存の知らせに「GAS」を出さない（断る文 MASTER_WRONG_MSG は3画面で同じ文のため対象外）',
  !/入居者マスタのGASかは確かめられませんでした/.test(SRC) && !/入居者マスタのGASと確認/.test(SRC) && !/setSync\('別アプリのGAS'/.test(SRC) &&
  /入居者マスタの接続先かは確かめられませんでした/.test(SRC) && /接続できました（入居者マスタの接続先と確認）/.test(SRC));
t('B7 失敗の文は fsErrWords_ を通す（英語・技術の文は職員向けの文に替えて記録）', ['一覧の取得', '食形態一覧の取得', 'フェイスシートの取得', '薬効辞書の取得', '接続テスト'].every(w => SRC.indexOf("fsErrWords_(e,'" + w + "',") >= 0));

/* ── C 接続先が無い時の案内 ── */
group('C 接続先が無い時の案内');
const noCfgFn = tryGrab(() => grabFn(SRC, 'fsNoCfgMsg_')) || '';
const errFn = tryGrab(() => grabFn(SRC, 'fsErrWords_')) || '';
function noCfg(field, asText){ if(!noCfgFn) return ''; const b = { isField(){ return field; } }; vm.runInNewContext(noCfgFn, b); return b.fsNoCfgMsg_(asText); }
const NO_CFG = noCfg(false), NO_CFG_FIELD = noCfg(true), NO_CFG_TEXT = noCfg(false, true);
t('C1 案内の文がある（何が足りないか・どこに何を入れるか）', /入居者マスタの接続先が未設定です/.test(NO_CFG) && /「入居者マスタ・フェイスシート」に、接続先のURLと合言葉を入れてください/.test(NO_CFG), NO_CFG);
t('C2 案内に接続設定へのリンクがある', NO_CFG.indexOf(LINK) >= 0);
t('C3 案内に技術用語が無い', NO_CFG && !TECH.test(NO_CFG.replace(LINK, '')));
t('C4 一覧が空で接続先も無い時はこの案内を出す（名簿があれば今までの文）', /\(CFG\.url\?'入居者がいません。入居者マスタで登録するか「設定」で接続してください':fsNoCfgMsg_\(\)\)/.test(SRC));
t('C9 現場端末では接続設定へのリンクを出さず、事務所に知らせる文にする', NO_CFG_FIELD && NO_CFG_FIELD.indexOf('connection-settings.html') < 0 && /事務所に知らせてください/.test(NO_CFG_FIELD) && !TECH.test(NO_CFG_FIELD), NO_CFG_FIELD);
t('C10 リンクなしの文（食形態一覧の欄用）には a タグを入れない', NO_CFG_TEXT && !/<a /.test(NO_CFG_TEXT) && /接続設定のページ/.test(NO_CFG_TEXT), NO_CFG_TEXT);

/* 詳細を開く（openResident）を偽物の部品で動かす */
function runOpen(cfgUrl, rejectWith, field){
  const els = {};
  const $ = id => (els[id] = els[id] || { innerHTML: '', textContent: '' });
  const notes = [];
  const box = {
    $, CFG: { url: cfgUrl, token: '' }, openSeq: 0, fromMasterActive: false, openingFromMaster: false,
    showScreen(){}, saveOpenId(){}, setFromMasterBar(){}, setSync(){}, isField(){ return !!field; },
    fsMdEnsure_(){ return Promise.resolve(); }, renderFaceSheet(){}, fsNote_(w, e){ notes.push(w + ':' + (e && e.message)); },
    apiGet(){ return Promise.reject(rejectWith); }, curRec: null, notes, els,
  };
  vm.runInNewContext([grabLine(SRC, 'function esc('), noCfgFn, errFn, grabFn(SRC, 'openResident')].join('\n'), box);
  box.openResident('901');
  return new Promise(r => setTimeout(() => r(box), 20));
}
/* 食形態一覧（mealLoad）を接続先なしで動かす */
function runMeal(url, err){
  const msgs = [], notes = [];
  const box = { CFG: { url: url || '', token: '' }, isField(){ return false; }, fsNote_(w){ notes.push(w); }, notes, mealLoading: false, mealRows: null, mealSeq: 0, mealVia: '',
    mealSetMsg_(m){ msgs.push(m); }, paintMealBar(){}, renderRoster(){}, apiGet(){ return Promise.reject(err || new Error('x')); }, msgs };
  vm.runInNewContext([noCfgFn, errFn, grabFn(SRC, 'mealLoad')].join('\n'), box);
  box.mealLoad(false);
  return new Promise(r => setTimeout(() => r({ msgs, notes }), 20));
}
/* 薬効辞書の取得（fsMdFetch_）の失敗の文 */
function runMd(err){
  const notes = [];
  const box = { isField(){ return false; }, fsMedsFxOk_(){ return true; }, apiGet(){ return Promise.reject(err); }, apiGetRetry(){ return Promise.reject(err); },
    MedsEffect: { key(){ return ''; } }, fsNote_(w){ notes.push(w); }, notes };
  vm.runInNewContext([errFn, grabFn(SRC, 'fsMdFetch_')].join('\n'), box);
  return box.fsMdFetch_(false).then(() => ({ msg: '(成功)', notes }), e => ({ msg: String(e && e.message), notes }));
}

(async () => {
  let b = await runOpen('', new Error('x'));
  const v0 = b.els.viewBox.innerHTML;
  t('C5 接続先なしで詳細を開くと、案内とリンクを出す', v0.indexOf(LINK) >= 0 && /接続先が未設定です/.test(v0), v0);
  t('C6 「「設定」で接続URLを入力してください」だけの文は出さない', !/「設定」で接続URLを入力してください/.test(SRC));
  const meal = await runMeal();
  const m0 = meal.msgs[0] || '';
  t('C7 接続先なしで食形態一覧を開くと、何が足りないか・どこに何を入れるかを出す', /入居者マスタの接続先が未設定です/.test(m0) && /接続設定のページの「入居者マスタ・フェイスシート」に、接続先のURLと合言葉を入れてください/.test(m0), m0);
  t('C8 その文に技術用語が無い', m0 && !TECH.test(m0), m0);
  b = await runOpen('', new Error('x'), true);
  const vf = b.els.viewBox.innerHTML;
  t('C11 現場端末で接続先なしで詳細を開くと、リンクなしで事務所に知らせる文', vf.indexOf('connection-settings.html') < 0 && /事務所に知らせてください/.test(vf), vf);

  group('D 詳細の取得の失敗');
  b = await runOpen('https://example.invalid/x', new Error('Failed to fetch'));
  const v1 = b.els.viewBox.innerHTML;
  t('D1 通信の失敗では英語の例外文を出さず、職員向けの文を出す', !/Failed/.test(v1) && /取得できませんでした。通信の状態を確かめて/.test(v1), v1);
  t('D2 通信の失敗（圏外）は記録に流さない（自動の不具合報告を増やさない）', b.notes.length === 0, b.notes);
  b = await runOpen('https://example.invalid/x', new Error('Unexpected token < in JSON at position 0'));
  t('D2b 通信でない英語の失敗は職員向けの文に替え、元の文を記録に残す', !/Unexpected/.test(b.els.viewBox.innerHTML) && b.notes.some(n => /フェイスシートの取得:Unexpected token/.test(n)), b.notes);
  b = await runOpen('https://example.invalid/x', new Error('該当データなし'));
  const v2 = b.els.viewBox.innerHTML;
  t('D3 記録が無い時は「この方の記録が見つかりませんでした」', /この方の記録が見つかりませんでした/.test(v2), v2);
  t('D4 記録が無いのは失敗ではないので記録（自動の不具合報告に流れる）に残さない', b.notes.length === 0, b.notes);
  const SIGNED_OUT = 'この端末はログインしていません。ログインしてから開いてください。';
  b = await runOpen('https://example.invalid/x', new Error(SIGNED_OUT));
  const v3 = b.els.viewBox.innerHTML;
  t('D5 日本語だけの断り（ログインしていない）はそのまま出す', v3.indexOf(SIGNED_OUT) >= 0 && !/通信の状態を確かめて/.test(v3), v3);
  t('D6 日本語だけの断りは障害ではないので記録しない', b.notes.length === 0, b.notes);
  const ms = await runMeal('https://example.invalid/x', new Error(SIGNED_OUT));
  t('D7 食形態一覧でも日本語だけの断りはそのまま出して記録しない', ms.msgs.indexOf(SIGNED_OUT) >= 0 && ms.notes.length === 0, ms);
  const mf = await runMeal('https://example.invalid/x', new Error('Failed to fetch'));
  t('D8 食形態一覧で通信の失敗は職員向けの文に替え、記録に流さない', mf.msgs.some(m => /取得できませんでした。通信の状態を確かめて/.test(m)) && !mf.msgs.some(m => /Failed/.test(m)) && mf.notes.length === 0, mf);
  const mf2 = await runMeal('https://example.invalid/x', new Error('Unexpected token < in JSON at position 0'));
  t('D8b 食形態一覧で通信でない英語の失敗は記録に残す', mf2.notes.indexOf('食形態一覧の取得') >= 0 && !mf2.msgs.some(m => /Unexpected/.test(m)), mf2);

  group('E 薬効辞書の取得の失敗');
  const e1 = await runMd(new Error('TIMEOUT'));
  t('E1 通信の失敗の文に元の例外文を混ぜない', !TECH.test(e1.msg) && /薬効辞書を取得できませんでした。/.test(e1.msg), e1.msg);
  t('E2 時間切れは記録に流さない', e1.notes.length === 0, e1.notes);
  const e2 = await runMd(new Error('不明なaction: getMedDict'));
  t('E3 受け口が古い時の文に「GAS」を出さず、管理者へ知らせるよう書く', !TECH.test(e2.msg) && /管理者へ知らせてください/.test(e2.msg), e2.msg);
  const e3 = await runMd(new Error(SIGNED_OUT));
  t('E4 日本語だけの断りはそのまま出して記録しない', e3.msg === SIGNED_OUT && e3.notes.length === 0, e3);
  const e4 = await runMd(new Error('NO_URL'));
  t('E5 接続先なし（NO_URL）は記録しない', e4.notes.length === 0 && !/NO_URL/.test(e4.msg), e4);

  group('F 一覧のカードは本物のボタン');
  const rb = {};
  let card = '';
  try {
    vm.runInNewContext([grabLine(SRC, 'function esc('), grabFn(SRC, 'fmtJDate'), 'var weightIdx={};function isField(){return false}', grabFn(SRC, 'rcardHtml')].join('\n'), rb);
    card = rb.rcardHtml({ masterId: '901', name: '架空A', kana: 'かくう', room: '101', careLevel: '要介護1', active: true });
  } catch(e){ card = 'ERR ' + e.message; }
  t('F1 カードは <button type="button" class="rcard">', /^<button type="button" class="rcard" /.test(card), card.slice(0, 80));
  t('F2 role="button" の div を作らない', !/<div class="rcard"/.test(SRC) && !/class="rcard" role="button"/.test(SRC));
  t('F3 ボタンの中に div を置かない', card && !/<div/.test(card), card);
  t('F4 読み上げの名前を残す', /aria-label="架空A　101号室 のフェイスシートを開く"/.test(card), card);
  t('F5 ボタンの既定の見た目を打ち消す（文字・行の高さ・左寄せ・幅・上から積む）',
    /button\.rcard\{display:flex; flex-direction:column;[^}]*width:100%;[^}]*font:inherit;[^}]*line-height:inherit;[^}]*text-align:left;/.test(SRC));
  const rr = tryGrab(() => grabFn(SRC, 'renderRoster')) || '';
  t('F6 自前の keydown で開かない（ボタンの Enter・Space と2回開かない）', rr && !/addEventListener\('keydown'/.test(rr));

  say('\n合格 ' + ok + ' / 不合格 ' + ng);
  process.exit(ng ? 1 : 0);
})().catch(e => { say('例外: ' + (e && e.stack)); process.exit(1); });
