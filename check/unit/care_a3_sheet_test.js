/* 週間計画「A3週間予定表」の紙面組み立てテスト（2026-09-01 新設）
   実行: node check/unit/care_a3_sheet_test.js

   何を守るか（元様式＝ご家族へ渡している Excel の再現）:
     ①時間軸の写像。等倍ではなく 0–8時＝早朝帯／8–17時＝1時間1行／17–20時＝1行／20–24時＝夜間帯。
       ここが狂うと、コマが別の時間帯に印字される（紙だけで気づけない事故）
     ②色の規則（通所=黄／支援内容に「買物」=緑／その他の訪問=青灰）
     ③♨は「入浴ありの通所」だけ（加算の有無を紙で誤って伝えない）
     ④短いコマの広げ方。次のコマに重ねない・実時間の重なりだけ列を分ける
     ⑤文言は入力されたものだけ（勝手な文字を足さない）
   ★このファイルは gas/ 配下＝公開リポジトリには載らない。氏名は全て架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

function scanBlock(src, from, open, close) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === open) { depth++; seen = true; }
    else if (c === close) { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const st = SRC.indexOf('\nfunction ' + name + '(');
  if (st < 0) throw new Error('関数が見つかりません: ' + name);
  return SRC.slice(st, scanBlock(SRC, st, '{', '}') + 1);
}
function grabDecl(name) {
  const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  const vpos = m.index + m[0].length, open = SRC[vpos];
  if (open === '{' || open === '[') {
    const end = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']');
    let j = end + 1;
    while (j < SRC.length && SRC[j] !== ';') j++;
    return SRC.slice(m.index, j + 1).replace(/^(?:const|let)\s/, 'var ');
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol).replace(/^(?:const|let)\s/, 'var ');
}

let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function near(label, got, want, tol) {
  if (Math.abs(got - want) <= (tol === undefined ? 0.05 : tol)) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + want + '±' + tol + '\n    実際: ' + got + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

const box = { JSON, Math, Number, String, Array, Object, console, isFinite, parseInt };
vm.createContext(box);
vm.runInContext([
  "var DAYS_JA = ['月','火','水','木','金','土','日'];",
  'var SOGO_VISIT_CODES = { A21121: { label: "【A11】" } };',
  /* escHtml は正規表現の中に " を含み簡易スキャナで切り出せないため、同じ実装を置く */
  'function escHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\\"/g,"&quot;");}',
  grabFn('timeToMins'), grabFn('catDisplayLabel_'),
  grabDecl('WK_ROW'), grabDecl('WK_AXIS'), grabDecl('WK_MIN_H'), grabDecl('WK_MIN_H_VISIT'), grabDecl('WK_BODY_H'),
  grabDecl('WK_SHEET_COLORS'), grabDecl('WK_SHEET_ICONS'), grabDecl('WK_ZONES'),
  grabFn('wkY_'), grabFn('wkIsBandSlot_'), grabFn('wkBandLabel_'), grabFn('wkKindOf_'), grabFn('wkTimeText_'), grabFn('wkMainText_'),
  grabFn('wkIconsFor_'), grabFn('wkLayoutDay_'), grabFn('buildWeeklySheetHtml_'),
].join('\n'), box);

const A = box.WK_AXIS;
const ev = (o) => Object.assign({ id: 'x', dayOfWeek: 0, serviceType: 'visit', category: '生活３',
  startTime: '10:00', endTime: '11:00', detail: '', bathing: false }, o || {});

/* ═══ 1. 時間軸（ここが狂うと紙だけ間違う）═══ */
group('wkY_（時刻→紙面のY）');
near('0:00 は先頭', box.wkY_(0), 0);
/* ★元様式の寸法（2026-09-02 実測）: 1行=19.5pt×125%=8.6mm／1時間=2行／早朝帯=2行／
   17:00〜20:00=3行／夜間帯=2行。時刻は7:00から出す（7時台の訪問が8:00の手前に収まる）。 */
near('1行は元様式の8.6mm', box.WK_ROW, 8.6);
near('1時間は2行', A.hour, box.WK_ROW * 2);
near('7:00 は早朝帯の終わり', box.wkY_(420), A.band);
near('8:00 は7:00の1時間下', box.wkY_(480), A.band + A.hour);
near('12:00', box.wkY_(720), A.band + 5 * A.hour);
near('17:00 は7:00から10時間ぶん下', box.wkY_(1020), A.band + 10 * A.hour);
near('20:00 は17:00の3行下', box.wkY_(1200), A.band + 10 * A.hour + A.eve);
near('24:00 は紙面の下端', box.wkY_(1440), box.WK_BODY_H);
near('早朝5:30も帯の中', box.wkY_(330), (330 / 420) * A.band);
near('18:30 は 17-20 の圧縮区間の中', box.wkY_(1110), A.band + 10 * A.hour + 0.5 * A.eve);
/* ★7時台の訪問は「8:00 の線の手前」に置かれる（本人指示の要） */
{
  const y740 = box.wkY_(460), y800 = box.wkY_(480), y700 = box.wkY_(420);
  eq('7:40 は 7:00 より下', y740 > y700, true);
  eq('7:40 は 8:00 より上', y740 < y800, true);
  near('7:40 は 7:00〜8:00 を等分した位置', y740, A.band + (40 / 60) * A.hour);
}
eq('負の値は先頭で止める', box.wkY_(-100), 0);
eq('24時を超えても下端で止める', box.wkY_(9999), box.WK_BODY_H);
eq('数値でない時も落ちない', box.wkY_('こわれた'), 0);
{
  /* 単調増加＝コマの前後関係が入れ替わらない（区分線形の要） */
  let prev = -1, monotonic = true;
  for (let m = 0; m <= 1440; m += 5) { const y = box.wkY_(m); if (y < prev) monotonic = false; prev = y; }
  eq('時刻が進めばYも必ず進む（前後が入れ替わらない）', monotonic, true);
}

