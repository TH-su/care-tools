/* 申送ビューア（moushiokuri-viewer.html）の平熱・摂取低下・濃淡（A1・A2・A6）と排泄タブの純関数の試験（2026-10-17 新設・本人指示）
   実行: node check/unit/msk_excretion_test.js（MSK_HTML で別の moushiokuri-viewer.html を当てられる）

   確かめること:
     1. 平熱（A1）: 直近30日・1日1回分の体温の中央値（0.1℃単位・偶数個は真ん中2つの平均・小数1桁へ四捨五入）、5回未満は出さない、
        平熱+1.0℃以上で「平熱+X↑」（境目は 0.1℃ 単位の整数で比べる）
     2. 摂取低下（A2）: 主＋副が10以下の食事が1日に2食以上で「▼摂取低下」、続いた日は「（N日目）」、記録の無い日で切れる
     3. 濃淡（A6）: 段階の境目と半分以下の斜線が care-log の intakeShade と同じ
     4. 照合: 氏名（空白だけ吸収）＋居室（NFKC・空白・号室）の両方一致の時だけ。同名2人以上・居室の食い違いは結ばない
     5. 読み方: 余白込みで直近14日に収まる時は getAll 1回、長い時は getDays を7日ずつ
     6. 排便の判定: 排便記録アプリの elH〜lastR（写し元を一字一句写した msk_haiben_stool_judge.src.txt）と同じ入力で同じ答え
     7. 接続設定は読むだけ（書かない）・記録を端末に残さない・読み取りの action だけ
     8b. 読み込んだ範囲の切れ目（2026-10-17 反証レビュー）: 全件を写し元に通した答えと、余白込み開始日で切ったビューアの答えを比べ、
        「最後の排便から◯日」は完全一致・「◯日以上」は本当以下・カレンダーの地は本当以下（読めなかった日を混ぜても）
     10. 排泄の読み込み（excLoad の実関数）: 古い表示を下ろす・通信中に変わった期間を追いかける・失敗時は追いかけない
   ★個人情報は置かない（入居者は記号の 利用者01 など・居室は数字だけ）。 */
'use strict';
/* 排便記録アプリもビューアも日本時間の端末で動く。CI（UTC）でも同じ答えにするため、この試験だけ日本時間にする */
process.env.TZ = 'Asia/Tokyo';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.MSK_HTML || path.join(ROOT, 'moushiokuri-viewer.html'), 'utf8');
const FIXTURE = path.join(__dirname, 'msk_haiben_stool_judge.src.txt');
const HAIBEN_HTML = '/Users/Takeshi/Claude/Repos/haiben-record/haiben-record.html';

let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

/* ── 切り出し（文字列とコメントの中のかっこを数えない） ── */
function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '/' && /[=(,:;!&|?{}\n]\s*$/.test(src.slice(Math.max(0, i - 3), i)) && n !== '/' && n !== '*') {
      /* 正規表現の文字列（/…/）を読み飛ばす */
      let j = i + 1, cls = false;
      for (; j < src.length; j++) {
        const ch = src[j];
        if (ch === '\\') { j++; continue; }
        if (ch === '[') cls = true; else if (ch === ']') cls = false;
        else if (ch === '/' && !cls) break;
        else if (ch === '\n') break;
      }
      i = j; continue;
    }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}
function grabDecl(name) {
  const m = new RegExp('^var\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  const vpos = m.index + m[0].length;
  const open = SRC[vpos];
  if (open === '{' || open === '[') {
    const end = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']');
    let j = end + 1; while (j < SRC.length && SRC[j] !== ';') j++;
    return SRC.slice(m.index, j + 1);
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol);
}

const FNS = ['z2', 'okYmd', 'ymd', 'addDays', 'normName', 'rosterByNorm', 'kanaKey', 'byKana', 'mergeBy',
  'vmTenths', 'vmFmtTenths', 'vmNum', 'vmUsualTemp', 'vmUsualFrom', 'vmUsualByName', 'vmJudgeUsual', 'vmFmtUsual',
  'vmMealDayLow', 'vmMealLowStreaks', 'vmMealLowLabel', 'vmIntakeShade',
  'excReadCfg', 'excJstDay', 'excAddDays', 'excDayMs', 'excPlan', 'excRefNow',
  'excToKey', 'excFiniteNum', 'excNormRoom', 'excNameKey', 'excLocalDt', 'excNormDate', 'excConsOf',
  'excParseRecord', 'excParseResident', 'excParsePayload',
  'excStoolResetSeries', 'excLastStoolReset', 'excFreezeIfHosp', 'excElapsedH', 'excStoolCfgOf', 'excStoolLevel',
  'excRecMs', 'excStatusOf', 'excStatusText', 'excMatch', 'excRows', 'excDays', 'excCalendar', 'excDayLevel'];
const DECLS = ['VM_USUAL_RISE', 'VM_USUAL_DAYS', 'VM_USUAL_MIN', 'VM_MEAL_HALF',
  'EXC_LS_URL_KEYS', 'EXC_LS_TOKEN_KEYS', 'EXC_GAS_RE', 'EXC_RECENT_DAYS', 'EXC_GETDAYS_MAX', 'EXC_MARGIN_DAYS',
  'EXC_DEFAULT_STOOL', 'EXC_SC_COLOR', 'EXC_BRISTOL', 'EXC_STOOL_SMALL_N'];   // EXC_STOOL_SMALL_N の行に _WIN_H も宣言されている

function makeBox() {
  const box = { console, ROSTER: [], lsGet: () => null };
  vm.createContext(box);
  /* EXC_STOOL_SMALL_N と _WIN_H は1行で宣言されている */
  vm.runInContext(DECLS.map(grabDecl).join('\n') + '\n' + FNS.map(grabFn).join('\n'), box);
  return box;
}
const X = makeBox();

