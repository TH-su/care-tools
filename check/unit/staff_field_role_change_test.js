/* staff_field_role_change_test.js — 職員マスタ：開いている間に用途が「現場用」に変わったら読み込み直す（2026-10-17 改善プロンプト第2弾の7・代表者の決定 B）
 * 守ること:
 *   1. 用途（su_device_role）が field に変わった知らせ（storage・戻るで復元した pageshow）で、保存していない編集が無ければ読み込み直す
 *   2. 保存していない編集がある時は、止める画面（deviceBlock）だけ出して読み込み直さない（編集を黙って捨てない）
 *   3. 用途以外のキー・事務所PCのまま・もう止めている時は何もしない
 *   4. 起動の止め（init の最初の applyDeviceGuard）は今までどおり
 * 実物の画面のソースから関数を切り出して動かす（写経しない）。STFM_HTML で差し替えるのは、わざと壊した版で落ちるかの確認用。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(process.env.STFM_HTML || path.join(__dirname, '..', '..', 'staff-master.html'), 'utf8');
let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + '  → ' + JSON.stringify(info)); }
}
function cutF(src, name) {
  const h = src.indexOf('function ' + name + '(');
  if (h < 0) throw new Error('関数が見つかりません: ' + name);
  let i = src.indexOf('{', h), d = 0;
  for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) return src.slice(h, i + 1); } }
  throw new Error('閉じていません: ' + name);
}

function box(opt) {
  const o = opt || {};
  const store = { su_device_role: o.role || 'field' };
  const cls = new Set(o.blocked ? ['on'] : []);
  const listeners = {};
  let reloads = 0;
  const b = {
    DEVICE_KEY: 'su_device_role',
    localStorage: { getItem: k => (k in store ? store[k] : null) },
    $: id => (id === 'deviceBlock' ? { classList: { contains: c => cls.has(c), toggle: (c, on) => { if (on) cls.add(c); else cls.delete(c); } } } : null),
    hasUnsaved: () => !!o.dirty,
    location: { reload: () => { reloads++; } },
    window: { addEventListener: (ev, fn) => { listeners[ev] = fn; } }
  };
  vm.createContext(b);
  vm.runInContext([cutF(SRC, 'applyDeviceGuard'), cutF(SRC, 'onDeviceRoleChange_')].join('\n'), b);
  /* 結線（storage・pageshow）は実物の2行をそのまま動かす */
  const wire = SRC.match(/window\.addEventListener\('storage', function \(e\) \{ try \{ onDeviceRoleChange_\(e\);[^\n]*\n[^\n]*pageshow[^\n]*/);
  if (wire) vm.runInContext(wire[0], b);
  return { b, cls, listeners, reloads: () => reloads, wired: !!wire };
}

console.log('\n— 1. 現場用に変わったら読み込み直す —');
{
  const x = box({});
  t('storage と pageshow を受ける', x.wired && typeof x.listeners.storage === 'function' && typeof x.listeners.pageshow === 'function');
  x.listeners.storage({ key: 'su_device_role' });
  t('編集が無ければ止める画面を出して読み込み直す', x.reloads() === 1 && x.cls.has('on'), [x.reloads(), [...x.cls]]);
}
{
  const x = box({});
  x.listeners.storage({ key: null });
  t('全部消された知らせ（key が null）でも判定する', x.reloads() === 1);
}
{
  const x = box({});
  x.listeners.pageshow({ persisted: true });
  t('「戻る」で復元された時も判定する', x.reloads() === 1);
  const y = box({});
  y.listeners.pageshow({ persisted: false });
  t('ふつうの読み込みの pageshow では何もしない（起動の止めに任せる）', y.reloads() === 0);
}

console.log('\n— 2. 保存していない編集がある時 —');
{
  const x = box({ dirty: true });
  x.listeners.storage({ key: 'su_device_role' });
  t('止める画面だけ出し、読み込み直さない（編集を黙って捨てない）', x.reloads() === 0 && x.cls.has('on'), [x.reloads(), [...x.cls]]);
}

console.log('\n— 3. 何もしない場面 —');
{
  const x = box({});
  x.listeners.storage({ key: 'stfm_ui_tab' });
  t('用途以外のキーでは何もしない', x.reloads() === 0 && !x.cls.has('on'));
  const y = box({ role: 'office' });
  y.listeners.storage({ key: 'su_device_role' });
  t('事務所PCのままなら何もしない', y.reloads() === 0 && !y.cls.has('on'));
  const z = box({ blocked: true });
  z.listeners.storage({ key: 'su_device_role' });
  t('もう止めている時は読み込み直さない（繰り返さない）', z.reloads() === 0);
}

console.log('\n— 4. 起動の止め —');
t('init の最初で applyDeviceGuard を見て止める（今までどおり）', /function init\(\) \{\n\s*if \(applyDeviceGuard\(\)\) return;/.test(SRC));

console.log('\n合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗');
process.exit(fail ? 1 : 0);
