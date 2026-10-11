/* 貼り薬カレンダー（patch-calendar.html）の「設定した職員と時刻」の試験（2026-10-11 新設・監査10月版 第2版 貼り薬カレンダー 第1手）
   実行: node check/unit/patch_setby_test.js
   対象を差し替える: PATCH_HTML=/tmp/変異版.html node check/unit/patch_setby_test.js（変異試験用）

   守ること:
     ①保存した時に、入居者ごとの設定（apc2_res）にも手入力の設定（apc2_setby）にも by・at を残す
     ②by はログイン中なら職員名、していなければ端末の用途（現場の端末／事務所PC）。入居者の氏名は入れない
     ③紙の見出しの行に出すのは、記録がそろい、設定が確定している時だけ（無い時は hidden＝今の紙のまま）
     ④保存された by・at の形が違えば出さない・名前は textContent で出す（タグとして解釈させない）
     ⑤入居者を選び直した時・起動時に、その設定の by・at を読み直す（別の方の記録を持ち越さない）
   ★このファイルは公開リポジトリの check/unit にある。氏名は使わない。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(process.env.PATCH_HTML || path.join(ROOT, 'patch-calendar.html'), 'utf8');

let pass = 0, fail = 0;
function t(name, ok, info) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name + (info !== undefined ? '  → ' + JSON.stringify(info) : '')); }
}
function scanBlock(src, from) {
  let depth = 0, seen = false, q = null;
  for (let i = from; i < src.length; i++) {
    const c = src[i], n = src[i + 1], p = src[i - 1];
    if (q) { if (c === q && p !== '\\') q = null; continue; }
    if (c === '/' && n === '/') { const e = src.indexOf('\n', i); if (e < 0) return -1; i = e; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); if (e < 0) return -1; i = e + 1; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; continue; }
    if (c === '{') { depth++; seen = true; }
    else if (c === '}') { depth--; if (seen && depth === 0) return i; }
  }
  return -1;
}
function grabFn(name) {
  const start = SRC.indexOf('\nfunction ' + name + '(');
  if (start < 0) throw new Error('関数が見つかりません: ' + name);
  return SRC.slice(start, scanBlock(SRC, start) + 1);
}
function body(name) { return grabFn(name); }

console.log('\n— 名前と時刻の決め方（関数を実際に動かす）—');
function sandbox(store) {
  const sb = {
    localStorage: { getItem: k => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null), length: Object.keys(store).length, key: i => Object.keys(store)[i] },
    PC_SESSION_RE: /^sb-[a-z0-9]+-auth-token$/, pcWhoAcct: '', Date
  };
  vm.createContext(sb);
  vm.runInContext(['pcDeviceLabel', 'pcWho', 'pcWhoLabel', 'pcSetByOf', 'pcFmtAt', 'pcHasLogin'].map(grabFn).join('\n'), sb);
  return sb;
}
{
  const a = sandbox({});
  t('ログインなし・用途の設定なし → 事務所PC', a.pcWho() === '事務所PC');
  const b = sandbox({ su_device_role: 'field' });
  t('ログインなし・現場の端末 → 現場の端末', b.pcWho() === '現場の端末');
  b.pcWhoAcct = '職員甲（staff01）';
  vm.runInContext('pcWhoAcct = "職員甲（staff01）"', b);
  t('ログイン中は職員名を優先', b.pcWho() === '職員甲（staff01）');
  t('ログインの表示名とアカウント', a.pcWhoLabel({ status: 'ok', email: 'staff01@example.com', label: '職員甲' }) === '職員甲（staff01）');
  t('表示名が無ければアカウントだけ', a.pcWhoLabel({ status: 'ok', email: 'staff01@example.com', label: '' }) === 'staff01');
  t('ログインできていない状態は名前にしない', a.pcWhoLabel({ status: 'none', email: 'staff01@example.com' }) === '');
  t('ログインの控え（sb-…-auth-token）があれば「ログインあり」', sandbox({ 'sb-abc-auth-token': '{}' }).pcHasLogin() === true && a.pcHasLogin() === false);
  t('保存された記録: 形が正しければ返す', JSON.stringify(a.pcSetByOf({ by: ' 職員甲 ', at: '2026-10-05T09:00:00+09:00' })) === JSON.stringify({ by: '職員甲', at: '2026-10-05T09:00:00+09:00' }));
  t('保存された記録: 時刻が壊れていれば出さない', a.pcSetByOf({ by: '職員甲', at: 'x' }).by === '');
  t('保存された記録: 名前が無ければ出さない', a.pcSetByOf({ by: '', at: '2026-10-05T09:00:00Z' }).by === '' && a.pcSetByOf(null).by === '');
  t('名前は60文字までに切る', a.pcSetByOf({ by: 'あ'.repeat(80), at: '2026-10-05T09:00:00Z' }).by.length === 60);
  t('時刻の書き方 YYYY/M/D HH:MM', /^\d{4}\/\d{1,2}\/\d{1,2} \d{2}:\d{2}$/.test(a.pcFmtAt('2026-10-05T09:00:00+09:00')));
}

console.log('\n— 保存・読み出し・表示のつなぎ —');
{
  const save = body('saveSettings');
  t('入居者ごとの設定に by・at を残す', /all\[state\.rid\] = \{ start: state\.start\.iso, no: state\.no, prev: state\.prev, by: by, at: at \}/.test(save));
  t('手入力の設定も apc2_setby に by・at を残す', /localStorage\.setItem\(LS_SETBY, JSON\.stringify\(\{ by: by2, at: at2 \}\)\)/.test(save));
  t('by は pcWho()（入居者の氏名ではない）', (save.match(/pcWho\(\)/g) || []).length === 2 && save.indexOf('el.nm') < 0);
  t('保存できた時だけ表示中の記録を更新する（失敗時は前のまま）',
    /setItem\(LS_BYRES[^;]*;\s*state\.setBy = by; state\.setAt = at;/.test(save) && /state\.setBy = by2; state\.setAt = at2;\s*\} catch/.test(save));
  t('入居者ごとの読み出しで by・at を返す', /by: sb\.by, at: sb\.at/.test(body('resSetting')));
  t('手入力の読み出しで by・at を返す', /by: sb\.by, at: sb\.at/.test(body('legacySetting')));
  t('入居者を選び直したら、その方の記録に入れ替える（無ければ空）', /state\.setBy = set \? set\.by : ''; state\.setAt = set \? set\.at : '';/.test(body('selectResident')));
  t('起動時（手入力）は確定している時だけ記録を読む', /if \(state\.confirmed\) \{ try \{ sb0 = pcSetByOf/.test(body('loadState')));
  const hdr = body('renderHeaderInfo');
  t('紙には、確定済み・記録がそろう時だけ出す', /var byTx = \(state\.confirmed && state\.setBy && state\.setAt\)/.test(hdr));
  t('名前は textContent で出す', /el\.pby\.textContent = byTx;/.test(hdr) && !/pby\.innerHTML/.test(SRC));
  t('無い時は hidden（紙の見出しの行は今のまま）', /el\.pby\.hidden = !byTx;/.test(hdr));
  t('紙の欄は既定で hidden', /<span class="by" id="p-by" hidden><\/span>/.test(SRC));
  t('起動時に職員名を取り直し、ログインの切り替えにも追従', /pcResolveWho\(\);\nwindow\.addEventListener\('storage'[^\n]*pcResolveWho\(\)/.test(SRC) && /visibilitychange[^\n]*pcResolveWho\(\)/.test(SRC));
  t('遅れて返った古い結果は捨てる（世代番号）', /if \(gen !== pcWhoGen\) return;/.test(body('pcResolveWho')));
}

console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
