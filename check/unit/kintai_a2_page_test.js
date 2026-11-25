/* 勤怠管理・給与の画面の段A2（記号の組・通勤回数・社内会議を時間外に足す・手当の回数の元）の組み込みの試験（2026-11-25 新設・凍結仕様 ROOT-v7-plus-parity.md「段A2」「反証レビュー1回」）
   実行: node check/unit/kintai_a2_page_test.js
   守りたいこと:
     1. 勤怠の設定のタブ: 3つの欄は #g-set の中（保存していない変更の確かめに入る）・触った欄だけ送る・切った欄は null で送る・案のままで使い始めるボタン
     2. 月の集計の CSV: 補助項目の列の後ろに段A2 の列（日ごとの CSV には足さない）・読めていない時は書き出さない
     3. 会議の時間が数えなかった時間より多い日の知らせ（個人の月の日の札・要確認の一覧の帯・締めは止めない）・入力の窓の案内
     4. 36協定の見張りの月の行に会議の分を足す（締めた月は控えの adj・開いている締めていない月は補助項目の行）。判定の式（kintai-36.js）は変えない
     5. 給与の受け口（attExt）: 控えの定義にある元を 0 で埋める・取り込みの人は組・通勤回数を埋めない・会議の足し分で時間外を置き換える・ext の無い控えは今のまま
     6. 給与の確かめ（verifyKintai）: 控えに ext がある月分だけ補助項目を読み、締めた時の定義で数え直して比べる（食い違えば止める・読めなければ止める）・
        会議を足す設定なのに控えに ext が無い月分（期間の初日が 2026-12-16 以降）の印
     7. 給与の職員の給与設定: 回数×単価の手当に「回数の元」の選び・回数の元の名前・payroll.html の読み込みの順
   ★架空データだけ（職員は sA… の番号）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const KC = require(path.join(ROOT, 'kintai-calc.js'));
const EX = require(path.join(ROOT, 'kintai-extras.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }
const K = read('kintai.js'), J = read('payroll.js'), HP = read('payroll.html'), HK = read('kintai.html');
const sl = (S, a, b) => { const i = S.indexOf(a), j = S.indexOf(b, i + 1); return i >= 0 && j > i ? S.slice(i, j) : ''; };

console.log('\n— 1. 勤怠の設定のタブ —');
{
  /* ★main の取り込み（2026-11-25）で年別・段B・社保・資格の欄が補助項目の欄のすぐ後に入ったので、すぐ次ではなく順番で確かめる（#g-set の中であることは同じ） */
  t('3つの欄は補助項目の欄の後ろ・#g-set の中', K.indexOf('h += exSetHtml();') > 0 && K.indexOf('h += exSetHtml();') < K.indexOf('h += a2SetHtml();') && K.indexOf('h += a2SetHtml();') < K.indexOf("h += '</form>' + a36Form()"));
  t('関数が無い（補助項目を確かめていない）時は欄を出さない', /function a2On\(\) \{ return !!EX && typeof EX\.buildExt === 'function' && exOn\(\) && !!exSt; \}/.test(K) && /function a2SetHtml\(\) \{\s*if \(!a2On\(\)\) return '';/.test(K));
  t('触った欄だけ送る（a2Touched・描き直したら触っていない状態から・id の頭 a2g-・a2c-・a2m-）', /a2Touched = \{ g: false, c: false, m: false \};   \/\* 描き直したら/.test(K) && /else if \(id && \/\^a2\[gcm\]-\/\.test\(id\)\) a2Touched\[id\.charAt\(2\)\] = true;/.test(K) && /if \(id && \/\^a2\[gcm\]-\/\.test\(id\)\) a2Touched\[id\.charAt\(2\)\] = true;/.test(K));
  const sv = sl(K, '  function saveSettings(btn)', '  /* 印刷: 見出しの日時');
  t('保存: 形の違う行があれば保存しない・触った鍵だけ formKeys に足す・切った欄は null のまま送る', /if \(a2s\.bad\.length\) \{ alert\(/.test(sv) && /\.concat\(Object\.keys\(a2s\.vals\)\)/.test(sv) && /for \(k in a2s\.vals\) outCfg\[k\] = a2s\.vals\[k\];/.test(sv) && sv.indexOf("rpc('kintai_settings_put'") > sv.indexOf('for (k in a2s.vals)'));
  t('案のままで使い始める（3つとも触った扱いにして保存）・行を足す', /else if \(a === 'a2-adopt'\) \{ a2Touched = \{ g: true, c: true, m: true \}; saveSettings\(b\); \}/.test(K) && /else if \(a === 'a2-add-group'\) a2AddGroup\(\);/.test(K));
  t('保存済みの組のコードは変えない（readonly）・組は止める（消さない）', /\(saved \? ' readonly' : ''\)/.test(sl(K, 'function a2GroupRow(', 'function a2SetHtml(')) && /> 使う<\/label>/.test(sl(K, 'function a2GroupRow(', 'function a2SetHtml(')));
  t('記号の組は cleanSymbolGroups で確かめる・保存済みの組が消えていれば保存しない', /var cl = EX\.cleanSymbolGroups\(raw\);/.test(K) && /保存済みの記号の組「/.test(K));
  t('入れる値は全部 esc を通す（コード・名前・記号・項目の名前）', /esc\(g \? g\.code : ''\)/.test(K) && /esc\(g \? g\.name : ''\)/.test(K) && /esc\(g \? g\.symbols\.join\('、'\) : ''\)/.test(K) && /esc\(EX\.nameOf\(x\)\) \+ ' の日を除く/.test(K));
}

console.log('\n— 2. 月の集計の CSV —');
{
  const wc = sl(K, '  function writeCsv(kind, from)', '  function loadEdits(');
  t('補助項目の列の後ろに段A2 の列（月の集計だけ・読めていない時は書き出さない）', wc.indexOf('var a2r = a2Csv(src, text, from);') > wc.indexOf('var exr = exCsv(kind, src, text);') && /if \(kind === 'sum'\) \{\s*var a2r = a2Csv\(src, text, from\);\s*if \(a2r === false\) return;/.test(wc));
  t('締めた時の数字は控えの ext・無い控えは今の設定で数えて知らせる', /var snapExt = from === 'snap' && isLocked\(\) && data\.month\.snapshot && EX\.isExt\(data\.month\.snapshot\.ext\)/.test(K) && /締めた時の控えに記号の組・通勤回数・社内会議の数が無いため/.test(K));
  /* 純関数: 今の列は1バイトも変えず末尾にだけ足す */
  const STAFF = [{ id: 'sA1', name: '試験 一', mainDivision: '施設', empCode: '9101', active: true }];
  const rows = KC.buildSchedule({ ym: '2026-12', plan: { cells: { sA1: { 1: '早', 2: '早/同' } } }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
  const at = (d, hm) => new Date(KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1])).toISOString();
  const pun = [{ id: 'a', staff_id: 'sA1', kind: 'in', at: at('2026-12-01', '7:00') }, { id: 'b', staff_id: 'sA1', kind: 'out', at: at('2026-12-01', '16:00') }, { id: 'c', staff_id: 'sA1', kind: 'in', at: at('2026-12-02', '7:00') }, { id: 'd', staff_id: 'sA1', kind: 'out', at: at('2026-12-02', '16:00') }];
  const cfg = { extraItems: [{ code: 'meeting', name: '社内会議', kind: 'time', unit: '', decimals: 0, active: true }], symbolGroups: EX.SYMBOL_GROUPS_DEFAULT, commuteCount: { minus: [] }, meetingOt: { code: 'meeting', on: true } };
  const m = KC.computeMonth({ ym: '2026-12', staff: [{ staff_id: 'sA1', name: '試験 一', office: 'facility', emp_code: '9101' }], schedule: rows, punches: pun, days: [], config: { csvTime: 'hmm' }, now: Date.parse('2027-01-10T12:00:00+09:00') });
  const ext = EX.buildExt(m, [{ id: 'x', staff_id: 'sA1', date: '2026-12-01', code: 'meeting', minutes: 45 }], rows, cfg);
  const csv = KC.buildCsv(m, { extraCols: true }).summary;
  const out = EX.appendExtCsv(csv, { people: EX.csvPeople(m.people), ext, base: { sA1: m.people[0].sum.legalOverMin }, mode: 'hmm' });
  const r0 = EX.splitCsv(csv), r1 = EX.splitCsv(out.text);
  t('CSV: 今の列はそのまま・末尾に3列（早遅（回）・通勤回数（回）・時間外（社内会議を含む））', out.cols === 3 && r1.length === r0.length && r1.every((r, i) => r.raw.indexOf(r0[i].raw) === 0) && r1[0].cells.slice(-3).join('|') === '早遅（回）|通勤回数（回）|時間外（社内会議を含む）', r1[0].cells.slice(-3));
  t('CSV: 値は早遅1回（同行の日は数えない）・通勤回数2回・時間外 0:45（会議を足した後）', r1[1].cells.slice(-3).join('|') === '1|2|0:45', r1[1].cells.slice(-3));
  t('CSV: 列が無い時は文がそのまま', EX.appendExtCsv(csv, { people: [], ext: EX.buildExt(m, [], rows, {}) }).text === csv);
  t('CSV: 取り込みの人の組・通勤回数は空（時間外は足す前の値）', EX.splitCsv(EX.appendExtCsv(csv, { people: EX.csvPeople(m.people), ext: { v: 1, def: ext.def, rows: {} }, base: { sA1: 30 }, imported: { sA1: 1 }, mode: 'hmm' }).text)[1].cells.slice(-3).join('|') === '||0:30');
}

console.log('\n— 3. 会議の時間の知らせ・入力の窓の案内 —');
{
  t('個人の月の日の札（画面だけ・no-print の中）', /\(typeof a2OverOn === 'function' && a2OverOn\(sid, date\) \? '<span class="tag rv">' \+ esc\(EX\.MEETING_OVER_TEXT\) \+ '<\/span>' : ''\) \+ '<\/span>';/.test(K));
  const pr = sl(K, '  function paintReview()', '  function personVisible(');
  t('要確認の一覧（要確認が無い時も）に帯を出す・締めは止めない（lockFigures・reviewList は変えない）', (pr.match(/a2OverBand\(\)/g) || []).length === 2 && /締めは止めません。/.test(K) && !/a2Over/.test(sl(K, '  function lockFigures(', '  function sameFigures(')));
  t('入力の窓: 時間外に足す会議の項目を選んだ時だけ案内（文は kintai-extras.js の MEETING_INPUT_HELP）', /'<p class="help" id="ex-meet-help" hidden>' \+ esc\(EX\.MEETING_INPUT_HELP \|\| ''\) \+ '<\/p>'/.test(K) && /if \(hp\) hp\.hidden = !\(mo && mo\.on && it && it\.code === mo\.code && tm\);/.test(K));
}

console.log('\n— 3b. 締めの控えに ext を入れる —');
{
  const go = sl(K, '  function lockGo(', '  function unlockMonth(');
  t('締め: 数え直して窓の数字と同じ時だけ、補助項目を読み直して ext を作り、控え（snapshotOf のまま）の最上段に入れて送る', go.indexOf('return a2ExtForLock(d).then(function (ext) {') > go.indexOf('sameFigures(shown, now)') && /var snap = C\.snapshotOf\(month\);\s*snap\.ext = ext;\s*return rpc\('kintai_month_lock', \{ p_ym: ym, p_snapshot: snap \}\)/.test(go));
  t('補助項目が読めない時は締めない（fail で窓に出す・世代が変われば捨てる）', /\}, function \(e\) \{ if \(my !== gen\) return; fail\(e, '締める時の補助項目の読み込み'\); \}\);/.test(go) && /a2_noextras: '補助項目が読めません。締めていません/.test(K));
  t('会議の設定を保存していない時は締めない（窓で止める・押した時も読み直した補助項目で止める）', /if \(EX\.meetingUnsaved && EX\.meetingUnsaved\(cfg, a2LockRows\)\) throw Object\.assign\(new Error\('meetunset'\), \{ kintai: 'a2_meetunset' \}\);/.test(K) && /if \(mu\) \{ var lgo = \$\('g-dlg-f'\)\.querySelector\('\[data-act="lock-go"\]'\); if \(lgo\) lgo\.remove\(\); \}/.test(K) && /a2_meetunset: '社内会議を時間外に足すかを、設定のタブで保存してから締めてください'/.test(K));
  const imp = sl(K, '  function importShift(my)', '  /* ── 読み込みと計算 ── */');
  t('予定の取り込み: badrow で同行の印の行がある時だけ、印を外して1回だけ送り直す（記録 note に「同行の印を外して送り直した」）', /res\.error === 'badrow' && bt\.rows\.some\(function \(x\) \{ return x && 'companion' in x; \}\)/.test(imp) && /note\('予定の取り込み', new Error\('同行の印を外して送り直した'\)\);/.test(imp) && (imp.match(/rpc\('kintai_schedule_put'/g) || []).length === 2);
  t('関数の無い DB（0127 の前）で補助項目を保存していない時だけ、補助項目なしで数える', /if \(noDb\(e\) && !Array\.isArray\(cfg\.extraItems\)\) return EX\.buildExt\(month, \[\], d\.schedule \|\| \[\], cfg\);/.test(K));
}

console.log('\n— 4. 36協定の見張りに会議の分を足す —');
{
  const src = sl(K, '  function row36(', '  /* その月分の36協定の判定');
  const run = (mm, ext0, opts) => new Function('C', 'EX', 'MM', 'O', `var ym = O.ym, exSt = O.exSt; function exReady() { return !!O.ready; } function rawCfg() { return O.cfg || {}; }
    ${opts && opts.other ? 'function a2Ex36Of(y) { return O.other(y); }' : ''}\n${src}\nvar miss = []; var r = row36(MM, 'sA1', O.ymx || '2026-12', [], miss); if (r) r.miss = miss; return r;`)(KC, EX, mm, opts || {});
  const lockedMM = { k36: { locked: true, rows: [{ staff_id: 'sA1', legalOverRawMin: 600, legalOverMin: 600, holidayRawMin: 30, holidayMin: 30 }], snapCfg: { legal_holiday: 0 }, ext: { v: 1, def: {}, rows: { sA1: { adj: { legalOverMin: 690, over60Min: 0, holidayMin: 90, meetingMin: 150 } } } } } };
  const r1 = run(lockedMM);
  t('締めた月: 控えの adj から（丸める前の 600＋90・休日 30＋60）', r1.legalOverMin === 690 && r1.holidayMin === 90, r1);
  const noExt = run({ k36: { locked: true, rows: lockedMM.k36.rows, snapCfg: {} } });
  t('締めた月: ext の無い控えは今までどおり', noExt.legalOverMin === 600 && noExt.holidayMin === 30, noExt);
  const live = { k36: { locked: false }, config: { legal_holiday: 0 }, people: [{ staff: { staff_id: 'sA1' }, sum: { legalOverRawMin: 100, legalOverMin: 100, holidayRawMin: 0, holidayMin: 0 }, days: [] }] };
  const cfgOn = { extraItems: [{ code: 'meeting', name: '社内会議', kind: 'time', decimals: 0, active: true }], meetingOt: { code: 'meeting', on: true } };
  const ex = [{ id: 'm1', staff_id: 'sA1', date: '2026-12-04', code: 'meeting', minutes: 40 }, { id: 'm2', staff_id: 'sA1', date: '2026-12-06', code: 'meeting', minutes: 20 }];
  const r2 = run(live, null, { ym: '2026-12', ymx: '2026-12', ready: true, exSt: { rows: ex }, cfg: cfgOn });
  t('開いている締めていない月: 補助項目の行から（平日 40分は時間外・日曜 20分は休日）', r2.legalOverMin === 140 && r2.holidayMin === 20, r2);
  const r3 = run(live, null, { ym: '2027-01', ymx: '2026-12', ready: true, exSt: { rows: ex }, cfg: cfgOn });
  t('ほかの締めていない月を読む口が無い時は足さない', r3.legalOverMin === 100 && r3.holidayMin === 0, r3);
  const r4 = run(live, null, { ym: '2027-01', ymx: '2026-12', ready: true, exSt: { rows: [] }, cfg: cfgOn, other: (y) => (y === '2026-12' ? { rows: ex } : null) });
  t('ほかの締めていない月: その月分の補助項目を読んで足す（反証レビュー1回の5）', r4.legalOverMin === 140 && r4.holidayMin === 20 && r4.miss.length === 0, r4);
  const r5 = run(live, null, { ym: '2027-01', ymx: '2026-12', ready: true, exSt: { rows: [] }, cfg: cfgOn, other: () => ({ err: true }) });
  t('読めない月は足さずに知らせる月に入れる', r5.legalOverMin === 100 && JSON.stringify(r5.miss) === '["2026-12"]', r5);
  const r6 = run(live, null, { ym: '2027-01', ymx: '2026-12', ready: true, exSt: { rows: [] }, cfg: cfgOn, other: () => ({ pending: true }) });
  t('読んでいる途中は足さず、知らせもしない（読み終わったら描き直す）', r6.legalOverMin === 100 && r6.miss.length === 0, r6);
  const pump = sl(K, '  function a2Ex36Of(y) {', '  function a2MissNote(');
  t('月ごとに kintai_extras_get を読む・同時に3本まで・世代で古い答えを捨てる・会議を足す設定の時だけ・読み直し（dropMonthCaches）で捨てる', /while \(a2Ex36Run < 3 && a2Ex36Q\.length\)/.test(pump) && /rpc\('kintai_extras_get', \{ p_ym: y \}\)/.test(pump) && /if \(my === a2Ex36Gen\) a2Ex36\[yy\] = res;/.test(pump) && /if \(!mo \|\| !mo\.on\) return null;/.test(pump) && /if \(typeof a2Ex36Reset === 'function'\) a2Ex36Reset\(\);/.test(sl(K, '  function dropMonthCaches(', '\n')) && /function a2Ex36Reset\(\) \{ a2Ex36 = \{\}; a2Ex36Gen\+\+; a2Ex36Q = \[\]; \}/.test(K));
  t('知らせの文（個人の月の帯・ホームの36協定の箱）', /'会議の時間を足せていない月があります（'/.test(K) && /if \(j\.mmiss && j\.mmiss\.length\) w\.push\(a2MissNote\(j\.mmiss\)\);/.test(K) && /b\.note = \(b\.note \? b\.note \+ '。' : ''\) \+ a2MissNote\(mms\.sort\(\)\);/.test(K));
  t('kintai-36.js は変えていない（判定の入力にだけ足す）', !/meeting|KintaiExtras|\.ext\b/.test(read('kintai-36.js')));
  t('締めの控えの様子に ext を持つ（k36Info）', /ext: snap && EX && EX\.isExt && EX\.isExt\(snap\.ext\) \? snap\.ext : null/.test(K));
}

console.log('\n— 5. 給与の受け口（attExt） —');
const ATT = (() => {
  const src = sl(J, '  var ATT_KEYS', '  /* 締めの控えの確かめ') + sl(J, '  function attMap(', '  /* 明細の行（DB の');
  return new Function('function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }\nfunction arr(v) { return Array.isArray(v) ? v : []; }\n' + src + '\nreturn { attFromKintai: attFromKintai, attMap: attMap, attExt: attExt };')();
})();
{
  const def = { items: [{ code: 'dist', kind: 'number' }, { code: 'meeting', kind: 'time' }], groups: [{ code: 'hayaoso', name: '早遅', symbols: ['早'], active: true }, { code: 'stop', name: 's', symbols: ['遅'], active: false }], commute: { minus: [] }, meetingOt: { code: 'meeting', on: true } };
  const base = { workDays: 2, paidDays: 0, paidMin: 0, workMin: 960, schedInMin: 960, legalInOverMin: 0, legalOverMin: 30, over60Min: 0, nightMin: 0, holidayMin: 0, absentDays: 0, lateMin: 0, earlyLeaveMin: 0, nightShiftCount: 0, schedDays: 2, reviewCount: 0, counts: { '早': 1 } };
  const snap = { rows: [Object.assign({ staff_id: 'sA1' }, base), Object.assign({ staff_id: 'sA2' }, base), Object.assign({ staff_id: 'sA3', imported: { source: 'freee_csv', id: 'i' } }, base)],
    ext: { v: 1, def, rows: { sA1: { 'g:hayaoso': 1, 'x:dist': 3.5, adj: { legalOverMin: 75, over60Min: 0, holidayMin: 0, meetingMin: 45 } }, sA3: { 'x:dist': 1 } } } };
  const M = ATT.attMap(snap, true);
  t('控えの元を a.ext に（定義にある元は 0 で埋める・止めた組は埋めない）', JSON.stringify(M.sA1.ext) === JSON.stringify({ 'x:dist': 3.5, 't:meeting': 0, 'g:hayaoso': 1, 'k:commute': 0 }) && JSON.stringify(M.sA2.ext) === JSON.stringify({ 'x:dist': 0, 't:meeting': 0, 'g:hayaoso': 0, 'k:commute': 0 }), [M.sA1.ext, M.sA2.ext]);
  t('取り込みの人は記号の組・通勤回数を埋めない（給与が「控えにありません」と知らせる）・補助項目は入る', JSON.stringify(M.sA3.ext) === JSON.stringify({ 'x:dist': 1, 't:meeting': 0 }), M.sA3.ext);
  t('会議の足し分で時間外・60時間超・休日労働を置き換え、meetingMin を持つ・労働時間数（workMin）にも会議の分を足す（960＋45）', M.sA1.legalOverMin === 75 && M.sA1.meetingMin === 45 && M.sA1.workMin === 1005 && M.sA2.legalOverMin === 30 && M.sA2.meetingMin === undefined);
  t('会議0の人は今と1分も変わらない（attFromKintai と同じ値・ext の鍵だけ足す）', (() => { const a0 = ATT.attFromKintai(snap.rows[1], true), a1 = M.sA2; return Object.keys(a0).every((k) => JSON.stringify(a0[k]) === JSON.stringify(a1[k])) && Object.keys(a1).filter((k) => !(k in a0)).join() === 'ext'; })(), M.sA2);
  const snapNo = { rows: snap.rows.slice(0, 1), ext: { v: 1, def: Object.assign({}, def, { meetingOt: null }), rows: { sA1: { 't:meeting': 45 } } } };
  const MN = ATT.attMap(snapNo, true);
  t('会議の設定を保存しないまま締めた控え（def.meetingOt が null）の印（extNoMeet）・会議の足し分は当てない', MN.sA1.extNoMeet === true && MN.sA1.ext['t:meeting'] === 45 && MN.sA1.legalOverMin === 30 && MN.sA1.workMin === 960);
  const old = ATT.attMap({ rows: snap.rows }, true);
  t('ext の無い控えは今のまま（ext も meetingMin も無い）', old.sA1.ext === undefined && old.sA1.legalOverMin === 30 && old.sA1.meetingMin === undefined);
  t('attFromKintai は ext を見ない（数え直しの比べ attSame は今のまま）', ATT.attFromKintai(snap.rows[0]).ext === undefined);
}

console.log('\n— 6. 給与の確かめ（verifyKintai） —');
const pend = [];
{
  const src = sl(J, '  function arr(v)', '  function kintaiBlock()');
  const make = (raw, extrasRows, withEx) => new Function('KC', 'EXM', 'RAW', 'XR', `var window = { KintaiCalc: KC }; if (EXM) window.KintaiExtras = EXM; function note() {}
    function rpc(name, args) { if (name === 'kintai_extras_get') return XR ? Promise.resolve({ ok: true, rows: XR }) : Promise.reject(new Error('net')); return Promise.resolve(RAW(args.p_ym)); }
    ${src}
    return { verifyKintai: verifyKintai };`)(KC, withEx === false ? null : EX, raw, extrasRows);
  const STAFF = [{ id: 'sA1', name: '試験 一', mainDivision: '施設', empCode: '9101', active: true }];
  const rows = KC.buildSchedule({ ym: '2026-12', plan: { cells: { sA1: { 1: '早', 2: '早/同' } } }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
  const at = (d, hm) => new Date(KC.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1])).toISOString();
  const pun = [{ id: 'a', staff_id: 'sA1', kind: 'in', at: at('2026-12-01', '7:00') }, { id: 'b', staff_id: 'sA1', kind: 'out', at: at('2026-12-01', '16:00') }, { id: 'c', staff_id: 'sA1', kind: 'in', at: at('2026-12-02', '7:00') }, { id: 'd', staff_id: 'sA1', kind: 'out', at: at('2026-12-02', '16:00') }];
  const staff = [{ staff_id: 'sA1', office: 'facility', emp_code: '9101' }], period = { from: '2026-12-01', to: '2026-12-31' };
  const scfg = { extraItems: [{ code: 'meeting', name: '社内会議', kind: 'time', unit: '', decimals: 0, active: true }], symbolGroups: EX.SYMBOL_GROUPS_DEFAULT, commuteCount: { minus: [] }, meetingOt: { code: 'meeting', on: true } };
  const xr = [{ id: 'x', staff_id: 'sA1', date: '2026-12-01', code: 'meeting', qty: null, minutes: 45 }];
  const month = KC.computeMonth({ ym: '2026-12', period, staff, schedule: rows, punches: pun, days: [], config: {}, now: Date.parse('2027-01-05') });
  const snap = KC.snapshotOf(month); snap.ext = EX.buildExt(month, xr, rows, scfg);
  const rawOf = (sn, per) => () => ({ ok: true, period: per || period, staff, schedule: rows, punches: pun, days: [], leave_uses: [], absences: [], settings: { config: scfg }, month: { ym: '2026-12', locked_at: '2027-01-05T00:00:00Z', snapshot: sn } });
  const boot = { kintai: { locked: true }, profiles: [{ staff_id: 'sA1', name: '架空 一', data: {} }] };
  t('材料: 控えの ext（早遅1・通勤2・会議45分の足し分）', snap.ext.rows.sA1['g:hayaoso'] === 1 && snap.ext.rows.sA1['k:commute'] === 2 && snap.ext.rows.sA1.adj.meetingMin === 45);
  pend.push(make(rawOf(snap), xr).verifyKintai('2026-12', boot).then((r) => {
    t('控えの ext と、補助項目を読んで締めた時の定義で数え直した値が同じなら ok（勤怠の設定を持つ）', r.state === 'ok' && r.kcfg && r.kcfg.meetingOt.on === true, r);
    return make(rawOf(snap), xr.concat([{ id: 'y', staff_id: 'sA1', date: '2026-12-02', code: 'meeting', qty: null, minutes: 30 }])).verifyKintai('2026-12', boot);
  }).then((r) => {
    t('締めた後に会議を足すと食い違って止まる（ng・名前）', r.state === 'ng' && r.names.join() === '架空 一', r);
    return make(rawOf(snap), null).verifyKintai('2026-12', boot);
  }).then((r) => {
    t('補助項目が読めない時は止める（err）', r.state === 'err', r);
    return make(rawOf(snap), xr, false).verifyKintai('2026-12', boot);
  }).then((r) => {
    t('補助項目の部品が無い時は止める（err）', r.state === 'err', r);
    const sn0 = KC.snapshotOf(month);
    return Promise.all([make(rawOf(sn0, { from: '2026-12-16', to: '2027-01-15' }), null).verifyKintai('2026-12', boot), make(rawOf(sn0), null).verifyKintai('2026-12', boot)]);
  }).then((rs) => {
    t('ext の無い控え: 補助項目を読まずに今までどおり比べる・期間の初日が 2026-12-16 以降で会議を足す設定なら extMissing の印（それより前は付けない）', rs[1].state === 'ok' && !rs[1].extMissing && rs[0].extMissing === true, rs);
  }));
  t('確定を止める警告に ext_missing・meeting_src・meeting_unset を入れる（BLOCK_WARN_SCREEN＝画面だけで止める）', /var BLOCK_WARN_SCREEN = \{ ext_missing: 1, meeting_src: 1, meeting_unset: 1 \};/.test(J) && /var BLOCK_WARN = \{[^}]*\bext_missing: 1, meeting_src: 1, meeting_unset: 1 \};/.test(J));
  t('meeting_unset: 控えの def.meetingOt が無く、時間の補助項目の合計（t:）が0でない人', /if \(a && a\.extNoMeet && Object\.keys\(obj\(a\.ext\)\)\.some\(function \(k\) \{ return \/\^t:\/\.test\(k\) && a\.ext\[k\] > 0; \}\)\) it\.warnings = arr\(it\.warnings\)\.concat\(\[\{ code: 'meeting_unset'/.test(J));
  const ca = sl(J, '  function computeAll()', '  function doCompute()');
  t('計算: 印のある月分は警告 ext_missing（文は仕様どおり）・明細の勤怠の欄に「うち社内会議」（表示だけ・額 0）', /if \(a && bs\.kcheck && bs\.kcheck\.extMissing\) it\.warnings = arr\(it\.warnings\)\.concat\(\[\{ code: 'ext_missing', msg: 'この月分の勤怠の控えに補助項目がありません。勤怠の締めを外して締め直してください' \}\]\);/.test(ca)
    && /\{ sec: 'att', code: 'meetingMin', name: 'うち社内会議（分）', qty: a\.meetingMin, unit: null, amount: 0/.test(ca));
  t('二重払いの守り: 時間外に足す会議の項目（t:<code>）を回数×単価の手当の元に選んだ人は meeting_src（文は仮置き）', /var mSrc = meetingSrc\(\);/.test(ca) && /x\.count_source === mSrc && bs\.allowances\.some\(function \(d\) \{ return d\.code === x\.code && d\.calc === 'count'; \}\)/.test(ca) && /code: 'meeting_src', msg: '社内会議の時間は時間外に足しているので、手当の回数の元に選べません'/.test(ca));
}

console.log('\n— 7. 職員の給与設定の「回数の元」・読み込みの順 —');
{
  const op = sl(J, '  function openProfile(sid)', '  function v(id)');
  t('回数×単価の手当だけに回数の元の選びと回数の欄', /if \(a\.calc === 'count'\) \{ var cur = alOf\(a\.code\); x \+= sel\('f-als' \+ i, \(a\.name \|\| a\.code\) \+ ' の回数の元', cur\.count_source \|\| 'manual', srcOpts\(cur\.count_source\)\) \+ inp\('f-alc' \+ i/.test(op));
  const pg = sl(J, '  function profGo(btn)', "    d.deductions = keepD;");
  t('保存: 選びがある時だけ count_source・手で入れる時は回数（0〜9999）・今の値（Object.assign(old)）は引き継ぐ', /if \(\$\('f-als' \+ i\)\) \{/.test(pg) && /ent\.count_source = src;/.test(pg) && /cn < 0 \|\| cn > 9999/.test(pg) && /Object\.assign\(\{\}, old \|\| \{\}, \{ code: a\.code, amount: x \}\)/.test(pg));
  const so = sl(J, '  function meetingSrc()', '  function openProfile(sid)');   /* srcOpts は meetingSrc を使う */
  const run = new Function('EXM', 'BS', 'KCFG', `var window = { KintaiExtras: EXM }, bs = BS, kintaiCfg0 = KCFG; function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }\n${so}\nreturn srcOpts;`);
  const bs0 = { kcheck: null, kintai: { summary_by_staff: { sA1: { counts: { '早': 2, '日1': 1 } } }, ext_def: { items: [{ code: 'old', name: '止めた回数', kind: 'count', decimals: 0, active: false }], groups: [], commute: null, meetingOt: null } } };
  const opts = run(EX, bs0, { extraItems: [{ code: 'dist', name: '移動距離', kind: 'number', unit: 'km', decimals: 1, active: true }, { code: 'sunday_time', name: '日曜出勤（時間）', kind: 'time', decimals: 0, active: true }], symbolGroups: EX.SYMBOL_GROUPS_DEFAULT, commuteCount: { minus: [] } })('早2');
  t('選び: 手で入れる・シフトの記号・補助項目（回数・時間）・控えの定義の項目・記号の組・通勤回数・今の値', JSON.stringify(opts.map((o) => o[0])) === JSON.stringify(['manual', '日1', '早', 'x:dist', 't:sunday_time', 'g:hayaoso', 'k:commute', 'x:old', '早2']) && opts[3][1] === '補助項目：移動距離' && opts[4][1] === '補助項目：日曜出勤（時間）' && opts[5][1] === '記号の組：早遅' && opts[8][1] === '今の値：シフトの記号：早2', opts);
  const runMs = new Function('EXM', 'BS', 'KCFG', `var window = { KintaiExtras: EXM }, bs = BS, kintaiCfg0 = KCFG; function obj(v) { return v && typeof v === "object" && !Array.isArray(v) ? v : {}; }\n${so}\nreturn { meetingSrc: meetingSrc, srcOpts: srcOpts };`);
  const kOn = { extraItems: [{ code: 'meeting', name: '社内会議', kind: 'time', decimals: 0, active: true }, { code: 'sunday_time', name: '日曜出勤（時間）', kind: 'time', decimals: 0, active: true }], meetingOt: { code: 'meeting', on: true } };
  const bsN = { kcheck: null, kintai: { summary_by_staff: {}, ext_def: null } };
  const mOn = runMs(EX, bsN, kOn), mOff = runMs(EX, bsN, Object.assign({}, kOn, { meetingOt: { code: 'meeting', on: false } }));
  const oOn = mOn.srcOpts('').map((o) => o[0]), oOff = mOff.srcOpts('').map((o) => o[0]);
  t('二重払いの守り: 会議を時間外に足す時は回数の元の一覧から t:meeting を外す（切の時は出す）', mOn.meetingSrc() === 't:meeting' && oOn.indexOf('t:meeting') < 0 && oOn.indexOf('t:sunday_time') >= 0 && mOff.meetingSrc() === null && oOff.indexOf('t:meeting') >= 0, [oOn, oOff]);
  const keep = mOn.srcOpts('t:meeting');
  t('今の値が t:meeting の人は黙って変えず「選べません」と出す（確定は meeting_src で止まる）', keep.some((o) => o[0] === 't:meeting' && /選べません/.test(o[1])), keep);
  const mSnap = runMs(EX, { kcheck: null, kintai: { summary_by_staff: {}, ext_def: { items: [], groups: [], commute: null, meetingOt: { code: 'mtg2', on: true } } } }, {});
  t('控えの定義で会議を足していればそちらを使う', mSnap.meetingSrc() === 't:mtg2');
  t('payroll.html: shift-symbols.js → kintai-calc.js → kintai-extras.js → payroll.js の順（kintai.html と同じ版）', HP.indexOf('<script src="shift-symbols.js?v=') > 0 && HP.indexOf('<script src="kintai-calc.js?v=') > HP.indexOf('<script src="shift-symbols.js?v=') && HP.indexOf('<script src="kintai-extras.js?v=') > HP.indexOf('<script src="kintai-calc.js?v=') && HP.indexOf('<script src="payroll.js?v=') > HP.indexOf('<script src="kintai-extras.js?v=')
    && (HP.match(/kintai-extras\.js\?v=[^"]+/) || [])[0] === (HK.match(/kintai-extras\.js\?v=[^"]+/) || [])[0] && (HP.match(/shift-symbols\.js\?v=[^"]+/) || [])[0] === (HK.match(/shift-symbols\.js\?v=[^"]+/) || [])[0]);
  t('console.log を足していない（kintai.js・payroll.js・kintai-extras.js）', !/console\.log/.test(K) && !/console\.log/.test(J) && !/console\.log/.test(read('kintai-extras.js')));
  t('端末に残す鍵を足していない（payroll.js の localStorage は payroll_tab だけ）', (J.match(/lsSet\(/g) || []).length === (read('payroll.js').match(/lsSet\(/g) || []).length && !/lsSet\([^)]*(ext|count_source|kintaiCfg)/.test(J));
}

Promise.all(pend).then(() => {
  console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
}, (e) => { console.log('  ✗ 試験が例外で止まりました: ' + (e && e.message)); process.exit(1); });