/* ═══ 2. 色の規則（本人確定）═══ */
group('wkKindOf_（色の規則）');
eq('通所は黄', box.wkKindOf_(ev({ serviceType: 'daycare' })), 'daycare');
eq('支援内容に「買物」を含む訪問は緑', box.wkKindOf_(ev({ detail: '買物' })), 'shop');
eq('「買物」を含んでいれば他の語があっても緑', box.wkKindOf_(ev({ detail: '掃除・買物' })), 'shop');
eq('その他の訪問は青灰', box.wkKindOf_(ev({ detail: '掃除・洗濯' })), 'visit');
eq('支援内容が空の訪問も青灰', box.wkKindOf_(ev({ detail: '' })), 'visit');
eq('壊れた入力でも落ちない', box.wkKindOf_(null), 'visit');
eq('色は4種類', Object.keys(box.WK_SHEET_COLORS).sort(), ['daycare', 'rise', 'shop', 'visit']);
/* ★起床時支援・就寝時支援の帯は本人指定の黄緑 RGB(85,255,0)＝#55FF00（2026-09-02）。 */
eq('帯は指定のRGB(85,255,0)', box.WK_SHEET_COLORS.rise, { time: '#55FF00', body: '#55FF00' });
eq('買物の緑とは違う色', box.WK_SHEET_COLORS.rise.body !== box.WK_SHEET_COLORS.shop.body, true);
eq('朝の身体01は帯の色',
   box.wkKindOf_(ev({ detail: '', category: '身体０１', startTime: '07:40', endTime: '07:59' })), 'rise');
eq('夕方以降の身体01も帯の色',
   box.wkKindOf_(ev({ detail: '', category: '身体０１', startTime: '20:40', endTime: '20:59' })), 'rise');
eq('日中の身体01は水色のまま',
   box.wkKindOf_(ev({ detail: '', category: '身体０１', startTime: '12:00', endTime: '12:20' })), 'visit');
/* ★支援内容の記載があっても帯は帯（「就寝時支援＋軟膏塗布」の意味）＝色は統一する。
   ただし記載は入力どおり出す（原則6）。 */
eq('軟膏の記載があっても帯の色',
   box.wkKindOf_(ev({ detail: '軟膏', category: '身体０１', startTime: '20:40', endTime: '20:59' })), 'rise');
eq('朝の記載つきも帯の色',
   box.wkKindOf_(ev({ detail: '整容', category: '身体０１', startTime: '07:40', endTime: '07:59' })), 'rise');
eq('記載があるときの文言は入力どおり',
   box.wkMainText_(ev({ detail: '軟膏', category: '身体０１', startTime: '20:40', endTime: '20:59' })), '軟膏');
eq('記載が無いときだけ呼び名にする',
   box.wkMainText_(ev({ detail: '', category: '身体０１', startTime: '20:40', endTime: '20:59' })), '就寝時支援');
eq('帯でも通所は黄のまま',
   box.wkKindOf_(ev({ serviceType: 'daycare', category: '', startTime: '07:40', endTime: '08:00' })), 'daycare');
eq('日中の記載つき身体01は水色',
   box.wkKindOf_(ev({ detail: '軟膏', category: '身体０１', startTime: '12:00', endTime: '12:20' })), 'visit');
/* ★「とにかく帯なら統一の色」（本人指示）＝買物の記載があっても帯が優先する */
eq('帯の時間に買物の記載があっても帯の色',
   box.wkKindOf_(ev({ detail: '買物', category: '身体０１', startTime: '20:00', endTime: '20:30' })), 'rise');
eq('日中の買物は従来どおり緑',
   box.wkKindOf_(ev({ detail: '買物', category: '生活２', startTime: '13:00', endTime: '14:00' })), 'shop');
/* 帯の判定（色）と呼び名（文言）は別物。記載があるときは呼び名を返さない＝入力を消さない */
eq('記載があっても帯そのものではある',
   box.wkIsBandSlot_(ev({ detail: '軟膏', category: '身体０１', startTime: '20:40', endTime: '20:59' })), true);
eq('記載があるときは呼び名を返さない',
   box.wkBandLabel_(ev({ detail: '軟膏', category: '身体０１', startTime: '20:40', endTime: '20:59' })), '');
