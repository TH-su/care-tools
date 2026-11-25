/* 勤怠の段B（2026-11-25・ROOT-v7-plus-parity.md「段B」・care-backend 統合 0130）の試験。架空の値だけを使う。
   1. お知らせの入力の確かめ（文の長さ・制御文字・期間・事業所）と言い方
   2. 補助項目の申請の送る形（kintai-extras.js と同じ値の決まり）・選択肢の読み方・値の言い方・断りの文（データベースの語は全部、職員に分かる文がある）
   3. ファイルの決まり: 管理画面と本人の画面の差し込みは1行ずつ・鍵が切なら何も描かない・本人の画面は HTML の代入なし・端末に残さない・console なし・
      読み込みの順番と版・公開の許可・帯と欄は初めは隠す
   4. 管理画面の部品を偽の窓口で動かす（鍵が切なら空・入の時に欄を出す・中身は esc を通す・設定の欄の読み書き）
   実行: node check/unit/kintai_board_test.js
   ★出力に console を使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const B = require(path.join(ROOT, 'kintai-board-calc.js'));
let ok = 0, ng = 0;
const say = (m) => process.stdout.write(m + '\n');
function group(n) { say('\n— ' + n + ' —'); }
function t(label, cond, info) { if (cond) { ok++; say('  ✓ ' + label); } else { ng++; say('  ✗ ' + label + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); } }

group('1. お知らせ');
const TD = '2030-04-10';
const good = B.checkAnnounce({ body: '  年末の打刻は\r\n忘れずに　', offices: ['visit', 'facility'], from: TD, to: '2030-04-17' }, TD);
t('通る: 前後の空白（全角も）を除き CRLF は LF・事業所は決まった順', good.ok && good.args.p_body === '年末の打刻は\n忘れずに' && JSON.stringify(good.args.p_offices) === '["facility","visit"]' && good.args.p_from === TD, good);
t('3つとも選ぶと全員（空の配列）', JSON.stringify(B.checkAnnounce({ body: 'x', offices: ['day', 'visit', 'facility'], from: TD, to: TD }, TD).args.p_offices) === '[]');
t('文が空・空白だけ・401字・タブは断る（400字は通る）',
  !B.checkAnnounce({ body: '', offices: [], from: TD, to: TD }, TD).ok && !B.checkAnnounce({ body: ' 　\n', from: TD, to: TD }, TD).ok
  && !B.checkAnnounce({ body: 'あ'.repeat(401), from: TD, to: TD }, TD).ok && !B.checkAnnounce({ body: 'a\tb', from: TD, to: TD }, TD).ok
  && B.checkAnnounce({ body: 'あ'.repeat(400), from: TD, to: TD }, TD).ok);
t('期間: 無い・逆・両端を含めて366日を超える・今日より前に終わるは断る（366日ちょうどと過去から今日は通る）',
  !B.checkAnnounce({ body: 'x', from: '', to: TD }, TD).ok && !B.checkAnnounce({ body: 'x', from: '2030-04-11', to: TD }, TD).ok
  && !B.checkAnnounce({ body: 'x', from: TD, to: B.addDays(TD, 366) }, TD).ok && !B.checkAnnounce({ body: 'x', from: '2030-04-01', to: '2030-04-09' }, TD).ok
  && B.checkAnnounce({ body: 'x', from: TD, to: B.addDays(TD, 365) }, TD).ok && B.checkAnnounce({ body: 'x', from: '2030-04-01', to: TD }, TD).ok
  && !B.checkAnnounce({ body: 'x', from: '2030-02-30', to: TD }, TD).ok);
t('文の上限・期間の上限はデータベース（0130）と同じ', B.BODY_MAX === 400 && B.SPAN_MAX === 366 && B.NOTE_MAX === 194);
t('事業所の言い方（空＝全員・名前で）', B.officesText([], null) === '全員' && B.officesText(['facility', 'day'], (x) => ({ facility: '施', day: '通' })[x]) === '施・通' && B.officesText(['visit'], () => '') === 'visit');
t('状態: 取り消し・終わった・これから・出している',
  B.announceState({ voided_at: 'x', date_from: TD, date_to: TD }, TD) === 'void' && B.announceState({ date_from: '2030-04-01', date_to: '2030-04-09' }, TD) === 'ended'
  && B.announceState({ date_from: '2030-04-11', date_to: '2030-04-12' }, TD) === 'future' && B.announceState({ date_from: TD, date_to: TD }, TD) === 'now');
t('期間の言い方', B.periodText('2030-04-01', '2030-04-10') === '4/1〜4/10' && B.periodText(TD, TD) === '4/10');
t('受け口の答えのお知らせ: 文の無い行・日付の違う行は捨てる・10件まで',
  B.announceRows([{ id: 1, body: 'a', date_from: TD, date_to: TD }, { body: '', date_from: TD, date_to: TD }, { body: 'b', date_from: 'x', date_to: TD }, null, 'x']).length === 1
  && B.announceRows(Array.from({ length: 12 }, (_, i) => ({ id: i, body: 'a', date_from: TD, date_to: TD }))).length === 10 && B.announceRows(null).length === 0);
t('鍵の入り: JSON の true だけ（文字の "true"・1 は切）', B.on({ selfAnnounce: true }, 'selfAnnounce') && !B.on({ selfAnnounce: 'true' }, 'selfAnnounce') && !B.on({ selfAnnounce: 1 }, 'selfAnnounce') && !B.on(null, 'selfAnnounce'));

group('2. 補助項目の申請');
const ITEMS = B.itemsOf([{ code: 'dist', name: '移動距離', kind: 'number', unit: 'km', decimals: 1 }, { code: 'checkup', name: '健診', kind: 'count', unit: '', decimals: 0 },
  { code: 'meeting', name: '社内会議', kind: 'time', unit: '', decimals: 0 }, { code: 'dist', name: '二つ目', kind: 'count' }, { code: 'bad code', kind: 'count' }, { code: 'x', kind: 'money' }, null]);
t('選択肢: 形の違い・同じ code の2つ目は捨てる', ITEMS.map((x) => x.code).join(',') === 'dist,checkup,meeting' && ITEMS[0].decimals === 1 && ITEMS[1].decimals === 0, ITEMS);
const bx = (o) => B.buildExtra(Object.assign({ date: '2030-04-09', today: TD }, o), ITEMS);
t('数値: 小数1桁まで通る・2桁は断る', bx({ code: 'dist', value: '12.3' }).ok && JSON.stringify(bx({ code: 'dist', value: '12.3' }).body) === '{"work_date":"2030-04-09","code":"dist","qty":12.3}'
  && !bx({ code: 'dist', value: '12.34' }).ok && !bx({ code: 'dist', value: '-1' }).ok && !bx({ code: 'dist', value: '' }).ok && !bx({ code: 'dist', value: '100000' }).ok);
t('回数: 整数だけ', bx({ code: 'checkup', value: '1' }).ok && !bx({ code: 'checkup', value: '1.5' }).ok);
t('時間: 時間と分から分にする・0分と24時間を超えるのは断る',
  JSON.stringify(bx({ code: 'meeting', hours: '1', mins: '30' }).body) === '{"work_date":"2030-04-09","code":"meeting","minutes":90}'
  && !bx({ code: 'meeting', hours: '0', mins: '0' }).ok && !bx({ code: 'meeting', hours: '24', mins: '1' }).ok && !bx({ code: 'meeting', hours: '', mins: '' }).ok
  && !bx({ code: 'meeting', hours: '1', mins: '60' }).ok);
t('日付: 無い・今日より先は断る・今日は通る', !bx({ code: 'checkup', value: '1', date: '' }).ok && !bx({ code: 'checkup', value: '1', date: '2030-04-11' }).ok && bx({ code: 'checkup', value: '1', date: TD }).ok);
t('項目が無い・知らない項目は断る', !bx({ code: '', value: '1' }).ok && !bx({ code: 'none', value: '1' }).ok);
t('理由: 前後の空白を除いて194字まで・空なら送らない', bx({ code: 'checkup', value: '1', note: ' 訪問 ' }).body.note === '訪問' && !('note' in bx({ code: 'checkup', value: '1', note: '  ' }).body)
  && !bx({ code: 'checkup', value: '1', note: 'あ'.repeat(195) }).ok && bx({ code: 'checkup', value: '1', note: 'あ'.repeat(194) }).ok);
t('値の言い方（kintai-extras.js の label と同じ・項目が消えた時は印と数）',
  B.valueText({ code: 'dist', qty: 12.3 }, ITEMS) === '移動距離 12.3 km' && B.valueText({ code: 'checkup', qty: 1 }, ITEMS) === '健診 1 回'
  && B.valueText({ code: 'meeting', minutes: 90 }, ITEMS) === '社内会議 1:30' && B.valueText({ code: 'gone', minutes: 5 }, ITEMS) === 'gone 5分', [B.valueText({ code: 'meeting', minutes: 90 }, ITEMS)]);
/* 断りの語は 0130 の本人の口（kintai_self_extra_add・kintai_self_extra_withdraw）が返す語を書き写した一覧 */
const DB_WORDS = ['off', 'reason', 'baddate', 'badcode', 'badvalue', 'locked', 'toomany', 'exists', 'conflict', 'notfound'];
t('データベースの断りの語（0130 の kintai_self_extra_add・_withdraw）は全部、職員に分かる文がある', DB_WORDS.every((w) => typeof B.xrErr(w) === 'string' && B.xrErr(w).length > 5));

