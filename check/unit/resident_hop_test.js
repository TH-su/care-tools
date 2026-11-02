/* 「この方の画面：」の行き来のボタン（su-resident-hop.js）の試験（代表者の決定 2026-11-02 案A）
   実行: node check/unit/resident_hop_test.js
   守ること:
     1 今の画面は出さない・決まった順に並ぶ・同じタブで移る（target を付けない）
     2 行き先へ渡すのは番号だけ。氏名を URL に載せるのは家族構成図だけ（既存の受け口）。現場の端末では家族構成図も出さない
     3 現場の端末では事務所向けの画面（入居者マスタ・週間計画・計画書・担当者会議）を出さない
     4 番号の形が正しくない時は何も出さない。外からの値はエスケープする
     5 帯に入れた画面は、部品とその CSS を読み込み、帯の文言は「この方の画面：」
     6 印刷に出さない
   画面のコードは書き換えず、部品を読み込んで確かめる。架空の番号・氏名だけを使う。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(path.join(ROOT, 'su-resident-hop.js'), 'utf8');
const CSS = fs.readFileSync(path.join(ROOT, 'su-resident-hop.css'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function load(role) {
  const store = { su_device_role: role };
  const win = { localStorage: { getItem: (k) => (k in store ? store[k] : null) } };
  win.window = win;
  vm.runInNewContext(SRC, win);
  return win.SUResHop;
}
const office = load('office'), field = load('field');

console.log('1 並び・今の画面・同じタブ');
const o = office.targets('facesheet.html', '12', '見本 一郎', false).map((x) => x.href.split('?')[0]);
t('1a 今の画面（フェイスシート）は出さない', o.indexOf('facesheet.html') < 0, o);
t('1b 決まった順に並ぶ', JSON.stringify(o) === JSON.stringify(['resident-master.html', 'genogram.html', 'care-schedule.html', 'weight-record.html', 'moushiokuri-viewer.html', '../haiben-record/haiben-record.html', 'training-plan.html', 'care-meeting.html']), o);
const h = office.html('weight-record.html', '12', '見本 一郎');
t('1c 同じタブで移る（target を付けない）', h && !/target=/.test(h), h);
t('1d 帯の文言は「この方の画面：」', h.indexOf('この方の画面：') >= 0, '');

console.log('2 URL に載せるもの');
const all = office.targets('weight-record.html', '12', '見本 一郎', false);
for (const x of all) {
  if (/^genogram\.html/.test(x.href)) t('2a 家族構成図だけ ?resident=&name=', x.href === 'genogram.html?resident=12&name=' + encodeURIComponent('見本 一郎'), x.href);
  else t('2b ' + x.href.split('?')[0] + ' は番号だけ', !/name=/.test(x.href) && /=12$/.test(x.href), x.href);
}
t('2c 入居者マスタは ?id=、担当者会議は ?resident=', all.some((x) => x.href === 'resident-master.html?id=12') && all.some((x) => x.href === 'care-meeting.html?resident=12'), '');
t('2d 氏名が無い時は家族構成図を出さない', !office.targets('facesheet.html', '12', '', false).some((x) => /^genogram/.test(x.href)), '');

console.log('3 現場の端末');
const f = field.targets('facesheet.html', '12', '見本 一郎', true).map((x) => x.href.split('?')[0]);
for (const off of ['resident-master.html', 'care-schedule.html', 'moushiokuri-viewer.html', 'training-plan.html', 'care-meeting.html']) t('3a 現場では ' + off + ' を出さない', f.indexOf(off) < 0, f);
t('3b 現場では家族構成図（氏名を URL に載せる）を出さない', f.indexOf('genogram.html') < 0, f);
t('3c 現場でも出す画面（体重管理・排便ケア記録）は出る', ['weight-record.html', '../haiben-record/haiben-record.html'].every((x) => f.indexOf(x) >= 0), f);
const fh = field.html('facesheet.html', '12', '見本 一郎');
t('3d html() は端末の用途を読んで現場の決まりを当てる', fh && !/resident-master|care-schedule|moushiokuri|training-plan|care-meeting|genogram/.test(fh), fh);

console.log('4 正しくない番号・危ない値');
for (const bad of ['', null, undefined, '1 2', '<b>', 'x'.repeat(40), '../1']) t('4a 番号 ' + JSON.stringify(bad) + ' では何も出さない', office.html('facesheet.html', bad, '見本') === '', bad);
const evil = office.html('facesheet.html', '12', '"><img src=x onerror=alert(1)>');
t('4b 氏名に危ない文字があっても属性の外に出ない', !/<img/i.test(evil) && !/"><img/.test(evil), evil);

console.log('5 帯に入れた画面');
for (const pg of ['facesheet.html', 'weight-record.html', 'genogram.html', 'care-schedule.html', 'training-plan.html', 'care-meeting.html', 'moushiokuri-viewer.html']) {
  const s = fs.readFileSync(path.join(ROOT, pg), 'utf8');
  t('5a ' + pg + ': 部品と CSS を読み込む', /<script src="su-resident-hop\.js\?v=[0-9.-]+"><\/script>/.test(s) && /<link rel="stylesheet" href="su-resident-hop\.css\?v=[0-9.-]+">/.test(s), '');
  t('5b ' + pg + ': 自分の画面の名前で呼ぶ', s.indexOf("SUResHop.html('" + pg + "'") >= 0 || s.indexOf("SUResHop.node('" + pg + "'") >= 0, '');
  if (['facesheet.html', 'weight-record.html', 'genogram.html'].indexOf(pg) >= 0) t('5c ' + pg + ': 帯は「〇〇さんを開いています」', /さんを開いています/.test(s), '');
  else if (pg === 'training-plan.html') t('5c 計画書: 画面を切り替えるたびに「この方の画面：」を出し直す（計画書の画面の時だけ）', /function showScreen\(id, opts\) \{[\s\S]{0,400}tpHopSync\(id\);/.test(s) && /if \(id !== 'scr-edit' \|\| !curMasterId/.test(s), '');
  else if (pg === 'care-meeting.html') t('5c 担当者会議: 「開いている方」の欄に並べる', /function whoHtml_\(c\)\{[\s\S]{0,900}SUResHop\.html\('care-meeting\.html',c\.id,c\.name\)/.test(s), '');
  else if (pg === 'moushiokuri-viewer.html') t('5c 申送ビューア: 本人確認バー（申し送り・バイタル）の両方に並べる', (s.match(/if\(typeof appendResHop === 'function'\) appendResHop\(who, (m|rosterByNorm\(VMSEL\))\);/g) || []).length === 2, '');
  else t('5c 週間計画: 集計の段に「この方の画面 ▾」のボタンを置く（盤面の位置を変えない）', /id="cs-hop-btn"[^>]*hidden[^>]*>🔗 この方の画面 ▾<\/button>/.test(s), '');
}

console.log('6 印刷');
t('6 帯のボタンは印刷で消す', /@media print\s*\{\s*\.srh\s*\{\s*display:\s*none\s*!important;\s*\}\s*\}/.test(CSS), '');
t('6b 押す所は 44px 以上', /\.srh-a\s*\{[^}]*min-height:\s*44px/.test(CSS), '');

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