eq('記載が無いときだけ呼び名を返す',
   box.wkBandLabel_(ev({ detail: '', category: '身体０１', startTime: '20:40', endTime: '20:59' })), '就寝時支援');
/* ★深夜〜午前4時は起床介助ではないので「排泄介助」と書く（2026-09-02 本人指示）。
   「午前4時以前」の指示どおり、4:00ちょうども深夜側に含める。 */
eq('深夜1:30は排泄介助',
   box.wkBandLabel_(ev({ detail: '', category: '身体０１', startTime: '01:30', endTime: '01:50' })), '排泄介助');
eq('午前4時ちょうども排泄介助',
   box.wkBandLabel_(ev({ detail: '', category: '身体０１', startTime: '04:00', endTime: '04:20' })), '排泄介助');
eq('4時を過ぎれば起床時支援',
   box.wkBandLabel_(ev({ detail: '', category: '身体０１', startTime: '04:30', endTime: '04:50' })), '起床時支援');
eq('朝7:40は従来どおり起床時支援',
   box.wkBandLabel_(ev({ detail: '', category: '身体０１', startTime: '07:40', endTime: '07:59' })), '起床時支援');
eq('深夜も帯の色は同じ',
   box.wkKindOf_(ev({ detail: '', category: '身体０１', startTime: '01:30', endTime: '01:50' })), 'rise');
eq('深夜でも記載があれば入力どおり',
   box.wkMainText_(ev({ detail: '軟膏', category: '身体０１', startTime: '01:30', endTime: '01:50' })), '軟膏');
eq('深夜の呼び名は紙にも出る',
   box.wkMainText_(ev({ detail: '', category: '身体０１', startTime: '02:00', endTime: '02:20' })), '排泄介助');
/* ★元様式の塗りつぶし実値（styles.xml から抽出・2026-09-02）。目視の近似に戻さないよう値で固定する。 */
eq('通所は元様式の黄', box.WK_SHEET_COLORS.daycare, { time: '#FFFF00', body: '#FFFF00' });
/* ★訪問（掃除・洗濯など通常の訪問）は元様式の #A5B6CB から水色 RGB(0,255,255) へ変えている
   （2026-09-02 本人指定）。元の値へ戻す変更は指示に反するので、値で固定して気づけるようにする。 */
eq('訪問は指定のRGB(0,255,255)', box.WK_SHEET_COLORS.visit, { time: '#00FFFF', body: '#00FFFF' });
eq('掃除・洗濯のコマがこの色になる',
   box.wkKindOf_(ev({ detail: '掃除・洗濯', category: '生活３', startTime: '13:00', endTime: '14:00' })), 'visit');
eq('帯・買物・通所とは別の色',
   new Set([box.WK_SHEET_COLORS.visit.body, box.WK_SHEET_COLORS.rise.body,
            box.WK_SHEET_COLORS.shop.body, box.WK_SHEET_COLORS.daycare.body]).size, 4);
eq('買物代行は元様式の緑', box.WK_SHEET_COLORS.shop, { time: '#92D050', body: '#92D050' });
eq('元様式は時刻の行と内容の行を同じ色で塗る（濃淡を付けない）',
   ['daycare', 'shop', 'visit'].every(k => box.WK_SHEET_COLORS[k].time === box.WK_SHEET_COLORS[k].body), true);

/* ═══ 3. 文字（元様式の書き方）═══ */
group('wkTimeText_ / wkMainText_');
/* ★元様式（週間サービス表.xlsm）の実際の表記に合わせている（2026-09-02 に全140件を数えて確認）。
   コロンは全角「：」U+FF1A・区切りは全角チルダ「～」U+FF5E・時の先頭0なし・通所と訪問で書き分けない。 */
eq('通所も全角コロンと全角チルダ',
   box.wkTimeText_(ev({ serviceType: 'daycare', startTime: '09:00', endTime: '13:30' })), '9：00～13：30');
eq('訪問も同じ書き方', box.wkTimeText_(ev({ startTime: '08:40', endTime: '09:00' })), '8：40～9：00');
eq('10時台は0を落とさない', box.wkTimeText_(ev({ startTime: '10:00', endTime: '11:00' })), '10：00～11：00');
eq('区切りは波ダッシュ(U+301C)ではなく全角チルダ(U+FF5E)',
   box.wkTimeText_(ev({ startTime: '09:00', endTime: '10:00' })).charCodeAt(4), 0xFF5E);   /* 9：00～ の5文字目 */
eq('コロンは全角(U+FF1A)',
   box.wkTimeText_(ev({ startTime: '09:00', endTime: '10:00' })).charCodeAt(1), 0xFF1A);
eq('時刻が欠けていれば空', box.wkTimeText_(ev({ startTime: '', endTime: '09:00' })), '');
eq('通所の見出しは様式の文言', box.wkMainText_(ev({ serviceType: 'daycare' })), 'デイサービス');
eq('訪問は入力された支援内容をそのまま出す', box.wkMainText_(ev({ detail: '掃除・洗濯' })), '掃除・洗濯');
eq('支援内容が無ければサービス区分', box.wkMainText_(ev({ detail: '', category: '生活３' })), '生活３');
/* ★支援内容が空の「身体01」は、紙では時間帯の呼び名にする（本人指示 2026-09-02）。
   データは書き換えず表示だけ。入力があるときは入力が優先（原則6）。 */
