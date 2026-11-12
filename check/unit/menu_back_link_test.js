/* 見出しの「← メニュー」の試験（2026-11-12 代表者の決定・反証レビュー）
   実行: node check/unit/menu_back_link_test.js
   守ること:
     1. 15画面の見出しに、メニュー（index.html）へ戻るリンク .su-menu-back がちょうど1本ある
     2. どの画面も印刷では .su-menu-back を消す（@media print）
     3. 左右比較は、枠の中の訪問俯瞰・全支援俯瞰で .su-menu-row と .su-menu-back を隠す（tidyPane）
     4. 保存していない入力がある4画面（入居者マスタ・職員マスタ・担当者会議・入居調整）は、リンクを押した時に既存の判定で確かめ、
        「いいえ」なら移らない・「はい」なら直後の beforeunload で二重に聞かない（iOS Safari は beforeunload の確かめを出さないため）
   画面のコードは書き換えず、ソースを読んで切り出して動かすだけ。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
/* 職員マスタの画面のスクリプトは 2026-11-12 に staff-master.js へ移した。読み込みの札をその中身に戻し、移す前と同じ文字で確かめる */
const stfmPage_ = (h) => h.replace(/<script src="staff-master\.js\?v=[^"]*"><\/script>/, () => '<script>\n' + fs.readFileSync(path.join(__dirname, '..', '..', 'staff-master.js'), 'utf8') + '</script>');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
/* start の位置から始まる { … } の塊を、対応する } まで切り出す（文字列・コメントの中の括弧は数えない簡易版） */
function block(src, start) {
  const i = src.indexOf('{', start);
  let d = 0, q = null;
  for (let k = i; k < src.length; k++) {
    const c = src[k];
    if (q) { if (c === '\\') { k++; continue; } if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '/' && src[k + 1] === '*') { k = src.indexOf('*/', k + 2) + 1; continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) return src.slice(start, k + 1); }
  }
  return '';
}
function cutF(src, name) {
  const i = src.search(new RegExp('function ' + name + '\\s*\\('));
  return i < 0 ? '' : block(src, i);
}
/* 押した時の動きを、架空の判定と confirm で動かす */
function clickRun(code, ctx, ans, target) {
  const ev = { prevented: false, preventDefault() { this.prevented = true; }, target };
  let asked = 0;
  const c = Object.assign({ confirm: () => { asked++; return ans; }, setTimeout: () => 0 }, ctx);
  vm.createContext(c);
  vm.runInContext(code, c);
  c.__click(ev);
  return { prevented: ev.prevented, asked, ctx: c };
}
const link = (cls) => ({ closest: (sel) => (sel.split(',').some((s) => s.trim() === 'a.su-menu-back') && cls === 'su-menu-back') || (sel.indexOf('resident-master.html') >= 0 && cls === 'master') ? { classList: { contains: (x) => x === cls } } : null });

const PAGES = ['resident-master.html', 'facesheet.html', 'genogram.html', 'weight-record.html', 'care-meeting.html', 'care-schedule.html',
  'visit-overview.html', 'support-overview.html', 'overview-compare.html', 'daycare-roster.html', 'supplies.html', 'staff-master.html',
  'shift-analyzer.html', 'admission-flow.html', 'training-plan.html'];

console.log('1・2 15画面のリンクと印刷');
for (const f of PAGES) {
  const s = read(f).replace(/<!--[\s\S]*?-->/g, '');
  const links = [...s.matchAll(/<a\s+class="[^"]*\bsu-menu-back\b[^"]*"\s+href="index\.html">← メニュー<\/a>/g)];
  t(f + ': 「← メニュー」が index.html へ1本', links.length === 1, links.length);
  t(f + ': 印刷では消す', /@media print\{\.su-menu-back\{display:none !important\}\}/.test(s), '');
}

console.log('3 左右比較の枠の中');
{
  const oc = read('overview-compare.html');
  const tidy = cutF(oc, 'tidyPane');
  t('tidyPane が .su-menu-row と .su-menu-back を隠す', /querySelectorAll\('\.su-menu-row, \.su-menu-back'\)/.test(tidy) && /\.style\.display = 'none'/.test(tidy), '');
}

