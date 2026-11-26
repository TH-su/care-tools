/* 勤怠管理: 締めの前の要確認を1件ずつ「認める／認めない（理由）」で決め、要確認が残る月分は締めない（本人指示 2026-11-21・統合 0120）の試験
   実行: node check/unit/kintai_review_decide_test.js（環境変数 KINTAI_CALC で別の版の kintai-calc.js を当てられる）
   守りたいこと:
     1. 認めない理由（日の行の early_ng・ot_ng）がある日は、早出・残業の印を「認めなかった」に替えて要確認から外す。数える時間（実働・残業・深夜・数えなかった時間）は1分も変えない
     2. 理由の無い行（今までの行・null・空）は、月の結果も締めの控えも1字も変わらない（締めた月の給与の数え直しを止めない）
     3. 早出だけ認めない日に残業が残れば、その日は要確認のまま（早出・残業は別々に決める）。認めた日（全部・この時刻から／まで）には理由を当てない
     4. CSV の日ごとの明細の末尾に「数えなかった時間」「数えなかった理由」。人ごとの日の合計は集計の「数えなかった時間」と同じ。理由は式として読まれない・カンマや改行でも列がずれない
     5. 要確認の印（REVIEW）のどれにも、決める道がある（早出・残業＝認める／認めない、控え・予定なし・締めた後＝認める（確認済み）、打刻の漏れ＝直す・欠勤・確認済み）
     6. 画面（kintai.js）: 締める前と「締める」を押して読み直した後の両方で要確認が残れば止め、止めた窓に「締める」を出さない・DB の断り review の文がある・
        決める窓は初めに何も選ばず、選ばないと保存しない・認めない時は理由を求める・送る鍵は DB が受ける鍵だけ・認めないと承認を同じ日に並べない
   ★職員は架空（試験 甲・試験 乙）。 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..', '..');
const C = require(process.env.KINTAI_CALC || path.join(ROOT, 'kintai-calc.js'));
const Sym = require(path.join(ROOT, 'shift-symbols.js'));
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const YM = '2026-12', NOW = Date.parse('2027-01-10T12:00:00+09:00');
const at = (d, hm) => C.jstMs(d, +hm.split(':')[0] * 60 + +hm.split(':')[1]);
let pid = 0;
const P = (sid, kind, d, hm, src) => ({ id: 'p' + (++pid), staff_id: sid, kind, at: new Date(at(d, hm)).toISOString(), source: src || 'tablet', created_at: new Date(at(d, hm)).toISOString() });
const STAFF = [{ id: 'sT01', name: '試験 甲', mainDivision: '施設', empCode: '9001', active: true }, { id: 'sT02', name: '試験 乙', mainDivision: '訪問', empCode: '9002', active: true }];
const K_STAFF = [{ staff_id: 'sT01', name: '試験 甲', office: 'facility', emp_code: '9001' }, { staff_id: 'sT02', name: '試験 乙', office: 'visit', emp_code: '9002' }];
const build = (cells) => C.buildSchedule({ ym: YM, plan: { cells }, nextPlan: {}, staff: STAFF, symbols: Sym.DEFAULT_SYMBOLS, settings: { breakThresholdH: 6, breakH: 1, nightBreakH: 2 } }).rows;
const month = (sched, pun, days, cfg) => C.computeMonth({ ym: YM, staff: K_STAFF, schedule: sched, punches: pun, days: days || [], config: cfg || {}, now: NOW });
const dayOf = (m, sid, date) => { const p = m.people.find((x) => x.staff.staff_id === sid); return p && p.days.find((d) => d.date === date); };
const sumOf = (m, sid) => m.people.find((x) => x.staff.staff_id === sid).sum;
/* 月の結果の文（日の note は受け取った日の行をそのまま持つだけなので比べに入れない） */
const js = (people) => JSON.stringify(people, (k, v) => (k === 'note' && v && typeof v === 'object' ? undefined : v));
/* CSV の1行を列に分ける（"…" の中のカンマ・改行・"" を読む） */
function cells(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
}
function rows(csv) {   /* CRLF で切る（"…" の中の改行は切らない） */
  const out = []; let cur = '', q = false;
  for (let i = 0; i < csv.length; i++) { const ch = csv[i]; if (ch === '"') q = !q; if (!q && ch === '\r' && csv[i + 1] === '\n') { out.push(cur); cur = ''; i++; } else cur += ch; }
  if (cur) out.push(cur); return out.map(cells);
}
const hmToMin = (s) => { const m = /^(\d+):(\d{2})$/.exec(s); return m ? +m[1] * 60 + +m[2] : NaN; };

