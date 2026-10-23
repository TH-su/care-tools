/* 入居者マスタ：詳細画面の「薬剤情報」の欄の上の「📷 薬情・お薬シールの写真を入れる」帯（2026-10-23 代表者の決定）
   実行: node check/unit/master_yakujo_photo_test.js（環境変数 MASTER_HTML で別の版を当てられる）
   守ること:
     1. 出すのは、管理者が事務所の Mac の Chrome で開いている時だけ（iPad・Windows・現場端末・フォルダへ書けないブラウザでは出さない）
     2. 入れてよいのは薬情よみとりと同じ形式（HEIC・HEIF・JPEG・PNG・PDF）と大きさ（10MB まで）。道具の決まりと数が一致する
     3. 前からあるファイルを上書きしない（同じ名前なら「名前 (2).拡張子」）。書けなかった時は、この帯が作った空のファイルだけを消す。
        空きを確かめた後にほかの経路が同じ名前を置いた時は、作った直後に大きさで気づいて次の名前へ進む・消す前にも空かを確かめる
     4. 選べるフォルダは名前が「入れる」のものだけ。許可はボタンを押した時だけ求める（ドラッグでは求めない）
     5. 端末に覚えるのはフォルダの印だけ（localStorage・console に出さない）。印刷に出さない・空の時は場所を取らない
     6. 入れた後の知らせの文言（代表者が決めた文）
   実物のソースから関数を切り出して vm で動かす（写経しない）。ファイル名はすべて架空。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const RM = fs.readFileSync(process.env.MASTER_HTML || path.join(ROOT, 'resident-master.html'), 'utf8');
const SWIFT = fs.readFileSync(path.join(ROOT, 'yakujo-reader', 'yakujo-reader.swift'), 'utf8');
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
}
const line = (src, re) => { const m = re.exec(src); if (!m) throw new Error('行が見つかりません: ' + re); return m[0]; };

/* 帯の部品（宣言と関数）を切り出す */
const FNS = ['yjpIsMac_', 'yjpCan_', 'yjpExt_', 'yjpKind_', 'yjpSafeName_', 'yjpNameAt_', 'yjpMsgOf_', 'yjpDb_', 'yjpLoad_', 'yjpSave_',
  'yjpRefresh_', 'yjpSlot_', 'yjpPaint_', 'yjpPickDir_', 'yjpAskPerm_', 'yjpFree_', 'yjpMake_', 'yjpDropEmpty_', 'yjpPut_', 'yjpPurge_', 'yjpWire_'];
const VARS = line(RM, /var YJP_EXT=[^\n]*\n/) + line(RM, /var YJP_ACCEPT=[^\n]*\n/) + line(RM, /var yjpDir=[^\n]*\n/);
const SRC = VARS + FNS.map((f) => cutF(RM, f)).join('\n');
const flush = () => new Promise((r) => setTimeout(r, 0)).then(() => new Promise((r) => setTimeout(r, 0)));

/* 偽のフォルダ（中身は名前→{data, dir}）。fail で書き込みの失敗を起こす。
   race: 空きを確かめた後・作る前に、ほかの経路がその名前へ中身を置く（1回だけ）。
   fillOnFail: 書き込みに失敗した後・消す前に、ほかの経路がその名前へ中身を書く */
function fakeDir(opt) {
  opt = opt || {};
  const files = Object.assign({}, opt.files || {});
  const log = [];
  const d = {
    kind: 'directory', name: opt.name || '入れる', files, log,
    queryPermission() { return Promise.resolve(opt.perm || 'granted'); },
    requestPermission() { log.push('ask'); return opt.askThrows ? Promise.reject(new Error('x')) : Promise.resolve(opt.askPerm || 'granted'); },
    getFileHandle(nm, o) {
      if (opt.gone) { const e = new Error('gone'); e.name = 'NotFoundError'; return Promise.reject(e); }
      const ex = Object.prototype.hasOwnProperty.call(files, nm);
      if (ex && files[nm].dir) { const e = new Error('dir'); e.name = 'TypeMismatchError'; return Promise.reject(e); }
      if (!ex && !(o && o.create)) { const e = new Error('nf'); e.name = 'NotFoundError'; return Promise.reject(e); }
      if (!ex && o && o.create && opt.race && opt.race === nm) { opt.race = null; files[nm] = { data: 'ほかの経路の写真' }; log.push('race:' + nm); }
      else if (!ex) { files[nm] = { data: '' }; log.push('create:' + nm); }
      return Promise.resolve({
        getFile() { return Promise.resolve({ size: String((files[nm] && files[nm].data) || '').length }); },
        createWritable() {
          let buf = null;
          return Promise.resolve({
            write(f) {
              if (opt.fail && opt.fail(nm)) {
                if (opt.fillOnFail) files[nm].data = 'ほかの経路が書いた';
                const e = new Error('w'); e.name = opt.failName || 'InvalidStateError'; return Promise.reject(e);
              }
              buf = f.body; return Promise.resolve();
            },
            close() { files[nm].data = buf; log.push('write:' + nm); return Promise.resolve(); },
            abort() { log.push('abort:' + nm); return Promise.resolve(); }
          });
        }
      });
    },
    removeEntry(nm) { log.push('remove:' + nm); delete files[nm]; return Promise.resolve(); }
  };
  return d;
}
function mkFile(name, size, body) { return { name, size, body: body || ('架空の中身:' + name) }; }