eq('朝の身体01は起床時支援',
   box.wkMainText_(ev({ detail: '', category: '身体０１', startTime: '07:40', endTime: '07:59' })), '起床時支援');
eq('夕方以降の身体01は就寝時支援',
   box.wkMainText_(ev({ detail: '', category: '身体０１', startTime: '20:40', endTime: '20:59' })), '就寝時支援');
eq('17:00ちょうども就寝時支援',
   box.wkMainText_(ev({ detail: '', category: '身体０１', startTime: '17:00', endTime: '17:20' })), '就寝時支援');
eq('日中の身体01は区分のまま',
   box.wkMainText_(ev({ detail: '', category: '身体０１', startTime: '12:00', endTime: '12:20' })), '身体０１');
eq('半角の身体01も同じ扱い',
   box.wkMainText_(ev({ detail: '', category: '身体01', startTime: '07:40', endTime: '07:59' })), '起床時支援');
eq('支援内容が入っていれば置き換えない',
   box.wkMainText_(ev({ detail: '排泄ケア', category: '身体０１', startTime: '07:40', endTime: '07:59' })), '排泄ケア');
eq('身体01以外は置き換えない',
   box.wkMainText_(ev({ detail: '', category: '身体１', startTime: '07:40', endTime: '07:59' })), '身体１');
eq('総合事業は略称で出す', box.wkMainText_(ev({ detail: '', category: 'A21121' })), '【A11】');
eq('区分も無ければ「訪問介護」', box.wkMainText_(ev({ detail: '', category: '' })), '訪問介護');

/* ═══ 4. 配置（重ねない・広げる向き）═══ */
group('wkLayoutDay_（短いコマの広げ方と列分け）');
{
  /* 元様式の水曜: 8:40〜9:00 の訪問 → 9:00 からの通所。重なりではないので1列のまま。 */
  const out = box.wkLayoutDay_([
    ev({ id: 'v', startTime: '08:40', endTime: '09:00', detail: '返却・デイ準備' }),
    ev({ id: 'd', serviceType: 'daycare', startTime: '09:00', endTime: '13:30' }),
  ]);
  eq('列は分けない（実時間が重なっていない）', out[0].lanes, 1);
  eq('短い訪問は上へ広げる（次のコマに掛けない）', out[0].top < box.wkY_(520), true);
  eq('上へ広げた箱も読める大きさ（実寸12mm以上）', out[0].h >= 12, true);
  eq('広げても次のコマに重ならない', out[0].top + out[0].h <= out[1].top + 0.001, true);
  eq('通所の位置は実時間どおり', Math.round(out[1].top * 100) / 100, Math.round(box.wkY_(540) * 100) / 100);
}
{
  /* 土曜 17:00〜17:20＝後ろに何も無い → 下へ広げる（元様式と同じ） */
  const out = box.wkLayoutDay_([ev({ startTime: '17:00', endTime: '17:20', detail: '返却・デイ準備' })]);
  near('位置は 17:00 のまま', out[0].top, box.wkY_(1020));
  /* ★下限は定数と比べない（定数ごと壊す変異を素通りさせるため）。実寸で確かめる。
     12mm = 時刻1行(3.6mm)＋内容1行(3.2mm)＋余白が入る最低限。 */
  eq('読める大きさまで下へ広げる（実寸12mm以上）', out[0].h >= 12, true);
}
{
  /* 実時間が重なる2件は左右に分ける */
  const out = box.wkLayoutDay_([
    ev({ id: 'a', startTime: '10:00', endTime: '11:00' }),
    ev({ id: 'b', startTime: '10:30', endTime: '11:30' }),
  ]);
  eq('重なりは2列に分ける', out[0].lanes, 2);
  eq('別の列に置く', [out[0].lane, out[1].lane], [0, 1]);
}
{
  /* 通所は実時間どおり（下限で膨らませない） */
  const out = box.wkLayoutDay_([ev({ serviceType: 'daycare', startTime: '09:00', endTime: '13:30' })]);
  near('通所の高さ＝実時間ぶん', out[0].h, box.wkY_(810) - box.wkY_(540));
}
{
  /* 3件が連続しても、どれも次のコマに重ならない */
  const out = box.wkLayoutDay_([
    ev({ startTime: '08:40', endTime: '09:00' }),
    ev({ startTime: '09:00', endTime: '09:20' }),
    ev({ startTime: '09:20', endTime: '09:40' }),
  ]);
  let overlap = false;
  for (let i = 0; i + 1 < out.length; i++) if (out[i].top + out[i].h > out[i + 1].top + 0.001) overlap = true;
  eq('連続するコマが重ならない', overlap, false);
}
eq('時刻が欠けたコマは置かない', box.wkLayoutDay_([ev({ startTime: '', endTime: '' })]).length, 0);
eq('予定が無ければ空', box.wkLayoutDay_([]).length, 0);