group('3. ファイルの決まり');
const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1');
const sb = read('kintai-self-board.js'), kb = read('kintai-board.js'), bc = read('kintai-board-calc.js'), sj = read('kintai-self.js'), kj = read('kintai.js');
const sh = read('kintai-self.html'), kh = read('kintai.html'), gi = read('.gitignore');
t('本人の画面の部品は HTML の代入を使わない', !/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(code(sb) + code(bc)));
t('3つの部品は console・eval を使わない', !/\bconsole\.|\beval\(|new Function/.test(code(sb) + code(kb) + code(bc)));
t('3つの部品は端末に何も残さない（localStorage・sessionStorage・indexedDB・cookie なし）', !/localStorage|sessionStorage|indexedDB|document\.cookie/.test(code(sb) + code(kb) + code(bc)));
t('本人の画面の部品は鍵・開いている印を持たない（kintai-self.js が呼ぶ道の中で足す）', !/\bkey\b\s*[:=]|\bopen\s*:/.test(code(sb).replace(/autocomplete|inputMode|keep/g, ''))
  && /window\.KintaiSelfBoard\.start\(function \(op, p\) \{ var b = \{ key: key, open: open \}, k; for \(k in p\) b\[k\] = p\[k\]; return call\(op, b\); \}, handleAuth\);/.test(sj));
t('閉じる時（lock）に本人の画面の部品の中身も捨てる', /function lock\(text\) \{[\s\S]*?window\.KintaiSelfBoard\.reset\(\);[\s\S]*?\n  \}/.test(sj));
t('管理画面の差し込みは4か所（描く・設定の欄・設定の保存・窓口）', /m\.innerHTML = bands\(\) \+ \(kb && tab === 'close' \? kb\.closeHtml\(\) : ''\) \+ f\(\) \+ \(kb && tab === 'requests' \? kb\.html\(\) : ''\);/.test(kj)
  && /if \(typeof window !== 'undefined' && window\.KintaiBoard\) h \+= window\.KintaiBoard\.settingsHtml\(rawCfg\(\), isAdmin\(\)\);/.test(kj) && /if \(typeof window !== 'undefined' && window\.KintaiBoard\) window\.KintaiBoard\.readSettings\(outCfg\);/.test(kj)
  && /window\.KintaiBoardHost = \{ rpc: rpc,/.test(kj));
t('管理画面の部品が呼ぶ関数は 0130 の5本だけ', [...new Set([...code(kb).matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]))].sort().join(',') === 'kintai_announce_add,kintai_announce_void,kintai_announces_list,kintai_extra_req_decide,kintai_extra_reqs_list',
  [...code(kb).matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]));
