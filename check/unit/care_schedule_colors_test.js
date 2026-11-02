/* 週間計画「A3週間予定表」の色を施設情報から読む試験（2026-11-02 新設）
   実行: node check/unit/care_schedule_colors_test.js
        （CS_HTML で対象ファイルを差し替えられる＝直す前の版・条件を抜いた版を試す時に使う）

   何を守るか:
     1. 施設情報に scheduleColors が無い時（読めない・例外も）は、今の既定の色（WK_SHEET_COLORS）とまったく同じ
     2. 正しい鍵（#RRGGBB の6桁・time と body の両方）がある種類だけ、その色に差し替える
     3. 崩れた値（3桁・色の名前・数・配列・片方だけ・知らない種類）は捨てて、その種類は既定の色のまま
     4. 紙面（buildWeeklySheetHtml_）が実際にこの色を使う。既定（WK_SHEET_COLORS）は書き換えない
   ★公開リポジトリの試験。色の値・氏名は全て架空（見本）にすること。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.CS_HTML || path.join(ROOT, 'care-schedule.html'), 'utf8');

/* ── 切り出し（care_namecut_test.js と同じ方式）── */
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
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  const end = scanBlock(SRC, start, '{', '}');
  if (end < 0) throw new Error('関数の終わりが見つかりません: ' + name);
  return SRC.slice(start, end + 1);
}
function grabDecl(name) {
  const m = new RegExp('^(?:var|const|let)\\s+' + name + '\\s*=\\s*', 'm').exec(SRC);
  if (!m) throw new Error('宣言が見つかりません: ' + name);
  const vpos = m.index + m[0].length;
  const open = SRC[vpos];
  if (open === '{' || open === '[') {
    const end = scanBlock(SRC, vpos, open, open === '{' ? '}' : ']');
    let j = end + 1;
    while (j < SRC.length && SRC[j] !== ';') j++;
    return SRC.slice(m.index, j + 1).replace(/^(?:const|let)\s/, 'var ');
  }
  const eol = SRC.indexOf('\n', vpos);
  return SRC.slice(m.index, eol < 0 ? SRC.length : eol).replace(/^(?:const|let)\s/, 'var ');
}

let ok = 0, ng = 0;
function eq(label, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { ok++; }
  else { ng++; process.stdout.write('  ✗ ' + label + '\n    期待: ' + w + '\n    実際: ' + g + '\n'); }
}
function group(name) { process.stdout.write('\n■ ' + name + '\n'); }

/* 紙面を組む関数一式（care_a3_sheet_test.js と同じ並び＋今の色の関数） */
const box = { JSON, Math, Number, String, Array, Object, console, isFinite, parseInt };
vm.createContext(box);
vm.runInContext([
  "var DAYS_JA = ['月','火','水','木','金','土','日'];",
  'var SOGO_VISIT_CODES = { A21121: { label: "【A11】" } };',
  'function escHtml(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\\"/g,"&quot;");}',
  grabFn('timeToMins'), grabFn('catDisplayLabel_'),
  grabDecl('WK_ROW'), grabDecl('WK_AXIS'), grabDecl('WK_MIN_H'), grabDecl('WK_MIN_H_VISIT'), grabDecl('WK_BODY_H'),
  grabDecl('WK_SHEET_COLORS'), grabFn('wkSheetColors_'), grabDecl('WK_SHEET_ICONS'), grabDecl('WK_ZONES'),
  grabFn('wkY_'), grabFn('wkIsBandSlot_'), grabFn('wkBandLabel_'), grabFn('wkKindOf_'), grabFn('wkTimeText_'), grabFn('wkMainText_'),
  grabFn('wkIconsFor_'), grabFn('wkLayoutDay_'), grabFn('buildWeeklySheetHtml_'),
].join('\n'), box);

/* 今の既定（この施設の本人指定の確定値）。ここが変わったら落とす */
const DEF = {
  daycare: { time: '#FFFF00', body: '#FFFF00' },
  shop:    { time: '#92D050', body: '#92D050' },
  rise:    { time: '#55FF00', body: '#55FF00' },
  visit:   { time: '#00FFFF', body: '#00FFFF' },
};
/* 施設情報の見本を置く。sec が関数なら section() の中で呼ぶ（例外の場面に使う） */
function setProfile(sec) {
  if (sec === undefined) { delete box.window; delete box.SUFacility; return; }
  const f = { section: function (n) { if (typeof sec === 'function') return sec(n); return n === 'scheduleColors' ? JSON.parse(JSON.stringify(sec)) : null; } };
  box.window = { SUFacility: f };
  box.SUFacility = f;
}
function colorsWith(sec) { setProfile(sec); const r = JSON.parse(JSON.stringify(box.wkSheetColors_())); setProfile(undefined); return r; }
/* 写しを通さずにそのまま渡す（部品が変わって写しでない値が届いた時の守りを確かめる） */
function colorsRaw(sec) { return colorsWith(function (n) { return n === 'scheduleColors' ? sec : null; }); }
const arrWith = (props) => Object.assign([], props);
const with1 = (k, v) => { const o = JSON.parse(JSON.stringify(DEF)); o[k] = v; return o; };