/* ═══ 5. 紙面（組み立てた HTML）═══ */
group('buildWeeklySheetHtml_');
{
  const res = { name: '架空 花子', events: [
    ev({ dayOfWeek: 0, serviceType: 'daycare', startTime: '09:00', endTime: '13:30', bathing: true }),
    ev({ dayOfWeek: 5, serviceType: 'daycare', startTime: '09:00', endTime: '13:30', bathing: false }),
    ev({ dayOfWeek: 4, detail: '買物', startTime: '13:00', endTime: '14:00' }),
  ] };
  const html = box.buildWeeklySheetHtml_(res);
  eq('氏名に「様」を付けて出す', /架空 花子様/.test(html), true);
  eq('曜日は7列', (html.match(/wk-day-col/g) || []).length, 7);
  eq('曜日見出しが7つ', ['月','火','水','木','金','土','日'].every(d => html.indexOf('>' + d + '<') >= 0), true);
  eq('コマは3つ', (html.match(/class="wk-ev"/g) || []).length, 3);
  eq('♨は入浴ありの通所だけ', (html.match(/wk-onsen/g) || []).length, 1);
  eq('買物は緑', html.indexOf(box.WK_SHEET_COLORS.shop.body) >= 0, true);
  eq('通所は黄', html.indexOf(box.WK_SHEET_COLORS.daycare.body) >= 0, true);
  eq('時刻ラベルは 8:00〜17:00 と 20:00（18:00・19:00 は出さない）',
     [/>8:00</, />17:00</, />20:00</].every(re => re.test(html)) && !/>18:00</.test(html) && !/>19:00</.test(html), true);
  eq('帯は4つ', ['早朝','午前','午後','夜間'].every(b => html.indexOf('>' + b + '<') >= 0), true);
}
{
  /* 予定ゼロでも様式は出る（白紙で渡せる） */
  const html = box.buildWeeklySheetHtml_({ name: '架空 一郎', events: [] });
  eq('予定ゼロでも表は出る', (html.match(/wk-day-col/g) || []).length, 7);
  eq('コマは無い', (html.match(/class="wk-ev"/g) || []).length, 0);
}
{
  /* 受け取った文字はそのまま埋め込まない（エスケープ） */
  const html = box.buildWeeklySheetHtml_({ name: '<img src=x onerror=alert(1)>', events: [
    ev({ dayOfWeek: 0, detail: '<script>' }) ] });
  eq('氏名をエスケープする', html.indexOf('<img src=x') < 0, true);
  eq('支援内容もエスケープする', html.indexOf('<script>') < 0, true);
}
{
  /* イラストは登録されている語だけ出す（未登録なら何も描かない）。
     ★実際に埋め込まれている画像に左右されないよう、この試験の間だけ対応表を差し替える。 */
  const real = box.WK_SHEET_ICONS;
  box.WK_SHEET_ICONS = {};
  eq('未登録なら画像は出ない', box.wkIconsFor_(ev({ detail: '掃除・洗濯' })).length, 0);
  box.WK_SHEET_ICONS = { '掃除': 'data:image/png;base64,AAA' };
  eq('登録された語は引ける', box.wkIconsFor_(ev({ detail: '掃除・洗濯' })), ['data:image/png;base64,AAA']);
  eq('区切りは「・」と「/」の両方', box.wkIconsFor_(ev({ detail: 'デイ/掃除' })), ['data:image/png;base64,AAA']);
  eq('同じ画像は1回だけ', box.wkIconsFor_(ev({ detail: '掃除・掃除' })).length, 1);
  eq('支援内容が空なら何も出ない', box.wkIconsFor_(ev({ detail: '' })).length, 0);
  box.WK_SHEET_ICONS = real;
  /* 埋め込み済みの対応表そのものの健全性（data URI 以外を入れない＝外部読み込みを作らない） */
  const keys = Object.keys(box.WK_SHEET_ICONS);
  /* 入浴の印は、画像が登録されていればそれを使い、無ければ記号で出す（届く前でも紙は成立する） */
  {
    const keep = box.WK_SHEET_ICONS;
    box.WK_SHEET_ICONS = {};
    const noImg = box.buildWeeklySheetHtml_({ name: '架空', events: [
      ev({ dayOfWeek: 0, serviceType: 'daycare', category: '', bathing: true }) ] });
    eq('画像が無ければ記号の♨を出す', noImg.indexOf('wk-onsen">♨') >= 0, true);
    box.WK_SHEET_ICONS = { '入浴': 'data:image/png;base64,AAA' };
    const withImg = box.buildWeeklySheetHtml_({ name: '架空', events: [
      ev({ dayOfWeek: 0, serviceType: 'daycare', category: '', bathing: true }) ] });
    eq('画像があれば画像を出す', withImg.indexOf('wk-onsen-img') >= 0, true);
    eq('画像を出すときは記号を重ねない', withImg.indexOf('wk-onsen">♨') < 0, true);
    const noBath = box.buildWeeklySheetHtml_({ name: '架空', events: [
      ev({ dayOfWeek: 0, serviceType: 'daycare', category: '', bathing: false }) ] });
    eq('入浴なしのデイには印を出さない', /wk-onsen/.test(noBath), false);
    box.WK_SHEET_ICONS = keep;
  }
  eq('登録された画像はすべて data URI（外部の読み込み先を作らない）',
     keys.every(k => /^data:image\/(png|jpeg|gif|webp);base64,/.test(box.WK_SHEET_ICONS[k])), true);
}