console.log('4 保存していない入力がある4画面');
const Q = '保存していない変更があります。メニューへ移ると消えます。移りますか？';
{ // 入居者マスタ
  const s = read('resident-master.html');
  const i = s.indexOf("document.addEventListener('click',function(e){\n  var a=e.target&&e.target.closest?e.target.closest('a.su-menu-back')");
  const on = i >= 0 ? s.slice(i, i + block(s, i).length + 2) : '';
  t('入居者マスタ: 受け口がある', !!on, '');
  t('入居者マスタ: 判定は beforeunload と同じ条件＋覆いの確かめ（rmGateDirty_）', /return rmGateDirty_\(\);/.test(cutF(s, 'rmMenuLeaveDirty_')) && /editDirty_\(\)/.test(cutF(s, 'rmMenuLeaveDirty_')), '');
  const code = 'var rmMenuLeaveOk_=false; var __h; var document={addEventListener:function(n,f){ __h=f; }};' + on.replace(/^document\.addEventListener\('click',/, 'document.addEventListener(\'click\',') + ' function __click(e){ __h(e); }';
  const no = clickRun(code, { rmMenuLeaveDirty_: () => true }, false, link('su-menu-back'));
  t('入居者マスタ: 保存していない時「いいえ」で移らない', no.prevented && no.asked === 1 && no.ctx.rmMenuLeaveOk_ === false, no);
  const yes = clickRun(code, { rmMenuLeaveDirty_: () => true }, true, link('su-menu-back'));
  t('入居者マスタ: 「はい」で移り、beforeunload に二重に聞かない印を立てる', !yes.prevented && yes.ctx.rmMenuLeaveOk_ === true, yes);
  const clean = clickRun(code, { rmMenuLeaveDirty_: () => false }, false, link('su-menu-back'));
  t('入居者マスタ: 変更が無ければ聞かない', !clean.prevented && clean.asked === 0, clean);
  t('入居者マスタ: 文言', on.indexOf(Q) >= 0, '');
  t('入居者マスタ: beforeunload は印が立っていれば聞かない', /window\.addEventListener\('beforeunload',function\(e\)\{\n  if\(rmMenuLeaveOk_\) return;/.test(s), '');
}
{ // 職員マスタ
  const s = stfmPage_(read('staff-master.html'));
  const i = s.indexOf("document.addEventListener('click', function (e) {\n    var a = e.target && e.target.closest ? e.target.closest('a.su-menu-back')");
  const on = i >= 0 ? s.slice(i, i + block(s, i).length + 2) : '';
  t('職員マスタ: 受け口がある・既存の判定（hasUnsaved）を呼ぶ', !!on && /hasUnsaved\(\)/.test(on), '');
  const code = 'var smMenuLeaveOk_=false; var __h; var document={addEventListener:function(n,f){ __h=f; }};' + on + ' function __click(e){ __h(e); }';
  const no = clickRun(code, { hasUnsaved: () => true }, false, link('su-menu-back'));
  t('職員マスタ: 保存していない時「いいえ」で移らない', no.prevented && no.asked === 1, no);
  const yes = clickRun(code, { hasUnsaved: () => true }, true, link('su-menu-back'));
  t('職員マスタ: 「はい」で移り印を立てる', !yes.prevented && yes.ctx.smMenuLeaveOk_ === true, yes);
  const clean = clickRun(code, { hasUnsaved: () => false }, false, link('su-menu-back'));
  t('職員マスタ: 変更が無ければ聞かない', !clean.prevented && clean.asked === 0, clean);
  t('職員マスタ: beforeunload は印が立っていれば聞かない', /if \(smMenuLeaveOk_\) return;\n    if \(!hasUnsaved\(\)\) return;/.test(s), '');
}
{ // 担当者会議
  const s = read('care-meeting.html');
  const code = 'var cmLeaveOk_=false;' + cutF(s, 'cmLeaveDirty_') + cutF(s, 'onHdrLeaveClick_') + cutF(s, 'onBeforeUnload_') + ' function __click(e){ onHdrLeaveClick_(e); }';
  const dirtyCtx = { isDirty_: () => true, ed: {}, impSt: null };
  const no = clickRun(code, dirtyCtx, false, link('su-menu-back'));
  t('担当者会議: 保存していない時「いいえ」で移らない', no.prevented && no.asked === 1, no);
  const yes = clickRun(code, dirtyCtx, true, link('su-menu-back'));
  const bu = { prevented: false, preventDefault() { this.prevented = true; } };
  yes.ctx.onBeforeUnload_(bu);
  t('担当者会議: 「はい」で移り、直後の beforeunload では止めない', !yes.prevented && yes.ctx.cmLeaveOk_ === true && !bu.prevented, { yes, bu });
  const m = clickRun(code, dirtyCtx, false, link('master'));
  t('担当者会議: 「← 入居者マスタ」でも確かめる', m.prevented && m.asked === 1, m);
  const clean = clickRun(code, { isDirty_: () => false, ed: null, impSt: null }, false, link('su-menu-back'));
  t('担当者会議: 変更が無ければ聞かない', !clean.prevented && clean.asked === 0, clean);
  t('担当者会議: 見出しに受け口を付ける', /hdrEl\.addEventListener\('click',onHdrLeaveClick_\)/.test(cutF(s, 'bindEvents_')), '');
}
{ // 入居調整
  const s = read('admission-flow.html');
  const i = s.indexOf("document.addEventListener('click', function (e) {\n  var a = e.target && e.target.closest ? e.target.closest('a.su-menu-back')");
  const on = i >= 0 ? s.slice(i, i + block(s, i).length + 2) : '';
  t('入居調整: 受け口がある・既存の判定（editing && editDirty）を使う', !!on && /editing && editDirty/.test(on), '');
  const code = 'var afMenuLeaveOk_=false; var __h; var document={addEventListener:function(n,f){ __h=f; }};' + on + ' function __click(e){ __h(e); }';
  const no = clickRun(code, { editing: {}, editDirty: true }, false, link('su-menu-back'));
  t('入居調整: 保存していない時「いいえ」で移らない', no.prevented && no.asked === 1, no);
  const yes = clickRun(code, { editing: {}, editDirty: true }, true, link('su-menu-back'));
  t('入居調整: 「はい」で移り印を立てる', !yes.prevented && yes.ctx.afMenuLeaveOk_ === true, yes);
  const clean = clickRun(code, { editing: null, editDirty: false }, false, link('su-menu-back'));
  t('入居調整: 変更が無ければ聞かない', !clean.prevented && clean.asked === 0, clean);
  t('入居調整: beforeunload は閉じる直前の送信を続け、印が立っていれば編集中の確かめだけ省く',
    /flushOnExit\(\);\n[^\n]*\n  if \(editing && editDirty && !afMenuLeaveOk_\)/.test(s) && /if \(dirty && afBeaconLost_\)/.test(s), '');
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