/* 場面: 12/1 早出（6:20 出勤・予定 7:00〜16:00・16:00 退勤）／12/2 残業（7:00〜16:45）／12/3 早出と残業（6:20〜16:45）／12/4 ちょうど（7:00〜16:00）
         sT02: 12/1 早出と残業（6:15〜16:50） */
const S = build({ sT01: { 1: '早', 2: '早', 3: '早', 4: '早' }, sT02: { 1: '早' } });
pid = 0;
const PUN = [
  P('sT01', 'in', '2026-12-01', '6:20'), P('sT01', 'out', '2026-12-01', '16:00'),
  P('sT01', 'in', '2026-12-02', '7:00'), P('sT01', 'out', '2026-12-02', '16:45'),
  P('sT01', 'in', '2026-12-03', '6:20'), P('sT01', 'out', '2026-12-03', '16:45'),
  P('sT01', 'in', '2026-12-04', '7:00'), P('sT01', 'out', '2026-12-04', '16:00'),
  P('sT02', 'in', '2026-12-01', '6:15'), P('sT02', 'out', '2026-12-01', '16:50')
];
const base = month(S, PUN, []);
const blk = (m, sid, d, i) => dayOf(m, sid, d).blocks[i || 0];

console.log('\n— 1. 認めない理由で要確認から外し、数える時間は変えない —');
{
  t('前提: 理由の無い時は 12/1 早出・12/2 残業・12/3 早出と残業・sT02 12/1 早出と残業が要確認（4件＋1件）',
    sumOf(base, 'sT01').reviewCount === 3 && sumOf(base, 'sT02').reviewCount === 1 && blk(base, 'sT01', '2026-12-01').flags.indexOf('early') >= 0 && blk(base, 'sT01', '2026-12-02').flags.indexOf('overtime') >= 0,
    [sumOf(base, 'sT01').reviewCount, sumOf(base, 'sT02').reviewCount]);
  const days = [
    { staff_id: 'sT01', work_date: '2026-12-01', early_ng: '指示の無い早出' },
    { staff_id: 'sT01', work_date: '2026-12-02', ot_ng: '私用で残った' },
    { staff_id: 'sT01', work_date: '2026-12-03', early_ng: '指示の無い早出' }
  ];
  const m = month(S, PUN, days);
  const b1 = blk(m, 'sT01', '2026-12-01'), b2 = blk(m, 'sT01', '2026-12-02'), b3 = blk(m, 'sT01', '2026-12-03');
  t('12/1: 早出の印が「早出を認めなかった」（early_ng）に替わり、要確認でない・理由を塊に写す', b1.flags.indexOf('early') < 0 && b1.flags.indexOf('early_ng') >= 0 && !C.needsReview(b1) && b1.ngEarly === '指示の無い早出', b1.flags);
  t('12/2: 残業の印が ot_ng に替わり、要確認でない', b2.flags.indexOf('overtime') < 0 && b2.flags.indexOf('ot_ng') >= 0 && !C.needsReview(b2) && b2.ngOt === '私用で残った', b2.flags);
  t('12/3: 早出だけ認めない日は、残業が残るので要確認のまま（1件）', b3.flags.indexOf('early_ng') >= 0 && b3.flags.indexOf('overtime') >= 0 && C.needsReview(b3), b3.flags);
  t('要確認の数: sT01 は 3→1・一覧にも 12/3 と sT02 だけ', sumOf(m, 'sT01').reviewCount === 1 && C.reviewList(m).map((r) => r.staffId + r.date).join() === 'sT022026-12-01,sT012026-12-03', C.reviewList(m));
  const keys = ['workMin', 'overtimeMin', 'nightMin', 'breakMin', 'uncountedMin', 'countStart', 'countEnd', 'lateMin', 'earlyLeaveMin', 'holidayMin'];
  const same = ['2026-12-01', '2026-12-02', '2026-12-03'].every((d) => keys.every((k) => blk(m, 'sT01', d)[k] === blk(base, 'sT01', d)[k]));
  t('数える時間（実働・残業・深夜・休憩・数えなかった時間・数えた区間）は理由の有無で1分も変わらない', same);
  const sb = sumOf(base, 'sT01'), sm = sumOf(m, 'sT01');
  t('月の合計（総労働・残業・法定外・数えなかった時間）も同じ', ['workMin', 'overtimeMin', 'legalOverMin', 'uncountedMin', 'nightMin', 'schedInMin'].every((k) => sb[k] === sm[k]), [sb.uncountedMin, sm.uncountedMin]);
  t('数えなかった時間: 12/1 は 40分（6:20〜7:00）・12/2 は 45分・12/3 は 85分', b1.uncountedMin === 40 && b2.uncountedMin === 45 && b3.uncountedMin === 85, [b1.uncountedMin, b2.uncountedMin, b3.uncountedMin]);
  t('印の名前: 早出を認めなかった・残業を認めなかった（要確認の印ではない）', C.FLAG_LABEL.early_ng === '早出を認めなかった' && C.FLAG_LABEL.ot_ng === '残業を認めなかった' && !C.REVIEW.early_ng && !C.REVIEW.ot_ng);
  /* 両方とも認めない */
  const m2 = month(S, PUN, [{ staff_id: 'sT01', work_date: '2026-12-03', early_ng: 'a', ot_ng: 'b' }]);
  t('12/3 を早出も残業も認めないにすると要確認から外れる', !C.needsReview(blk(m2, 'sT01', '2026-12-03')) && sumOf(m2, 'sT01').reviewCount === 2);
  /* 確認済みの印（day_mark checked）と並んでも、替えた印は残る */
  const m3 = month(S, PUN, [{ staff_id: 'sT01', work_date: '2026-12-03', early_ng: 'a', day_mark: 'checked' }]);
  t('確認済みと並ぶ日: 早出は「認めなかった」・残業の印は残して要確認に数えない（今の確認済みと同じ）', blk(m3, 'sT01', '2026-12-03').flags.join() === 'early_ng,overtime,checked' && !C.needsReview(blk(m3, 'sT01', '2026-12-03')), blk(m3, 'sT01', '2026-12-03').flags);
}