/* ═══ 5-2. 圧縮された帯に複数コマ（レビュー高3・紙から訪問が消えないこと）═══ */
group('圧縮帯の等分（早朝・夕夜）');
{
  /* 夜間に2件（20:30 と 22:00）。時間に比例させると2件目が潰れる条件。 */
  const out = box.wkLayoutDay_([
    ev({ startTime: '20:30', endTime: '20:50', detail: '排泄ケア' }),
    ev({ startTime: '22:00', endTime: '22:20', detail: '排泄ケア' }),
  ]);
  eq('2件とも紙に置かれる', out.length, 2);
  eq('どちらも読める高さ（実寸8mm以上）', out.every(p => p.h >= 8), true);
  eq('縦に並べる（左右には割らない）', out.every(p => p.lane === 0), true);
  eq('重ならない', out[0].top + out[0].h <= out[1].top + 0.001, true);
  eq('夜間の帯の中に収まる', out[1].top + out[1].h <= box.WK_BODY_H + 0.001, true);
  /* ★22時のコマが17時の位置から描かれないこと（帯をまとめて等分すると起きる） */
  eq('夜間のコマは20:00より下から始まる', out[0].top >= box.wkY_(1200) - 0.001, true);
  eq('狭い枠は文字を落とす印が付く', out.every(p => typeof p.tight === 'boolean'), true);
}
{
  /* 早朝に3件（元様式の帯は30mm＝比例配置なら1.5mm級まで潰れる条件） */
  const out = box.wkLayoutDay_([
    ev({ startTime: '04:00', endTime: '04:20', detail: '排泄ケア' }),
    ev({ startTime: '04:30', endTime: '04:50', detail: '排泄ケア' }),
    ev({ startTime: '05:00', endTime: '05:20', detail: '排泄ケア' }),
  ]);
  eq('3件とも置かれる', out.length, 3);
  eq('最小でも実寸5mm以上（早朝帯17.2mmに3件）', Math.min.apply(null, out.map(p => p.h)) >= 5, true);
  let bad = false;
  for (let i = 0; i + 1 < out.length; i++) if (out[i].top + out[i].h > out[i + 1].top + 0.001) bad = true;
  eq('重ならない', bad, false);
  eq('早朝の帯からはみ出さない', out[2].top + out[2].h <= box.wkY_(480) + 0.001, true);
  eq('狭いので文字を落とす', out.every(p => p.tight === true), true);
}
{
  /* 日中は従来どおり（比例配置＝様式の見た目を変えない） */
  const out = box.wkLayoutDay_([
    ev({ startTime: '10:00', endTime: '11:00' }),
    ev({ startTime: '13:00', endTime: '14:00' }),
  ]);
  near('日中の位置は実時間どおり（等分しない）', out[0].top, box.wkY_(600));
  near('2件目も実時間どおり', out[1].top, box.wkY_(780));
}
{
  /* 帯に1件だけなら従来どおり（下限まで広げる） */
  const out = box.wkLayoutDay_([ev({ startTime: '21:00', endTime: '21:20' })]);
  eq('1件なら等分しない（下限まで広げる）', out[0].h >= 12, true);
}
{
  /* 並び順が時刻順でない入力でも、置く順は時刻順になる */
  const out = box.wkLayoutDay_([
    ev({ id: 'late', startTime: '13:00', endTime: '14:00' }),
    ev({ id: 'early', startTime: '09:00', endTime: '10:00' }),
  ]);
  eq('時刻順に並べ替えて置く', out.map(p => p.ev.id), ['early', 'late']);
  eq('上に来るのは早い方', out[0].top < out[1].top, true);
}