/* ══════════════════════════════════════════════════════════ */
group('1. 平熱（A1）');
{
  eq('5回未満は平熱なし', X.vmUsualTemp([36.5, 36.6, 36.4, 36.7]), null);
  eq('5回（奇数）は真ん中', X.vmUsualTemp([36.9, 36.1, 36.5, 36.3, 36.7]), 36.5);
  eq('6回（偶数）は真ん中2つの平均', X.vmUsualTemp([36.2, 36.4, 36.6, 36.8, 36.0, 37.0]), 36.5);
  eq('偶数で .05 になる時は四捨五入（36.4 と 36.5 → 36.5）', X.vmUsualTemp([36.0, 36.1, 36.4, 36.5, 36.9, 37.0]), 36.5);
  eq('数でない値は数えない', X.vmUsualTemp([36.5, null, '36.5', 36.4, 36.6, 36.5, NaN]), null);
  eq('表示は小数1桁', X.vmFmtUsual(36), '36.0');
  eq('平熱+1.0 ちょうどで印', X.vmJudgeUsual(37.5, 36.5).mark, '平熱+1.0↑');
  eq('平熱+0.9 は印なし', X.vmJudgeUsual(37.4, 36.5).mark, null);
  eq('浮動小数の誤差で外れない（37.3−36.3）', X.vmJudgeUsual(37.3, 36.3).over, true);
  eq('平熱なしなら印なし', X.vmJudgeUsual(38.5, null).mark, null);
  eq('差の文字（+1.7）', X.vmJudgeUsual(38.2, 36.5).mark, '平熱+1.7↑');
  eq('30日の開始日（終了日を含む）', X.vmUsualFrom('2026-10-17'), '2026-09-18');
  /* 1日1行に統合してから数える・30日の外は数えない */
  const rows = [];
  ['2026-10-13', '2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].forEach((d, i) => rows.push({ date: d, name: '利用者01', temp: 36.3 + i * 0.1 }));
  rows.push({ date: '2026-10-17', name: '利用者01', temp: null });          // 同じ日の2件目（体温なし）
  rows.push({ date: '2026-10-16', name: '利用者 01', temp: 39.0 });         // 同じ日の2件目（空白違いの同じ方）＝先に値のある方が残る
  rows.push({ date: '2026-09-17', name: '利用者01', temp: 35.0 });          // 30日より前
  rows.push({ date: '2026-10-17', name: '利用者02', temp: 36.8 });
  const by = X.vmUsualByName(rows, '2026-09-18', '2026-10-17');
  eq('1日1回分・30日の中だけで5回（36.3〜36.7 の中央値）', by['利用者01'], 36.5);
  eq('5回未満の方は null', by['利用者02'], null);
}

group('2. 摂取低下（A2）');
{
  eq('2食が半分以下で低下', X.vmMealDayLow({ bMain: 5, bSide: 5, lMain: 4, lSide: 2, dMain: 10, dSide: 10 }).low, true);
  eq('1食だけでは低下でない', X.vmMealDayLow({ bMain: 5, bSide: 6, lMain: 4, lSide: 2, dMain: 10, dSide: 10 }).low, false);
  eq('主＋副 11 は半分より多い', X.vmMealDayLow({ bMain: 6, bSide: 5, lMain: 6, lSide: 5 }).half, 0);
  eq('片方だけの記録も数える（副だけ 3）', X.vmMealDayLow({ bSide: 3, lMain: 2 }).low, true);
  eq('両方無い食事は数えない', X.vmMealDayLow({ bMain: 2 }).counted, 1);
  const dates = ['2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14'];
  const low = { bMain: 3, bSide: 3, lMain: 3, lSide: 3, dMain: 3, dSide: 3 };
  const st = X.vmMealLowStreaks({ '2026-10-10': low, '2026-10-11': low, '2026-10-12': low, '2026-10-14': low }, dates);
  eq('連続日数（記録の無い日で切れる）', dates.map(d => st[d]), [1, 2, 3, 0, 1]);
  eq('1日目の文言', X.vmMealLowLabel(1), '▼摂取低下');
  eq('2日目からの文言', X.vmMealLowLabel(3), '▼摂取低下（3日目）');
  eq('0 は空', X.vmMealLowLabel(0), '');
}

group('3. 濃淡（A6・intakeShade と同じ境目）');
{
  eq('0〜10 の段階', [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(v => X.vmIntakeShade(v, 10).stage), [0, 0, 0, 1, 1, 1, 2, 2, 3, 3, 4]);
  eq('半分以下（5以下）だけ斜線', [4, 5, 6].map(v => X.vmIntakeShade(v, 10).hatched), [true, true, false]);
  eq('範囲外は端にそろえる', [X.vmIntakeShade(-1, 10).stage, X.vmIntakeShade(12, 10).stage], [0, 4]);
  eq('値が無ければ null', X.vmIntakeShade(null, 10), null);
  eq('食事の表だけに濃淡を付ける呼び出し', /vmTable\(dates, VM_MEALS, mBy, \{ shade:true/.test(SRC) && !/vmTable\(dates, VM_SERIES, vBy, \{[^}]*shade/.test(SRC), true);
}

group('4. 照合（氏名＋居室の両方一致の時だけ）');
{
  const hb = (id, name, room, extra) => X.excParseResident(Object.assign({ id, name, room }, extra || {}));
  const list = [hb(1, '利用者 01', '101'), hb(2, '利用者02', '２０２号室'), hb(3, '利用者03', '103'), hb(4, '利用者03', '104'),
    hb(5, '利用者05', '105'), hb(6, '利用者05', '106', { hidden: true }), hb(7, '利用者07', ''), hb(8, '利用者08', '108')];
  const roster = [{ name: '利用者01', room: '101' }, { name: '利用者02', room: '202' }, { name: '利用者03', room: '103' },
    { name: '利用者05', room: '105号室' }, { name: '利用者07', room: '107' }, { name: '利用者08', room: '109' },
    { name: '利用者09', room: '110' }, { name: '利用者09', room: '111' }];
  eq('空白違いは同じ方', X.excMatch(list[0], roster, list).ok, true);
  eq('全角・号室は吸収', X.excMatch(list[1], roster, list).ok, true);
  eq('排便記録に同名2人は結ばない', X.excMatch(list[2], roster, list).reason, 'dupHaiben');
  eq('非表示の方は同名に数えない', X.excMatch(list[4], roster, list).ok, true);
  eq('居室が空は結ばない', X.excMatch(list[6], roster, list).reason, 'roomMismatch');
  eq('居室の食い違いは結ばない', X.excMatch(list[7], roster, list).reason, 'roomMismatch');
  eq('名簿に同名2人は結ばない', X.excMatch(hb(9, '利用者09', '110'), roster, list).reason, 'dupRoster');
  eq('名簿に居ない', X.excMatch(hb(10, '利用者10', '112'), roster, list).reason, 'notFound');
  eq('敬称は取らない（様つきは別の名前）', X.excNameKey(' 利用者 01 様'), '利用者01様');
}

group('5. 読み方（14日以内は getAll 1回・長いと getDays を7日ずつ）');
{
  const now = Date.parse('2026-10-17T10:00:00+09:00');
  const p1 = X.excPlan('2026-10-03', '2026-10-17', now);   // 余白込み 10/3〜＝今日−14日ちょうど
  eq('14日以内は getAll', [p1.mode, p1.chunks.length], ['getAll', 0]);
  eq('since は余白込み開始日の0時（日本時間）', p1.since, Date.parse('2026-10-03T00:00:00+09:00'));
  const p2 = X.excPlan('2026-10-02', '2026-10-17', now);
  eq('1日でもはみ出せば getDays', p2.mode, 'getDays');
  const p3 = X.excPlan('2026-09-16', '2026-10-17', now);   // 32日
  const flat = [].concat.apply([], p3.chunks);
  eq('32日は7日ずつ5回', p3.chunks.map(c => c.length), [7, 7, 7, 7, 4]);
  eq('抜けも重なりもない', [flat[0], flat[flat.length - 1], flat.length, new Set(flat).size], ['2026-09-16', '2026-10-17', 32, 32]);
  eq('過去の終了日は翌日0時で数える', X.excRefNow('2026-10-10', now), { ms: Date.parse('2026-10-11T00:00:00+09:00'), past: true });
  eq('終了日が今日なら今', X.excRefNow('2026-10-17', now), { ms: now, past: false });
}

group('6. 接続設定は読むだけ・記録は持たない項目を捨てる');
{
  const store = { hbcr_api_url_bak: 'https://script.google.com/macros/s/AKfyTEST/exec', hbcr_api_token_bak: 'x' };
  const get = k => (k in store ? store[k] : null);
  eq('予備のキーから読む', X.excReadCfg(get), { url: store.hbcr_api_url_bak, token: 'x' });
  eq('合言葉が無ければ未設定', X.excReadCfg(k => (k === 'hbcr_api_url' ? store.hbcr_api_url_bak : null)), null);
  eq('GAS の形式でなければ送らない', X.excReadCfg(k => (k === 'hbcr_api_url' ? 'https://example.com/x' : (k === 'hbcr_api_token' ? 't' : null))), 'invalid');
  const exc = SRC.slice(SRC.indexOf('var EXC_LS_URL_KEYS'), SRC.indexOf('var excPrintReady_'));
  eq('排泄の部分で localStorage に書かない', /lsSet\(|setItem|removeItem|indexedDB/i.test(exc), false);
  eq('排泄の部分で console に出さない', /console\./.test(exc), false);
  eq('送る action は読み取りの2つだけ', (exc.match(/action:'[a-zA-Z]+'/g) || []).sort(), ["action:'getAll'", "action:'getDays'"]);
  eq('合言葉は本文にだけ載せる（URL に足さない）', /token=|\?token/.test(exc), false);
  eq('本文は text/plain', exc.indexOf("'Content-Type':'text/plain;charset=utf-8'") >= 0, true);
  eq('待ちは30秒', /var EXC_TIMEOUT_MS\s*=\s*30000;/.test(SRC), true);
  const snap = X.excParsePayload({
    residents: [{ id: '1', name: '利用者01', room: '101' }],
    records: [{ id: 'a', residentId: 1, type: 'stool', date: '2026-10-10', time: '9:05', stoolAmt: '中等量', consistency: '普通', notes: 'メモ', staff: '記入者' },
      { id: 'b', residentId: 1, type: 'stool', date: '2026-10-01', time: '09:00', stoolAmt: '多量' },
      { id: 'c', residentId: 1, type: 'urine', date: '2026-10-20', time: '09:00' }],
    cfg: { stoolWarnD: 3 }
  }, '2026-10-05', '2026-10-17');
  const r = snap.recs['1'];
  eq('期間外の日付は捨てる', r.map(x => x.id), ['a']);
  eq('メモ・記入者は持たない', ['notes', 'staff'].some(k => k in r[0]), false);
  eq('時刻は 09:05 にそろえる', r[0].time, '09:05');
  eq('全体の cfg を既定に重ねる', snap.cfg, { stoolWarnD: 3, stoolDangerD: 3 });
}

group('7. 一覧・日ごとの表・カレンダー');
{
  const now = Date.parse('2026-10-17T12:00:00+09:00');
  const snap = X.excParsePayload({
    residents: [{ id: 1, name: '利用者01', room: '101' }, { id: 2, name: '利用者02', room: '102' }, { id: 3, name: '利用者03', room: '103' },
      { id: 4, name: '利用者04', room: '104', active: false },
      { id: 5, name: '利用者05', room: '105' }],
    records: [{ id: 'a', residentId: 1, type: 'stool', date: '2026-10-16', time: '20:00', stoolAmt: '中等量' },
      { id: 'b', residentId: 2, type: 'stool', date: '2026-10-14', time: '08:00', stoolAmt: '多量' },
      { id: 'f', residentId: 5, type: 'stool', date: '2026-10-15', time: '10:00', stoolAmt: '多量' },
      { id: 'c', residentId: 1, type: 'urine', date: '2026-10-16', time: '07:00' },
      { id: 'd', residentId: 1, type: 'both', date: '2026-10-16', time: '06:00', stoolAmt: '少量' },
      { id: 'e', residentId: 1, type: 'laxative', date: '2026-10-15', time: '21:00', medicine: '下剤A', tablets: 2 }]
  }, '2026-10-01', '2026-10-17');
  const rows = X.excRows(snap, [], now, '2026-10-01', []);
  eq('退居の方は出さない・危険→注意→その他（同じ中は五十音）', rows.map(r => [r.id, r.status.level]), [['2', 'danger'], ['3', 'danger'], ['5', 'warn'], ['1', 'ok']]);
  eq('期間内に排便1回分が無い方は下限（記録が無ければ余白込み開始日の0時から）', X.excStatusText(rows[1].status), '期間内に排便1回分の記録がありません（16日以上）（危険）');
  eq('最後の排便から◯日', X.excStatusText(rows[0].status), '最後の排便から3日（危険）');
  eq('注意', X.excStatusText(rows[2].status), '最後の排便から2日（注意）');
  const fa = X.excStatusOf(snap.recs['2'], snap.residents[1], snap.cfg, now, '2026-10-01', ['2026-10-15']);
  eq('最後の1回分より後に読めない日があれば、その翌日0時からの下限＋明示', X.excStatusText(fa), '最後の排便1回分から1日以上（読めなかった日があります）');
  const fut = X.excParsePayload({ residents: [{ id: 1, name: '利用者01', room: '101' }],
    records: [{ id: 'z', residentId: 1, type: 'stool', date: '2026-10-17', time: '13:00', stoolAmt: '多量' }] }, '2026-10-01', '2026-10-17');
  const fs1 = X.excStatusOf(fut.recs['1'], fut.residents[0], fut.cfg, now, '2026-10-01', []);
  eq('基準時より後の記録は 0日・ok に丸めて知らせる', [fs1.days, fs1.level, fs1.future, X.excStatusText(fs1)], [0, 'ok', true, '最後の排便から0日']);
  eq('その記録の行に印', X.excDays(fut.recs['1'], ['2026-10-17'], [], now)[0].stools[0].future, true);
  const days = X.excDays(snap.recs['1'], ['2026-10-15', '2026-10-16', '2026-10-17'], ['2026-10-17'], now);
  eq('新しい日が上・読めない日は印', days.map(d => [d.day, d.failed]), [['2026-10-17', true], ['2026-10-16', false], ['2026-10-15', false]]);
  eq('排尿の回数（both も数える）・排便は時刻順', [days[1].urine, days[1].stools.map(s => s.time)], [2, ['06:00', '20:00']]);
  eq('下剤（薬名・錠数）', days[2].laxatives, [{ time: '21:00', medicine: '下剤A', tablets: '2' }]);
  const cal = X.excCalendar(snap.recs['2'], snap.residents[1], { stoolWarnD: 2, stoolDangerD: 3 }, '2026-10-12', '2026-10-17', '2026-10-10', [], now);
  const real = cal.filter(c => !c.blank);
  eq('日曜始まり（10/11 から並べ、期間外は空き）', [cal[0].day, cal[0].blank, cal.length % 7], ['2026-10-11', true, 0]);
  eq('その日の終わりの経過で地の色（初めは余白込み開始日からの下限）', real.map(c => c.cls), ['ng', 'ng', '', '', 'w', 'ng']);
}

group('8. 排便の判定の写し（排便記録アプリと同じ入力で同じ答え）');
{
  const raw = fs.readFileSync(FIXTURE, 'utf8');
  const i = raw.indexOf('//@----\n');
  const head = raw.slice(0, i), code = raw.slice(i + '//@----\n'.length);
  eq('fixture の見出しに写し元のコミットと行', /コミット: [0-9a-f]{40}/.test(head) && /行: \d+〜\d+/.test(head), true);
  eq('fixture は elH から lastR まで', [/^function elH\(dt,rid\)\{/.test(code), /function lastR\(rid,t\)\{/.test(code)], [true, true]);
  if (fs.existsSync(HAIBEN_HTML)) {
    const html = fs.readFileSync(HAIBEN_HTML, 'utf8');
    const a = html.indexOf('function elH(dt,rid){'), b = html.indexOf('/* 記録が途切れた期間とみなす');
    eq('写し元の elH〜lastR が fixture と一字一句同じ（違えば写しを見直す）', a > 0 && b > a && html.slice(a, b) === code, true);
  } else {
    /* CI など写し元が無い端末。スキップ扱いにせず記録だけ残す（fixture どうしの比べは下で行う） */
    console.log('  （写し元の排便記録アプリがこの端末に無いため、fixture だけで比べる）');
  }

  function loadHaiben(residents, records, cfg, now) {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...a) { if (a.length === 0) super(now); else super(...a); }
      static now() { return now; }
    }
    const ctx = {
      D: { residents, records, cfg }, Date: FixedDate, isNaN, Math, Array,
      recsByRes: rid => records.filter(r => r.residentId === rid).slice().sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''))
    };
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    return ctx;
  }
  const pad = n => String(n).padStart(2, '0');
  const dtOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const NOW = new Date(2026, 9, 16, 15, 0).getTime();
  const H1 = 3600 * 1000;
  let seq = 0;
  const stool = (hAgo, amt, type = 'stool') => { const dt = dtOf(NOW - hAgo * H1); return { id: `r${++seq}`, residentId: 1, type, date: dt.slice(0, 10), time: dt.slice(11, 16), datetime: dt, stoolAmt: amt }; };
  const urine = hAgo => { const dt = dtOf(NOW - hAgo * H1); return { id: `u${++seq}`, residentId: 1, type: 'urine', date: dt.slice(0, 10), time: dt.slice(11, 16), datetime: dt }; };
  function compare({ records, resCfg = null, globalCfg = {}, hospitalizations = null }) {
    const serverRes = Object.assign({ id: 1, name: '利用者01', room: '101', active: true }, resCfg ? { cfg: resCfg } : {});
    if (hospitalizations) serverRes.hospitalizations = hospitalizations;
    const hbRecs = records.map(r => { const o = Object.assign({}, r); if (typeof o.tsUTC !== 'number') { const t = new Date(o.datetime).getTime(); if (!isNaN(t)) o.tsUTC = t; } return o; });
    const H = loadHaiben([Object.assign({}, serverRes)], hbRecs, Object.assign({ urineWarnH: 6, urineDangerH: 8, stoolWarnD: 2, stoolDangerD: 3 }, globalCfg), NOW);
    const ls = H.lastR(1, 's');
    const h = H.elH(ls || null, 1);
    const want = { lastId: ls ? ls.id : null, h, cls: H.badgeCls(h, 's', 1), days: h === null ? null : Math.floor(h / 24) };
    const snap = X.excParsePayload({ residents: [serverRes], records, cfg: globalCfg });
    const pool = snap.recs['1'] || [];
    const res = snap.residents[0];
    const last = X.excLastStoolReset(pool);
    const gh = X.excElapsedH(last, NOW, res.hospitalizations);
    const got = { lastId: last ? last.id : null, h: gh, cls: { ok: 'eb-ok', warn: 'eb-w', danger: 'eb-ng' }[X.excStoolLevel(gh, X.excStoolCfgOf(res, snap.cfg))], days: gh === null ? null : Math.floor(gh / 24) };
    return { want, got };
  }
  const cases = [
    ['記録なし', { records: [] }],
    ['中等量1回（30時間前）', { records: [stool(30, '中等量')] }],
    ['多量1回（80時間前）＝危険', { records: [stool(80, '多量')] }],
    ['量の空欄は1回（50時間前）＝注意', { records: [stool(50, '')] }],
    ['少量1回だけ＝1回と数えない', { records: [stool(70, '多量'), stool(10, '少量')] }],
    ['少量3回（48時間以内）の3回目で1回', { records: [stool(100, '多量'), stool(40, '少量'), stool(20, '少量'), stool(5, '少量')] }],
    ['少量3回が48時間を超える＝鎖を作り直す', { records: [stool(120, '中等量'), stool(60, '少量'), stool(30, '少量'), stool(5, '少量')] }],
    ['少量の間が48時間ちょうどなら同じ鎖', { records: [stool(100, '多量'), stool(60, '少量'), stool(30, '少量'), stool(12, '少量')] }],
    ['少量2回→中等量で1回', { records: [stool(60, '少量'), stool(50, '少量'), stool(40, '中等量'), stool(20, '少量')] }],
    ['both も排便に数える', { records: [urine(3), stool(30, '中等量', 'both'), urine(1)] }],
    ['届いた順がばらばらでも datetime の順', { records: [stool(5, '少量'), stool(40, '少量'), stool(100, '多量'), stool(20, '少量')] }],
    ['入居者の cfg が優先', { records: [stool(100, '多量')], resCfg: { stoolWarnD: 5, stoolDangerD: 7 } }],
    ['全体の cfg', { records: [stool(30, '多量')], globalCfg: { stoolWarnD: 1, stoolDangerD: 2 } }],
    ['入居者の cfg が片方だけ', { records: [stool(60, '多量')], resCfg: { stoolDangerD: 2 }, globalCfg: { stoolWarnD: 1, stoolDangerD: 9 } }],
    ['しきい値ちょうど（48時間）は注意', { records: [stool(48, '多量')] }],
    ['tsUTC が数で届いた記録はそれを優先', { records: [Object.assign(stool(30, '多量'), { tsUTC: NOW - 70 * H1 })] }],
    ['入院中は入院日時で止まる', { records: [stool(100, '多量')], hospitalizations: [{ admissionAt: dtOf(NOW - 60 * H1), dischargeAt: null }] }],
    ['退院済みの入院は止めない', { records: [stool(100, '多量')], hospitalizations: [{ admissionAt: dtOf(NOW - 90 * H1), dischargeAt: dtOf(NOW - 70 * H1) }] }],
  ];
  cases.forEach(([name, input]) => { const { want, got } = compare(input); eq(name, got, want); });

  let s = 20261017;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const amts = ['少量', '少量', '少量', '中等量', '多量', '', null];
  let differ = 0, warnOrDanger = 0;
  for (let n = 0; n < 600; n++) {
    const records = [];
    const k = Math.floor(rnd() * 12);
    for (let i2 = 0; i2 < k; i2++) {
      const hAgo = Math.floor(rnd() * 16 * 24 * 60) / 60;
      const type = rnd() < 0.2 ? 'both' : rnd() < 0.3 ? 'urine' : 'stool';
      records.push(type === 'urine' ? urine(hAgo) : stool(hAgo, amts[Math.floor(rnd() * amts.length)], type));
    }
    const resCfg = rnd() < 0.3 ? { stoolWarnD: 1 + Math.floor(rnd() * 3), stoolDangerD: 3 + Math.floor(rnd() * 3) } : null;
    const { want, got } = compare({ records, resCfg });
    if (JSON.stringify(want) !== JSON.stringify(got)) differ++;
    if (want.cls !== 'eb-ok') warnOrDanger++;
  }
  eq('乱数の600通りで全部同じ', differ, 0);
  eq('注意・危険の側も十分に試せている（100通り超）', warnOrDanger > 100, true);

  /* ══ 8b. 読み込んだ範囲の切れ目（2026-10-17 反証レビューの指摘）══
     全件を写し元に通した「本当の最後の1回分・経過」と、余白込み開始日（fetchFrom）で切って読み込ませたビューアを比べる。
       (i)  ビューアが「最後の排便から◯日」（下限でない）と言う時は、本当の最後の1回分・日数と完全一致
       (ii) 「◯日以上」の時は、表示の日数 ≤ 本当の日数（判定の重さも本当以下）
       (iii) カレンダーの各日の地の段階は本当の段階を超えない（その日の判定が下限でない日は一致）
       (iv) 読めなかった日を混ぜても (i)〜(iii) が成り立つ */
  const H = loadHaiben([{ id: 1, name: '利用者01', room: '101', active: true }], [], { urineWarnH: 6, urineDangerH: 8, stoolWarnD: 2, stoolDangerD: 3 }, NOW);
  const CFG = { stoolWarnD: 2, stoolDangerD: 3 };
  const rankOf = h => (h === Infinity || h / 24 >= 3) ? 2 : (h / 24 >= 2 ? 1 : 0);
  const lvRank = { ok: 0, warn: 1, danger: 2 };
  const clsRank = { '': 0, w: 1, ng: 2 };
  /* 本当の最後の1回分（写し元の stoolResetSeries を全件に）と、時点 T での経過（時間）。無ければ Infinity */
  function truthAt(all, T, day) {
    /* day を渡すとその日までの記録（0時ちょうどの記録は翌日の分＝ビューアのカレンダーと同じ切り方） */
    const st = all.filter(r => (r.type === 'stool' || r.type === 'both') && new Date(r.datetime).getTime() <= T && (!day || r.date <= day))
      .slice().sort((a, b) => (a.datetime || '').localeCompare(b.datetime || ''));
    const ser = H.stoolResetSeries(st);
    const last = ser.length ? ser[ser.length - 1] : null;
    return { last, h: last ? (T - new Date(last.datetime).getTime()) / 36e5 : Infinity };
  }
  const dayOf = ms => dtOf(ms).slice(0, 10);
  const addDay = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  function viewer(all, fetchFrom, failed) {
    const fset = new Set(failed);
    const vis = all.filter(r => r.date >= fetchFrom && !fset.has(r.date));
    const snap = X.excParsePayload({ residents: [{ id: 1, name: '利用者01', room: '101' }], records: vis, cfg: {} }, fetchFrom, dayOf(NOW));
    return { pool: snap.recs['1'] || [], res: snap.residents[0], cfg: snap.cfg };
  }
  function check(all, fetchFrom, failed, tally) {
    const v = viewer(all, fetchFrom, failed);
    const st = X.excStatusOf(v.pool, v.res, v.cfg, NOW, fetchFrom, failed);
    const tr = truthAt(all, NOW);
    const bad = [];
    if (!st.atLeast) {
      tally.exact++;
      if (!(tr.last && st.lastAt === tr.last.datetime && st.days === Math.floor(tr.h / 24))) bad.push('i');
    } else {
      tally.lower++;
      const tDays = tr.h === Infinity ? Infinity : Math.floor(tr.h / 24);
      if (!(st.days <= tDays && lvRank[st.level] <= rankOf(tr.h))) bad.push('ii');
    }
    const from = addDay(fetchFrom, 2);
    X.excCalendar(v.pool, v.res, v.cfg, from, dayOf(NOW), fetchFrom, failed, NOW).forEach(c => {
      if (c.blank || c.failed) return;
      const end = Math.min(new Date(addDay(c.day, 1) + 'T00:00:00').getTime(), NOW);
      const t = truthAt(all, end, c.day);
      const upto = v.pool.filter(r => r.date <= c.day);
      const s = X.excStatusOf(upto, v.res, v.cfg, end, fetchFrom, failed.filter(x => x <= c.day));
      tally.cells++;
      if (clsRank[c.cls] > rankOf(t.h)) bad.push('iii>' + c.day);
      if (!s.atLeast) { tally.exactCells++; if (clsRank[c.cls] !== rankOf(t.h)) bad.push('iii=' + c.day); }
    });
    return bad;
  }

  /* レビューの再現例（固定）。F＝余白込み開始日の0時 */
  {
    const F = '2026-10-08', Fms = new Date(F + 'T00:00:00').getTime();
    const at = h => { const dt = dtOf(Fms + h * H1); return dt; };
    const sm = (h, amt) => { const dt = at(h); return { id: 'x' + (++seq), residentId: 1, type: 'stool', date: dt.slice(0, 10), time: dt.slice(11, 16), datetime: dt, stoolAmt: amt || '少量' }; };
    /* 少量3件: 読んでいない前日の少量＋見えている少量2件で、本当は2件目の時刻に1回分が成立している */
    const ex3 = [sm(-10), sm(5), sm(20)];
    const t3 = { exact: 0, lower: 0, cells: 0, exactCells: 0 };
    eq('再現例（少量3件）: 写し元と矛盾しない', check(ex3, F, [], t3), []);
    const v3 = viewer(ex3, F, []), s3 = X.excStatusOf(v3.pool, v3.res, v3.cfg, NOW, F, []);
    eq('再現例（少量3件）: 「1回分の記録がありません」と言い切らず下限（最後の少量から）', [s3.atLeast, s3.days, Math.floor(truthAt(ex3, NOW).h / 24)], [true, Math.floor(truthAt(ex3, NOW).h / 24), Math.floor(truthAt(ex3, NOW).h / 24)]);
    /* 少量5件: 読んでいない前の少量2件で、本当の1回分は見えている1件目。見えている3件だけで数えると最後の1件が1回分に見えて少なく出ていた */
    const ex5 = [sm(-40), sm(-20), sm(2), sm(10), sm(30)];
    const t5 = { exact: 0, lower: 0, cells: 0, exactCells: 0 };
    eq('再現例（少量5件）: 写し元と矛盾しない', check(ex5, F, [], t5), []);
    const v5 = viewer(ex5, F, []), s5 = X.excStatusOf(v5.pool, v5.res, v5.cfg, NOW, F, []);
    eq('再現例（少量5件）: 見えている3件目を1回分と言い切らない（下限）', s5.atLeast, true);
    eq('再現例（少量5件）: 下限は本当の日数以下', s5.days <= Math.floor(truthAt(ex5, NOW).h / 24), true);
    /* 48時間を超えて空いた少量は確定点（そこから先は写し元と一致） */
    const exB = [sm(-30), sm(60), sm(70), sm(80), sm(150, '中等量'), sm(200), sm(210)];
    const vB = viewer(exB, F, []), sB = X.excStatusOf(vB.pool, vB.res, vB.cfg, NOW, F, []);
    eq('確定点の後の1回分は写し元と一致', [sB.atLeast, sB.lastAt], [false, truthAt(exB, NOW).last.datetime]);
  }

  /* 乱数（少量を多め・48時間の前後の間隔・中等量混在）＋読めなかった日 */
  {
    let s2 = 20261018;
    const rnd2 = () => { s2 = (s2 * 1103515245 + 12345) % 2147483648; return s2 / 2147483648; };
    const tally = { exact: 0, lower: 0, cells: 0, exactCells: 0 };
    let fails = 0, firstBad = null, withFailed = 0;
    for (let n = 0; n < 400; n++) {
      const all = [];
      let hAgo = Math.floor(rnd2() * 30);
      while (hAgo < 24 * 22) {
        const amtR = rnd2();
        const amt = amtR < 0.65 ? '少量' : (amtR < 0.85 ? '中等量' : (amtR < 0.93 ? '多量' : ''));
        const dt = dtOf(NOW - hAgo * H1);
        all.push({ id: 'q' + (++seq), residentId: 1, type: rnd2() < 0.2 ? 'both' : 'stool', date: dt.slice(0, 10), time: dt.slice(11, 16), datetime: dt, stoolAmt: amt });
        const g = rnd2();
        hAgo += g < 0.45 ? 1 + Math.floor(rnd2() * 30) : (g < 0.8 ? 44 + Math.floor(rnd2() * 9 * 60) / 60 : 55 + Math.floor(rnd2() * 50));
      }
      const fetchFrom = addDay(dayOf(NOW), -(4 + Math.floor(rnd2() * 10)));
      const failed = [];
      if (rnd2() < 0.4) { withFailed++; const k = 1 + Math.floor(rnd2() * 2); for (let i = 0; i < k; i++) { const d = addDay(fetchFrom, Math.floor(rnd2() * 12)); if (d <= dayOf(NOW) && failed.indexOf(d) < 0) failed.push(d); } }
      failed.sort();
      const bad = check(all, fetchFrom, failed, tally);
      if (bad.length) { fails++; if (!firstBad) firstBad = { n, fetchFrom, failed, bad }; }
    }
    eq('乱数の400通りで (i)〜(iv) が全部成り立つ', firstBad, null);
    eq('下限でない（完全一致を求めた）場合も十分にある', tally.exact > 100, true);
    eq('下限の場合も十分にある', tally.lower > 50, true);
    eq('カレンダーで一致を求めた日も十分にある', tally.exactCells > 500, true);
    eq('読めなかった日を混ぜた回も十分にある', withFailed > 100, true);
    console.log('  （8b の内訳: 完全一致 ' + tally.exact + '・下限 ' + tally.lower + '・カレンダーの日 ' + tally.cells + '（一致を求めた日 ' + tally.exactCells + '）・読めなかった日あり ' + withFailed + '）');
  }
}

group('9. 配線（タブ・期間・保存しないこと）');
{
  eq('排泄のタブがボトムナビにある', /data-scr="scr-exc"/.test(SRC), true);
  eq('再読み込みの戻り先の一覧に排泄', /var SCREENS = \[[^\]]*'scr-exc'/.test(SRC), true);
  eq('期間バーの接尾辞に e', /var RG_TABS = \['r','v','s','e'\]/.test(SRC), true);
  ['rgDays-', 'rgSpan-', 'rgFrom-', 'rgTo-', 'rgLoad-'].forEach(k => eq('id ' + k + 'e がある', SRC.indexOf('id="' + k + 'e"') >= 0, true));
  eq('排泄タブで期間を変えると排便記録を読む', grabFn('rgApply').indexOf('ensureExcData();') >= 0 && grabFn('rgReload').indexOf('excLoad();') >= 0, true);
  eq('選んだ方を保存しない', /lsSet\([^)]*EXC_SEL/.test(SRC), false);
  eq('印刷は共通部品を通す（msPrintSetup_ には足さない）', /msPrint_\('exc'\)/.test(SRC) && grabFn('msPrintSetup_').indexOf("'exc'") < 0, true);
}


group('10. 排泄の読み込み（excLoad の実関数）: 古い表示を下ろす・通信中に変わった期間を追いかける・失敗時は追いかけない');
(async () => {
  function loadBox() {
    const els = {};
    const el = () => ({ textContent: '', hidden: false, disabled: false, children: [], appendChild(c) { this.children.push(c); return c; } });
    ['excStatus', 'excBanner', 'excList', 'excWho', 'excBody', 'excActions', 'rgLoad-e'].forEach(id => { els[id] = el(); });
    const calls = { post: [], clear: 0, render: 0, notice: 0 };
    const pend = [];
    const box = {
      console, JSON, Math, Object, String, Number, Array, isNaN, isFinite, parseInt, Promise, Date,
      document: { createElement: () => el() },
      $: id => els[id], _calls: calls, _pend: pend, SCREEN: 'scr-exc',
      lsGet: k => ({ hbcr_api_url: 'https://script.google.com/macros/s/AKfyTEST/exec', hbcr_api_token: 'x' })[k] || null,
      currentScreen: () => box.SCREEN,
      excPost: (cfg, body) => new Promise((res, rej) => { calls.post.push(body.action); pend.push({ res, rej }); }),
      rgClearExc: () => { calls.clear++; },
      excRenderBanner: () => { calls.render++; }, excRenderList: () => {}, excRenderBody: () => {},
      excCfgNotice: () => { calls.notice++; }, rgBusyExc: () => {}
    };
    vm.createContext(box);
    vm.runInContext([
      grabDecl('VM_MAX_DAYS'), grabDecl('RG_DAYS_OPTS'), grabDecl('RG_DEF_DAYS'), grabDecl('RANGE'), grabDecl('EXC'),
      'var EXC_LOADING = false, EXC_ERR = "";',
      ...DECLS.map(grabDecl),
      ...['z2', 'okYmd', 'ymd', 'addDays', 'rgDays', 'sharedRange', 'rgSpecStale', 'excLoaded', 'excStale', 'excLoad', 'excErrMsg',
        'excReadCfg', 'excJstDay', 'excAddDays', 'excDayMs', 'excPlan', 'excRefNow', 'excToKey', 'excFiniteNum', 'excNormRoom',
        'excNameKey', 'excLocalDt', 'excNormDate', 'excConsOf', 'excParseRecord', 'excParseResident', 'excParsePayload'].map(grabFn)
    ].join('\n'), box);
    return box;
  }
  const ok1 = { ok: true, residents: [], records: [], cfg: {} };
  const tick = () => new Promise(r => setImmediate(r));

  let b = loadBox();
  const today = b.ymd(new Date());
  b.RANGE.days = 7;                       // 余白込み9日＝直近14日に収まる
  b.excLoad(); await tick();
  eq('直近14日に収まる期間は getAll を1回', b._calls.post, ['getAll']);
  Object.assign(b.RANGE, { mode: 'span', from: b.ymd(b.addDays(new Date(), -4)), to: today });   // 通信中に期間を変える
  b._pend.shift().res(ok1);
  await tick(); await tick(); await tick();
  eq('通信中に変わった期間を追いかけて読み直す', b._calls.post, ['getAll', 'getAll']);
  b._pend.shift().res(ok1);
  await tick(); await tick(); await tick();
  eq('追いかけた後は読み込み済み（期間が今の指定と一致）', [b.excStale(), b.excLoaded(), b.EXC_LOADING], [false, true, false]);
  const clear0 = b._calls.clear;          // 追いかけの読み込みでも下ろしている（その分を数えない）
  Object.assign(b.RANGE, { mode: 'recent', days: 7 });
  b.excLoad(); await tick();
  eq('期間が変わっていれば古い表示を下ろしてから読む', [clear0 >= 1, b._calls.clear - clear0], [true, 1]);
  Object.assign(b.RANGE, { mode: 'span', from: b.ymd(b.addDays(new Date(), -2)), to: today });
  b._pend.shift().rej(new Error('network'));
  await tick(); await tick(); await tick();
  eq('失敗した時は追いかけない（読み直し続けない）', [b._calls.post.length, b.EXC_LOADING, b.EXC_ERR !== ''], [3, false, true]);

  b = loadBox();
  b.lsGet = () => null;
  b.excLoad(); await tick();
  eq('接続設定が無い端末は通信しないで案内だけ', [b._calls.post.length, b._calls.notice], [0, 1]);

  b = loadBox();
  b.RANGE.days = 30;
  b.excLoad(); await tick();
  for (let i = 0; i < 6 && b._pend.length; i++) {
    const p = b._pend.shift();
    if (i === 1) p.rej(new Error('network')); else p.res(ok1);
    await tick(); await tick();
  }
  await tick(); await tick();
  eq('長い期間は getDays を7日ずつ順に（30日＋余白2日＝5回）', b._calls.post, ['getDays', 'getDays', 'getDays', 'getDays', 'getDays']);
  eq('途中で失敗した7日は読めなかった日として控える', b.EXC.failed.length, 7);
  done();
})().catch(e => { ng++; console.log('  ✗ 例外: ' + e); done(); });

function done() {
  console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
}
