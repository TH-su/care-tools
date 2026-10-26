/* 困った時の問い合わせ先（施設情報の support）の試験（2026-10-26 本人指示）
   守りたいこと:
     A su-facility.js の support(): {contactName, contactTel, hours, emergency, replyTarget} の5つを文字列で返す。
       書いていない・壊れた値は空文字。文字列でない値（数・配列・真偽）を文字にしない
     B 見本（facility-profile.sample.json）の support は架空の値（電話は 000- の形だけ）で、_note に公開で読める旨と
       「公表済みの事業所の番号だけ」を書いている
     C 使い方・困った時（help.html）: 問い合わせ先・受付時間・緊急時の連絡先・不具合報告の返事の目安の4つを出す。
       値が無い項目は「施設の管理者にお問い合わせください」。値は textContent で入る（<img onerror> を入れても要素にならない）。
       tel: のリンクにしない。画面の中のスクリプトの指紋が CSP の meta と合う（help.html は check/csp.mjs の対象外のため）
     D メニュー（index.html）: 「困った時」の区分のタイルの下に、問い合わせ先と受付時間の1行だけを出す（値が無ければ決まりの文言）。
       タイルの数・並びは変えない。現場端末でも出す。値は textContent で入る
   架空データだけを使う。実行: node check/unit/facility_support_test.js */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.join(__dirname, '..', '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

const NONE = '施設の管理者にお問い合わせください';
const KEYS = ['contactName', 'contactTel', 'hours', 'emergency', 'replyTarget'];
const SAMPLE_SRC = read('facility-profile.sample.json');
const SAMPLE = JSON.parse(SAMPLE_SRC);
const XSS = '<img src=x onerror=alert(1)>';

/* 実物の su-facility.js に、端末の控えとして設定を読ませる（fetch は無し＝控えだけ） */
function facility(profile) {
  const box = { window: {}, console, JSON, localStorage: { getItem: k => (k === 'su_facility_json_v1' && profile !== undefined ? JSON.stringify(profile) : null), setItem() {} } };
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('su-facility.js'), box);
  return box.SUFacility;
}
function withSupport(sup) { const p = JSON.parse(SAMPLE_SRC); if (sup === undefined) delete p.support; else p.support = sup; return p; }

/* 組み立てに要る分だけの小さな DOM（作った要素の種類を全部数える＝<img> が作られたら分かる） */
function makeDom() {
  const made = [];
  function makeEl(tag) {
    const e = { tagName: String(tag).toUpperCase(), className: '', attrs: {}, children: [], _text: '', id: '',
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c, ref) { const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
      removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
      get firstChild() { return this.children[0] || null; },
      get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
      set textContent(v) { this._text = String(v); this.children = []; },
      set innerHTML(v) { throw new Error('innerHTML を使った'); },
      querySelector(sel) {
        const [tg, cls] = sel.split('.');
        const walk = n => { for (const c of n.children || []) { if (c.tagName === tg.toUpperCase() && (' ' + c.className + ' ').indexOf(' ' + cls + ' ') >= 0) return c; const r = walk(c); if (r) return r; } return null; };
        return walk(this);
      }
    };
    made.push(e.tagName);
    return e;
  }
  return { made, makeEl };
}
function walkAll(n, f) { for (const c of n.children || []) { f(c); walkAll(c, f); } }

