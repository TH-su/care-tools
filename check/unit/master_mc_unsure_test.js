/* 入居者マスタ画面（resident-master.html）の薬の変更候補で、「反映できたか確かめ中」の印を
   読み直しの後も残す（mcKeepUnsure_）ことの試験（2026-10-07）。
   以前は mcLoad_ の完了で印を全部消していたため、結果が分からなかった候補が数秒で「未判断」に見え、
   開く・反映するの止め（mcPick_・mcCanApply_）も外れていた（審査の指摘）。
   実行: node check/unit/master_mc_unsure_test.js（MASTER_HTML で別の resident-master.html を当てられる） */
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const HTML = process.env.MASTER_HTML || path.join(__dirname, '..', '..', 'resident-master.html');
const src = fs.readFileSync(HTML, 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }
function cut(name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('not found: ' + name);
  let d = 0, i = src.indexOf('{', h);
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('unbalanced: ' + name);
}
const sb = {}; vm.createContext(sb); vm.runInContext(cut('mcKeepUnsure_'), sb);
const K = s => JSON.stringify(Object.keys(s).sort());

console.log('\n— 1. 印を残す・外す —');
const prev = { 'S|1|2026-10-05|aaaaaaaa': 1, 'S|2|2026-10-05|bbbbbbbb': 1, 'S|3|2026-10-05|cccccccc': 1, 'S|4|2026-10-05|dddddddd': 1 };
const dec = {
  'S|1|2026-10-05|aaaaaaaa': { status: '反映' },
  'S|2|2026-10-05|bbbbbbbb': { status: '見送り' },
  'S|3|2026-10-05|cccccccc': { status: '保留' }
};
const out = sb.mcKeepUnsure_(prev, dec);
t('★サーバーで「反映」と確定した候補の印は外す（一覧から消える）', !out['S|1|2026-10-05|aaaaaaaa']);
t('★「見送り」と確定した候補の印も外す', !out['S|2|2026-10-05|bbbbbbbb']);
t('★「保留」の候補には印を残す（結果が分からないまま未判断に見せない）', out['S|3|2026-10-05|cccccccc'] === 1);
t('★判断の記録が無い候補には印を残す（書けなかった・書けたか分からない）', out['S|4|2026-10-05|dddddddd'] === 1);
t('残るのは2件だけ', K(out) === K({ 'S|3|2026-10-05|cccccccc': 1, 'S|4|2026-10-05|dddddddd': 1 }), out);
t('前の印が無ければ空', K(sb.mcKeepUnsure_(null, dec)) === '[]' && K(sb.mcKeepUnsure_(undefined, {})) === '[]');
t('判断の一覧が無くても印は残す', K(sb.mcKeepUnsure_({ a: 1 }, null)) === '["a"]');
t('0 の印は捨てる', K(sb.mcKeepUnsure_({ a: 0, b: 1 }, {})) === '["b"]');

console.log('\n— 2. 読み直しで使われている —');
t('★mcLoad_ は印を全部消さず、mcKeepUnsure_ で引き継ぐ', /mcSt\.unsure=mcKeepUnsure_\(mcSt\.unsure,dec\);/.test(cut('mcLoad_')) && !/mcSt\.unsure=\{\};/.test(cut('mcLoad_')));
t('結果が分からない時は、読み直しの前に印を付ける（mcRecheck_）', /mcSt\.unsure\[cur\.c\.srcKey\]=1;[\s\S]*mcLoad_\(\)/.test(cut('mcRecheck_')));
t('印の付いた候補は、確かめたと答えない限り開けない（mcPick_）', /mcSt\.unsure\[key\]\)\{\s*if\(!confirm\(/.test(cut('mcPick_')));

console.log('\n— 3. 印の付いた候補を押した時（2026-10-07 再審査の指摘）—');
function pickEnv(answer) {
  const asked = [], env = {
    mcCur: null, mcBulk: { busy: false, sel: { x: 1 } }, mcFilterId: '',
    mcSt: { unsure: { K1: 1 } }, painted: 0, opened: null,
    confirm: m => { asked.push(m); return answer(m); },
    mcPaint_: () => { env.painted++; }, mcPaintModal_: () => {}, mcFetchRec_: (c) => { env.opened = c.c.srcKey; },
    mcAll_: () => [{ srcKey: 'K1', id: '1' }], Object
  };
  vm.createContext(env); vm.runInContext(cut('mcPick_'), env);
  return { env, asked };
}
{
  const a = pickEnv(() => false);
  a.env.mcPick_('K1');
  t('★「キャンセル」なら開かず、印も残す', a.env.opened === null && a.env.mcSt.unsure.K1 === 1);
  t('★確かめたかを最初に聞く（まとめて片付けるの取りやめより前）', a.asked.length === 1 && /反映できたか分からない/.test(a.asked[0]), a.asked);
  t('★キャンセルの時は、まとめて片付けるの選択を壊さない（動かない画面を残さない）', a.env.mcBulk !== null);
  const b = pickEnv(() => true);
  b.env.mcPick_('K1');
  t('「OK」なら印を外して開く', b.env.opened === 'K1' && !b.env.mcSt.unsure.K1 && b.env.painted >= 1, { opened: b.env.opened, u: b.env.mcSt.unsure });
  t('その後にまとめて片付けるの取りやめを聞く', b.asked.length === 2 && /まとめて片付ける/.test(b.asked[1]), b.asked);
  const c = pickEnv(() => true); c.env.mcSt.unsure = {}; c.env.mcBulk = null;
  c.env.mcPick_('K1');
  t('印の無い候補は確かめを聞かずに開く', c.env.opened === 'K1' && c.asked.length === 0, c.asked);
}
t('印の付いた候補は反映できない（mcCanApply_）', /mcSt\.unsure\[mcCur\.c\.srcKey\]/.test(cut('mcCanApply_')));

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