function env(opt) {
  opt = opt || {};
  const bar = { innerHTML: '', firstChild: null, classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } } };
  const saved = [];
  const ctx = {
    console: { log() { throw new Error('console を使った'); }, error() { throw new Error('console を使った'); } },
    setTimeout, Promise, String, Number, Array, Object, Error, RegExp,
    yjBy: opt.admin === false ? '' : 'admin@example.invalid',
    getDeviceRole: () => opt.role || 'office',
    esc: (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
    $: (id) => (id === 'yjpBar' ? bar : null),
    document: { addEventListener() {} },
    window: {
      navigator: opt.nav || { platform: 'MacIntel', maxTouchPoints: 0 },
      showDirectoryPicker: opt.noPicker ? undefined : (opt.picker || (() => Promise.resolve(fakeDir()))),
      indexedDB: opt.noIdb ? undefined : {}
    }
  };
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  /* 覚える所（IndexedDB）は偽物に差し替える */
  ctx.yjpLoad_ = () => Promise.resolve(opt.stored === undefined ? null : opt.stored);
  ctx.yjpSave_ = (h) => { saved.push(h); return opt.saveFails ? Promise.reject(new Error('s')) : Promise.resolve(true); };
  return { ctx, bar, saved, run: (code) => vm.runInContext(code, ctx) };
}