t('本人の画面の部品が呼ぶ受け口の op は 0130 の4つだけ', [...new Set([...code(sb).matchAll(/callFn\('([a-z_]+)'/g)].map((m) => m[1]))].sort().join(',') === 'announces,extra_add,extra_info,extra_withdraw');
const noC = (h) => h.replace(/<!--[\s\S]*?-->/g, '');
const ord = (h, list) => list.map((f) => noC(h).indexOf('src="' + f));
const o1 = ord(sh, ['kintai-calc.js', 'kintai-self-calc.js', 'kintai-self.js', 'kintai-extras.js', 'kintai-board-calc.js', 'kintai-self-board.js', 'su-report.js']);
t('本人の画面の読み込みの順番: 計算 → 本人の計算 → 画面 → 補助項目 → 段B の計算 → 段B の部品 → 不具合の報告', o1.every((x, i) => x > 0 && (i === 0 || x > o1[i - 1])), o1);
const o2 = ord(kh, ['kintai-extras.js', 'kintai.js', 'kintai-board-calc.js', 'kintai-board.js', 'su-report.js']);
t('管理画面の読み込みの順番: 補助項目 → 画面 → 段B の計算 → 段B の部品', o2.every((x, i) => x > 0 && (i === 0 || x > o2[i - 1])), o2);
const ver = (src, f) => (new RegExp(f.replace(/[.]/g, '\\.') + '\\?v=([^"]+)"').exec(src) || [])[1];
t('同じ部品の版は2つの画面で同じ', ['kintai-extras.js', 'kintai-board-calc.js'].every((f) => ver(noC(sh), f) && ver(noC(sh), f) === ver(noC(kh), f)));
t('公開の許可（.gitignore のホワイトリスト）に3つの部品がある', ['kintai-board-calc.js', 'kintai-board.js', 'kintai-self-board.js'].every((f) => gi.indexOf('!/' + f + '\n') >= 0));
t('本人の画面の帯と欄は初めは隠す', /<div id="an-box" class="nt-box an-box" role="status" hidden><\/div>/.test(sh) && /<div id="xr-sec" hidden><\/div>/.test(sh));
t('管理画面の部品の欄と帯は画面だけ（no-print）', (kb.match(/class="cd no-print kb-/g) || []).length === 3 && /class="band warn no-print kb-close"/.test(kb) && /<div class="no-print" style="grid-column:1\/-1"><h2[^>]*>職員のスマホの画面/.test(kb));

group('4. 管理画面の部品を偽の窓口で動かす');
function runBoard(cfg, calls, pendRows) {
  const listeners = {};
  const els = {};
  const document = { addEventListener: (k, f) => { (listeners[k] = listeners[k] || []).push(f); }, getElementById: (id) => els[id] || null };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const host = { esc, cfg: () => cfg, today: () => TD, officeName: (o) => ({ facility: '施設', visit: '訪問', day: '通所' })[o], noDb: () => false, isNetErr: () => false, msgOf: () => 'x', note: () => {},
    toast: () => {}, pressBusy: () => () => {}, repaint: () => {}, okOr: (r) => r,
    rpc: (name, args) => { calls.push([name, args]); return Promise.resolve(name === 'kintai_announces_list' ? { ok: true, rows: [{ id: 'a1', body: '<b>見本</b>', offices: ['facility'], date_from: TD, date_to: TD, created_at: '2030-04-10T00:00:00Z' }] }
      : pendRows ? { ok: true, rows: pendRows, pending: pendRows.length }
      : { ok: true, rows: [{ id: 'r1', staff_id: 's1', name: '<i>架空</i>', work_date: TD, ym: '2030-04', code: 'checkup', qty: 1, note: '<img>', status: 'pending', rev: 1 }], pending: 1 }); },
    ym: () => '2030-04' };
  const win = { KintaiExtras: require(path.join(ROOT, 'kintai-extras.js')), KintaiBoardCalc: B, KintaiBoardHost: host, SUDialog: null, confirm: () => true, prompt: () => '' };
  const ctx = vm.createContext({ window: win, document, Promise, Date, String, Math, JSON, isFinite, Array, Object });
  vm.runInContext(read('kintai-board.js'), ctx, { filename: 'kintai-board.js' });
  return { K: win.KintaiBoard, els };
}
(async () => {
  /* 鍵が切の時は、切る前に出された承認待ちだけを出す（データベースは切でも決められる・反証レビュー 2026-11-25 の 5）。無ければ何も描かない */
  const c0 = [];
  const off = runBoard({ extraItems: [{ code: 'checkup', name: '健診', kind: 'count' }] }, c0, []);
  t('鍵が切: お知らせの関数は呼ばず、補助項目の承認待ちを1回だけ聞く', off.K.html() === '' && c0.map((x) => x[0]).join(',') === 'kintai_extra_reqs_list' && JSON.stringify(c0[0][1]) === '{"p_ym":null,"p_status":"pending"}');
  await new Promise((r) => setTimeout(r, 10));
  t('鍵が切で承認待ちが無ければ申請のタブにも締めの画面にも何も足さない（今の画面のまま）', off.K.html() === '' && off.K.closeHtml() === '' && c0.length === 1);
  const cL = [];
  const left = runBoard({ extraItems: [{ code: 'checkup', name: '健診', kind: 'count' }] }, cL, [{ id: 'r9', staff_id: 's1', name: '架空', work_date: TD, ym: '2030-04', code: 'checkup', qty: 1, status: 'pending', rev: 1 }]);
  left.K.html(); await new Promise((r) => setTimeout(r, 10));
  const lh = left.K.html();
  t('鍵が切で承認待ちが残っていれば、その分だけ承認・差し戻しを出す（切にした旨の帯つき）', /data-act="kb-x-ok" data-id="r9"/.test(lh) && /切にしたため/.test(lh) && !/kb-a-add/.test(lh));
  t('締めの画面の上に、この月分の補助項目の承認待ちの帯（反証レビュー 2026-11-25 の 1）', /承認待ちが 1 件あります/.test(left.K.closeHtml()) && /no-print/.test(left.K.closeHtml()));
  const c1 = [];
  const on = runBoard({ selfAnnounce: true, selfExtraReq: true, extraItems: [{ code: 'checkup', name: '健診', kind: 'count' }] }, c1);
  t('鍵が入なら読みに行く（お知らせ・補助項目の申請の承認待ち）', on.K.html().indexOf('読み込んでいます') >= 0 && c1.map((x) => x[0]).join(',') === 'kintai_announces_list,kintai_extra_reqs_list'
    && JSON.stringify(c1[1][1]) === '{"p_ym":null,"p_status":"pending"}');
  await new Promise((r) => setTimeout(r, 10));
  const h = on.K.html();
  t('読んだ中身は esc を通して入れる（お知らせの文・名前・理由）', h.indexOf('&lt;b&gt;見本&lt;/b&gt;') >= 0 && h.indexOf('&lt;i&gt;架空&lt;/i&gt;') >= 0 && h.indexOf('&lt;img&gt;') >= 0 && !/<b>見本|<i>架空|<img>/.test(h));
  t('お知らせの欄・補助項目の申請の欄・承認と差し戻しのボタン・承認待ちの数', /data-act="kb-a-add"/.test(h) && /data-act="kb-a-void" data-id="a1"/.test(h) && /data-act="kb-x-ok" data-id="r1"/.test(h)
    && /data-act="kb-x-ng" data-id="r1"/.test(h) && /承認待ち 1 件/.test(h) && /健診 1 回/.test(h) && /施設/.test(h));
  const sOff = on.K.settingsHtml({}, true), sOn = on.K.settingsHtml({ selfAnnounce: true, selfExtraReq: true }, false);
  t('設定の欄: 既定は外れ・入は印・管理者でない時は押せない', !/id="kb-s-ann" checked/.test(sOff) && /id="kb-s-ann" checked disabled/.test(sOn) && /id="kb-s-xr" checked disabled/.test(sOn));
  on.els['kb-s-ann'] = { checked: true }; on.els['kb-s-xr'] = { checked: false };
  const out = { selfExtraReq: true, other: 1 };
  on.K.readSettings(out);
  t('保存: 印のある鍵は true・外した鍵は消す（ほかの鍵はそのまま）', out.selfAnnounce === true && !('selfExtraReq' in out) && out.other === 1);
  const out2 = { selfAnnounce: true };
  runBoard({}, []).K.readSettings(out2);
  t('欄の無い画面では今の設定のまま', out2.selfAnnounce === true);

  say('\n合格 ' + ok + ' / 不合格 ' + ng);
  process.exit(ng ? 1 : 0);
})();