console.log('\n— 2. 理由の無い行は1字も変わらない —');
{
  const days0 = [{ staff_id: 'sT01', work_date: '2026-12-01', note: 'メモ', rev: 1 }, { staff_id: 'sT01', work_date: '2026-12-02', overtime_ok: true }];
  const a = month(S, PUN, days0);
  const b = month(S, PUN, days0.map((d) => Object.assign({}, d, { early_ng: null, ot_ng: null })));
  const c = month(S, PUN, days0.map((d) => Object.assign({}, d, { early_ng: '', ot_ng: '' })));
  t('理由の鍵が無い・null・空の3つで、月の結果（全員の日と塊・受け取った日の行の写し note は除く）が同じ', js(a.people) === js(b.people) && js(a.people) === js(c.people));
  t('締めの控え（snapshotOf）も同じ', JSON.stringify(C.snapshotOf(a)) === JSON.stringify(C.snapshotOf(b)) && JSON.stringify(C.snapshotOf(a)) === JSON.stringify(C.snapshotOf(c)));
  t('理由の無い行の塊には理由の鍵を作らない', !('ngEarly' in blk(a, 'sT01', '2026-12-01')) && !('ngOt' in blk(a, 'sT01', '2026-12-01')));
  /* 認めた日（全部認める・この時刻から／まで）に理由が残っていても当てない（DB は並べないが、古い行でも数えを変えない） */
  const d = month(S, PUN, [{ staff_id: 'sT01', work_date: '2026-12-01', early_ok: true, early_ng: '古い理由' }, { staff_id: 'sT01', work_date: '2026-12-02', ot_until: new Date(at('2026-12-02', '16:30')).toISOString(), ot_ng: '古い理由' }]);
  const e = month(S, PUN, [{ staff_id: 'sT01', work_date: '2026-12-01', early_ok: true }, { staff_id: 'sT01', work_date: '2026-12-02', ot_until: new Date(at('2026-12-02', '16:30')).toISOString() }]);
  t('認めた日は理由があっても数え・印・理由の鍵が認めた時と同じ', js(d.people) === js(e.people) && blk(d, 'sT01', '2026-12-01').workMin === blk(base, 'sT01', '2026-12-01').workMin + 40);
  /* 休憩を直した日（break_min・その日の別の塊には休憩の直しを当てない道）でも理由は当たる */
  const S2 = build({ sT01: { 4: '7-9 17-21' } });
  pid = 100;
  const pun2 = [P('sT01', 'in', '2026-12-04', '6:20'), P('sT01', 'out', '2026-12-04', '9:00'), P('sT01', 'in', '2026-12-04', '16:20'), P('sT01', 'out', '2026-12-04', '21:00')];
  const f = month(S2, pun2, [{ staff_id: 'sT01', work_date: '2026-12-04', break_min: 0, early_ng: '指示の無い早出' }]);
  const fb = dayOf(f, 'sT01', '2026-12-04').blocks;
  t('分割勤務の日（2つの塊とも早出・休憩の直しあり）: 両方の塊の早出が「認めなかった」になり要確認でない', fb.length === 2 && fb.every((x) => x.flags.indexOf('early_ng') >= 0 && !C.needsReview(x)), fb.map((x) => x.flags));
}