/* ═══ 5-3. 紙面のHTML（曜日・狭い枠の印）═══ */
group('曜日の割り当てと狭い枠の印');
{
  /* ★コマが「別の曜日」に出ないこと（レビューの指摘＝ここが試験で止まっていなかった） */
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 3, startTime: '10:00', endTime: '11:00', detail: '木の予定' }) ] });
  const cols = html.split('<div class="wk-day-col"');
  eq('列は7つに割れている', cols.length - 1, 7);
  eq('木曜（4列目）にだけ入る', cols.findIndex(c => c.indexOf('木の予定') >= 0), 4);
}
{
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 0, startTime: '10:00', endTime: '11:00' }),
    ev({ dayOfWeek: 0, startTime: '10:30', endTime: '11:30' }) ] });
  eq('左右に割れた枠には narrow が付く', (html.match(/wk-ev narrow/g) || []).length, 2);
}
{
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 0, startTime: '04:00', endTime: '04:20' }),
    ev({ dayOfWeek: 0, startTime: '05:00', endTime: '05:20' }),
    ev({ dayOfWeek: 0, startTime: '06:00', endTime: '06:20' }) ] });
  eq('等分した狭い枠には tight が付く', (html.match(/tight/g) || []).length >= 3, true);
}
{
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 0, startTime: '10:00', endTime: '11:00',
         detail: '掃除・洗濯・排泄ケア・シーツ交換・デイ準備・整容・軟膏・食事・薬確認' }) ] });
  eq('長い支援内容は文字を落とす', html.indexOf('wk-ev-body xlong') >= 0, true);
}
{
  /* ★文字の大きさの段階（本人指示：短い文言は大きく・長い文言は今の大きさのまま）。
     曜日の列は約50mm＝5mmの字なら10文字で一杯になるため、8文字超で1段落とす。 */
  const mk = (d) => box.buildWeeklySheetHtml_({ name: '架空', events: [
    ev({ dayOfWeek: 0, startTime: '10:00', endTime: '11:00', detail: d }) ] });
  eq('8文字までは大きいまま', /wk-ev-body"/.test(mk('掃除・洗濯')), true);
  eq('9文字以上は1段落とす', /wk-ev-body long"/.test(mk('掃除・洗濯・デイ準備')), true);
  eq('15文字以上はもう1段落とす', /wk-ev-body xlong"/.test(mk('掃除・洗濯・デイ準備・シーツ交換')), true);
}

/* ═══ 5-3b. 見出しの段（表題・印刷日）═══ */
group('見出し（表題と印刷日）');
{
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [] });
  eq('氏名は左に様つきで出す', /class="wk-title">架空 花子様</.test(html), true);
  eq('中央に表題を出す', /class="wk-sheet-title">１週間のスケジュール</.test(html), true);
  /* ★印刷日＝紙を作った日。年月日で右上に出す（本人指示 2026-09-02）。 */
  const m = /class="wk-printed">印刷日：(\d{4})年(\d{1,2})月(\d{1,2})日</.exec(html);
  eq('右上に印刷日を出す', !!m, true);
  if (m) {
    const now = new Date();
    eq('印刷日は当日', [Number(m[1]), Number(m[2]), Number(m[3])],
       [now.getFullYear(), now.getMonth() + 1, now.getDate()]);
  }
  eq('並びは 氏名→表題→印刷日',
     html.indexOf('wk-title') < html.indexOf('wk-sheet-title')
     && html.indexOf('wk-sheet-title') < html.indexOf('wk-printed'), true);
  /* 左右の幅を同じにして表題が中央に来るようにしている（違う幅だと中央がずれる） */
  eq('左右の欄は同じ幅', (SRC.match(/flex: 0 0 30%/g) || []).length, 2);
  eq('表題は折り返さない', /\.wk-sheet-title \{[^}]*white-space: nowrap/.test(SRC), true);
}

/* ═══ 5-4. 元様式の見た目（本人指示 2026-09-02）═══ */
group('時刻の列とイラストの置き方');
{
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 0, startTime: '13:00', endTime: '14:00', detail: '掃除・洗濯' }) ] });
  /* ★時刻は7:00から出す（7時台の訪問が8:00の手前に収まるように） */
  eq('7:00 の目盛を出す', /class="wk-time"[^>]*>7:00</.test(html), true);
  eq('17:00 まで出す', /class="wk-time"[^>]*>17:00</.test(html), true);
  eq('18:00・19:00 は出さない（元様式どおり）',
     /class="wk-time"[^>]*>1[89]:00</.test(html), false);
  eq('20:00 は出す', /class="wk-time"[^>]*>20:00</.test(html), true);
  /* ★時刻の列には時刻に被る濃い罫線を引かない（薄い線だけ） */
  const timeCol = html.slice(html.indexOf('wk-time-col'), html.indexOf('wk-day-col'));
  eq('時刻列に濃い罫線を引かない', /class="wk-line"/.test(timeCol), false);
  eq('時刻列にも薄い罫線はある', /class="wk-line q"/.test(timeCol), true);
  const dayCol = html.slice(html.indexOf('wk-day-col'));
  eq('曜日の列には濃い罫線を引く', /class="wk-line"/.test(dayCol), true);
}
{
  /* ★掃除・洗濯のイラストは枠の【直下】に置く（枠の中ではない） */
  const keep = box.WK_SHEET_ICONS;
  box.WK_SHEET_ICONS = { '掃除': 'data:image/png;base64,AAA', '洗濯': 'data:image/png;base64,BBB' };
  const html = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 0, startTime: '13:00', endTime: '14:00', detail: '掃除・洗濯' }) ] });
  eq('枠の直下の入れ物がある', /class="wk-ev-under"/.test(html), true);
  eq('イラスト2枚が直下に入る',
     (html.slice(html.indexOf('wk-ev-under')).match(/<img /g) || []).length, 2);
  const evBox = html.slice(html.indexOf('class="wk-ev'), html.indexOf('wk-ev-under'));
  eq('枠の中にはイラストを入れない', /<img /.test(evBox), false);
  /* ★イラストは大きく出す（本人指示 2026-09-02）。1時間のコマの下に3行ぶん（25.8mm）確保する。 */
  {
    const m = /class="wk-ev-under" style="top:[\d.]+mm;height:([\d.]+)mm/.exec(html);
    eq('直下のイラスト欄がある', !!m, true);
    eq('イラスト欄は3行ぶん（25.8mm）', m ? Math.round(parseFloat(m[1]) * 10) / 10 : 0, Math.round(box.WK_ROW * 3 * 10) / 10);
  }
  /* 入浴の印だけは枠の中（黄色の中央） */
  box.WK_SHEET_ICONS = {};
  const day = box.buildWeeklySheetHtml_({ name: '架空 花子', events: [
    ev({ dayOfWeek: 0, serviceType: 'daycare', category: '', bathing: true }) ] });
  eq('入浴の印は枠の中に置く', day.indexOf('wk-onsen') > day.indexOf('wk-ev-body'), true);
  box.WK_SHEET_ICONS = keep;
}

