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
  'excRecMs', 'excStatusOf', 'excStatusText', 'excMatch', 'excRows', 'excDays', 'excCalendar', 'excDayLevel',
  /* 第2弾（2026-10-17） */
  'excDefaultCfg', 'excConfirmed', 'excUrineCfgOf', 'excUrineLevel', 'excUrineStatusOf', 'excUrineText',
  'excParsePads', 'excPadsTotal', 'excFmtUA', 'excConsBs', 'excEvMs', 'excLaxReaction', 'excLaxReactText', 'excHospOverlaps',
  'excIntervalStats', 'excFmtDur', 'excGuideStats', 'excGsPct', 'excAbn',
  'excUiState', 'excRoomCmp', 'excLvRank', 'excCalCell', 'excByDay', 'excCalCellFix', 'excBand', 'excUrineDay', 'excUrineDayText',
  'excPeriodSummary', 'excIsFullHospDay', 'excDayDiffSrc', 'excHidAfter', 'excHidText', 'excRunTasks', 'excRetryFailed', 'excLaxList', 'excGuideWeeks', 'excPadTotals',
  'excCacheFor', 'excPlan', 'excCacheStore', 'excBuildSnap', 'excPool'];
const DECLS = ['VM_USUAL_RISE', 'VM_USUAL_DAYS', 'VM_USUAL_MIN', 'VM_MEAL_HALF',
  'EXC_LS_URL_KEYS', 'EXC_LS_TOKEN_KEYS', 'EXC_GAS_RE', 'EXC_RECENT_DAYS', 'EXC_GETDAYS_MAX', 'EXC_MARGIN_DAYS',
  'EXC_DEFAULT_STOOL', 'EXC_SC_COLOR', 'EXC_BRISTOL', 'EXC_STOOL_SMALL_N',
  'EXC_DEFAULT_URINE', 'EXC_LAX_REACT_H', 'EXC_STATS_GAP_H', 'EXC_CONS_BS', 'LS_EXC_SORT', 'LS_EXC_ATTN', 'EXC_SORTS', 'EXC_BAND_DAYS',
  'EXC_CACHE_MS', 'EXC_PARALLEL', 'EXC_CACHE', 'EXC_MSG_UNKNOWN', 'EXC_MSG_NODAYS'];   // EXC_STOOL_SMALL_N の行に _WIN_H も宣言されている

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