console.log('\n— 3. CSV の日ごとの明細 —');
{
  const days = [
    { staff_id: 'sT01', work_date: '2026-12-01', early_ng: '=指示の無い早出' },
    { staff_id: 'sT01', work_date: '2026-12-03', early_ng: '早出, 打ち合わせなし', ot_ng: '私用で\n残った "本人"' },
    { staff_id: 'sT02', work_date: '2026-12-01', ot_ng: '申請なし' }
  ];
  const m = month(S, PUN, days);
  const csv = C.buildCsv(m, { nameOf: (d) => d + '事業所', extraCols: true });
  const D = rows(csv.daily), H = D[0], iU = H.indexOf('数えなかった時間'), iW = H.indexOf('数えなかった理由');
  t('見出しの末尾が「数えなかった時間」「数えなかった理由」（前の列はそのまま）', iU === H.length - 2 && iW === H.length - 1 && H.slice(0, H.length - 2).join() === C.DAILY_HEAD.concat(['氏名', '予定の開始', '予定の終わり', '打刻の出勤（生）', '打刻の退勤（生）', '残業', '休日労働', '有休時間', '印']).join(), H);
  t('どの行も見出しと同じ列の数（カンマ・改行・" の入った理由でも列がずれない）', D.every((r) => r.length === H.length), D.map((r) => r.length));
  const r1 = D.find((r) => r[0] === '9001' && r[1] === '2026-12-01'), r3 = D.find((r) => r[0] === '9001' && r[1] === '2026-12-03'), r4 = D.find((r) => r[0] === '9001' && r[1] === '2026-12-04');
  t('12/1: 数えなかった時間 0:40・理由は「早出：」＋理由（= で始まる文は式として読まれない形）', r1[iU] === '0:40' && r1[iW] === '早出：=指示の無い早出' && /,早出：=指示の無い早出\r\n/.test(csv.daily), r1);
  t('12/1: 備考（要確認）に早出の確認は出ない・印の列に「早出を認めなかった」', r1[9] === '' && r1[H.indexOf('印')] === '早出を認めなかった', r1);
  t('12/3: 早出と残業の理由を「 ／ 」でつなぐ・1:25', r3[iU] === '1:25' && r3[iW] === '早出：早出, 打ち合わせなし ／ 残業：私用で\n残った "本人"', r3);
  t('12/4（ちょうど）: 0:00・理由は空', r4[iU] === '0:00' && r4[iW] === '', r4);
  const sumUnc = (code) => D.slice(1).filter((r) => r[0] === code).reduce((a, r) => a + hmToMin(r[iU]), 0);
  const Sm = rows(csv.summary), iS = Sm[0].indexOf('数えなかった時間');
  const sOf = (code) => hmToMin(Sm.find((r) => r[0] === code)[iS]);
  t('人ごとの日の「数えなかった時間」の合計＝集計の「数えなかった時間」（sT01 170分・sT02 95分）', sumUnc('9001') === sOf('9001') && sumUnc('9002') === sOf('9002') && sOf('9001') === 170 && sOf('9002') === 95, [sumUnc('9001'), sOf('9001'), sumUnc('9002'), sOf('9002')]);
  t('10進の時間（csvTime dec）でも同じ列に出る', rows(C.buildCsv(month(S, PUN, days, { csvTime: 'dec' }), { extraCols: true }).daily).find((r) => r[0] === '9001' && r[1] === '2026-12-01')[iU] === '0.67');
  const plain = C.buildCsv(m, { nameOf: (d) => d + '事業所' });
  t('extraCols を付けない時（v1 の列）は2列を足さない', plain.daily.split('\r\n')[0] === C.DAILY_HEAD.join(','));
  /* 有休だけの日の行（有休の行の形）も列がそろう */
  const S3 = build({ sT01: { 5: '有' } });
  const csv3 = C.buildCsv(month(S3, [], []), { extraCols: true });
  const r5 = rows(csv3.daily).find((r) => r[1] === '2026-12-05');
  t('有休だけの日の行も列の数がそろい、数えなかった時間 0:00・理由は空', r5 && r5.length === H.length && r5[iU] === '0:00' && r5[iW] === '', r5);
}

