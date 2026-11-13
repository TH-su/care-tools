/* 職員マスタ（staff-master.html）：職員に見える文から技術用語を減らす（品質改善 第3期 便5）。
   実物の HTML を読み、変えた文ごとに「前の技術用語が無い」「新しい文がある」を確かめる。
   原因の文（errText）と古い版の時の案内（corpWhy）は、実物の関数を切り出して動かす（写経しない）。
   接続先が無い時の案内は前からあり（設定画面へ案内する）、ここでは技術用語が無いことだけを見る。
   対象 HTML は環境変数 STAFF_HTML で差し替えられる（直す前の版で落ちることを確かめるため）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = process.env.STAFF_HTML || path.join(__dirname, '..', '..', 'staff-master.html');
/* 職員マスタの画面のスクリプトは 2026-11-12 に staff-master.js へ移した。読み込みの札をその中身に戻し、移す前と同じ文字で確かめる */
const stfmPage_ = (h) => h.replace(/<script src="staff-master\.js\?v=[^"]*"><\/script>/, () => '<script>\n' + fs.readFileSync(path.join(__dirname, '..', '..', 'staff-master.js'), 'utf8') + '</script>');
const src = process.env.STAFF_HTML ? fs.readFileSync(HTML, 'utf8') : stfmPage_(fs.readFileSync(HTML, 'utf8'));

let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
const has = (s) => src.indexOf(s) >= 0;

/* 関数を名前で切り出す */
function cut(name) {
  const head = src.indexOf('function ' + name + '(');
  if (head < 0) return null;
  let i = src.indexOf('{', head), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(head, i + 1); }
  }
  return null;
}
/* 1行の var を切り出す */
function cutVar(name) {
  const m = src.match(new RegExp('var ' + name + ' = [^\\n]*;'));
  return m ? m[0] : null;
}
const OLD_VER = '職員マスタの Google の受け口が古い版のため';

console.log('— 1. 設定の接続先の文 —');
t('1-1 接続先URLの見出しに GAS が無い', !has('接続先URL（職員マスタGASの /exec）'));
t('1-2 接続先URLの見出しは「職員マスタの Google の受け口の URL」', has('<label for="cfgUrl">接続先URL（職員マスタの Google の受け口の URL）</label>'));
t('1-3 URL の形が違う時の文に GAS が無い', !has('https:// で始まる GAS の /exec のURL'));
t('1-4 URL の形が違う時の文は「職員マスタの Google の受け口の URL」', has("'https:// で始まる、職員マスタの Google の受け口の URL（終わりが /exec）を貼り付けてください。'"));