/* ═══ 1. 鍵なし → 今と同じ ═══ */
group('鍵なし（今と同じ色）');
eq('既定の宣言そのものが本人指定の値', JSON.parse(JSON.stringify(box.WK_SHEET_COLORS)), DEF);
eq('window が無い', colorsWith(undefined), DEF);
eq('section が null', colorsWith(null), DEF);
eq('section が例外を出す', colorsWith(function () { throw new Error('見本の失敗'); }), DEF);
box.SUFacility = {}; box.window = { SUFacility: box.SUFacility };
eq('section の口が無い古い部品', JSON.parse(JSON.stringify(box.wkSheetColors_())), DEF);
setProfile(undefined);
eq('空の塊', colorsWith({}), DEF);
{
  const r = box.wkSheetColors_();
  eq('既定の写しを返す（同じ物を渡さない）', r !== box.WK_SHEET_COLORS && r.visit !== box.WK_SHEET_COLORS.visit, true);
  r.visit.body = '#000000';
  eq('返した値を書き換えても既定は変わらない', box.WK_SHEET_COLORS.visit.body, '#00FFFF');
}

/* ═══ 2. 正しい鍵 → その値 ═══ */
group('正しい鍵（その色に差し替える）');
{
  const all = {
    daycare: { time: '#101010', body: '#202020' },
    shop:    { time: '#303030', body: '#404040' },
    rise:    { time: '#505050', body: '#606060' },
    visit:   { time: '#707070', body: '#808080' },
  };
  eq('4種類とも差し替え', colorsWith(all), all);
  eq('1種類だけ書けば他は既定', colorsWith({ shop: { time: '#123456', body: '#654321' } }), with1('shop', { time: '#123456', body: '#654321' }));
  eq('小文字の16進も受け付ける', colorsWith({ rise: { time: '#abcdef', body: '#0a0b0c' } }), with1('rise', { time: '#abcdef', body: '#0a0b0c' }));
  eq('崩れた種類があっても正しい種類は使う',
     colorsWith({ daycare: { time: '#FFF', body: '#FFF' }, visit: { time: '#112233', body: '#445566' } }),
     with1('visit', { time: '#112233', body: '#445566' }));
  eq('time と body 以外の余計な項目は持ち込まない',
     colorsWith({ visit: { time: '#112233', body: '#445566', border: '#000000' } }), with1('visit', { time: '#112233', body: '#445566' }));
  eq('差し替えた後も既定の宣言は変わらない', JSON.parse(JSON.stringify(box.WK_SHEET_COLORS)), DEF);
}