{
  const S4 = build({ sT01: { 8: '早' } });
  pid = 400;
  const m4 = month(S4, [P('sT01', 'in', '2026-12-08', '6:50'), P('sT01', 'out', '2026-12-08', '6:55')], []);
  const b4 = blk(m4, 'sT01', '2026-12-08');
  const both = [C.buildCsv(m4, { extraCols: true }).daily, C.buildCsv(m4, {}).daily];
  t('理由の無い月: 数えた区間が無く要確認の印も無い塊（6:50〜6:55 だけ・数えなかった 5分）は、日ごとの CSV に行を足さない（前と同じ行の数）',
    b4.countStart == null && b4.uncountedMin === 5 && !C.needsReview(b4) && both.every((c) => c.split('\r\n').filter((l) => l.indexOf('9001,2026-12-08') === 0).length === 0), [b4.flags, b4.uncountedMin]);
}

console.log('\n— 4. 要確認の印のどれにも決める道がある —');
{
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  const known = ['early', 'overtime', 'missing_out', 'missing_in', 'no_punch', 'no_schedule', 'offline', 'after_lock'];
  t('要確認の印は8つ（増やした時はこの試験と決める窓の道を一緒に直す）', Object.keys(C.REVIEW).sort().join() === known.slice().sort().join(), Object.keys(C.REVIEW));
  t('確認済みの印（day_mark checked）は8つのどの印も要確認から外す（打刻の漏れ・控え・予定なし・締めた後の打刻の道）',
    known.every((f) => !C.needsReview({ flags: [f, 'checked'], checked: true })) && known.every((f) => C.needsReview({ flags: [f], checked: false })));
  const mi = /var MISS = \{([^}]*)\}/.exec(K);
  const missKeys = mi ? mi[1].split(',').map((x) => x.split(':')[0].trim()).sort() : [];
  t('決める窓: 打刻の漏れ（missing_in・missing_out・no_punch）は「直す」へ回し、ほかの印（控え・予定なし・締めた後）は「認める（確認済み）」を出す', missKeys.join() === 'missing_in,missing_out,no_punch', missKeys);
}