(async () => {
  console.log('— 1. 出す相手（管理者・事務所の Mac の Chrome だけ） —');
  {
    const e = env();
    const isMac = (n) => e.ctx.yjpIsMac_(n);
    t('Mac の Chrome（MacIntel・指0）は Mac', isMac({ platform: 'MacIntel', maxTouchPoints: 0 }) === true);
    t('新しい名乗り（userAgentData macOS）も Mac', isMac({ userAgentData: { platform: 'macOS' }, platform: '' }) === true);
    t('★iPad（Mac と名乗るが指で触れる）は外す', isMac({ platform: 'MacIntel', maxTouchPoints: 5 }) === false);
    t('Windows・iPhone・空は外す', !isMac({ platform: 'Win32' }) && !isMac({ platform: 'iPhone', maxTouchPoints: 5 }) && !isMac({}) && !isMac(null));
    t('管理者・Mac・Chrome・事務所なら出す', e.ctx.yjpCan_() === true);
    t('★管理者でない時は出さない', env({ admin: false }).ctx.yjpCan_() === false);
    t('★現場端末では出さない', env({ role: 'field' }).ctx.yjpCan_() === false);
    t('★Windows では出さない', env({ nav: { platform: 'Win32', maxTouchPoints: 0 } }).ctx.yjpCan_() === false);
    t('★フォルダへ書けないブラウザ（Safari など）では出さない', env({ noPicker: true }).ctx.yjpCan_() === false);
    t('覚える所（IndexedDB）が無いブラウザでは出さない', env({ noIdb: true }).ctx.yjpCan_() === false);
    const n = env({ admin: false }); n.ctx.yjpLoaded = true; n.bar.innerHTML = 'x'; n.ctx.yjpPaint_();
    t('出さない時は帯を空にする（:empty で場所を取らない）', n.bar.innerHTML === '');
  }

  console.log('\n— 2. 入れてよいもの（薬情よみとりの決まりと同じ） —');
  {
    const e = env(); const k = (n, s) => e.ctx.yjpKind_(n, s);
    t('HEIC・HEIF・JPG・JPEG・PNG・PDF（大文字も）は入れる', ['a.HEIC', 'a.heif', 'a.jpg', 'a.JPEG', 'a.png', 'a.pdf'].every((n) => k(n, 1000) === 'ok'));
    t('写真か PDF でないもの（GIF・文字・拡張子なし）は入れない', k('a.gif', 9) === 'type' && k('a.txt', 9) === 'type' && k('noext', 9) === 'type');
    t('10MB ちょうどは入れる・1バイトでも超えたら入れない', k('a.jpg', 10 * 1024 * 1024) === 'ok' && k('a.jpg', 10 * 1024 * 1024 + 1) === 'size');
    t('中身が無いもの（0バイト・大きさ不明）は入れない', k('a.jpg', 0) === 'empty' && k('a.jpg', undefined) === 'empty');
    const swExt = line(SWIFT, /let IMAGE_EXT: Set<String> = \[[^\]]*\]/).match(/"([a-z]+)"/g).map((x) => x.replace(/"/g, '')).concat(['pdf']).sort();
    const rmExt = e.ctx.YJP_EXT.slice().sort();
    t('★形式の一覧が薬情よみとり（IMAGE_EXT＋pdf）と同じ', JSON.stringify(swExt) === JSON.stringify(rmExt), [swExt, rmExt]);
    const swMax = eval(line(SWIFT, /let MAX_BYTES = [0-9 *]+/).replace('let MAX_BYTES =', ''));
    t('★大きさの上限が薬情よみとり（MAX_BYTES）と同じ', swMax === e.ctx.YJP_MAX, [swMax, e.ctx.YJP_MAX]);
  }

  console.log('\n— 3. 名前（上書きしない・道具が読める名前にする） —');
  {
    const e = env(); const s = (n) => e.ctx.yjpSafeName_(n), at = (n, i) => e.ctx.yjpNameAt_(n, i);
    t('先頭の「.」は外す（道具は隠しファイルを読まない）', s('.架空の写真.heic') === '架空の写真.heic' && s('...a.jpg') === 'a.jpg');
    t('「/」「\\」「:」と制御文字は「_」に', s('a/b.jpg') === 'a_b.jpg' && s('a\\b:c.png') === 'a_b_c.png' && s('a\u0001b.pdf') === 'a_b.pdf');
    t('前後の空白を外す・無い名前は空', s('  x.pdf ') === 'x.pdf' && s(null) === '' && s('') === '');
    t('1番目は元の名前・2番目から「名前 (2).拡張子」', at('IMG_1.HEIC', 1) === 'IMG_1.HEIC' && at('IMG_1.HEIC', 2) === 'IMG_1 (2).HEIC');
    t('点が2つある名前・拡張子の無い名前', at('a.b.jpg', 3) === 'a.b (3).jpg' && at('noext', 2) === 'noext (2)');
    const d = fakeDir({ files: { 'IMG_1.HEIC': { data: '前' }, 'IMG_1 (2).HEIC': { data: '前2' }, 'X.jpg': { dir: true } } });
    t('★同じ名前のファイルが2つあれば3番目の名前', (await e.ctx.yjpFree_(d, 'IMG_1.HEIC')) === 'IMG_1 (3).HEIC');
    t('同じ名前のフォルダがあっても使わない', (await e.ctx.yjpFree_(d, 'X.jpg')) === 'X (2).jpg');
    t('空いていればそのまま', (await e.ctx.yjpFree_(d, '新しい.png')) === '新しい.png');
    const many = {}; for (let i = 1; i <= 99; i++) many[e.ctx.yjpNameAt_('a.jpg', i)] = { data: '前' };
    let threw = false; try { await e.ctx.yjpFree_(fakeDir({ files: many }), 'a.jpg'); } catch (er) { threw = true; }
    t('同じ名前が99個あれば、それ以上は探さずに失敗にする（上書きしない）', threw === true);
  }

  console.log('\n— 4. 書き込み —');
  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir({ files: { 'IMG_1.HEIC': { data: '前からある' } } });
    e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('IMG_1.HEIC', 2000, '新'), mkFile('.シール.jpg', 1000), mkFile('a.gif', 10), mkFile('big.pdf', 11 * 1024 * 1024), mkFile('zero.png', 0)]);
    t('書いている間はボタンを止める（二重に入れない）', e.ctx.yjpBusy === true && /disabled/.test(e.bar.innerHTML));
    await flush(); await flush();
    t('★前からあるファイルは書き換えない', d.files['IMG_1.HEIC'].data === '前からある');
    t('★同じ名前は「名前 (2).拡張子」で入れる', d.files['IMG_1 (2).HEIC'] && d.files['IMG_1 (2).HEIC'].data === '新');
    t('先頭の「.」を外して入れる', !!d.files['シール.jpg'] && !d.files['.シール.jpg']);
    t('形式違い・10MB 超え・0バイトは入れない', !d.files['a.gif'] && !d.files['big.pdf'] && !d.files['zero.png']);
    t('★入れた後の知らせ（代表者が決めた文）',
      e.ctx.yjpMsg === '2件を「入れる」に入れました。Mac の「薬情よみとり」→「読む」をダブルクリックしてください。 入れなかったもの: 写真か PDF ではない 1件・10MB を超える 1件・中身が無い 1件。', e.ctx.yjpMsg);
    t('終わったらボタンを戻す', e.ctx.yjpBusy === false && !/disabled/.test(e.bar.innerHTML));
    t('入れたものが無い時の知らせ', e.ctx.yjpMsgOf_(0, { type: 1 }) === '入れたものはありません。 入れなかったもの: 写真か PDF ではない 1件。');
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir({ files: { '前.jpg': { data: '前' } }, fail: (nm) => nm === '壊れ.jpg' });
    e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('壊れ.jpg', 100), mkFile('次.jpg', 100)]);
    await flush(); await flush();
    t('★書けなかった時は、この帯が作った空のファイルだけを消す', !d.files['壊れ.jpg'] && d.log.includes('remove:壊れ.jpg') && d.files['前.jpg'].data === '前');
    t('1件書けなくても次は入れる（許可の問題でない時）', d.files['次.jpg'] && /書き込めなかった 1件/.test(e.ctx.yjpMsg));
    t('前からあるファイルは消さない', !d.log.some((x) => x === 'remove:前.jpg'));
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir({ fail: () => true, failName: 'NotAllowedError' });
    e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('a.jpg', 100), mkFile('b.jpg', 100)]);
    await flush(); await flush();
    t('★許可が切れたら残りは書かず、「許可する」に戻す', e.ctx.yjpPerm === 'prompt' && !d.log.includes('create:b.jpg') && /許可が切れました/.test(e.ctx.yjpMsg));
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    e.ctx.yjpDir = fakeDir({ gone: true }); e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('a.jpg', 100)]);
    await flush(); await flush();
    t('フォルダが無くなっていたら選び直しへ戻す', e.ctx.yjpDir === null && /選び直してください/.test(e.ctx.yjpMsg));
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir(); e.ctx.yjpDir = d; e.ctx.yjpPerm = 'prompt';
    e.ctx.yjpPut_([mkFile('a.jpg', 100)]);
    await flush();
    t('★許可が無い時は書かない（ドラッグでは許可を求めない）', !d.log.length && /先に/.test(e.ctx.yjpMsg));
    const e2 = env(); e2.ctx.yjpLoaded = true; e2.ctx.yjpDir = null;
    e2.ctx.yjpPut_([mkFile('a.jpg', 100)]);
    t('フォルダを選ぶ前は書かない', /先に「入れる」フォルダを選んで/.test(e2.ctx.yjpMsg));
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir(); e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('a.jpg', 100), mkFile('b.jpg', 100), mkFile('c.jpg', 100)]);
    e.ctx.yjpPurge_();   /* 現場用へ切り替わった */
    await flush(); await flush();
    t('★途中で現場用へ切り替わったら、残りは書かない', Object.keys(d.files).length <= 1 && e.bar.innerHTML === '', Object.keys(d.files));
  }
  {
    const e = env({ admin: false }); const d = fakeDir(); e.ctx.yjpLoaded = true; e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('a.jpg', 100)]); await flush();
    t('管理者でない時は書かない', !d.log.length);
  }

  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir({ race: '架空.jpg' }); e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('架空.jpg', 100, '帯の写真')]); await flush(); await flush();
    t('★空きを確かめた後にほかの経路が同じ名前を置いても、その写真は書き換えない', d.files['架空.jpg'].data === 'ほかの経路の写真', d.files);
    t('★その時は次の名前（架空 (2).jpg）で入れる', d.files['架空 (2).jpg'] && d.files['架空 (2).jpg'].data === '帯の写真' && /1件を「入れる」に入れました/.test(e.ctx.yjpMsg), [d.files, e.ctx.yjpMsg]);
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    const d = fakeDir({ fail: (nm) => nm === '架空.jpg', fillOnFail: true }); e.ctx.yjpDir = d; e.ctx.yjpPerm = 'granted';
    e.ctx.yjpPut_([mkFile('架空.jpg', 100)]); await flush(); await flush();
    t('★書けなかった後にほかの経路が中身を書いていたら、消さない（空の時だけ消す）', d.files['架空.jpg'] && d.files['架空.jpg'].data === 'ほかの経路が書いた' && !d.log.includes('remove:架空.jpg'), d.log);
  }
  {
    const e = env(); e.ctx.yjpLoaded = true; e.ctx.yjpDir = fakeDir(); e.ctx.yjpPerm = 'granted';
    e.ctx.yjpBusy = true; e.ctx.yjpPut_([mkFile('a.jpg', 100)], true);
    t('書いている途中に落とした時は「入れている途中です」と知らせる（黙って捨てない）', /入れている途中です/.test(e.ctx.yjpMsg), e.ctx.yjpMsg);
    e.ctx.yjpBusy = false; e.ctx.yjpMsg = ''; e.ctx.yjpPut_([], true);
    t('落としたのに写真を受け取れなかった時は知らせる', /写真を受け取れませんでした/.test(e.ctx.yjpMsg), e.ctx.yjpMsg);
    e.ctx.yjpMsg = ''; e.ctx.yjpPut_([], false);
    t('選ぶ窓を何も選ばずに閉じた時は何も言わない', e.ctx.yjpMsg === '');
  }
  {
    const e = env(); e.ctx.yjpLoaded = true;
    e.ctx.yjpSlot_({ id: 1 }); e.ctx.yjpMsg = '2件を「入れる」に入れました。';
    e.ctx.yjpSlot_({ id: 1 });
    t('同じ方の詳細を描き直しても知らせは残る', /2件/.test(e.ctx.yjpMsg));
    e.ctx.yjpSlot_({ id: 2 });
    t('★別の方の詳細へ移ったら知らせを消す（別の方の写真と取り違えない）', e.ctx.yjpMsg === '');
    e.ctx.yjpMsg = '入れています…（3件）'; e.ctx.yjpBusy = true; e.ctx.yjpSlot_({ id: 3 });
    t('書いている間は、別の方へ移っても知らせを残す', /入れています/.test(e.ctx.yjpMsg));
  }

  console.log('\n— 5. フォルダを選ぶ・許可を求める —');
  {
    const e = env({ picker: () => Promise.resolve(fakeDir({ name: 'ダウンロード' })) }); e.ctx.yjpLoaded = true;
    e.ctx.yjpPickDir_(); await flush();
    t('★名前が「入れる」でないフォルダは受け取らない', e.ctx.yjpDir === null && e.saved.length === 0 && /「入れる」ではありません/.test(e.ctx.yjpMsg));
    t('選んだフォルダの名前は画面に出さない', !/ダウンロード/.test(e.ctx.yjpMsg) && !/ダウンロード/.test(e.bar.innerHTML));
    const ok = fakeDir();
    const e2 = env({ picker: () => Promise.resolve(ok) }); e2.ctx.yjpLoaded = true;
    e2.ctx.yjpPickDir_(); await flush();
    t('「入れる」なら受け取り、端末に印を覚える', e2.ctx.yjpDir === ok && e2.saved[0] === ok && e2.ctx.yjpPerm === 'granted');
    t('受け取ったら「写真を選ぶ」とドラッグの案内を出す', /写真を選ぶ/.test(e2.bar.innerHTML) && /ここに写真をドラッグしても入れられます/.test(e2.bar.innerHTML) && /📷 薬情・お薬シールの写真を入れる/.test(e2.bar.innerHTML));
    const ab = env({ picker: () => { const er = new Error('a'); er.name = 'AbortError'; return Promise.reject(er); } }); ab.ctx.yjpLoaded = true;
    ab.ctx.yjpPickDir_(); await flush();
    t('選ぶ窓を閉じただけなら何も言わない', ab.ctx.yjpMsg === '');
    const sf = env({ picker: () => Promise.resolve(fakeDir()), saveFails: true }); sf.ctx.yjpLoaded = true; sf.ctx.yjpPickDir_(); await flush(); await flush();
    t('覚えられなかった時は知らせる（今回は使える）', sf.ctx.yjpDir && /覚えられませんでした/.test(sf.ctx.yjpMsg));
  }
  {
    const d = fakeDir({ perm: 'prompt', askPerm: 'granted' });
    const e = env({ stored: d }); e.ctx.yjpRefresh_(); await flush();
    t('覚えたフォルダの許可が無い時は「許可する」を出す（勝手に求めない）', /書き込みを許可する/.test(e.bar.innerHTML) && !d.log.includes('ask'));
    e.ctx.yjpAskPerm_(); await flush();
    t('押したら許可を求め、許可されたら「写真を選ぶ」に', d.log.includes('ask') && e.ctx.yjpPerm === 'granted' && /写真を選ぶ/.test(e.bar.innerHTML));
    const e0 = env({ stored: null }); e0.ctx.yjpRefresh_(); await flush();
    t('覚えたフォルダが無い時は「「入れる」フォルダを選ぶ（初回だけ）」を出す', /「入れる」フォルダを選ぶ（初回だけ）/.test(e0.bar.innerHTML));
    const dg = fakeDir({ perm: 'granted' });
    const eg = env({ stored: dg }); eg.ctx.yjpRefresh_(); await flush();
    t('前に「毎回許可」した時は、すぐ「写真を選ぶ」', /写真を選ぶ/.test(eg.bar.innerHTML));
    const bad = env({ stored: { kind: 'file' } }); bad.ctx.yjpRefresh_(); await flush();
    t('覚えた印が壊れていたら選び直しにする', bad.ctx.yjpDir === null && /初回だけ/.test(bad.bar.innerHTML));
  }

  console.log('\n— 6. 置き場所・印刷・端末に覚えるもの —');
  {
    const rv = cutF(RM, 'renderView');
    t('★帯の場所は「薬剤情報」の欄のすぐ上', /h\+=yjpSlot_\(r\);[^\n]*\n\s*h\+='<div class="sec"><div class="sec-lbl">薬剤情報<\/div>/.test(rv));
    t('★印刷では消す', /@media print\{ \.yjp-bar\{display:none !important\} \}/.test(RM));
    t('空の時は場所を取らない', /\.yjp-bar:empty\{display:none\}/.test(RM));
    const gate = cutF(RM, 'yjGate_');
    t('管理者と分かった後にだけ帯を出す（yjGate_ の確かめの後）', /yjBy=String\(st\.email\|\|''\); b\.hidden=false;\s*\n\s*yjpRefresh_\(\);/.test(gate));
    t('確かめ直す間は帯を消す', /yjBy=''; yjpPaint_\(\);/.test(gate));
    t('★管理者でない・ログインしていないと分かったら、帯の状態を捨てる（書いている途中の残りも書かない）',
      /typeof Promise==='undefined'\)\{ yjpPurge_\(\); return; \}/.test(gate) && /st\.role==='admin'\)\)\{ yjpPurge_\(\); return; \}/.test(gate));
    const bu = line(RM, /window\.addEventListener\('beforeunload',function\(e\)\{[\s\S]*?\n\}\);/);
    t('★書いている間は、再読み込み・タブを閉じる前に確かめる', /if\(typeof yjpBusy!=='undefined' && yjpBusy\) yjBusy=true;/.test(bu));
    const wire = cutF(RM, 'yjpWire_');
    t('★帯が出ている間は、帯の外へ落としてもページを写真の表示へ切り替えない（受け取りはしない）',
      /if\(!b\)\{ var sb=shown\(\); if\(sb\)\{ e\.preventDefault\(\);/.test(wire) && /if\(!b\)\{ if\(shown\(\)\)\{ e\.preventDefault\(\);/.test(wire));
    t('ファイルの入力欄へのドロップは、ふだんどおりブラウザに任せる', /if\(!hasFiles\(e\)\|\|toInput\(e\)\) return;/.test(wire));
    t('現場用へ切り替わったら帯も消す', /yjpPurge_\(\);/.test(cutF(RM, 'yjPurge_')));
    t('起動時に配線する', /\n  yjpWire_\(\);/.test(RM));
    t('★端末に覚えない（localStorage・sessionStorage を使わない）・console に出さない', !/localStorage|sessionStorage|console\./.test(SRC));
    t('文字を画面へ出す時はエスケープする（知らせ）', /esc\(yjpMsg\)/.test(cutF(RM, 'yjpPaint_')));
  }

  console.log('\n────────────────\n合計 ' + (pass + fail) + '件: 成功 ' + pass + '・失敗 ' + fail);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.log('例外: ' + (e && e.stack || e)); process.exit(1); });
