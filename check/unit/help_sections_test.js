/* 使い方の頁の「画面ごとの使い方」（2026-11-13 代表者の指示）と、?sec=<画面> で節へ飛ぶ部品（help-sec.js）の試験。
 * 確かめること:
 *   A 画面ごとの節（週間計画・ワークスケジュール・入居者マスタ・体重管理と、2026-11-13 に足した「使い方」を持つ残りの業務画面・接続設定）があり、
 *     それぞれ「できること」と困りごとが3つ以上ある。目次から全部の節へ飛べる。見出しは焦点を当てられる（tabindex="-1"）。「はじめて使う時」はいちばん上のまま
 *   B help-sec.js の対応表の値が、節の見出しの id と一致する（足し忘れ・余りが無い）。help.html は同じサイトの部品として読む（画面の中のスクリプトは増やさない）。
 *     公開の許可リストに部品がある
 *   C 決まった値の時だけ、その見出しへスクロールして焦点を当てる。決まっていない値・壊れた値・タグ入りの値では何もしない
 *     （画面に書かない・innerHTML・console を使わない）
 *   D 新しい節に電話番号らしい数字の並び・tel: のリンクが無い
 * 架空データだけを使う。実行: node check/unit/help_sections_test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const H = read('help.html');
const J = read('help-sec.js');
let ok = 0, ng = 0;
function t(name, cond, info) { if (cond) { ok++; console.log('  ✓ ' + name); } else { ng++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

const SCREENS = [
  ['care-schedule', 'h-care-schedule', '週間計画'],
  ['work-schedule', 'h-work-schedule', 'ワークスケジュール'],
  ['shift-app', 'h-shift-app', 'シフト作成'],
  ['shift-analyzer', 'h-shift-analyzer', '過去シフト分析'],
  ['resident-master', 'h-resident-master', '入居者マスタ'],
  ['weight-record', 'h-weight-record', '体重管理'],
  ['facesheet', 'h-facesheet', 'フェイスシート'],
  ['genogram', 'h-genogram', '家族構成図（ジェノグラム）'],
  ['patch-calendar', 'h-patch-calendar', '貼り薬カレンダー'],
  ['moushiokuri-viewer', 'h-moushiokuri-viewer', '申送ビューア'],
  ['admission-flow', 'h-admission-flow', '入居調整'],
  ['care-meeting', 'h-care-meeting', '担当者会議の記録'],
  ['supplies', 'h-supplies', '消耗品管理'],
  ['equip-log', 'h-equip-log', '設備・修繕の記録'],
  ['visit-overview', 'h-visit-overview', '訪問 週間俯瞰'],
  ['support-overview', 'h-support-overview', '全支援 週間俯瞰'],
  ['overview-compare', 'h-overview-compare', '訪問／全支援 左右比較'],
  ['daycare-roster', 'h-daycare-roster', 'デイ利用表'],
  ['training-plan', 'h-training-plan', '個別機能訓練計画書'],
  ['staff-master', 'h-staff-master', '職員マスタ'],
  ['ats', 'h-ats', '採用管理'],
  ['connection-settings', 'h-connection-settings', '接続設定'],
  ['accounts', 'h-accounts', '使える人の管理'],
  ['app-access', 'h-app-access', 'アプリの使える人'],
  ['menu-settings', 'h-menu-settings', 'メニューの設定'],
  ['shadow-check', 'h-shadow-check', '写しの見比べ'],
  ['unsent', 'h-unsent', '未送信の一覧']
];

console.log('\n— A. 画面ごとの節 —');
for (const [, hid, name] of SCREENS) {
  const at = H.indexOf('<h2 id="' + hid + '" tabindex="-1">' + name + '</h2>');
  const end = H.indexOf('</section>', at);
  const sec = at >= 0 ? H.slice(at, end) : '';
  t(name + ': 節の見出しがあり、焦点を当てられる', at > 0);
  t(name + ': 「できること」と「よくある困りごと」がある', /<strong>できること<\/strong>/.test(sec) && /<strong>よくある困りごと<\/strong>/.test(sec));
  t(name + ': 困りごとが3つ以上（見出しと対処の組）', (sec.match(/<dt>/g) || []).length >= 3 && (sec.match(/<dt>/g) || []).length === (sec.match(/<dd>/g) || []).length);
  t(name + ': 目次から節へ飛べる', H.indexOf('<a href="#' + hid + '">' + name + '</a>') > 0);
}
const s = H.indexOf('id="h-start"'), toc = H.indexOf('id="h-screens"'), tr = H.indexOf('id="h-trouble"');
{
  const secIds = [...H.matchAll(/<section class="cd" id="sec-([a-z-]+)"/g)].map((m) => m[1]);
  t('画面ごとの節は全部この試験の一覧にある（足した節が確かめから漏れない）', JSON.stringify(secIds) === JSON.stringify(SCREENS.map(([k]) => k)), secIds);
}
t('「はじめて使う時」はいちばん上のまま（目次はその下）', s > 0 && toc > s && tr > toc, [s, toc, tr]);
t('応募者向けの欄（#privacy）はそのまま残っている', /<section class="cd" id="privacy" aria-labelledby="h-privacy">/.test(H));

console.log('\n— B. 対応表と読み込み —');
const mapSrc = (/var SEC = (\{[\s\S]*?\});/.exec(J) || [])[1] || '{}';
const MAP = vm.runInNewContext('(' + mapSrc + ')', {});
t('対応表は節のある画面の値だけで、節の見出しの id と一致する', JSON.stringify(MAP) === JSON.stringify(Object.fromEntries(SCREENS.map(([k, h]) => [k, h]))), MAP);
t('help.html は同じサイトの部品として読む（?v= 付き）', /<script src="help-sec\.js\?v=[0-9.-]+"><\/script>/.test(H));
t('公開の許可リストに部品がある', /^!\/help-sec\.js$/m.test(read('.gitignore')));
t('部品は innerHTML・document.write・console を使わない', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write|console\./.test(J));

console.log('\n— C. ?sec= の動き —');
function run(search, readyState) {
  const calls = [];
  const heads = {};
  for (const [, hid] of SCREENS) {
    heads[hid] = {
      id: hid,
      scrollIntoView(o) { calls.push(['scroll', hid, o]); },
      focus(o) { calls.push(['focus', hid, o]); },
      set textContent(v) { calls.push(['write', hid]); },
      set innerHTML(v) { calls.push(['write', hid]); }
    };
  }
  let ready = null;
  const doc = {
    readyState: readyState || 'complete',
    getElementById(id) { calls.push(['get', id]); return Object.prototype.hasOwnProperty.call(heads, id) ? heads[id] : null; },
    addEventListener(ev, fn) { if (ev === 'DOMContentLoaded') ready = fn; },
    createElement() { calls.push(['create']); return {}; },
    write() { calls.push(['write']); }
  };
  const box = { window: { location: { search } }, document: doc, String, Object };
  box.window.document = doc;
  vm.createContext(box);
  let err = null;
  try { vm.runInContext(J, box); if (ready) ready(); } catch (e) { err = e.message; }
  return { calls, err };
}
for (const [k, hid] of SCREENS) {
  const r = run('?sec=' + k);
  const sc = r.calls.find((c) => c[0] === 'scroll'), fo = r.calls.find((c) => c[0] === 'focus');
  t('?sec=' + k + ' → ' + hid + ' へスクロールして焦点を当てる', !r.err && sc && sc[1] === hid && fo && fo[1] === hid && fo[2] && fo[2].preventScroll === true, r);
}
{
  const r = run('?x=1&sec=weight-record&y=2');
  t('ほかの値と並んでいても受ける', !r.err && r.calls.some((c) => c[0] === 'focus' && c[1] === 'h-weight-record'), r);
  const r2 = run('?sec=resident-master', 'loading');
  t('読み込み中なら、組み立て終わってから動く', !r2.err && r2.calls.some((c) => c[0] === 'focus' && c[1] === 'h-resident-master'), r2);
}
const BAD = ['', '?sec=', '?sec=unknown', '?sec=Care-Schedule', '?sec=care-schedulex', '?sec=care-schedule%3Cimg', '?sec=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E',
  '?sec=<img src=x onerror=alert(1)>', '?sec=h-care-schedule', '?sec=privacy', '?sec=__proto__', '?sec=constructor', '?sec=hasOwnProperty', '?section=care-schedule', '?xsec=care-schedule'];
for (const q of BAD) {
  const r = run(q);
  t('決まっていない値 ' + JSON.stringify(q) + ' では何もしない（見出しを探しもしない）', !r.err && r.calls.length === 0, r);
}
{
  /* 見出しが無い時（節を消した版など）も例外を出さない */
  const box = { window: { location: { search: '?sec=care-schedule' } }, document: { readyState: 'complete', getElementById() { return null; }, addEventListener() {} }, String, Object };
  vm.createContext(box);
  let err = null; try { vm.runInContext(J, box); } catch (e) { err = e.message; }
  t('見出しが見つからない時も止まらない', err === null, err);
}

console.log('\n— D. 連絡先を書かない —');
const a = H.indexOf('id="h-screens"'), b = H.indexOf('<!-- 応募者向けの個人情報の取り扱い');
const NEW = H.slice(a, b);
t('新しい節に電話番号らしい数字の並び・tel: が無い', a > 0 && b > a && !/\d{2,5}-\d{1,4}-\d{3,4}/.test(NEW) && !/tel:/i.test(NEW));

console.log('\n結果: 成功 ' + ok + ' / 失敗 ' + ng);
process.exit(ng ? 1 : 0);