/* ═══ 6. 既存の印刷に触っていないこと（静的照合）═══ */
group('既存の印刷経路は無変更');
eq('週ボードA4印刷はそのまま', /function printWeek\(\) \{ clearRlPrintState_\(\); window\.print\(\); \}/.test(SRC), true);
eq('一覧A3印刷は rl-print のまま', /document\.body\.classList\.add\('rl-print'\)/.test(SRC), true);
eq('新しい印刷は別のクラスを使う', /document\.body\.classList\.add\('wk-print'\)/.test(SRC), true);
eq('新しい紙面は afterprint で必ず後始末する',
   /wk-print[\s\S]{0,1200}addEventListener\('afterprint', done\)/.test(SRC), true);
eq('afterprint が来ない環境の保険がある', /setTimeout\(done, \d+\)/.test(SRC), true);
eq('印刷後に氏名を画面のDOMへ残さない', /if \(b\) b\.innerHTML = '';/.test(SRC), true);

/* ═══ 7. 印刷状態の後始末（レビュー高1・高2・中3）═══ */
group('印刷状態が残らない');
{
  const CLEAN = grabFn('clearRlPrintState_');
  eq('共通クリーナが wk-print も落とす', /classList\.remove\('wk-print'\)/.test(CLEAN), true);
  eq('共通クリーナが注入した @page も落とす', /#wk-a3-page/.test(CLEAN), true);
  eq('共通クリーナは全件消す（多重クリック対策）', /querySelectorAll\('#wk-a3-page'\)/.test(CLEAN), true);
  eq('共通クリーナが紙面の氏名も消す', /wkBox\.innerHTML = ''/.test(CLEAN), true);
  /* ★既存の入口はすべて共通クリーナを通る＝A3週間予定表の残骸を必ず落としてから印刷する */
  eq('週ボード印刷は共通クリーナを通る', /function printWeek\(\) \{ clearRlPrintState_\(\);/.test(SRC), true);
  eq('一覧A3印刷も共通クリーナを通る',
     /function printResidentList\(\) \{\s*\n\s*clearRlPrintState_\(\);/.test(SRC), true);
}
{
  const P = grabFn('printWeeklySheet');
  /* ★保険のタイマーは print() より前（print が例外を投げる環境で後始末に到達しなくなるため） */
  /* コメント本文にも window.print() の字が出るため、実際の呼び出し（try 節）と比べる */
  eq('保険のタイマーは印刷の前に張る',
     P.indexOf('setTimeout(done') < P.indexOf('try { window.print(); }'), true);
  eq('印刷が例外でも後始末する', /catch \(e\) \{\s*\n\s*done\(\);/.test(P), true);
  eq('試算中は印刷しない', /if \(SIM_ON\)/.test(P), true);
  eq('利用者が未選択なら印刷しない', /利用者が選択されていません/.test(P), true);
  eq('A3横を指定する', /size:A3 landscape/.test(P), true);
  /* ★共通クリーナは #wk-sheet の中身も空にするので、紙面を組む【前】に呼ばないと白紙が出る
     （実測で白紙になった経路。順序を入れ替えるとここで落ちる） */
  eq('残骸を落としてから紙面を組む',
     P.indexOf('clearRlPrintState_();') < P.indexOf('box.innerHTML = buildWeeklySheetHtml_'), true);
}
eq('週ボードの下ごしらえは A3週間予定表では走らせない',
   /beforeprint[\s\S]{0,400}classList\.contains\('wk-print'\)\) return;/.test(SRC), true);
/* CSS 側（紙面だけを出す・画面には出さない・枠からはみ出させない） */
eq('印刷中は紙面以外を隠す', /body\.wk-print > \*:not\(#wk-sheet\) \{ display: none !important; \}/.test(SRC), true);
eq('画面では紙面を出さない', /#wk-sheet \{ display: none; \}/.test(SRC), true);
eq('色を落とさずに刷る', /print-color-adjust: exact/.test(SRC), true);
eq('枠からはみ出させない', /\.wk-ev \{[^}]*overflow: hidden/.test(SRC), true);

process.stdout.write(ng ? ('\n✗ 合格 ' + ok + ' / 不合格 ' + ng + '\n') : ('\n✓ 合格 ' + ok + ' / 不合格 0\n'));
process.exit(ng ? 1 : 0);