console.log('\n— 5. 画面（kintai.js）—');
{
  const K = fs.readFileSync(path.join(ROOT, 'kintai.js'), 'utf8');
  const between = (a, b) => { const i = K.indexOf(a), j = K.indexOf(b, i + 1); return i >= 0 && j > i ? K.slice(i, j) : ''; };
  const fnSrc = (name) => { const i = K.indexOf('  function ' + name + '('); if (i < 0) return ''; const j = K.indexOf('\n  }\n', i); return K.slice(i, j + 4); };
  const goFn = between('function lockGo(', 'function unlockMonth(');
  t('「締める」を押して読み直した後に要確認が残れば止める（締めの関数を呼ぶ前・読み直しの後）',
    /if \(now\.review > 0\) \{ busy = false; openLock\(now, null, blk\); return; \}/.test(goFn) && goFn.indexOf('now.review > 0') > goFn.indexOf('recompute()') && goFn.indexOf('now.review > 0') < goFn.indexOf("rpc('kintai_month_lock'"));
  const ol = fnSrc('openLock');
  t('締めの窓: 要確認が残る時は「締められません」の帯と「要確認を1件目から決める」・「締める」のボタンを出さない',
    /fig\.review \? '<div class="band ng" role="alert">要確認が '/.test(ol) && /data-act="rvd-start"/.test(ol) && /, bl\.length > 0 \|\| fig\.review > 0, '締める', 'lock-go'\);/.test(ol));
  t('「残ったまま締めると…給与へ渡ります」の帯（残ったまま締められる前提の文）は消した', K.indexOf('残ったまま締めると') < 0 && K.indexOf('残ったままでも締められます') < 0);
  t('DB の断り review の文（前の版の画面から締めた時）', /review: '要確認が残っているため締められません/.test(K));
  /* 締めの窓を偽の部品で開く */
  {
    const src = ol;
    const run = (fig) => { const out = {}; new Function('FIG', 'OUT', `var dlgCtx = null, ym = '2026-12'; function perLabel() { return '12月分'; } function esc(s) { return String(s); } function md(d) { return d; } function fm(m) { return String(m); }
      function openDlg(t, b, lk, sl, sa) { OUT.title = t; OUT.body = b; OUT.noSave = lk; OUT.act = sa; }
      ${src}\nopenLock(FIG, null, []);`)(fig, out); return out; };
    const a = run({ review: 2, rvPeople: 1, people: 3, worked: 2, workMin: 600, absent: 0 }), b = run({ review: 0, rvPeople: 0, people: 3, worked: 2, workMin: 600, absent: 0 });
    t('締めの窓（偽の部品で開く）: 要確認 2件なら保存のボタン無し・帯あり／0件なら「締める」が出る', a.noSave === true && /要確認が 2 件（1 人）残っているため、締められません/.test(a.body) && b.noSave === false && b.act === 'lock-go' && b.body.indexOf('締められません') < 0, [a.noSave, b.noSave]);
  }
  /* 決める窓の保存を偽の部品で動かす */
  {
    const src = fnSrc('saveDecide');
    const run = (ctx, radios, why) => {
      const out = { sent: [], msg: '' };
      const fakeMsg = { set textContent(v) { out.msg = v; }, get textContent() { return out.msg; } };
      new Function('CTX', 'R', 'WHY', 'OUT', 'MSG', `var dlgCtx = CTX, busy = false, editsCache = null;
        function $(id) { if (id === 'e-msg') return MSG; if (id === 'e-reason') return { value: WHY, focus: function () {} }; if (id === 'g-dlg') return { open: true }; return null; }
        function radioVal(n) { return R[n] || ''; } function pressBusy() { return function () {}; } function toast() {} function sync() {} function closeDlg() {} function nameOf(s) { return s; } function md(d) { return d; } function note() {} function msgOf(e) { return String(e); } function nextDecide() {}
        function okOr(r) { return r; } function load() { return { then: function (f) { f(); } }; }
        function rpc(f, a) { OUT.sent.push([f, a]); return { then: function (g) { g({ ok: true }); return { then: function (h) { h && h(); return { 'catch': function () {} }; }, 'catch': function () {} }; } }; }
        ${src}\nsaveDecide(null);`)(ctx, radios, why, out, fakeMsg);
      return out;
    };
    const ctx = (o) => Object.assign({ mode: 'rvd', sid: 'sT01', date: '2026-12-03', rev: 3, dn: { rev: 3 }, early: true, ot: true, ck: false }, o || {});
    const n1 = run(ctx(), {}, '');
    t('決める窓: 早出・残業のどちらも選ばないと送らない（初めの値を「決めた」と数えない）', n1.sent.length === 0 && /早出を「認める」か「認めない」かを選んでください/.test(n1.msg), n1);
    const n2 = run(ctx(), { 'd-em': 'ok' }, '');
    t('決める窓: 残業を選んでいなければ送らない', n2.sent.length === 0 && /残業を/.test(n2.msg), n2);
    const n3 = run(ctx(), { 'd-em': 'ng', 'd-om': 'ok' }, '  ');
    t('決める窓: 認めない時に理由が空なら送らない', n3.sent.length === 0 && /認めない理由を書いてください/.test(n3.msg), n3);
    const n4 = run(ctx({ dn: { rev: 3, early_from: '2026-12-03T06:40:00+09:00', ot_ng: '前の理由' } }), { 'd-em': 'ng', 'd-om': 'ok' }, ' 指示の無い早出 ');
    const a4 = n4.sent[0] && n4.sent[0][1];
    t('決める窓: 早出を認めない＝early_ng に理由だけ（区切って認めた時刻 early_from は消さない＝ほかの勤務の数えを変えない）／残業を認める＝overtime_ok と前の「認めない」を外す・理由は p_reason にも',
      n4.sent.length === 1 && n4.sent[0][0] === 'kintai_day_put' && a4.p_patch.early_ng === '指示の無い早出' && !('early_from' in a4.p_patch) && !('early_ok' in a4.p_patch) &&
      a4.p_patch.overtime_ok === true && a4.p_patch.ot_ng === null && a4.p_reason === '指示の無い早出' && a4.p_rev === 3 && a4.p_staff_id === 'sT01' && a4.p_date === '2026-12-03', a4);
    const allowed = ['early_ok', 'overtime_ok', 'break_min', 'note', 'day_mark', 'early_from', 'ot_until', 'early_ng', 'ot_ng'];
    t('決める窓: 送る鍵は DB（0120 の kintai_day_put）が受ける鍵だけ', n4.sent.every((s) => Object.keys(s[1].p_patch).every((k) => allowed.indexOf(k) >= 0)));
    const n5 = run(ctx({ early: false, ot: false, ck: true }), { 'd-ck': 'ok' }, '');
    t('決める窓: 控え・予定なしだけの日は「認める」で確認済み（day_mark checked）・理由の空は決まった文', n5.sent.length === 1 && JSON.stringify(n5.sent[0][1].p_patch) === '{"day_mark":"checked"}' && n5.sent[0][1].p_reason === '締めの前の確かめで認めた', n5.sent);
    const n6 = run(ctx({ dn: { rev: 3, overtime_ok: true } }), { 'd-em': 'ok', 'd-om': 'ng' }, '私用');
    t('決める窓: 残業を認めない時は「全部認める」を外して理由（並べない）', n6.sent[0][1].p_patch.overtime_ok === false && n6.sent[0][1].p_patch.ot_ng === '私用' && n6.sent[0][1].p_patch.early_ok === true, n6.sent[0][1].p_patch);
    const n7 = run(ctx({ ck: true }), { 'd-em': 'ok', 'd-om': 'ok' }, '');
    t('決める窓: 早出・残業と並ぶ「ほかの要確認」も選ばないと送らない（決めた日が要確認に残らない）', n7.sent.length === 0 && /ほかの要確認も「認める」を選ぶか/.test(n7.msg), n7);
    const n8 = run(ctx({ ck: true }), { 'd-em': 'ng', 'd-om': 'ok', 'd-ck': 'ok' }, '私用');
    t('決める窓: 3つとも選べば1回で送る（early_ng・overtime_ok・day_mark checked）', n8.sent.length === 1 && n8.sent[0][1].p_patch.early_ng === '私用' && n8.sent[0][1].p_patch.overtime_ok === true && n8.sent[0][1].p_patch.day_mark === 'checked', n8.sent);
  }
  /* 決める窓を偽の部品で開く: 時刻を区切って認めてある日は「認める」を出さない（日全体の承認に広がるため・反証レビュー 2026-11-21） */
  {
    const S2 = build({ sT01: { 4: '7-9 17-21' } });
    pid = 300;
    const pun2 = [P('sT01', 'in', '2026-12-04', '6:20'), P('sT01', 'out', '2026-12-04', '9:00'), P('sT01', 'in', '2026-12-04', '16:20'), P('sT01', 'out', '2026-12-04', '21:00')];
    const dn = { staff_id: 'sT01', work_date: '2026-12-04', early_from: new Date(at('2026-12-04', '16:40')).toISOString(), rev: 2 };
    const m = month(S2, pun2, [dn]);
    const src = fnSrc('openDecide');
    const out = {};
    new Function('C', 'M', 'DN', 'OUT', `var month = M, data = { days: [DN] }, busy = false, dlgCtx = null; var MISS = { missing_in: 1, missing_out: 1, no_punch: 1 }, DECIDE_REASONS = ['その他'];
      function isLocked() { return false; } function toast() {} function personOf(s) { return M.people.filter(function (p) { return p.staff.staff_id === s; })[0]; }
      function esc(s) { return String(s); } function hm(v) { var d = new Date(typeof v === 'number' ? v : Date.parse(v)); return ('0' + ((d.getUTCHours() + 9) % 24)).slice(-2) + ':' + ('0' + d.getUTCMinutes()).slice(-2); } function fm(m) { return String(m); }
      function schedText() { return ''; } function countText() { return ''; } function flagTags() { return ''; } function rawPunches() { return ''; } function nameOf(s) { return s; } function md(d) { return d; } function wd() { return ''; }
      function openDlg(t, b, lk) { OUT.body = b; OUT.noSave = lk; } function addFootBtn() {} function formState() { return ''; }
      ${src}
openDecide(0); OUT.ctx = dlgCtx;`)(C, m, dn, out);
    t('決める窓: 時刻を区切って認めてある日（分割勤務の2つ目を 16:40 から）は、早出の「認める」を出さず、「認めない」と直す窓への案内だけ',
      out.ctx && out.ctx.early === true && out.body.indexOf('name="d-em" value="ok"') < 0 && out.body.indexOf('name="d-em" value="ng"') > 0 && /16:40 から」と時刻を区切って認めてあります/.test(out.body), out.body && out.body.slice(0, 300));
    /* 送る形（early_ng だけ）を数えに通すと、区切って認めた2つ目の勤務の実働は変わらない */
    const after = month(S2, pun2, [Object.assign({}, dn, { early_ng: '私用' })]);
    const bA = dayOf(after, 'sT01', '2026-12-04').blocks, bB = dayOf(m, 'sT01', '2026-12-04').blocks;
    t('分割勤務: 1つ目を認めないにしても、16:40 から認めた2つ目の実働・日の実働は同じ・1つ目は要確認から外れる',
      bA.length === 2 && bA[1].workMin === bB[1].workMin && dayOf(after, 'sT01', '2026-12-04').workMin === dayOf(m, 'sT01', '2026-12-04').workMin && !C.needsReview(bA[0]) && bA[0].flags.indexOf('early_ng') >= 0, [bA.map((x) => x.workMin), bB.map((x) => x.workMin), bA[0].flags]);
  }
  const se0 = fnSrc('saveEdit');
  t('直す窓: 早出・残業が「まだ決めない」のまま「確認済み」にはさせない（理由の無いまま締められる抜け道を閉じる）',
    /if \(mark === 'checked' && dn\.day_mark !== 'checked'\)/.test(se0) && /が「まだ決めない」のままでは確認済みにできません/.test(se0) && se0.indexOf("undec.length") < se0.indexOf("patch.day_mark = mark"));
  t('直す窓: 「この時刻から／まで」を選んだ日は認めない理由を外さない（「まだ決めない」「全部認める」の時だけ外す）', /else if \(\(em === 'none' \|\| em === 'all'\) && dn\.early_ng\)/.test(se0) && /else if \(\(om === 'none' \|\| om === 'all'\) && dn\.ot_ng\)/.test(se0));
  {
  const od = fnSrc('openDecide');
  t('決める窓: ラジオは初めにどれも選んでいない（checked を付けない）・理由の欄は200字まで', od.length > 0 && !/name="d-[eoc][mk]" value="[a-z]+" checked/.test(od) && od.indexOf(' checked>') < 0 && /id="e-reason" maxlength="200"/.test(od));
  t('決める窓: 締めた月は開かない・打刻の漏れは「打刻・欠勤を直す」へ', /if \(isLocked\(\)\) \{ toast\(/.test(od) && /addFootBtn\('打刻・欠勤を直す', 'rvd-edit'\)/.test(od));
  const se = fnSrc('saveEdit');
  t('直す窓: 「認めない」に替えた時だけ理由を early_ng・ot_ng に送り、「まだ決めない」「全部認める」へ替えた時は外す', /if \(em === 'ng' && !dn\.early_ng\) \{ patch\.early_ng = reason;/.test(se) && /else if \(\(em === 'none' \|\| em === 'all'\) && dn\.early_ng\) \{ patch\.early_ng = null;/.test(se) && /if \(om === 'ng' && !dn\.ot_ng\) \{ patch\.ot_ng = reason;/.test(se));
  t('直す窓: 「まだ決めない」と「認めない（理由を残す）」を分けて出す', /まだ決めない（予定の開始から数える・要確認に残る）/.test(K) && /認めない（予定の開始から数える・理由を残す）/.test(K) && /まだ決めない（予定の終わりまで数える・要確認に残る）/.test(K));
  t('直しの履歴: 認めない理由の前後を言う', /早出を認めなかった（「' \+ a\.early_ng/.test(K) && /残業の「認めない」を外した/.test(K));
  t('console.log を足していない', K.indexOf('console.log') < 0);
  /* 2026-11-26: 要確認が残る間はこのボタンを画面の塗り（主ボタン）にした（検品の指摘・本人指示）。紙に出さないのはそのまま */
  t('締めと出力の「要確認を1件目から決める」は紙に出さない（no-print）', /<div class="row no-print"><button type="button" class="btn pri" data-act="rvd-start">/.test(K));
  }
}

console.log('\n' + pass + ' 件合格 / ' + fail + ' 件不合格');
process.exit(fail ? 1 : 0);