group('5. 読み方（窓は getAll 1本・窓より前は getDays を7日ずつ新しい塊から・器にある日は読まない）');
{
  const now = Date.parse('2026-10-17T10:00:00+09:00');
  /* 既定の14日（余白込み16日＝10/2〜10/17）: 窓（今日−13＝10/4〜）は getAll、10/2・10/3 は getDays 1本 */
  const p1 = X.excPlan('2026-10-02', '2026-10-17', now, {}, false);
  eq('既定の14日は getAll 1本＋getDays 1本（2日分）', [p1.getAll, p1.chunks.map(c => c.join(','))], [true, ['2026-10-02,2026-10-03']]);
  eq('窓の日は 10/4〜10/17', [p1.winDays[0], p1.winDays[p1.winDays.length - 1], p1.winDays.length], ['2026-10-04', '2026-10-17', 14]);
  eq('since は今より少し未来（窓の記録だけが返る形）', p1.since > now && p1.since - now <= 5 * 60000, true);
  const p3 = X.excPlan('2026-08-17', '2026-10-17', now, {}, false);   // 62日
  const flat = [].concat.apply([], p3.chunks);
  eq('窓より前の48日は7日ずつ（新しい塊から）', [p3.chunks.length, p3.chunks[0][6], p3.chunks[0][0]], [7, '2026-10-03', '2026-09-27']);
  eq('抜けも重なりもない', [flat.length, new Set(flat).size, flat.indexOf('2026-08-17') >= 0, flat.indexOf('2026-10-04') >= 0], [48, 48, true, false]);
  /* 器にある新しい日は読まない（5分以内）・古い日・force は読む */
  const cached = {};
  ['2026-09-27', '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03'].forEach(d => { cached[d] = { at: now - 60000, recs: [] }; });
  cached['2026-09-26'] = { at: now - 10 * 60000, recs: [] };   // 5分を過ぎた
  const p4 = X.excPlan('2026-09-20', '2026-10-17', now, cached, false);
  eq('足りない日だけ読む（5分以内の日は読まない・5分を過ぎた日は読む）', [].concat.apply([], p4.chunks).sort(),
    ['2026-09-20', '2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26']);
  eq('窓の日は器にあっても毎回 getAll で取り直す', X.excPlan('2026-10-10', '2026-10-17', now, { '2026-10-12': { at: now, recs: [] } }, false).getAll, true);
  eq('「読み込み」（force）は全部読む', [].concat.apply([], X.excPlan('2026-09-20', '2026-10-17', now, cached, true).chunks).length, 14);
  const p5 = X.excPlan('2026-09-01', '2026-09-10', now, {}, false);
  eq('過去の期間（窓と重ならない）は getAll を使わない', [p5.getAll, p5.chunks.length], [false, 2]);
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
  eq('排泄の部分で localStorage に書かない（書くのは一覧の並べ方・要注意だけの UI 状態の2つだけ）',
    [/setItem|removeItem|indexedDB/i.test(exc), (exc.match(/lsSet\(([A-Z_]+)/g) || []).filter(x => !/lsSet\(LS_EXC_(SORT|ATTN)$/.test(x))], [false, []]);
  eq('排泄の部分で console に出さない', /console\./.test(exc), false);
  eq('送る action は読み取りの2つだけ', Array.from(new Set(exc.match(/action:'[a-zA-Z]+'/g) || [])).sort(), ["action:'getAll'", "action:'getDays'"]);
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
  eq('全体の cfg を既定に重ねる（排尿の既定 6/8 も）', snap.cfg, { stoolWarnD: 3, stoolDangerD: 3, urineWarnH: 6, urineDangerH: 8 });
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
  /* 並びは便・尿の重い方で（ここでは全員の排尿が危険＝同じ段なので五十音） */
  eq('退居の方は出さない・危険→注意→その他（便・尿の重い方・同じ中は五十音）', rows.map(r => [r.id, r.status.level, r.urine.level]),
    [['1', 'ok', 'danger'], ['2', 'danger', 'danger'], ['3', 'danger', 'danger'], ['5', 'warn', 'danger']]);
  eq('期間内に排便1回分が無い方は下限（記録が無ければ余白込み開始日の0時から）', X.excStatusText(rows[2].status), '期間内に排便1回分の記録がありません（16日以上）（危険）');
  eq('最後の排便から◯日', X.excStatusText(rows[1].status), '最後の排便から3日（危険）');
  eq('注意', X.excStatusText(rows[3].status), '最後の排便から2日（注意）');
  eq('排尿の判定（最後の排尿から29時間・写し元の badgeCls と同じ 8時間以上で危険）', X.excUrineText(rows[0].urine), '最後の排尿から29時間（危険）');
  eq('排尿が期間内に無い方は下限', X.excUrineText(rows[1].urine), '排尿 396時間以上なし（危険）');
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
      if (st.level === 'unknown') tally.unknown = (tally.unknown || 0) + 1;   // 直近の日を読めていない＝判定しない（下限も言わない）
      else if (!(st.days <= tDays && lvRank[st.level] <= rankOf(tr.h))) bad.push('ii');
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
    console.log('  （8b の内訳: 完全一致 ' + tally.exact + '・下限 ' + tally.lower + '（うち判定できない ' + (tally.unknown || 0) + '）' + '・カレンダーの日 ' + tally.cells + '（一致を求めた日 ' + tally.exactCells + '）・読めなかった日あり ' + withFailed + '）');
  }
}

group('7b. デイだけの方（排泄ケア記録の cfg.dayOnly・2026-10-25 代表者の決定）: 施設の判定と一覧に出さない');
{
  const now = Date.parse('2026-10-17T12:00:00+09:00');
  const snap = X.excParsePayload({
    residents: [{ id: 1, name: '利用者01', room: '101' },
      { id: 2, name: '利用者02', room: '102', cfg: { dayOnly: true } },
      { id: 3, name: '利用者03', room: '103', cfg: JSON.stringify({ dayOnly: true, stoolWarnD: 3 }) },
      { id: 4, name: '利用者04', room: '104', cfg: { dayOnly: 'true' } },
      { id: 5, name: '利用者05', room: '105', cfg: { dayOnly: false, stoolWarnD: 4 } }],
    records: [{ id: 'a', residentId: 2, type: 'stool', date: '2026-10-10', time: '10:00', stoolAmt: '中等量' },
      { id: 'b', residentId: 3, type: 'urine', date: '2026-10-16', time: '11:00' }]
  }, '2026-10-01', '2026-10-17');
  eq('cfg の dayOnly は真偽値の true だけ読む（JSON の文字の cfg でも・文字の "true" は読まない）', snap.residents.map(r => [r.id, r.dayOnly]),
    [['1', false], ['2', true], ['3', true], ['4', false], ['5', false]]);
  eq('閾値の読み方は今までどおり', [snap.residents[2].cfg.stoolWarnD, snap.residents[4].cfg.stoolWarnD], [3, 4]);
  const rows = X.excRows(snap, [], now, '2026-10-01', []);
  eq('一覧（排便なしN日・排尿の判定）にデイだけの方を出さない', rows.map(r => r.id).sort(), ['1', '4', '5']);
  eq('「要注意だけ」にも出さない', X.excRows(snap, [], now, '2026-10-01', [], { attn: true }).some(r => r.id === '2' || r.id === '3'), false);
  eq('居室順でも出さない', X.excRows(snap, [], now, '2026-10-01', [], { sort: 'room' }).map(r => r.id), ['1', '4', '5']);
  const hb = X.excParseResident({ id: 9, name: '利用者09', room: '109' });
  const dd = X.excParseResident({ id: 10, name: '利用者09', room: '110', cfg: { dayOnly: true } });
  eq('照合: デイだけの方を「排便記録に同名2人」に数えない', X.excMatch(hb, [{ name: '利用者09', room: '109' }], [hb, dd]).ok, true);
  eq('照合: デイだけの方でない同名の2人は今までどおり結ばない', X.excMatch(hb, [{ name: '利用者09', room: '109' }], [hb, X.excParseResident({ id: 11, name: '利用者09', room: '111' })]).reason, 'dupHaiben');
  /* 詳細（excRenderBody の実関数）: 選んだ方がデイだけの方なら何も描かず選択を外す。ほかの方は判定へ進む */
  {
    const el = () => ({ textContent: '', hidden: false, appendChild() {} });
    const els = { excBody: el(), excWho: el(), excActions: el() };
    const body = { console, $: (id) => els[id], excStale: () => false, excLoaded: () => true, EXC: { noDays: false },
      EXC_CACHE: { residents: snap.residents }, EXC_SEL: '', excSnapNow: () => snap, excHidden: () => [],
      excStatusOf: () => { throw new Error('判定へ進んだ'); } };
    vm.createContext(body);
    vm.runInContext(grabFn('excRenderBody'), body);
    body.EXC_SEL = '2';
    let wentDay = false;
    try { body.excRenderBody(); } catch (e) { wentDay = true; }
    eq('詳細: デイだけの方を選んでいても開かず、選択を外す（判定へ進まない）', [wentDay, body.EXC_SEL, els.excActions.hidden], [false, '', true]);
    body.EXC_SEL = '1';
    let went = false;
    try { body.excRenderBody(); } catch (e) { went = /判定へ進んだ/.test(String(e && e.message)); }
    eq('詳細: デイだけの方でない方は今までどおり判定へ進む', went, true);
  }
}

group('9. 配線（タブ・期間・保存しないこと）');
{
  eq('排泄のタブがボトムナビにある', /data-scr="scr-exc"/.test(SRC), true);
  eq('再読み込みの戻り先の一覧に排泄', /var SCREENS = \[[^\]]*'scr-exc'/.test(SRC), true);
  eq('期間バーの接尾辞に e', /var RG_TABS = \['r','v','s','e'\]/.test(SRC), true);
  ['rgDays-', 'rgSpan-', 'rgFrom-', 'rgTo-', 'rgLoad-'].forEach(k => eq('id ' + k + 'e がある', SRC.indexOf('id="' + k + 'e"') >= 0, true));
  eq('排泄タブで期間を変えると排便記録を読む', grabFn('rgApply').indexOf('ensureExcData();') >= 0 && /excLoad\(\{ force:true \}\)/.test(grabFn('rgReload')), true);
  eq('選んだ方を保存しない', /lsSet\([^)]*EXC_SEL/.test(SRC), false);
  eq('印刷は共通部品を通す（msPrintSetup_ には足さない）', /msPrint_\('exc'\)/.test(SRC) && grabFn('msPrintSetup_').indexOf("'exc'") < 0, true);
}


group('10. 排泄の読み込み（excLoad の実関数・第2弾）: 同時読み・段階表示・合流（重複 id・削除の印）・再利用・追いかけ・先読みの失敗');
(async () => {
  const tick = () => new Promise(r => setImmediate(r));
  const ticks = async (n) => { for (let i = 0; i < (n || 4); i++) await tick(); };
  function loadBox() {
    const els = {};
    const el = () => ({ textContent: '', hidden: false, disabled: false, children: [], appendChild(c) { this.children.push(c); return c; } });
    ['excStatus', 'excBanner', 'excList', 'excWho', 'excBody', 'excActions', 'rgLoad-e'].forEach(id => { els[id] = el(); });
    const calls = { post: [], clear: 0, render: 0, notice: 0, renderPending: [] };
    const pend = [];
    const box = {
      console, JSON, Math, Object, String, Number, Array, isNaN, isFinite, parseInt, Promise, Date, Set,
      document: { createElement: () => el() },
      $: id => els[id], _calls: calls, _pend: pend, SCREEN: 'scr-exc', ROSTER: [],
      lsGet: k => ({ hbcr_api_url: 'https://script.google.com/macros/s/AKfyTEST/exec', hbcr_api_token: 'x' })[k] || null,
      currentScreen: () => box.SCREEN,
      excPost: (cfg, body) => new Promise((res, rej) => { calls.post.push(body.action + (body.days ? ':' + body.days.length : '')); pend.push({ body, res, rej }); }),
      rgClearExc: () => { calls.clear++; },
      excRenderBanner: () => {}, excRenderList: () => { calls.render++; calls.renderPending.push(Object.keys(box.EXC.pending).length); }, excRenderBody: () => {},
      excCfgNotice: () => { calls.notice++; }, rgBusyExc: () => {}, byKana: (a, b) => String(a).localeCompare(String(b))
    };
    vm.createContext(box);
    vm.runInContext([
      grabDecl('VM_MAX_DAYS'), grabDecl('RG_DAYS_OPTS'), grabDecl('RG_DEF_DAYS'), grabDecl('RANGE'), grabDecl('EXC'),
      'var EXC_LOADING = false, EXC_ERR = "", EXC_SEL = "";',
      ...DECLS.map(grabDecl), grabDecl('EXC_TIMEOUT_MS'),
      ...['z2', 'okYmd', 'ymd', 'addDays', 'rgDays', 'sharedRange', 'rgSpecStale', 'excLoaded', 'excStale', 'ensureExcData', 'excLoad', 'excErrMsg',
        'excStatusLine', 'excHidden', 'excSnapNow'].map(grabFn),
      ...FNS.filter(n => ['z2', 'okYmd', 'ymd', 'addDays', 'byKana', 'kanaKey', 'rosterByNorm', 'normName', 'mergeBy'].indexOf(n) < 0 && n.indexOf('vm') !== 0).map(grabFn)
    ].join('\n'), box);
    return box;
  }
  const today = (() => { const d = new Date(Date.now() + 9 * 3600e3); return d.toISOString().slice(0, 10); })();
  const addD = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const res1 = [{ id: 1, name: '利用者01', room: '101' }, { id: 2, name: '利用者02', room: '102' }];
  const rec = (id, rid, day, time, type, extra) => Object.assign({ id, residentId: rid, type: type || 'stool', date: day, time, datetime: day + 'T' + time, stoolAmt: '中等量' }, extra || {});
  /* 偽の応答: getAll は窓の日、getDays は指定の日 */
  function answer(p, recs, extra) {
    const days = p.body.days || null;
    const winFrom = addD(today, -13);
    const list = recs.filter(r => days ? days.indexOf(r.date) >= 0 : r.date >= winFrom);
    p.res(Object.assign({ ok: true, residents: res1, records: list, cfg: {} }, extra || {}));
  }

  /* (a) 既定の14日: getAll と getDays が同時に出る（順番待ちにしない） */
  let b = loadBox();
  b.excLoad(); await ticks();
  eq('既定の14日は getAll と getDays（2日分）を同時に出す', b._calls.post.slice().sort(), ['getAll', 'getDays:2']);
  eq('出した直後は全部の日が「読み込み中」', Object.keys(b.EXC.pending).length, 16);
  /* (b) 段階表示: 窓（getAll）が先に届くと一覧を描き直し、古い日はまだ読み込み中のまま */
  const recs = [rec('a', 1, addD(today, -1), '09:00'), rec('b', 2, addD(today, -14), '09:00'),
    rec('dup', 1, addD(today, -2), '10:00')];
  const pAll = b._pend.find(p => p.body.action === 'getAll'), pDays = b._pend.find(p => p.body.action === 'getDays');
  b._pend.length = 0;   // 手で答えるので待ち行列から外す
  answer(pAll, recs); await ticks();
  eq('窓が届いたら描き直す（読み込み中の日は窓より前の2日だけ）', [b._calls.render > 1, Object.keys(b.EXC.pending).sort()], [true, [addD(today, -15), addD(today, -14)].sort()]);
  eq('届いた途中でも一覧は組み立てられる（窓の記録で利用者01 は判定済み）',
    b.excStatusOf(b.excSnapNow().recs['1'], b.excSnapNow().residents[0], b.excSnapNow().cfg, Date.now(), b.EXC.fetchFrom, b.excHidden()).atLeast, false);
  eq('まだ届いていない日は日ごとの表で「読み込み中」', b.excDays([], [addD(today, -14)], b.excHidden(), Date.now(), b.EXC.pending)[0].pending, true);
  /* (c) 合流: 同じ id が getAll と getDays の両方に来ても1件、削除の印の id は除く */
  answer(pDays, [rec('b', 2, addD(today, -14), '09:00'), rec('gone', 2, addD(today, -15), '08:00'),
    rec('dup', 1, addD(today, -14), '10:00')], { deleted: ['gone'] });   // 同じ id が別の日で後から届いた（日付を直した記録）
  await ticks(6);
  const snapA = b.excSnapNow();
  eq('全部届いたら読み込み中の日は0・読み込み済み', [Object.keys(b.EXC.pending).length, b.EXC_LOADING, b.excLoaded()], [0, false, true]);
  eq('同じ id は1件（後から読んだ方）・削除の印の記録は除く', [(snapA.recs['1'] || []).map(r => r.id), (snapA.recs['2'] || []).map(r => r.id)], [['dup', 'a'], ['b']]);
  eq('状態表示は期間', b.$('excStatus').textContent.indexOf('〜') > 0, true);

  /* (d) 再利用: 期間を30日に広げると、窓（getAll）と足りない古い日だけ読む（既に読んだ2日は読まない） */
  b._calls.post.length = 0;
  b.RANGE.days = 30;
  b.excLoad(); await ticks();
  const daysAsked = b._pend.filter(p => p.body.action === 'getDays').reduce((a, p) => a.concat(p.body.days), []);
  eq('広げた時は足りない日だけ読む（読み終えた 今日−15・−14 は読まない）',
    [b._calls.post.indexOf('getAll') >= 0, daysAsked.length, daysAsked.indexOf(addD(today, -15)) < 0, daysAsked.indexOf(addD(today, -14)) < 0], [true, 16, true, true]);   // 足りない16日を全部（getAll＋塊3本＝4本は同時6本の枠に収まる）
  eq('4本とも同時に出る（同時6本まで）', b._pend.length, 4);
  while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
  await ticks(6);
  eq('塊は新しい日から順に出す', b._calls.post.filter(x => x.indexOf('getDays') === 0).length, 3);
  /* (e) 「読み込み」（force）は全部取り直す */
  b._calls.post.length = 0;
  b.excLoad({ force: true }); await ticks();
  while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
  await ticks(6);
  eq('「読み込み」は全部取り直す（getAll＋古い日の塊 3本）', b._calls.post.filter(x => x.indexOf('getDays') === 0).length, 3);

  /* (d2) 60日: getAll 1本＋getDays 7本（窓より前の48日を7日ずつ）。同時は6本まで・空きが出たら次を出す */
  {
    const c = loadBox();
    c.RANGE.days = 60;
    let maxPend = 0;
    c.excLoad(); await ticks();
    maxPend = Math.max(maxPend, c._pend.length);
    eq('60日: 最初に6本を同時に出す（getAll 1本＋getDays 5本）', [c._pend.length, c._calls.post.filter(x => x === 'getAll').length, c._calls.post.filter(x => x.indexOf('getDays') === 0).length], [6, 1, 5]);
    answer(c._pend.shift(), []); await ticks();
    maxPend = Math.max(maxPend, c._pend.length);
    eq('60日: 1本届いたら7本目を出す（同時は6本のまま）', [c._calls.post.length, c._pend.length], [7, 6]);
    while (c._pend.length) { answer(c._pend.shift(), []); await ticks(); maxPend = Math.max(maxPend, c._pend.length); }
    await ticks(6);
    const asked = c._calls.post.filter(x => x.indexOf('getDays') === 0);
    eq('60日: 全部で getAll 1本＋getDays 7本・同時は最大6本', [c._calls.post.length, c._calls.post.filter(x => x === 'getAll').length, asked.length, maxPend], [8, 1, 7, 6]);
    eq('60日: 読み終えたら読み込み中の日は0・読み込み済み', [Object.keys(c.EXC.pending).length, c.EXC_LOADING, c.excLoaded()], [0, false, true]);
  }

  /* (e2) 全部が器にある（窓と重ならない過去の期間で、5分以内に読んだ日だけ）時は通信せずに終わる */
  Object.assign(b.RANGE, { mode: 'span', from: addD(today, -40), to: addD(today, -35) });
  b._calls.post.length = 0;
  b.excLoad(); await ticks();
  while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
  await ticks(6);
  b._calls.post.length = 0;
  b.excLoad(); await ticks(6);
  eq('全部器にある時は通信せず、読み込み中のまま止まらない', [b._calls.post.length, b.EXC_LOADING, b.excLoaded(), b.$('excStatus').textContent.indexOf('〜') > 0], [0, false, true, true]);

  /* (f) 通信中に期間が変わったら追いかける・失敗の時は追いかけない */
  b = loadBox();
  b.RANGE.days = 7;
  b.excLoad(); await ticks();
  Object.assign(b.RANGE, { mode: 'span', from: addD(today, -4), to: today });
  while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
  await ticks(6);
  eq('通信中に変わった期間を追いかけて読み直す', b.EXC.reqMode, 'span');
  while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
  await ticks(6);
  const clear0 = b._calls.clear;
  Object.assign(b.RANGE, { mode: 'recent', days: 7 });
  b.excLoad(); await ticks();
  eq('期間が変わっていれば古い表示を下ろしてから読む', b._calls.clear - clear0, 1);
  Object.assign(b.RANGE, { mode: 'span', from: addD(today, -2), to: today });
  const n0 = b._calls.post.length;
  while (b._pend.length) { b._pend.shift().rej(new Error('network')); await ticks(); }
  await ticks(6);
  eq('全部失敗した時は追いかけない・赤帯の理由を持つ・読み込み済みにしない', [b._calls.post.length - n0, b.EXC_LOADING, b.EXC_ERR !== '', b.excLoaded()], [1, false, true, false]);   // 1＝窓の getAll を1回だけ自動で読み直した分（期間の追いかけは無し）

  /* (g) 一部の塊だけ失敗: その日は「読めず」、ほかは表示 */
  b = loadBox();
  b.RANGE.days = 30;
  b.excLoad(); await ticks();
  let k = 0;
  while (b._pend.length) { const p = b._pend.shift(); if (p.body.action === 'getDays' && k++ === 0) p.rej(new Error('network')); else answer(p, []); await ticks(); }
  await ticks(6);
  eq('途中で失敗した7日は読めなかった日として控える（ほかは読み込み済み）', [Object.keys(b.EXC.failed).length, b.excLoaded(), b.EXC_ERR], [7, true, '']);
  /* (h) 合言葉違いは残りの塊を出さずに止める */
  b = loadBox();
  b.RANGE.days = 60;
  b.excLoad(); await ticks();
  const first = b._calls.post.length;
  b._pend.shift().rej(new Error('EXC_AUTH')); await ticks(6);
  while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
  await ticks(6);
  eq('合言葉違いの後は新しい塊を出さない', [first, b._calls.post.length, b.EXC_ERR.indexOf('合言葉') >= 0], [6, 6, true]);   // 60日は8本。最初の6本だけ出て、残り2本は出さない
  /* (i) 先読み（quiet）の失敗: その画面を見ていなければ赤帯を出さず、開いた時に読み直せる状態に戻す */
  b = loadBox();
  b.SCREEN = 'scr-resident';
  b.RANGE.days = 7;
  b.excLoad({ quiet: true }); await ticks();
  while (b._pend.length) { b._pend.shift().rej(new Error('network')); await ticks(); }
  await ticks(6);
  eq('先読みの失敗は赤帯を出さない・読み込み済みにしない', [b.EXC_ERR, b.$('excBanner').children.length, b.excLoaded()], ['', 0, false]);
  b.SCREEN = 'scr-exc';
  const before = b._calls.post.length;
  b.ensureExcData(); await ticks();
  eq('排泄タブを開いた時に通常どおり読み直す', b._calls.post.length > before, true);
  /* (k) 窓の getAll だけ失敗（自動の読み直しも失敗）・余白の getDays は成功 → 全員「判定できない」（ok にしない）・要注意に入る */
  b = loadBox();
  b.excLoad(); await ticks();
  {
    const recsK = [rec('old', 2, addD(today, -15), '09:00', 'urine')];
    for (let i = 0; i < 4 && b._pend.length; i++) {
      const p = b._pend.shift();
      if (p.body.action === 'getAll') p.rej(new Error('network')); else answer(p, recsK);
      await ticks(4);
    }
    eq('窓の getAll は1回だけ自動で読み直す', b._calls.post.filter(x => x === 'getAll').length, 2);
    while (b._pend.length) { const p = b._pend.shift(); if (p.body.action === 'getAll') p.rej(new Error('network')); else answer(p, recsK); await ticks(4); }
    await ticks(6);
    const snapK = b.excSnapNow();
    const optK = { from: b.EXC.from, to: b.EXC.to, pending: b.EXC.pending };
    const rowsK = b.excRows(snapK, [], b.EXC.refNow, b.EXC.fetchFrom, b.excHidden(), optK);
    eq('窓だけ失敗: 便・尿とも判定できない（ok にしない）', rowsK.map(r => [r.status.level, r.urine.level]), [['unknown', 'unknown'], ['unknown', 'unknown']]);
    eq('文言は「直近の日を読めなかったため判定できません」', [b.excStatusText(rowsK[0].status), b.excUrineText(rowsK[0].urine)],
      ['排便: 直近の日を読めなかったため判定できません', '排尿: 直近の日を読めなかったため判定できません']);
    eq('今日の排尿・最新の便は「読めず」（0回・— を出さない）', [rowsK[0].urineDayHid, rowsK[0].stoolHid, b.excHidText(rowsK[0].urineDayHid)], ['failed', 'failed', '読めず']);
    eq('「要注意だけ」にも入る（安全側）', b.excRows(snapK, [], b.EXC.refNow, b.EXC.fetchFrom, b.excHidden(), Object.assign({}, optK, { attn: true })).length, 2);
    eq('判定できない方は危険より上に並ぶ', [b.excLvRank('unknown') < b.excLvRank('danger')], [true]);
    eq('赤帯の理由は出さない（一部の日の失敗として扱う）', [b.EXC_ERR, b.excLoaded(), Object.keys(b.EXC.failed).length], ['', true, 14]);
    /* 「もう一度読む」は読めなかった日だけ（窓＝getAll 1本） */
    const n1 = b._calls.post.length;
    b.excRetryFailed(); await ticks();
    eq('もう一度読む＝読めなかった日だけ（getAll 1本）', b._calls.post.slice(n1), ['getAll']);
    answer(b._pend.shift(), [rec('new', 1, today, '00:00', 'urine')]); await ticks(8);
    const rowsK2 = b.excRows(b.excSnapNow(), [], b.EXC.refNow, b.EXC.fetchFrom, b.excHidden(), optK);
    eq('読み直せたら判定が出る', [Object.keys(b.EXC.failed).length, rowsK2.every(r => r.status.level !== 'unknown')], [0, true]);
  }
  /* (l) 窓だけ未着（getDays は届いた）→ 読み込み中（数を出さない）・一番上 */
  b = loadBox();
  b.excLoad(); await ticks();
  {
    const pDays2 = b._pend.find(p => p.body.action === 'getDays');
    b._pend.splice(b._pend.indexOf(pDays2), 1);
    answer(pDays2, []); await ticks(6);
    const rowsL = b.excRows(b.excSnapNow(), [], b.EXC.refNow, b.EXC.fetchFrom, b.excHidden(), { from: b.EXC.from, to: b.EXC.to, pending: b.EXC.pending });
    eq('窓だけ未着: 便・尿とも読み込み中・今日の排尿も読み込み中', rowsL.map(r => [r.sLoading, r.uLoading, r.urineDayHid]), [[true, true, 'pending'], [true, true, 'pending']]);
    while (b._pend.length) { answer(b._pend.shift(), []); await ticks(); }
    await ticks(6);
  }
  /* (m) 期間がすべて先の日: 通信せず「読み込める日がありません」・読み込み中のままにしない */
  b = loadBox();
  Object.assign(b.RANGE, { mode: 'span', from: addD(today, 14), to: addD(today, 20) });
  await b.excLoad(); await ticks();
  eq('期間がすべて先の日は通信しない・読み込み中のままにしない', [b._calls.post.length, b.EXC.noDays, b.EXC_LOADING, b.excLoaded()], [0, true, false, true]);
  eq('案内の文言', b.EXC_MSG_NODAYS, '指定した期間に、読み込める日（今日まで）がありません');

  /* (j) 接続設定が無い端末は通信しない（先読みでも） */
  b = loadBox();
  b.lsGet = () => null;
  b.excLoad({ quiet: true }); b.excLoad(); await ticks();
  eq('接続設定が無い端末は通信しない（案内は画面から読んだ時だけ）', [b._calls.post.length, b._calls.notice], [0, 1]);

  /* ══ 11. 写した計算（下剤の反応・平均間隔・トイレの成功率・交換・性状）が写し元と同じ ══ */
  group('11. 写した計算の一致（fixture: msk_haiben_stats.src.txt）');
  {
    const raw = fs.readFileSync(path.join(__dirname, 'msk_haiben_stats.src.txt'), 'utf8');
    const parts = raw.split('//@==== ').slice(1).map(p => {
      const head = p.slice(0, p.indexOf('//@----\n'));
      return { name: head.split(' 行:')[0], head, start: (/\/\/@始: (.*)/.exec(head) || [])[1], end: (/\/\/@終: (.*)/.exec(head) || [])[1], code: p.slice(p.indexOf('//@----\n') + 8).replace(/\n+$/, '') };
    });
    eq('fixture の見出しにコミットと各区切りの行', [/コミット: [0-9a-f]{40}/.test(raw), parts.length, parts.every(p => /行: \d+〜\d+/.test(p.head))], [true, 15, true]);
    if (fs.existsSync(HAIBEN_HTML)) {
      const html = fs.readFileSync(HAIBEN_HTML, 'utf8');
      const bad = parts.filter(p => {
        const a = html.indexOf(p.start);
        const e = p.end === '（行末）' ? html.indexOf('\n', a) : html.indexOf(p.end, a);
        return !(a >= 0 && e > a && html.slice(a, e).replace(/\n+$/, '') === p.code);
      }).map(p => p.name);
      eq('写し元の各範囲が fixture と一字一句同じ（違えば写しを見直す）', bad, []);
    } else {
      console.log('  （写し元の排便記録アプリがこの端末に無いため、fixture だけで比べる）');
    }
    const code = parts.map(p => p.code).join('\n');
    function loadSrc(records, residents, now, todayStr, keepDays) {
      const RealDate = Date;
      class FixedDate extends RealDate { constructor(...a) { if (a.length === 0) super(now); else super(...a); } static now() { return now; } }
      const ctx = {
        Date: FixedDate, isNaN, Math, Array, Object, JSON, String, Number, parseInt,
        D: { residents, records },
        recsByRes: rid => records.filter(r => r.residentId === rid).slice().sort((a, b) => (a.datetime || '').localeCompare(b.datetime || '')),
        today: () => todayStr,
        dateOff: n => { const d = new RealDate(todayStr + 'T00:00:00'); d.setDate(d.getDate() + (n || 0)); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); },
        _localKeepDays: () => keepDays
      };
      vm.createContext(ctx);
      /* stoolResetSeries は前回の fixture（写し元の elH〜lastR）から */
      const judge = fs.readFileSync(FIXTURE, 'utf8');
      vm.runInContext(judge.slice(judge.indexOf('//@----\n') + 8) + '\n' + code, ctx);
      return ctx;
    }
    const NOW2 = new Date(2026, 9, 16, 15, 0).getTime();
    const pad = n => String(n).padStart(2, '0');
    const dtOf = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
    let s3 = 777, sq = 0;
    const rnd3 = () => { s3 = (s3 * 1103515245 + 12345) % 2147483648; return s3 / 2147483648; };
    const cons = ['水様便', '下痢便', '柔らかめ', '普通', '硬め', '硬便', ''];
    const srcs = ['self', 'pad', 'both', 'toilet', ''];
    let diff = { lax: 0, iv: 0, guide: 0, misc: 0 }, nLax = 0, nOkLax = 0, nIv = 0;
    for (let n = 0; n < 200; n++) {
      const recsR = [];
      let hAgo = Math.floor(rnd3() * 5);
      while (hAgo < 24 * 40) {
        const dt = dtOf(NOW2 - hAgo * 3600e3), x = rnd3();
        const type = x < 0.45 ? 'urine' : (x < 0.7 ? 'stool' : (x < 0.8 ? 'both' : (x < 0.9 ? 'laxative' : 'none')));
        const r = { id: 'z' + (++sq), residentId: 1, type, date: dt.slice(0, 10), time: dt.slice(11, 16), datetime: dt };
        if (type === 'stool' || type === 'both') { r.stoolAmt = ['少量', '中等量', '多量', ''][Math.floor(rnd3() * 4)]; r.consistency = cons[Math.floor(rnd3() * cons.length)]; r.stoolSrc = srcs[Math.floor(rnd3() * srcs.length)]; }
        if (type === 'urine' || type === 'both') { r.urineSrc = srcs[Math.floor(rnd3() * srcs.length)]; r.urineAmt = rnd3() < 0.5 ? 150 : '普通'; }
        if (type === 'laxative') { r.medicine = rnd3() < 0.5 ? '下剤A' : '下剤B'; r.tablets = '2'; }
        if (rnd3() < 0.3) r.pads = JSON.stringify({ 'パッド': 1 + Math.floor(rnd3() * 2) });
        recsR.push(r);
        hAgo += rnd3() < 0.1 ? 50 + rnd3() * 40 : 1 + rnd3() * 10;
      }
      const resid = { id: 1, name: '利用者01', room: '101', hospitalizations: rnd3() < 0.3 ? [{ admissionAt: dtOf(NOW2 - 20 * 24 * 3600e3), dischargeAt: dtOf(NOW2 - 17 * 24 * 3600e3) }] : [] };
      const keep = 20 + Math.floor(rnd3() * 60);
      const todayStr = dtOf(NOW2).slice(0, 10);
      const H = loadSrc(recsR, [resid], NOW2, todayStr, keep);
      const snap = X.excParsePayload({ residents: [resid], records: recsR });
      const pool = snap.recs['1'] || [];
      /* 下剤の反応 */
      recsR.filter(r => r.type === 'laxative').forEach(lx => {
        nLax++;
        const w = H.laxReaction(Object.assign({}, lx, { tsUTC: new Date(lx.datetime).getTime() }));
        const g = X.excLaxReaction(pool.find(p => p.id === lx.id), pool, NOW2, []);
        if (w && w.st === 'ok') nOkLax++;
        const pick = x => x ? [x.st, x.h === undefined ? null : Math.round(x.h * 1000), x.rec ? x.rec.id : null] : null;
        if (JSON.stringify(pick(w)) !== JSON.stringify(pick(g))) diff.lax++;
      });
      /* 平均間隔（窓＝dateOff(-span)〜today。ビューアは期間を同じにして比べる） */
      const span = Math.min(92, keep);
      const from = H.dateOff(-span);
      const wv = H.intervalStats(1);
      const sAll = X.excStoolResetSeries(pool.filter(r => r.type === 'stool' || r.type === 'both'));
      const gv = X.excIntervalStats(pool, snap.residents[0], sAll, from, todayStr, []);
      nIv++;
      const iv = o => ['urine', 'stool', 'lax'].map(k => [o[k].n, o[k].avgH === null ? null : Math.round(o[k].avgH * 1e6)]);
      if (JSON.stringify(iv(wv)) !== JSON.stringify(iv(gv))) diff.iv++;
      /* トイレの成功率・失禁率・交換 */
      const gw = H.guideStats(recsR), gg = X.excGuideStats(pool);
      if (JSON.stringify(gw) !== JSON.stringify(gg)) diff.guide++;
      if (H.gsPct(gw.succ, gw.toilet, gw.toilet + gw.miss) !== X.excGsPct(gg.succ, gg.toilet, gg.toilet + gg.miss)) diff.misc++;
      /* 性状（ブリストル）・量 */
      recsR.forEach(r => {
        const p = pool.find(q => q.id === r.id);
        if (H.rpConsTxt(r) !== X.excConsBs(p) || H.fmtCons(r) !== X.excConsOf(p) || H.fmtUA(H.toNum(r.urineAmt) === null ? r.urineAmt : H.toNum(r.urineAmt)) !== X.excFmtUA(p.urineAmt)) diff.misc++;
      });
      [0.4, 1.999, 25.5, 49, null, -1].forEach(h => { if (H.fmtDur(h) !== X.excFmtDur(h)) diff.misc++; });
    }
    eq('下剤の反応（ok/wait/none・時間・反応した記録）が全部同じ', diff.lax, 0);
    eq('平均間隔（排尿・排便・下剤の n と平均）が全部同じ（入院またぎ・記録の空白を含む）', diff.iv, 0);
    eq('トイレの成功率・失禁率・交換の枚数が全部同じ', diff.guide, 0);
    eq('性状・ブリストル・量・時間の書き方が全部同じ', diff.misc, 0);
    eq('下剤の反応ありの場合も十分に試せている', [nLax > 200, nOkLax > 50, nIv], [true, true, 200]);
    ['{"パッド":2,"リハパン":1}', { 'パッド': '3', x: 0, y: 200 }, 'こわれた', '', null, '[1,2]'].forEach(v => {
      const H = loadSrc([], [], NOW2, '2026-10-16', 30);
      eq('交換の読み方が同じ: ' + JSON.stringify(v), [X.excParsePads(v), X.excPadsTotal(v)], [H.parsePads(v), H.padsTotal(v)]);
    });
    /* 期間のまとめ（rpBowelOne の集計）と薬ごとの反応（laxHistHtml の集計）が写し元と同じ（読めていない日が無い入力） */
    {
      let s4 = 4242, sq4 = 0, bad4 = [], nHospStop = 0, nMax = 0, nLaxSum = 0;
      const rnd4 = () => { s4 = (s4 * 1103515245 + 12345) % 2147483648; return s4 / 2147483648; };
      const ymdL = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
      for (let n = 0; n < 150; n++) {
        const keep = 18 + Math.floor(rnd4() * 10);
        const todayStr = dtOf(NOW2).slice(0, 10);
        const recs4 = [];
        let hAgo = 1 + rnd4() * 5, nLx = 0;
        while (hAgo < 24 * (keep + 8)) {
          const dt = dtOf(NOW2 - hAgo * 3600e3), x = rnd4();
          const type = x < 0.35 ? 'urine' : (x < 0.75 ? 'stool' : (x < 0.85 ? 'both' : 'laxative'));
          if (type === 'laxative' && (nLx >= 10 || hAgo > 24 * keep - 24)) { hAgo += 3; continue; }
          const r = { id: 'p' + (++sq4), residentId: 1, type, date: dt.slice(0, 10), time: dt.slice(11, 16), datetime: dt };
          if (type === 'stool' || type === 'both') { r.stoolAmt = ['少量', '少量', '中等量', '多量'][Math.floor(rnd4() * 4)]; r.consistency = '普通'; }
          if (type === 'laxative') { nLx++; r.medicine = rnd4() < 0.5 ? '下剤A' : '下剤B'; r.tablets = '1'; }
          recs4.push(r);
          hAgo += rnd4() < 0.15 ? 30 + rnd4() * 60 : 2 + rnd4() * 14;
        }
        const re = { id: 1, name: '利用者01', room: '101', laxNote: rnd4() < 0.3 ? '架空のメモ' : '',
          hospitalizations: rnd4() < 0.4 ? [{ admissionAt: dtOf(NOW2 - (5 + Math.floor(rnd4() * 15)) * 864e5), dischargeAt: rnd4() < 0.8 ? dtOf(NOW2 - Math.floor(rnd4() * 5) * 864e5) : null }] : [] };
        if (re.hospitalizations.length && re.hospitalizations[0].dischargeAt && re.hospitalizations[0].dischargeAt < re.hospitalizations[0].admissionAt) re.hospitalizations = [];
        const H = loadSrc(recs4, [re], NOW2, todayStr, keep);
        const from = H.dateOff(-Math.min(92, keep)), to = todayStr;
        const dates = []; for (let d = new Date(from + 'T00:00:00'); ymdL(d) <= to; d.setDate(d.getDate() + 1)) dates.push(ymdL(d));
        Object.assign(H, {
          rpSpanDates: () => dates, $: () => null, rpResidents: () => [re], rpYMD: ymdL, isUserRec: () => true,
          recsByResDate: (rid, k) => recs4.filter(r => r.residentId === rid && r.date === k),
          rpWdCls: () => '', RP_WD: ['日', '月', '火', '水', '木', '金', '土'], escapeHtmlText: esc, rpHead: () => '', rpFoot: () => ''
        });
        const htmlB = H.rpBowelOne(), htmlL = H.laxHistHtml(1);
        const m1 = /期間中の排便 <b>(\d+)回<\/b>（うち少量 (\d+)回）　排便1回分として数えた回数 <b>(\d+)回<\/b>/.exec(htmlB);
        const m2 = /排便1回分の無かった最長の日数 <b>(.*?)<\/b>((?:（.*? の排便のあと）)?)<\/div>/.exec(htmlB);
        const m3 = /<div>下剤 <b>(\d+)回<\/b>(.*?)<\/div>/.exec(htmlB);
        const m4 = /平均の排便間隔.*?<b>(.*?)<\/b>/.exec(htmlB);
        const m5 = /下剤メモ: (.*?)<\/div>/.exec(htmlB);
        const m6 = /margin:4px 0">(.*?)<\/div>/.exec(htmlL);
        /* ビューア側: 全部を読み込んだ形（余白込み開始日は最初の記録より3日前＝確定点が最初の記録になる） */
        const snap = X.excParsePayload({ residents: [re], records: recs4 });
        const pool = snap.recs['1'] || [];
        const ff = X.excAddDays(pool.length ? pool[0].date : from, -3);
        const sm = X.excPeriodSummary(pool, snap.residents[0], snap.cfg, from, to, ff, [], NOW2);
        const ll = X.excLaxList(pool, from, to, NOW2, []);
        const want = [m1 && m1[1], m1 && m1[2], m1 && m1[3], m2 && m2[1], m2 && m2[2], m3 && m3[1], m3 && m3[2], m4 && m4[1], m5 ? m5[1] : '', m6 ? m6[1] : ''];
        const lxPart = sm.nLax ? '（' + H.LAX_REACT_H + '時間以内に排便あり ' + sm.lxOk + '回' + (sm.lxOk ? '・平均 ' + X.excFmtDur(sm.lxAvgH) + '後' : '') + '／なし ' + sm.lxNone + '回' + (sm.lxWait ? '／判定待ち ' + sm.lxWait + '回' : '') + '）' : '';
        const got = [String(sm.nStool), String(sm.nSmall), String(sm.nReset), sm.maxAfter ? sm.maxG + '日' : '—', sm.maxAfter ? '（' + H.fmtMD(sm.maxAfter) + ' の排便のあと）' : '',
          String(sm.nLax), lxPart, X.excFmtDur(sm.avgStoolH), sm.laxNote, ll.sum.map(esc).join('　／　')];
        if (JSON.stringify(want) !== JSON.stringify(got)) bad4.push({ n, want, got });
        if (sm.maxAfter) nMax++;
        if (re.hospitalizations.length) nHospStop++;
        if (ll.sum.length) nLaxSum++;
      }
      eq('期間のまとめ（回数・最長なし・下剤と反応・平均間隔・メモ）と薬ごとの反応が写し元と150通りすべて同じ（入院の日で止まる）', bad4.slice(0, 1), []);
      eq('入院あり・最長なしあり・薬ごとの集計ありの場合も十分に試せている', [nHospStop > 40, nMax > 80, nLaxSum > 80], [true, true, true]);
    }
    /* 写し元に無い扱い（読めていない日がある時）を固定 */
    {
      const now = Date.parse('2026-10-17T12:00:00+09:00');
      const snap = X.excParsePayload({ residents: [{ id: 1, name: '利用者01', room: '101' }],
        records: ['2026-10-03', '2026-10-06', '2026-10-08', '2026-10-12', '2026-10-15'].map((d, i) => ({ id: 's' + i, residentId: 1, type: 'stool', date: d, time: '08:00', stoolAmt: '中等量' })) });
      const p = snap.recs['1'];
      const a = X.excPeriodSummary(p, snap.residents[0], snap.cfg, '2026-10-02', '2026-10-17', '2026-09-30', [], now);
      const b2 = X.excPeriodSummary(p, snap.residents[0], snap.cfg, '2026-10-02', '2026-10-17', '2026-09-30', ['2026-10-10'], now);
      eq('数え落としが無ければ注記なし', [a.nReset, a.uncertain, a.failedNote], [5, false, '']);
      eq('期間の途中に読めなかった日があれば、その日付の注記・最長なしもそこで止まる', [b2.nReset, b2.failedNote, b2.uncertain, b2.maxG], [2, '2026-10-10', true, 2]);
      const snapH = X.excParsePayload({ residents: [{ id: 1, name: '利用者01', room: '101', hospitalizations: [{ admissionAt: '2026-10-05T10:00', dischargeAt: '2026-10-14T10:00' }] }],
        records: [{ id: 'a', residentId: 1, type: 'stool', date: '2026-10-04', time: '08:00', stoolAmt: '中等量' }, { id: 'b', residentId: 1, type: 'stool', date: '2026-10-15', time: '08:00', stoolAmt: '中等量' }] });
      const hm = X.excPeriodSummary(snapH.recs['1'], snapH.residents[0], snapH.cfg, '2026-10-02', '2026-10-17', '2026-09-30', [], now);
      eq('入院の日で「最長の排便1回分なし」を止める（写し元 isFullHospDay）', [hm.maxG, hm.maxAfter], [2, '2026-10-15']);
    }
    /* 写し元に無い扱い: 24時間の窓に読めていない日が重なれば「不明」 */
    const lx = { id: 'l1', residentId: '1', type: 'laxative', date: '2026-10-14', time: '20:00', datetime: '2026-10-14T20:00' };
    eq('反応が見つからず、24時間の中に読めていない日があれば不明', X.excLaxReaction(lx, [lx], NOW2, ['2026-10-15']).st, 'unknown');
    eq('読めていない日が窓の外なら写し元どおり', X.excLaxReaction(lx, [lx], NOW2, ['2026-10-10']).st, 'none');
  }

  /* ══ 12. 一覧の並べ方・要注意だけ（UI 状態の保存と不正値のフォールバック）・帯・異常の印 ══ */
  group('12. 一覧（並べ方・要注意だけ・帯・異常の印・最新の便・下剤・排尿）');
  {
    eq('既定は危険順・要注意だけは切', X.excUiState(() => null), { sort: 'risk', attn: false });
    eq('保存した値を読む', X.excUiState(k => ({ msk_excSort: 'room', msk_excAttn: '1' })[k]), { sort: 'room', attn: true });
    eq('不正値・未知値は既定へ', X.excUiState(k => ({ msk_excSort: 'toString', msk_excAttn: 'yes' })[k]), { sort: 'risk', attn: false });
    eq('居室は数で並べる（全角・号室を吸収）', ['１０号室', '9', '101', 'A棟'].sort(X.excRoomCmp), ['9', '１０号室', '101', 'A棟']);
    const now = Date.parse('2026-10-17T12:00:00+09:00');
    const snap = X.excParsePayload({
      residents: [{ id: 1, name: '利用者01', room: '101' }, { id: 2, name: '利用者02', room: '103' }, { id: 3, name: '利用者03', room: '102' }],
      records: [
        { id: 'a', residentId: 1, type: 'stool', date: '2026-10-17', time: '08:00', stoolAmt: '中等量', consistency: '普通', stoolColor: '血便' },
        { id: 'b', residentId: 1, type: 'urine', date: '2026-10-17', time: '11:00', urineAmt: 150, urineColor: '淡黄色' },
        { id: 'b2', residentId: 1, type: 'urine', date: '2026-10-17', time: '09:00', urineAmt: '多い' },
        { id: 'c', residentId: 1, type: 'laxative', date: '2026-10-16', time: '20:00', medicine: '下剤A', tablets: '2' },
        { id: 'd', residentId: 2, type: 'stool', date: '2026-10-14', time: '08:00', stoolAmt: '多量', consistency: '硬便' },
        { id: 'e', residentId: 2, type: 'urine', date: '2026-10-17', time: '10:30' },
        { id: 'f', residentId: 3, type: 'stool', date: '2026-10-17', time: '07:00', stoolAmt: '少量', consistency: '水様便' },
        { id: 'g', residentId: 3, type: 'urine', date: '2026-10-17', time: '03:00', urineColor: '血尿' }],
      cfg: { stoolWarnD: 2, stoolDangerD: 3 }
    });
    const opt = { from: '2026-10-04', to: '2026-10-17', pending: {} };
    const rows = X.excRows(snap, [], now, '2026-10-02', [], opt);
    eq('危険順（便か尿の重い方）→ 同じ中は五十音', rows.map(r => [r.id, r.status.level, r.urine.level]), [['2', 'danger', 'ok'], ['3', 'ok', 'danger'], ['1', 'ok', 'ok']]);
    eq('居室順', X.excRows(snap, [], now, '2026-10-02', [], Object.assign({}, opt, { sort: 'room' })).map(r => r.id), ['1', '3', '2']);
    eq('要注意だけ（尿か便が注意・危険）', X.excRows(snap, [], now, '2026-10-02', [], Object.assign({}, opt, { attn: true })).map(r => r.id), ['2', '3']);
    const r1 = rows.find(r => r.id === '1');
    eq('帯は終了日までの14日・同じ関数（カレンダーと同じ地）', [r1.band.length, r1.band[13].day, r1.band[13].items.length, r1.band[13].abn], [14, '2026-10-17', 1, ['血便']]);
    eq('最新の便（ブリストル付き）', X.excConsBs(r1.lastStool) + '・' + r1.lastStool.stoolAmt, '普通（ブリストル4）・中等量');
    eq('直近の下剤と反応（12時間後に反応）', [r1.lastLax.medicine, X.excLaxReactText(r1.laxReact)], ['下剤A', '→ 12時間後に排便']);
    eq('今日の排尿の回数・ml・文字の量', X.excUrineDayText(r1.urineDay), '2回・150ml・多い');
    eq('期間内の異常の印', [r1.abn, rows.find(r => r.id === '3').abn.sort()], [['血便'], ['水様便', '血尿'].sort()]);
    /* 読み込み中の日が判定の起点なら「読み込み中」（数を出さない） */
    const r2 = X.excRows(snap, [], now, '2026-10-02', ['2026-10-17'], Object.assign({}, opt, { pending: { '2026-10-17': true } }));
    eq('まだ届いていない日が起点の間は読み込み中', r2.find(r => r.id === '2').sLoading, true);
    /* 期間のまとめ・下剤の一覧・週ごと・交換 */
    const sm = X.excPeriodSummary(snap.recs['1'], snap.residents[0], snap.cfg, '2026-10-04', '2026-10-17', '2026-10-02', [], now);
    eq('期間のまとめ（回数・下剤・反応・メモ）', [sm.nStool, sm.nSmall, sm.nReset, sm.nLax, sm.lxOk], [1, 0, 1, 1, 1]);
    const ll = X.excLaxList(snap.recs['1'], '2026-10-04', '2026-10-17', now, []);
    eq('薬ごとの「n回中m回反応（平均◯後）」', ll.sum, ['下剤A：1回中1回反応（平均 12時間後）']);
    eq('週ごと（月曜始まり・期間で切る）', X.excGuideWeeks(snap.recs['1'], '2026-10-04', '2026-10-17', []).map(w => w.from + '〜' + w.to),
      ['2026-10-04〜2026-10-04', '2026-10-05〜2026-10-11', '2026-10-12〜2026-10-17']);
    eq('交換の列が無ければ欄ごと出さない', X.excPadTotals(snap.recs['1'], '2026-10-04', '2026-10-17').any, false);
  }

  /* ══ 13. バイタル: 平熱用の30日分を本体と1回にまとめ、表示は期間で切る ══ */
  group('13. バイタルの measures を1回にまとめる（期間で切る）');
  {
    const calls = [];
    const box = {
      console, JSON, Math, Object, String, Number, Array, isNaN, isFinite, parseInt, Promise, Date,
      $: () => ({ textContent: '', appendChild() {}, set disabled(v) {} }), document: { createElement: () => ({ appendChild() {} }) },
      apiGet: (a, p) => { calls.push(p); const vitals = [], meals = []; for (let d = p.from; d <= p.to; d = addD(d, 1)) { vitals.push({ date: d, name: '利用者01', temp: 36.5 }); meals.push({ date: d, name: '利用者01', bMain: 5 }); }
        return Promise.resolve({ from: p.from, to: p.to, vitals, meals, vitalDates: vitals.map(v => v.date), mealDates: meals.map(v => v.date) }); },
      rgBusyVm() {}, rgClearVm() {}, vmRenderBanner() {}, vmRenderList() {}, vmRenderBody() {}, currentScreen: () => 'scr-vm', goto() {}, apiErrMsg: () => 'x'
    };
    vm.createContext(box);
    vm.runInContext([grabDecl('VM_MAX_DAYS'), grabDecl('RG_DAYS_OPTS'), grabDecl('RG_DEF_DAYS'), grabDecl('RANGE'), grabDecl('VM'), grabDecl('VM_USUAL'),
      grabDecl('VM_USUAL_RISE'), grabDecl('VM_USUAL_DAYS'), grabDecl('VM_USUAL_MIN'), 'var VM_LOADING = false, VM_ERR = "";',
      ...['z2', 'okYmd', 'ymd', 'addDays', 'rgDays', 'sharedRange', 'rgSpecStale', 'vmLoaded', 'vmStale', 'vmLoad', 'normName', 'mergeBy',
        'vmTenths', 'vmNum', 'vmUsualTemp', 'vmUsualFrom', 'vmUsualByName'].map(grabFn)].join('\n'), box);
    box.RANGE.days = 7;
    await box.vmLoad(); await ticks();
    const r = box.sharedRange();
    eq('7日の期間は measures を1回だけ（from＝終了日−29）', [calls.length, calls[0].from, calls[0].to], [1, box.vmUsualFrom(r.to), r.to]);
    eq('表・グラフ・コピー・印刷の材料は期間で切る（期間外の日を出さない）',
      [box.VM.vitals.length, box.VM.meals.length, box.VM.vitalDates.length, box.VM.from, box.VM.vitals.every(v => v.date >= r.from)], [7, 7, 7, r.from, true]);
    eq('平熱は切る前の30日分から', box.VM_USUAL.by['利用者01'], 36.5);
    eq('平熱の別読みの関数は無い', /function vmLoadUsual\(/.test(SRC), false);
    calls.length = 0;
    box.RANGE.days = 60;
    await box.vmLoad(); await ticks();
    eq('30日以上の期間は期間の開始から1回', [calls.length, calls[0].from], [1, box.sharedRange().from]);
  }

  /* ══ 14. 先読み: 最初のタブを読み終えたら、ほかのタブを順に裏で読む ══ */
  group('14. 先読み（順番・接続設定が無いものは読まない・古い先読みは捨てる）');
  {
    const order = [];
    const mk = (cfgOk, hbOk) => {
      const box = { console, Promise, setTimeout: (f) => setImmediate(f), LOADING: false, VM_LOADING: false, EXC_LOADING: false, PF_STARTED: false,
        loadCfg: () => cfgOk ? { url: 'u', token: 't' } : { url: '', token: '' }, excReadCfg: () => hbOk ? { url: 'h', token: 'x' } : null,
        dataLoaded: () => false, baseStale: () => false, vmLoaded: () => false, vmStale: () => false, excLoaded: () => false, excStale: () => false,
        load: (o) => { order.push('events:' + !!(o && o.quiet)); return Promise.resolve(); },
        vmLoad: (o) => { order.push('measures:' + !!(o && o.quiet)); return Promise.resolve(); },
        excLoad: (o) => { order.push('exc:' + !!(o && o.quiet)); return Promise.resolve(); } };
      vm.createContext(box);
      vm.runInContext(['var PF_STARTED = false;', 'var LOADING = false, VM_LOADING = false, EXC_LOADING = false;', grabFn('pfBusy'), grabFn('pfSteps'), grabFn('pfRun'), grabFn('pfAfterFirst')].join('\n'), box);
      return box;
    };
    let bx = mk(true, true);
    bx.pfAfterFirst(); await ticks(10);
    eq('申し送り→バイタル→排泄の順に、裏で（quiet）', order, ['events:true', 'measures:true', 'exc:true']);
    order.length = 0;
    bx.pfRun(); await ticks(10);
    eq('先読みは1回だけ', order, []);
    bx = mk(true, false); bx.pfRun(); await ticks(10);
    eq('排便記録の接続設定が無い端末は排泄を先読みしない', order, ['events:true', 'measures:true']);
    order.length = 0;
    bx = mk(false, true); bx.pfRun(); await ticks(10);
    eq('申送の接続設定が無い端末は排泄だけ', order, ['exc:true']);
    order.length = 0;
    bx = mk(true, true); bx.VM_LOADING = true;
    vm.runInContext('VM_LOADING = true;', bx);
    bx.pfRun(); await ticks(4);
    eq('画面の読み込み中は先読みを待つ', order, []);
    vm.runInContext('VM_LOADING = false;', bx); await ticks(10);
    eq('終わったら続ける', order.length, 3);
    /* 古い先読みは捨てる＝期間を変えた後は stale として扱われ、タブを開いた時に読み直す（10群の (i) と msk_range_test の⑩） */
    const t10 = loadBox();
    t10.SCREEN = 'scr-resident'; t10.RANGE.days = 7;
    t10.excLoad({ quiet: true }); await ticks();
    t10.RANGE.days = 14;                                   // 先読み中に期間を変える
    while (t10._pend.length) { answer(t10._pend.shift(), []); await ticks(); }
    await ticks(6);
    eq('先読み中に期間を変えたら、先読みの結果は古い期間（stale）・見ていないので追いかけない', [t10.excStale(), t10.EXC.reqDays], [true, 7]);
    t10.SCREEN = 'scr-exc';
    const p0 = t10._calls.post.length;
    t10.ensureExcData(); await ticks();
    eq('タブを開いた時に今の期間で読み直す', t10._calls.post.length > p0, true);
  }
  done();
})().catch(e => { ng++; console.log('  ✗ 例外: ' + (e && e.stack || e)); done(); });

function done() {
  console.log('\n────────── 合計: ' + ok + ' 件成功 / ' + ng + ' 件失敗 ──────────');
  process.exit(ng ? 1 : 0);
}