/* ═══ 3. 崩れた値 → 既定 ═══ */
group('崩れた値（既定のまま）');
eq('3桁の #FFF', colorsWith({ daycare: { time: '#FFF', body: '#FFF' } }), DEF);
eq('色の名前', colorsWith({ daycare: { time: 'red', body: 'red' } }), DEF);
eq('# の無い6桁', colorsWith({ daycare: { time: 'FFFF00', body: 'FFFF00' } }), DEF);
eq('8桁（透明度つき）', colorsWith({ daycare: { time: '#FFFF0080', body: '#FFFF0080' } }), DEF);
eq('16進でない文字', colorsWith({ daycare: { time: '#GGGGGG', body: '#GGGGGG' } }), DEF);
eq('前後の余計な文字', colorsWith({ daycare: { time: ' #112233', body: '#112233;' } }), DEF);
eq('数', colorsWith({ daycare: { time: 0xFFFF00, body: 0xFFFF00 } }), DEF);
eq('種類の値が数', colorsWith({ daycare: 123 }), DEF);
eq('種類の値が文字', colorsWith({ daycare: '#112233' }), DEF);
eq('種類の値が配列', colorsWith({ daycare: ['#112233', '#112233'] }), DEF);
eq('種類の値が null', colorsWith({ daycare: null }), DEF);
eq('塊が配列', colorsWith([{ time: '#112233', body: '#112233' }]), DEF);
eq('塊が文字', colorsWith('#112233'), DEF);
eq('塊が数', colorsWith(5), DEF);
eq('time だけ正しい（body が無い）', colorsWith({ daycare: { time: '#112233' } }), DEF);
eq('body だけ正しい（time が崩れている）', colorsWith({ daycare: { time: 'red', body: '#112233' } }), DEF);
eq('time だけ崩れている（body は正しい）', colorsWith({ daycare: { time: '#112233', body: '#FFF' } }), DEF);
{
  const r = colorsWith({ other: { time: '#112233', body: '#112233' } });
  eq('知らない種類は捨てる', r, DEF);
  eq('知らない種類を増やさない', Object.keys(r).sort(), ['daycare', 'rise', 'shop', 'visit']);
}
eq('継承された値は使わない', colorsRaw(Object.create({ daycare: { time: '#112233', body: '#112233' } })), DEF);
eq('time・body が配列（文字にすると #RRGGBB になる）', colorsWith({ daycare: { time: ['#112233'], body: ['#112233'] } }), DEF);
eq('body だけ配列', colorsWith({ daycare: { time: '#112233', body: ['#112233'] } }), DEF);
eq('time だけ配列', colorsWith({ daycare: { time: ['#112233'], body: '#112233' } }), DEF);
eq('塊が種類の名前を持つ配列', colorsRaw(arrWith({ daycare: { time: '#112233', body: '#112233' } })), DEF);
eq('塊が種類の名前を持つ関数', colorsRaw(Object.assign(function () {}, { daycare: { time: '#112233', body: '#112233' } })), DEF);
eq('種類の値が time・body を持つ配列', colorsRaw({ daycare: arrWith({ time: '#112233', body: '#112233' }) }), DEF);
eq('種類の値が time・body を持つ関数', colorsRaw({ daycare: Object.assign(function () {}, { time: '#112233', body: '#112233' }) }), DEF);

/* ═══ 4. 紙面がこの色を使う ═══ */
group('buildWeeklySheetHtml_ が今の色で組む');
{
  const ev = (o) => Object.assign({ id: 'x', dayOfWeek: 0, serviceType: 'visit', category: '生活３',
    startTime: '10:00', endTime: '11:00', detail: '', bathing: false }, o || {});
  const res = { name: '架空 花子', events: [
    ev({ dayOfWeek: 0, serviceType: 'daycare', startTime: '09:00', endTime: '13:30' }),
    ev({ dayOfWeek: 2, startTime: '10:00', endTime: '11:00', detail: '掃除' }),
  ] };
  const h0 = box.buildWeeklySheetHtml_(res);
  eq('鍵なし: 通所は既定の黄', h0.indexOf('#FFFF00') >= 0, true);
  eq('鍵なし: 訪問は既定の水色', h0.indexOf('#00FFFF') >= 0, true);
  setProfile({ daycare: { time: '#123456', body: '#123457' }, visit: { time: '#ABCDEF', body: '#ABCDE0' } });
  const h1 = box.buildWeeklySheetHtml_(res);
  setProfile(undefined);
  eq('鍵あり: 通所の時刻・内容の色が設定の値', h1.indexOf('#123456') >= 0 && h1.indexOf('#123457') >= 0, true);
  eq('鍵あり: 訪問の時刻・内容の色が設定の値', h1.indexOf('#ABCDEF') >= 0 && h1.indexOf('#ABCDE0') >= 0, true);
  eq('鍵あり: 既定の黄・水色は使わない', h1.indexOf('#FFFF00') < 0 && h1.indexOf('#00FFFF') < 0, true);
  eq('色以外は同じ紙面', h1.replace(/#123456/g, '#FFFF00').replace(/#123457/g, '#FFFF00').replace(/#ABCDEF/g, '#00FFFF').replace(/#ABCDE0/g, '#00FFFF'), h0);
  setProfile({ daycare: { time: 'red', body: 'red' } });
  const h2 = box.buildWeeklySheetHtml_(res);
  setProfile(undefined);
  eq('崩れた鍵: 紙面は鍵なしと1文字も違わない', h2, h0);
  eq('崩れた値を紙面に出さない', /\bred\b/.test(h2), false);
}

process.stdout.write(ng ? ('\n✗ 合格 ' + ok + ' / 不合格 ' + ng + '\n') : ('\n✓ 合格 ' + ok + ' / 不合格 0\n'));
process.exit(ng ? 1 : 0);
