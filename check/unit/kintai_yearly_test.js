/* 勤怠の年別・事業所別の集計（kintai-yearly.js）と、画面の足し（kintai-views.js・kintai.js・kintai.html）の試験（2026-11-25 新設・ROOT-v7 段C）
   実行: node check/unit/kintai_yearly_test.js
   守りたいこと:
     1. 年別: 幅は1〜12か月・古い順・職員の並びは今の月の並び・名簿に無い月は空・月の合計＝人の値の和
     2. 年別の値は月の集計（computeMonth の people[].sum）と同じ（数え直さない）
     3. 事業所別: 実働の事業所の合計＝全体の合計（分単位で一致）・残業などは主の事業所・未設定の行・在籍と働いた人
     4. 画面の足し: 入り切りの鍵 plusViews（既定は切）・切の時はタブを足さない・部品が無くても動く・端末に残す鍵は決まった2つ・kintai-calc.js を変えない */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const Y = require(path.join(ROOT, 'kintai-yearly.js'));
const C = require(path.join(ROOT, 'kintai-calc.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e).slice(0, 600) : '')); } }

(async () => {
  console.log('\n— 1. 年別の形 —');
  t('幅は1〜12か月・古い順・年をまたぐ', JSON.stringify(Y.monthsBack('2026-02', 4)) === JSON.stringify(['2025-11', '2025-12', '2026-01', '2026-02']) && Y.monthsBack('2026-02', 99).length === 12 && Y.monthsBack('2026-02', 0).length === 1 && Y.monthsBack('x', 3).length === 0);
  const P = (sid, office, sum, active) => ({ staff: { staff_id: sid, office, active: active !== false }, sum });
  const m1 = { people: [P('a', 'facility', { workMin: 600, paidDays: 1 }), P('b', 'visit', { workMin: 300 })] };
  const m2 = { people: [P('b', 'visit', { workMin: 100 }), P('c', 'day', { workMin: 50 })] };
  const tb = Y.yearTable([{ ym: '2026-01', month: m1 }, { ym: '2026-02', month: m2 }, { ym: '2026-03', month: null }], 'workMin', ['c', 'b']);
  t('並びは渡した順（c・b）の後に、出てきた順の残り（a）', tb.rows.map((r) => r.staff_id).join() === 'c,b,a', tb.rows.map((r) => r.staff_id));
  t('名簿に無い月は null・ある月は値', tb.rows[0].cells['2026-01'] === null && tb.rows[0].cells['2026-02'] === 50 && tb.rows[2].cells['2026-02'] === null);
  t('人の合計・月の合計・全体の合計', tb.rows[1].total === 400 && tb.totals['2026-01'] === 900 && tb.totals['2026-02'] === 150 && tb.totals['2026-03'] === null && tb.grand === 1050, tb);
  t('項目の名前が違う時は実働', Y.yearTable([{ ym: '2026-01', month: m1 }], 'nope').item === 'workMin' && Y.yearTable([{ ym: '2026-01', month: m1 }], 'paidDays').rows[0].total === 1);

  console.log('\n— 2. 月の集計と同じ値（架空の3名・計算の部品でその月を数える）—');
  const FX = await import(path.join(ROOT, 'check/fixtures/kintai.mjs'));
  const months = ['2025-11', '2025-12'].map((ym) => {
    const d = FX.monthOf(ym);
    let id = 0;
    const iso = (dt, hm) => dt + 'T' + hm + ':00+09:00';
    const pun = [];
    d.schedule.filter((r) => r.kind === 'work').forEach((r, i) => { pun.push({ id: ym + 'i' + (++id), staff_id: r.staff_id, kind: 'in', at: iso(r.work_date, '08:50'), source: 'tablet', voided_at: null }, { id: ym + 'o' + (++id), staff_id: r.staff_id, kind: 'out', at: iso(r.work_date, i % 5 === 0 ? '23:30' : '18:00'), source: 'tablet', voided_at: null }); });
    /* 予定の無い日の夜の勤務（打刻どおり数える＝残業・深夜が出る） */
    const busy = new Set(d.schedule.filter((r) => r.staff_id === 'sK01').map((r) => r.work_date));
    for (let dt = d.period ? d.period.from : ym + '-01', k = 0; k < 40; k++, dt = C.addDays(dt, 1)) { if (!busy.has(dt)) { pun.push({ id: ym + 'xi', staff_id: 'sK01', kind: 'in', at: iso(dt, '17:00'), source: 'tablet', voided_at: null }, { id: ym + 'xo', staff_id: 'sK01', kind: 'out', at: iso(dt, '23:30'), source: 'tablet', voided_at: null }); break; } }
    const m = C.computeMonth({ ym, period: d.period, staff: d.staff, schedule: d.schedule, punches: pun, days: [], config: { overtimeAlertMin: 9999 }, now: Date.parse('2026-02-01T00:00:00+09:00') });
    return { ym, month: m };
  });
  const order = months[1].month.people.map((p) => p.staff.staff_id);
  let same = true;
  Y.ITEM_KEYS.forEach((k) => {
    const tt = Y.yearTable(months, k, order);
    months.forEach((x) => x.month.people.forEach((p) => { const r = tt.rows.filter((rr) => rr.staff_id === p.staff.staff_id)[0]; if (!r || r.cells[x.ym] !== p.sum[k]) same = false; }));
  });
  t('8つの項目すべてで、年別の値＝その月分の people[].sum の値', same && months[0].month.people.length >= 3);
  t('材料に残業と深夜がある（試験が空振りしない）', months.some((x) => x.month.people.some((p) => p.sum.overtimeMin > 0 && p.sum.nightMin > 0)));

  console.log('\n— 3. 事業所別 —');
  months.forEach((x) => {
    const st = Y.siteTable(x.month), sumW = st.rows.reduce((a, r) => a + r.workMin, 0);
    const tot = x.month.people.reduce((a, p) => a + p.sum.workMin, 0);
    t(x.ym + ': 事業所の実働の合計＝全体＝人の実働の和（' + tot + ' 分）', sumW === st.total.workMin && st.total.workMin === tot, [sumW, st.total.workMin, tot]);
    t(x.ym + ': 残業・深夜・有休は主の事業所の和＝全体', ['overtimeMin', 'nightMin', 'paidDays', 'legalOverMin'].every((k) => Math.abs(st.rows.reduce((a, r) => a + r[k], 0) - st.total[k]) < 1e-9));
  });
  /* 2つの事業所で働いた人・予定の無い勤務・主の事業所が無い人 */
  const mx = { people: [
    P('a', 'facility', { workMin: 601, overtimeMin: 30, byOffice: { facility: 400.4, visit: 200.3 } }),
    P('b', 'visit', { workMin: 100, byOffice: { visit: 99.6 } }),
    P('c', null, { workMin: 50, nightMin: 20, byOffice: {} }),
    P('d', 'day', { workMin: 0, paidDays: 1, byOffice: {} }, true),
    P('e', 'day', { workMin: 0, byOffice: {} }, false)
  ] };
  const sx = Y.siteTable(mx), by = {}; sx.rows.forEach((r) => { by[r.office] = r; });
  t('行は 施設・訪問・通所・未設定（未設定は人がいる時だけ）', sx.rows.map((r) => r.office).join() === 'facility,visit,day,' && Y.siteTable({ people: [P('a', 'day', { workMin: 1 })] }).rows.length === 3);
  t('実働の合計は 751 分ちょうど（端数を配る）', sx.rows.reduce((a, r) => a + r.workMin, 0) === 751 && sx.total.workMin === 751, sx.rows.map((r) => r.workMin));
  t('割合で分けきれない分は主の事業所（a の 0.3 分は施設・b の 0.4 分は訪問・c は未設定）', by.facility.workMin === 400 || by.facility.workMin === 401, sx.rows.map((r) => [r.office, r.workMin]));
  t('残業・深夜は主の事業所（a の残業は施設・c の深夜は未設定）', by.facility.overtimeMin === 30 && by.visit.overtimeMin === 0 && by[''].nightMin === 20);
  t('在籍は休止でない人を主の事業所で（通所は d だけ）・働いた人は1分以上働いた事業所（a は施設と訪問の両方）', by.day.active === 1 && by.facility.worked === 1 && by.visit.worked === 2 && by[''].worked === 1 && sx.total.active === 4 && sx.total.worked === 3, [by, sx.total]);
  const s4 = Y.siteTable({ people: [P('a', 'facility', { workMin: 500, byOffice: { visit: 300 } })] }), b4 = {}; s4.rows.forEach((r) => { b4[r.office] = r; });
  t('予定の無い勤務が主の事業所に入った人は、その事業所の働いた人にも数える（全体は1人）', b4.facility.worked === 1 && b4.visit.worked === 1 && s4.total.worked === 1 && b4.facility.workMin === 200, [b4, s4.total]);
  const s5 = Y.siteTable({ people: [P('a', 'facility', { workMin: 301, byOffice: { facility: 151, visit: 151 } }), P('b', 'day', { workMin: 100, byOffice: { day: 100 } })] }), b5 = {}; s5.rows.forEach((r) => { b5[r.office] = r; });
  t('事業所の割合の和が実働を超える人（丸め）は、その人の分だけ縮める（ほかの人の事業所から引かない）', b5.day.workMin === 100 && b5.facility.workMin + b5.visit.workMin === 301 && s5.total.workMin === 401, s5.rows.map((r) => [r.office, r.workMin]));
  t('端数の配り方: 合計がちょうど合う', JSON.stringify(Y.apportion({ a: 0.5, b: 0.5, c: 0 }, 1)) === JSON.stringify({ a: 1, b: 0, c: 0 }) && Object.values(Y.apportion({ a: 33.4, b: 33.3, c: 33.3 }, 100)).reduce((p, q) => p + q, 0) === 100);
  t('月が無い時は空の表', Y.siteTable(null).rows.length === 3 && Y.siteTable(null).total.workMin === 0);

  console.log('\n— 4. 画面の足し —');
  const K = read('kintai.js'), V = read('kintai-views.js'), HT = read('kintai.html'), YS = read('kintai-yearly.js');
  t('kintai.html は 3つの部品を kintai-calc.js の後・kintai.js の前に ?v= つきで読む', ['kintai-holiday.js', 'kintai-yearly.js', 'kintai-views.js'].every((f) => { const i = HT.indexOf('<script src="' + f + '?v='); return i > HT.indexOf('kintai-calc.js?v=') && i < HT.indexOf('<script src="kintai.js?v='); }));
  t('タブのボタンは HTML に置かない（切の時は今の画面のまま）', !/data-tab="(year|site|holiday)"/.test(HT));
  t('入り切りの鍵は plusViews が true の時だけ入', /function on\(cfg\) \{ return !!\(cfg && cfg\.plusViews === true\); \}/.test(V));
  t('切・部品が無い時に年別などのタブを開こうとしたらホーム（描く関数の中で決める）', /var vwApi = typeof window !== 'undefined' && window\.KintaiViews \|\| null, vwIsOn = !!vwApi && vwApi\.on\(rawCfg\(\)\), vwT = tab === 'year' \|\| tab === 'site' \|\| tab === 'holiday';\s*if \(vwApi\) vwApi\.syncTabs\(vwIsOn, tab\);\s*if \(vwT && !vwIsOn\) \{ tab = 'home'; vwT = false; paintTabs\(\); \}/.test(K) && /m\.innerHTML = bands\(\) \+ (\(kb && tab === 'close' \? kb\.closeHtml\(\) : ''\) \+ )?\(vwT \? vwApi\.paint\(tab, vwCtx\(\)\) : f\(\)\)( \+ \(kb && tab === 'requests' \? kb\.html\(\) : ''\))?;/.test(K));   /* 段B（統合 0130）が締めの画面の帯と申請のタブの欄を前後に足した（年別などのタブの決め方は同じ） */
  t('タブの読み戻しは決まった名前だけ（TABS に year・site・holiday・社保の知らせの shaho を後に足した）', /var TABS = \['home', 'day', 'review', 'requests', 'grid', 'person', 'staff', 'leave', 'close', 'settings', 'year', 'site', 'holiday', 'shaho'\];/.test(K));
  t('kintai.js の localStorage の書き込みは今までどおり lsSet の1か所', (K.match(/localStorage\.setItem/g) || []).length === 1);
  t('kintai-views.js が端末に書く鍵は kintai_vw_n と kintai_vw_item だけ（読み戻しは決まった値だけ）', (V.match(/lsSet\(/g) || []).length === 3 && /lsSet\(LS_N, String\(n\)\)/.test(V) && /if \(Y\.isItem\(e\.target\.value\)\) lsSet\(LS_ITEM/.test(V) && /var LS_N = 'kintai_vw_n', LS_ITEM = 'kintai_vw_item';/.test(V) && (V.match(/localStorage\.setItem/g) || []).length === 1);
  t('ほかの月分の数え方は月の一覧と同じ（締めた月は控えの設定・締めていない月はシフトの休憩を重ねる）', /function vwBr\(\) \{ if \(shiftInfo && shiftInfo\.breaks\) vwBreaks = shiftInfo\.breaks; return vwBreaks; \}\s*function vwMonth\(y, d\) \{\s*var cfg = monthCfg\(d\), br = vwBr\(\) \|\| \{\}, k;\s*if \(!\(d\.month && d\.month\.locked_at && d\.month\.snapshot && d\.month\.snapshot\.config\)\) for \(k in br\) if \(typeof br\[k\] === 'number'\) cfg\[k\] = br\[k\];/.test(K));
  t('月の読み込みのたびに年別の控えを捨てる（ほかの月分の直し・締め・設定の保存の後に古い数字を出さない）', /function load\(withImport\) \{\s*var my = \+\+gen;\s*if \(typeof VW !== 'undefined' && VW\) VW\.drop\(\);/.test(K));
  t('読み込みで描き直すのは年別を開いている時だけ・休日の書きかけは描き直しで戻し、閉じる前に確かめる', /ctx\.repaintYear\(\);/.test(V) && !/ctx\.repaint\(\);\s*next\(\);/.test(V) && /value="' \+ ctx\.esc\(dv\('vw-h-name'\)\) \+ '"/.test(V) && /if \(typeof VW !== 'undefined' && VW && VW\.dirty\(\)\) \{ e\.preventDefault\(\);/.test(K) && /if \(id && id\.indexOf\('vw-h-'\) === 0 && typeof VW !== 'undefined' && VW\) VW\.keep\(e\);/.test(K));
  t('読めない・読み込み中の月は見出しに書き（紙にも出る）、読み込み中は印刷を押せない', /stOf\[x\.ym\] = x\.wait \? '読み込み中' : x\.err \? '読めず' : ''/.test(V) && /data-act="print"' \+ \(waitN \? ' disabled' : ''\)/.test(V));
  t('止めた休日を使うに戻す時も、使う分が30件なら断る（31件目を黙って読み飛ばさない）', /if \(!x\.active && items\.filter\(function \(c\) \{ return c\.active; \}\)\.length >= H\.MAX_COMPANY\)/.test(V));
  t('件数の行き止まりを解く: 外せるのは去年までの「この年だけ」で止めた休日だけ・確かめてから', /return !\(c\.active === false && c\.date && \(c\.to \|\| c\.date\)\.slice\(0, 4\) < y0\);/.test(V) && /if \(!confirm\('去年までの「この年だけ」で止めた会社の休日 '/.test(V));
  t('年別の読み込みの通信の失敗は月分ごとに報告しない', /if \(!ctx\.isNetErr\(e\)\) ctx\.note\('年別の読み込み', e\);/.test(V));
  t('同時に読むのは3本まで・世代で古い答えを捨てる・5分で捨てる', /var CONC = 3, TTL = 5 \* 60 \* 1000;/.test(V) && /if \(my !== gen\) return;/.test(V));
  t('設定の保存は今の鍵を全部残して送る（会社の休日・入り切り）', /for \(k in cfg\) if \(Object\.prototype\.hasOwnProperty\.call\(cfg, k\)\) out\[k\] = cfg\[k\];/.test(V) && /\.concat\(vws \? vws\.keys : \[\]\)/.test(K) && /if \(vws\) for \(k in vws\.vals\) outCfg\[k\] = vws\.vals\[k\];/.test(K));
  t('保存の前に設定の大きさを確かめる', /if \(!H\.fitsConfig\(out\)\)/.test(V));
  t('切のまま鍵が無ければ plusViews を作らない', /if \(el\.checked\) vals\.plusViews = true;\s*else if \(cfg && Object\.prototype\.hasOwnProperty\.call\(cfg, 'plusViews'\)\) vals\.plusViews = false;/.test(V));
  t('入り切りの欄は #g-set の中（保存していない変更の確かめに乗る）', /h \+= exSetHtml\(\);[^\n]*\n\s*if \(typeof VW !== 'undefined' && VW\) h \+= VW\.setHtml\(rawCfg\(\)\);/.test(K));
  t('画面の文に外の値を入れる所は esc を通す（名前・事業所・休日の名前）', /ctx\.esc\(ctx\.dispName\(r\.staff\)\)/.test(V) && /ctx\.esc\(x\.name\)/.test(V) && /ctx\.esc\(c\.national\.name\)/.test(V));
  t('インラインの onclick・onsubmit を書かない（CSP）', !/\son(click|submit|change)=/.test(V));
  t('kintai-yearly.js は通信・端末・画面に触れず、kintai-calc.js を変えない（呼ばない）', !/localStorage|fetch\(|document\.|rpc\(|KintaiCalc|require\(/.test(YS.replace(/\/\*[\s\S]*?\*\//g, '')));
  /* kintai-calc.js などを変えていないことは PR の差分で確かめる（ここで git の差を見ると、後でこれらを直すほかの PR を落とすため・反証レビュー 2026-11-25） */

  console.log('\n' + (fail ? '✗ ' : '✓ ') + pass + ' 件合格 / ' + fail + ' 件不合格');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('✗ 試験の途中で止まりました: ' + (e && e.stack || e)); process.exit(1); });
