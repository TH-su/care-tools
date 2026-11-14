#!/usr/bin/env node
/* check/print_head_patch_e2e.mjs — 貼り薬カレンダーの紙の見出しの「施設名・印刷日」の通し試験（2026-11-13 反証レビュー 高1）
 *
 *   node check/print_head_patch_e2e.mjs
 *
 * 守ること: 施設名なし・9字・30字・50字のどれでも、印刷の見た目で
 *   (1) 見出しの段（.sh-ttl）の高さが施設名を入れる前と同じ（表題・薬名が折り返さない＝カレンダーが縮まない）
 *   (2) 施設名・印刷日の印（.pc-fac）が表題（h2）・薬名（.drug）・年月（.ym）と重ならない
 *   (3) 施設名を入れた時は印刷日が切れずに見える（施設名だけを … で切る）
 * 紙の幅で測る（A4 縦 210mm − 余白 8mm×2 = 194mm ≒ 733px の幅で印刷の見た目にする。画面の幅だと空きが広く、折り返しが起きない）。
 * 施設情報は架空の施設（check/fixtures/facility-profile.alt.mjs）の名前だけを差し替えてメモリから配る。外への通信は止める。
 * 使い捨てのプロファイルは playwright に任せ、必ず閉じる。結果: 全部合格で 0・不合格で 1・確かめられない時は 2 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, startServer } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
let pass = 0, fail = 0;
function t(n, c, e) { if (c) { pass++; console.log('  ✓ ' + n); } else { fail++; console.log('  ✗ ' + n + (e !== undefined ? '  → ' + JSON.stringify(e) : '')); } }

let pw;
try { pw = loadPlaywright(); } catch (e) { console.log('playwright を読めないため確かめられません'); process.exit(2); }
const alt = (await import(pathToFileURL(path.join(HERE, 'fixtures', 'facility-profile.alt.mjs')).href)).default;
const BASE = '架空ゆめの家みらい館本館東棟西棟南棟北棟中央棟架空ゆめの家みらい館本館東棟西棟南棟北棟中央棟架空ゆめの家';
const CASES = [['施設名なし', ''], ['9字', BASE.slice(0, 9)], ['30字', BASE.slice(0, 30)], ['50字', BASE.slice(0, 50)]];

function profileOf(name) {
  const p = JSON.parse(JSON.stringify(alt));
  p.facilityName = name;
  for (const o of p.offices) if (o.kind === '施設') o.name = name;
  return p;
}
const overlap = (a, b) => !!(a && b) && a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;

const browser = await pw.chromium.launch();
try {
  for (const [label, name] of CASES) {
    const srv = await startServer(REPO, 0, { facilityProfile: profileOf(name) });
    const ctx = await browser.newContext({ viewport: { width: 733, height: 1100 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
    await ctx.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
    const p = await ctx.newPage();
    try {
      await p.goto(srv.url + '/patch-calendar.html', { waitUntil: 'load' });
      await p.waitForFunction(() => window.SUFacility && SUFacility.ready() && window.SUPrint && document.querySelector('.sh-ttl .pc-fac'), null, { timeout: 15000 });
      await p.emulateMedia({ media: 'print' });
      /* 施設名を入れる前（印を空にした時）の段の高さ → 入れた後 */
      const m = await p.evaluate(() => {
        const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, h: b.height, w: b.width }; };
        const ttl = document.querySelector('.sh-ttl'), st = ttl.querySelector('.pc-fac');
        while (st.firstChild) st.removeChild(st.firstChild);
        const before = r(ttl).h;
        SUPrint.fillHeads(document);
        const n = st.querySelector('.su-print-head-n'), d = st.querySelector('.su-print-head-d');
        return {
          before, after: r(ttl).h, ttl: r(ttl), fac: getComputedStyle(st).display === 'none' ? null : r(st),
          h2: r(ttl.querySelector('h2')), drug: r(ttl.querySelector('.drug')), ym: r(ttl.querySelector('.ym')),
          nameText: n ? n.textContent : '', dateText: d ? d.textContent : '',
          dateCut: d ? d.scrollWidth > d.clientWidth + 0.5 : null, dateVisible: d ? d.getBoundingClientRect().width > 0 : false
        };
      });
      t(label + ': 見出しの段の高さは施設名を入れる前と同じ', Math.abs(m.after - m.before) < 0.01, { before: m.before, after: m.after });
      t(label + ': 印は表題・薬名・年月と重ならない', !overlap(m.fac, m.h2) && !overlap(m.fac, m.drug) && !overlap(m.fac, m.ym), m);
      t(label + ': 印は見出しの段の中・年月の左に収まる', !m.fac || (m.fac.top >= m.ttl.top - 0.5 && m.fac.bottom <= m.ttl.bottom + 0.5 && m.fac.right <= m.ym.left + 0.5 && m.fac.left >= m.drug.right - 0.5), m.fac);
      if (name) t(label + ': 施設名を出し、印刷日は切れずに見える', m.nameText === name && /^　印刷日：/.test(m.dateText) && m.dateVisible && m.dateCut === false, m);
      else t(label + ': 施設名なしでは印刷日だけ', m.nameText === '' && /^印刷日：/.test(m.dateText), m);
    } catch (e) {
      fail++; console.log('  ✗ ' + label + ': 確かめられない（' + String(e.message || e).split('\n')[0].slice(0, 120) + '）');
    } finally { await ctx.close(); await srv.close(); }
  }
} finally { await browser.close(); }
console.log('\n────────── 合計: ' + pass + ' 件成功 / ' + fail + ' 件失敗 ──────────');
process.exit(fail ? 1 : 0);