(async () => {
  console.log('\n— A. support() の形 —');
  const F = facility(SAMPLE);
  const s0 = F.support();
  t('5つの項目を文字列で返す', JSON.stringify(Object.keys(s0)) === JSON.stringify(KEYS) && KEYS.every(k => typeof s0[k] === 'string'), s0);
  t('見本の値をそのまま返す', KEYS.every(k => s0[k] === SAMPLE.support[k]), s0);
  const none = facility(withSupport(undefined)).support();
  t('書いていなければ5つとも空文字', KEYS.every(k => none[k] === ''), none);
  const nodata = facility(undefined);
  t('施設情報を読めていない時も5つとも空文字', nodata.ready() === false && KEYS.every(k => nodata.support()[k] === ''), nodata.support());
  const typed = facility(withSupport({ contactName: 123, contactTel: ['000-000-0000'], hours: true, emergency: { a: 1 }, replyTarget: null })).support();
  t('文字列でない値（数・配列・真偽・オブジェクト・null）は文字にせず空文字', KEYS.every(k => typed[k] === ''), typed);
  for (const bad of ['見本', ['x'], 5, null]) {
    const r = facility(withSupport(bad)).support();
    t('support が ' + JSON.stringify(bad) + ' なら書いていない扱い', KEYS.every(k => r[k] === ''), r);
  }
  const part = facility(withSupport({ contactName: '  見本ホーム 事務所  ', hours: '' })).support();
  t('前後の空白を落とし、書いていない項目は空文字', part.contactName === '見本ホーム 事務所' && part.contactTel === '' && part.hours === '', part);
  const long = facility(withSupport({ contactName: 'あ'.repeat(500), emergency: 'い'.repeat(500) })).support();
  t('長すぎる値は切る（問い合わせ先 60 字・緊急時 120 字）', long.contactName.length === 60 && long.emergency.length === 120, [long.contactName.length, long.emergency.length]);
  const cp = F.support(); cp.contactName = '改';
  t('返した値を書き換えても元は変わらない', F.support().contactName === SAMPLE.support.contactName);
  t('冒頭の一覧に support() を書いている', /SUFacility\.support\(\)\s+… /.test(read('su-facility.js')));

  console.log('\n— B. 見本の値 —');
  const S = SAMPLE.support || {};
  t('見本に support があり、4つの項目（問い合わせ先の名前と電話・受付時間・緊急時・返事の目安）が入っている', KEYS.every(k => typeof S[k] === 'string' && S[k]), S);
  t('問い合わせ先の電話は 000- の形', /^000-\d{3}-\d{4}$/.test(S.contactTel || ''), S.contactTel);
  const phones = (SAMPLE_SRC.match(/\d{2,5}-\d{1,4}-\d{3,4}/g) || []);
  t('見本の中の電話らしい番号は全部 000- の形（実在らしい番号が無い）', phones.length > 0 && phones.every(p => /^000-/.test(p)), phones);
  t('見本の support の値に携帯の番号の形（070/080/090）が無い', !/0[789]0-?\d{4}-?\d{4}/.test(JSON.stringify(S)));
  t('施設名は見本（架空）', /見本/.test(S.contactName || '') && /見本/.test(S.emergency || ''));
  t('_note に「公開サイトで誰でも読める」「公表済みの事業所の番号だけ」「個人の携帯・夜間の当番の番号は入れない」を書く',
    /この値は公開サイトの facility-profile\.json として誰でも読める/.test(S._note || '') && /電話は公表済みの事業所の番号だけを入れる/.test(S._note || '') && /個人の携帯・夜間の当番の番号は入れない/.test(S._note || ''), S._note);

  console.log('\n— C. 使い方・困った時（help.html） —');
  const H = read('help.html');
  const C = await import(path.join(ROOT, 'check', 'csp.mjs'));
  const inl = C.inlineScripts(H);
  t('画面の中のスクリプトは問い合わせ先を埋める1本だけ', inl.length === 1 && /HELP_SUPPORT/.test(inl[0]), inl.length);
  const pol = (/http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(H) || [])[1] || '';
  const ss = (pol.split(';').map(x => x.trim()).find(x => x.startsWith('script-src ')) || '');
  t('CSP の script-src は自サイトとそのスクリプトの指紋だけ（中身を変えたら指紋を直す）', ss === "script-src 'self' " + inl.map(C.hashOf).join(' '), ss);
  t('CSP のほかの決まりは前のまま（form-action none・Supabase への通信）', /form-action 'none'/.test(pol) && /connect-src[^;]*https:\/\/jhbernqawjrzqwrmqrih\.supabase\.co/.test(pol), pol);
  const fv = (/<script src="su-facility\.js\?v=([^"]+)"><\/script>/.exec(H) || [])[1];
  const iv = (/<script src="su-facility\.js\?v=([^"]+)"><\/script>/.exec(read('index.html')) || [])[1];
  t('su-facility.js を読み、版の印はメニューと同じ', !!fv && fv === iv, [fv, iv]);
  t('su-facility.js はスクリプトより前に読む', H.indexOf('su-facility.js?v=') < H.indexOf('HELP_SUPPORT'));
  const LABELS = [['contact', '問い合わせ先'], ['hours', '受付時間'], ['emergency', '緊急時の連絡先'], ['replyTarget', '不具合報告の返事の目安']];
  t('4つの項目の見出しと欄があり、はじめは決まりの文言', LABELS.every(([k, l]) => H.indexOf('<dt>' + l + '</dt><dd data-sup="' + k + '">' + NONE + '</dd>') >= 0));
  t('値を入れるのに innerHTML・insertAdjacentHTML・tel: を使わない', !/innerHTML|outerHTML|insertAdjacentHTML/.test(inl[0]) && !/['"`]tel:|href\s*=\s*['"]?tel:/i.test(H));
  t('「入力して保存した内容は、まずこの端末に残り…」の文言のとおり',
    H.indexOf('入力して保存した内容は、まずこの端末に残り、つながった時にサーバーへ送られます。送り終わる前に、ブラウザの履歴やデータを消したり、端末を替えたりしないでください。') >= 0 && H.indexOf('入力して保存した内容は消えません') < 0);
  t('冒頭の書き添えを 2026-10-26 本人指示に書き直した', /2026-10-26 本人指示で、施設情報の support（公表済みの事業所の番号だけ）を出すように改めた/.test(H) && !/電話番号・個人の連絡先は書かない＝本人決定 3a/.test(H));

  function runHelp(fac) {
    const dds = LABELS.map(([k]) => ({ attrs: { 'data-sup': k }, _t: NONE, getAttribute(a) { return this.attrs[a]; },
      get textContent() { return this._t; }, set textContent(v) { this._t = String(v); }, set innerHTML(v) { throw new Error('innerHTML を使った'); } }));
    const made = [];
    const doc = { querySelectorAll: sel => (sel === '[data-sup]' ? dds : []), createElement: tg => { made.push(tg); return {}; } };
    const box = { document: doc, window: {}, String, Array };
    if (fac) box.window.SUFacility = box.SUFacility = fac;
    vm.createContext(box);
    let err = null;
    try { vm.runInContext(inl[0], box); } catch (e) { err = e.message; }
    const out = {}; dds.forEach(d => { out[d.attrs['data-sup']] = d._t; });
    return { out, made, err };
  }
  {
    const r = runHelp(F);
    t('値あり: 4つに見本の値が出る（問い合わせ先は名前と電話を空白でつなぐ）', !r.err && r.out.contact === S.contactName + ' ' + S.contactTel &&
      r.out.hours === S.hours && r.out.emergency === S.emergency && r.out.replyTarget === S.replyTarget, r);
  }
  {
    const r = runHelp(facility(withSupport(undefined)));
    t('値なし: 4つとも「' + NONE + '」', !r.err && LABELS.every(([k]) => r.out[k] === NONE), r);
    const r2 = runHelp(null);
    t('su-facility.js が無い・読めない: 4つとも決まりの文言のまま', !r2.err && LABELS.every(([k]) => r2.out[k] === NONE), r2);
    const r3 = runHelp(facility(withSupport({ contactTel: '000-000-0000', hours: '' })));
    t('一部だけ: 電話だけなら問い合わせ先は電話、空の項目は決まりの文言', !r3.err && r3.out.contact === '000-000-0000' && r3.out.hours === NONE && r3.out.emergency === NONE, r3);
  }
  {
    const r = runHelp(facility(withSupport({ contactName: XSS, contactTel: '', hours: XSS, emergency: XSS, replyTarget: XSS })));
    t('<img onerror> を入れても要素を作らず、文字のまま出る', !r.err && r.made.length === 0 && LABELS.every(([k]) => r.out[k] === XSS), r);
  }

  console.log('\n— D. メニュー（index.html）の「困った時」 —');
  const IX = read('index.html');
  const defEnd = IX.indexOf('</script>', IX.indexOf('id="menuDef"'));
  const sStart = IX.indexOf('<script>', defEnd) + '<script>'.length;
  const BUILD = IX.slice(sStart, IX.indexOf('</script>', sStart));
  const DEF = IX.slice(IX.indexOf('>', IX.indexOf('id="menuDef"')) + 1, defEnd);
  function runMenu(fac) {
    const { made, makeEl } = makeDom();
    const main = makeEl('main');
    made.length = 0;
    const doc = {
      getElementById: id => (id === 'menu' ? main : id === 'menuDef' ? { textContent: DEF } : null),
      createElement: makeEl,
      createTextNode: s => ({ textContent: String(s), children: [] })
    };
    const box = { document: doc, window: {}, JSON, Array, String, Object, Error };
    if (fac) box.window.SUFacility = box.SUFacility = fac;
    vm.createContext(box);
    let err = null;
    try { vm.runInContext(BUILD, box); } catch (e) { err = e.message; }
    const secs = main.children.filter(c => c.tagName === 'SECTION');
    const help = secs.find(c => c.attrs['aria-labelledby'] === 'sec-help');
    const sups = []; walkAll(main, c => { if (c.attrs && 'data-fac-support' in c.attrs) sups.push(c); });
    return { err, made, secs, help, sups };
  }
  const def = JSON.parse(DEF);
  const helpDef = def.sections.find(s => s.id === 'sec-help');
  {
    const r = runMenu(F);
    const kids = r.help ? r.help.children : [];
    t('問い合わせ先の1行は「困った時」の区分にだけ1つ', !r.err && r.sups.length === 1 && kids.indexOf(r.sups[0]) >= 0, [r.err, r.sups.length]);
    t('並びは 見出し → タイル → 1行（タイルの下）', kids.length === 3 && kids[0].tagName === 'H2' && kids[1].className === 'grid' && kids[2] === r.sups[0], kids.map(c => c.tagName + '.' + c.className));
    t('「困った時」のタイルの数・行き先は定義どおり（1枚・help.html）', kids[1] && kids[1].children.length === helpDef.tiles.length && kids[1].children[0].attrs.href === 'help.html');
    t('現場端末でも出す（区分にも1行にも事務所専用の印が無い）', r.help && !('data-office-only' in r.help.attrs) && !('data-office-only' in r.sups[0].attrs));
    t('値あり: 「問い合わせ先：名前 電話（受付時間：…）」の1行', r.sups[0] && r.sups[0].textContent === '問い合わせ先：' + S.contactName + ' ' + S.contactTel + '（受付時間：' + S.hours + '）', r.sups[0] && r.sups[0].textContent);
    t('1行に緊急時の連絡先・返事の目安は出さない', r.sups[0] && r.sups[0].textContent.indexOf(S.replyTarget) < 0 && r.sups[0].textContent.indexOf('緊急') < 0);
    t('ほかの区分の数は定義どおり', r.secs.length === def.sections.length, r.secs.length);
  }
  {
    const r = runMenu(facility(withSupport(undefined)));
    t('値なし: 「' + NONE + '」だけ', !r.err && r.sups.length === 1 && r.sups[0].textContent === NONE, r.sups[0] && r.sups[0].textContent);
    const r2 = runMenu(null);
    t('su-facility.js がまだ無い（組み立ての時点）: 決まりの文言', !r2.err && r2.sups.length === 1 && r2.sups[0].textContent === NONE);
    const r3 = runMenu(facility(withSupport({ contactName: '見本ホーム 事務所', contactTel: '000-000-0000' })));
    t('受付時間が無ければ問い合わせ先だけ', r3.sups[0].textContent === '問い合わせ先：見本ホーム 事務所 000-000-0000', r3.sups[0].textContent);
    const r4 = runMenu(facility(withSupport({ hours: '平日 9:00〜17:00' })));
    t('問い合わせ先が無く受付時間だけなら、問い合わせ先の所は決まりの文言', r4.sups[0].textContent === '問い合わせ先：' + NONE + '（受付時間：平日 9:00〜17:00）', r4.sups[0].textContent);
  }
  {
    const r = runMenu(facility(withSupport({ contactName: XSS, contactTel: '', hours: XSS })));
    t('<img onerror> を入れても要素を作らず、文字のまま出る', !r.err && r.made.indexOf('IMG') < 0 && r.sups[0].textContent === '問い合わせ先：' + XSS + '（受付時間：' + XSS + '）', [r.made.filter(x => x === 'IMG').length, r.sups[0] && r.sups[0].textContent]);
  }
  t('施設情報を読み終えた時と、メニューを組み立て直した時（fill）に1行を埋め直す',
    /var sp = document\.querySelectorAll\('\[data-fac-support\]'\);\n\s+for \(var j = 0; j < sp\.length; j\+\+\) sp\[j\]\.textContent = supportLine\(\);/.test(BUILD) &&
    /document\.addEventListener\('DOMContentLoaded', function \(\) \{\n\s+try \{ if \(window\.SUFacility\) \{ fill\(\); SUFacility\.onReady\(function \(\) \{ fill\(\); \}\); \} \} catch \(e\) \{\}/.test(BUILD));
  t('1行に tel: のリンクを使わない', !/['"`]tel:/i.test(BUILD));

  console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
  process.exit(fail ? 1 : 0);
})();