console.log('— 2. 通信の失敗の文 —');
t('2-1 応答の失敗に「HTTP」の語を出さない', !/mkErr\('[^']*HTTP/.test(src));
t('2-2 応答の失敗は「応答の番号」（保存と接続テストの2か所）', (src.match(/mkErr\('サーバーが応答しませんでした（応答の番号 ' \+ res\.status \+ '）'/g) || []).length === 2);
t('2-3 応答を読めない時の案内に「職員マスタGAS」が無い', !has('職員マスタGASの /exec'));
t('2-4 応答を読めない時の案内は Google の受け口', has("'設定の接続先URLが、職員マスタの Google の受け口の URL（終わりが /exec）になっているか確かめてください。'"));
t('2-5 接続テストの失敗の案内に「GAS側」が無い', !has('GAS側の公開設定'));
t('2-6 接続テストの失敗の案内は管理者に公開設定を確かめてもらう', has("'接続先URLを確かめてください。続く時は管理者に、Google の受け口の公開設定を確かめてもらってください。'"));
t('2-7 接続テストで応答が読めない時の案内に GAS が無く、公開設定は管理者に頼む', !has('URLが職員マスタGASの /exec か') && has('続く時は管理者に、受け口の公開設定が「全員」になっているか確かめてもらってください。'));
t('2-8 接続テストで応答が無い時の案内は管理者から受け取った URL と見比べる', !has("'URLの末尾が /exec になっているか確かめてください。'") && has("'接続先URLが、管理者から受け取った職員マスタの Google の受け口の URL（終わりが /exec）か確かめてください。'"));

console.log('— 3. 古い版の時の案内（GAS・setup を出さない） —');
t('3-1 「GAS を更新」「setup を実行」の文が無い', !/'[^'\n]*GAS を更新[^'\n]*'/.test(src) && !/'[^'\n]*setup を実行[^'\n]*'/.test(src));
t('3-2 兼務比率の案内は管理者へ知らせる', has("'" + OLD_VER + '、兼務比率はまだ保存できません。管理者へ知らせてください\''));
t('3-3 書類・選択肢のボタンの案内（2か所）', (src.match(new RegExp("why = '" + OLD_VER + "、まだ使えません。管理者へ知らせてください';", 'g')) || []).length === 2);
t('3-4 委員会の案内（CMT_NO_CAPS_MSG）', cutVar('CMT_NO_CAPS_MSG') === "var CMT_NO_CAPS_MSG = '" + OLD_VER + "、委員会はまだ保存できません。管理者へ知らせてください';", cutVar('CMT_NO_CAPS_MSG'));
t('3-5 一覧が受け取れない時の文に「GAS の版」が無い', !has('GAS の版を確かめ') && has('続く時は、職員マスタの Google の受け口の版を確かめるよう管理者へ知らせてください。'));
t('3-6 法人設定が読めない時の文に「GAS の版」が無い', !has('職員マスタの GAS の版') && has("'接続先と合言葉を確かめてください。続く時は、職員マスタの Google の受け口の版を確かめるよう管理者へ知らせてください。いまは既定のまま動いています。'"));
{
  const fn = cut('corpWhy');
  const sb = { txt: (v) => (v === undefined || v === null ? '' : String(v)),
    URL_OK_RE: /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/,
    cfg: { url: 'https://script.google.com/macros/s/AKfyTEST/exec', token: 'x' }, ST: { caps: ['enums'] }, CORP: { loaded: false, busy: false } };
  sb.loadCfg = () => sb.cfg;
  sb.SC = () => ({ setCorp: function () {} });
  sb.capsHas = (n) => !!(sb.ST.caps && sb.ST.caps.indexOf(n) >= 0);
  vm.createContext(sb);
  let msg = '';
  try { vm.runInContext(fn, sb); msg = sb.corpWhy(); } catch (e) { msg = 'ERR ' + e.message; }
  t('3-7 法人設定（古い版）: GAS の語が無く、管理者へ知らせる・既定のまま動いていると伝える（実物の corpWhy）',
    !/GAS|setup/.test(msg) && /Google の受け口を新しい版に替えると/.test(msg) && /管理者へ知らせて/.test(msg) && /既定のまま/.test(msg), msg);
  sb.ST.caps = ['enums', 'corp'];
  sb.SC = () => ({});
  try { msg = sb.corpWhy(); } catch (e) { msg = 'ERR ' + e.message; }
  t('3-8 法人設定（画面の部品が古い）: ファイル名を出さない（実物の corpWhy）', !/staff-master-calc|\.js/.test(msg) && /画面の部品が古い版のままです/.test(msg), msg);
}

t('3-9 通称の案内（CMT_ALIAS_NO_CAPS_MSG）は職員向けの1文で、受け口・配備の語を出さない（2026-11-13 第6段 SM-03）',
  cutVar('CMT_ALIAS_NO_CAPS_MSG') === "var CMT_ALIAS_NO_CAPS_MSG = 'まだ準備ができていません。管理者に伝えてください。';"
  && !has('職員マスタAPI') && !has('配備の後に使えます'), cutVar('CMT_ALIAS_NO_CAPS_MSG'));

console.log('— 4. 画面の部品（計算の部品）が無い・古い時の文 —');
t('4-1 起動時の止めにファイル名・「計算モジュール」が無い', !has('<p><b>計算モジュールを読み込めませんでした</b></p>') && !has('staff-master-calc.js が同じフォルダにあるか'));
t('4-2 起動時の止めは「画面の部品を読み込めませんでした」と次にすること', has('<p><b>画面の部品を読み込めませんでした</b></p>') && has('<p class="sub">通信の状態を確かめて、この画面を再読み込みしてください。<br>続く時は管理者へ知らせてください。</p>'));
t('4-3 委員会の画面の知らせに「計算モジュール」・ファイル名が無い', !has("'計算モジュールが委員会に対応していません'") && has("'画面の部品が委員会に対応していません'") && !/'staff-master-calc\.js を新しい版/.test(src));

console.log('— 5. 書類の削除の文（Drive → Google ドライブ） —');
t('5-1 確かめの窓に「Drive の」が無く「Google ドライブの」', !has('\\nDrive の「削除済み」') && has('Google ドライブの「削除済み」フォルダへ移動します。元に戻す時は Google ドライブで戻せます。'));
t('5-2 一部だけ外せた時の文', !has("' Drive 側は手で移してください'") && has("' Google ドライブ側は手で移してください'"));
t('5-3 削除できた時の文', !has('を一覧から外しました。Drive の') && has('を一覧から外しました。Google ドライブの「削除済み」フォルダに残っています。'));

console.log('— 6. 原因の文に英語の例外文を出さない（実物の errText を動かす） —');
{
  const notes = [];
  const sb = { txt: (v) => (v === undefined || v === null ? '' : String(v)), window: {} };
  sb.window.SUErrors = { note: (k, m, w) => notes.push([k, m, w]) };
  vm.createContext(sb);
  let ok = true, why = '';
  try {
    vm.runInContext([cutVar('ERR_SCREEN_MSG') || '', cut('stfmNote_') || '', cut('mkErr'), cut('errText')].join('\n'), sb);
  } catch (e) { ok = false; why = e.message; }
  t('6-1 関数を切り出せた', ok && typeof sb.errText === 'function', why);
  if (ok && typeof sb.errText === 'function') {
    const raw = new TypeError("Cannot read properties of undefined (reading 'x')");
    const a = sb.errText(raw), b = sb.errText(raw);
    t('6-2 例外の英語の文を出さない', a.indexOf('Cannot read') < 0 && a.indexOf('undefined') < 0, a);
    t('6-3 職員向けの一文に替える', a === '画面の処理がうまくいきませんでした', a);
    t('6-4 元の例外は記録に1回だけ残す（2回目は残さない）', notes.length === 1 && notes[0][1] === raw && b === a, notes.length);
    const se = sb.mkErr('通信に失敗しました', 'x');
    const n0 = notes.length;
    t('6-5 画面が組んだ文（通信の失敗など）はそのまま出し、記録に流さない', sb.errText(se) === '通信に失敗しました' && notes.length === n0);
    t('6-6 サーバーの断りの文（確定不明など）はそのまま（文で判定している所を壊さない）',
      sb.errText(sb.mkErr('保存を確定できたか確かめられませんでした。画面を開き直して、保存されているか確かめてください')) === '保存を確定できたか確かめられませんでした。画面を開き直して、保存されているか確かめてください');
    t('6-7 何も無い時は空', sb.errText(undefined) === '' && notes.length === n0);
  }
}

console.log('— 7. 変えていないもの —');
t('7-1 FLUSH_FAIL_MSG は1文字も変えていない', has("var FLUSH_FAIL_MSG = '保存を確定できたか確かめられませんでした。画面を開き直して、保存されているか確かめてください';"));
t('7-2 接続先が無い時の案内（一覧）は前のまま', has("setState('listState', 'warn', '接続先が未設定です', '右上の歯車（設定）で、接続先URLと合言葉を入れて保存してください。', '設定を開く'"));
t('7-3 通信の形（POST 本文・redirect）は前のまま', has("var opt = { method: 'POST', body: JSON.stringify(p), redirect: 'follow' };"));

console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
