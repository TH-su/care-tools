#!/usr/bin/env node
/* check/facility-swap.mjs — facility-profile.json を差し替えるだけで全アプリが動くかを確かめる（2026-11-02 新設・施設の導入手順の試験）
 *
 *   node check/facility-swap.mjs                       … 2つ目の架空の施設（check/fixtures/facility-profile.alt.mjs）で配って20画面を開く
 *   node check/facility-swap.mjs --pages index.html,daycare-roster.html   … 画面を絞る
 *   node check/facility-swap.mjs --profile facility-profile.sample.json   … 配る施設情報を変える（守りが働くかの確かめ用。見本で配ると (a) が落ちる）
 *   node check/facility-swap.mjs --settle 2500         … 開いてから待つミリ秒（既定 2500・snap.mjs と同じ）
 *
 * 流れ: 施設情報をメモリに持った手元の配信（check/lib.mjs の startServer の facilityProfile）を立て、使い捨てのプロファイル
 *       （~/.claude/scripts/lib/chrome-temp.mjs の makeTempProfile・無い環境では同じ決まりの控え）のヘッドレス Chrome で
 *       PAGES の20画面を順に開き、1画面ごとに次の3つを見る。
 *   (a) 見本の施設名・事業所名・法人名（SAMPLE_NAMES）が画面の文字に0件。画面の文字＝見出し（title）・本文の textContent（隠れた所も含む）・入力欄の値
 *   (b) 画面のスクリプトの例外（pageerror）が0件。snap.mjs・compare.mjs と同じく pageerror を数え、加えて CSP で止められたスクリプト
 *       （例外は出ないが動かない。CSP の指紋の作り直し忘れ）も数える。
 *       読み込みの失敗（ws-master.json など公開に無いファイルの 404・外へ出ようとして止めた要求）は pageerror ではないので数に入れず、
 *       「除いたもの」として出力に書く（隠して数を減らしているのではない）
 *   (c) 施設名・事業所名を出す画面（PAGES の shows）では、配った施設の名前（法人名・施設名・事業所名・正式名）が見える文字（innerText）に出ている。
 *       さらに施設情報を読む画面（PAGES の reads）では、画面が読んだ施設情報（SUFacility.get()）の施設名が配った施設のものである
 * 結果: 1画面1行。全部合格で終了コード 0、1つでも不合格で 1、Chrome を起動できない・画面を開けない等で確かめられない時は 2。
 *       詳しい結果は check/out/facility-swap.json
 * ・外への通信は手元の配信以外を全部止める（接続先は入れない＝架空の施設情報だけで開く）。画面のコードは変えない
 * ・check/unit/run-all.mjs には入れない（20画面を開くので時間がかかる）。軽い確かめは check/unit/facility_swap_test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright, startServer, parseArgs, ensureDir, writeJson } from './lib.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
export const ALT_PROFILE_FILE = path.join(HERE, 'fixtures', 'facility-profile.alt.mjs');
export const SAMPLE_PROFILE_FILE = path.join(ROOT, 'facility-profile.sample.json');

/* 全アプリ＝20画面。reads … su-facility.js を読み込む画面（grep で決めた）。shows … 施設名・事業所名を画面の文字に出す画面
   （SUFacility の使い方を grep で拾い、接続先の無い架空の状態で実際に名前が出るかを開いて確かめた結果。出さない画面は理由を why に書く）。
   hidden … 見える所には出さないが、隠れた部品の文字（textContent）に事業所の名前が入る画面（その名前が配った施設のものかも見る）。
   shift-app・shift-analyzer・work-schedule は別の正本から配る画面で、このリポジトリでは変えない（開いて確かめるだけ） */
export const PAGES = [
  { file: 'index.html', title: 'メニュー', reads: true, shows: true, why: '事業所の呼び名（officeName）を区分・ボタンの名前に、問い合わせ先（support）を「困った時」に出す' },
  { file: 'care-schedule.html', title: '週間計画', reads: true, shows: false, why: '読むのは市区町村（municipality）だけで、施設名・事業所名は出さない' },
  { file: 'weight-record.html', title: '体重管理', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'training-plan.html', title: '個別機能訓練計画書', reads: true, shows: false, why: '事業所（office）は計画書の中で使う。ログインしていない時は覆いの画面だけ（SUAppGate）' },
  { file: 'supplies.html', title: '消耗品管理', reads: true, shows: false, hidden: true, why: '事業所（office・get）の名前は隠れた部品（帳票など）に入り、接続先の無い状態では見えない' },
  { file: 'shift-app.html', title: 'シフト作成', reads: false, shows: false, why: '別の正本から配る画面。施設情報は画面の中の設定（su_facility_profile_v1）で持ち、facility-profile.json を読まない' },
  { file: 'work-schedule.html', title: 'ワークスケジュール', reads: false, shows: false, why: '別の正本から配る画面。施設情報は画面の中の設定（su_facility_profile_v1）で持ち、facility-profile.json を読まない' },
  { file: 'staff-master.html', title: '職員マスタ', reads: true, shows: false, why: '読むのは法人設定と市区町村だけ。ログインしていない時は覆いの画面だけ（SUAppGate）' },
  { file: 'connection-settings.html', title: '接続設定', reads: true, shows: false, why: '事業所の呼び名（officeName）は接続の欄に出すが、ログインしていない時は覆いの画面だけ（SUAppGate）' },
  { file: 'support-overview.html', title: '全支援俯瞰', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'moushiokuri-viewer.html', title: '申し送りビューア', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'resident-master.html', title: '入居者マスタ', reads: true, shows: false, why: '事業所・階・間取りは一覧と帳票の中で使う。ログインしていない時は覆いの画面だけ（SUAppGate）' },
  { file: 'visit-overview.html', title: '週間計画俯瞰（訪問）', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'admission-flow.html', title: '入居調整', reads: true, shows: false, hidden: true, why: '事業所の名前（nameOf）は隠れた部品（相談の欄）に入り、ログインしていない時は覆いの画面だけで見えない（SUAppGate）' },
  { file: 'daycare-roster.html', title: 'デイ利用表', reads: true, shows: true, why: '通所の事業所名（nameOf）を見出しに出す' },
  { file: 'facesheet.html', title: 'フェイスシート', reads: true, shows: false, why: '読むのは階（floorOf・floorLabel）だけで、施設名・事業所名は出さない' },
  { file: 'overview-compare.html', title: '左右比較', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'genogram.html', title: '家族構成図', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'patch-calendar.html', title: '貼り薬カレンダー', reads: false, shows: false, why: '施設情報を読まない' },
  { file: 'shift-analyzer.html', title: 'シフト分析', reads: true, shows: false, why: '別の正本から配る画面。su-facility.js を読み込むが、施設名・事業所名は出さない' },
];

/* 施設情報から「名前」を集める（法人名・施設名・事業所名・正式名・問い合わせ先の名前・医療機関の名前）。空・重複は捨てる */
export function profileNames(p) {
  const out = [];
  const add = (v) => { if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim()); };
  if (!p || typeof p !== 'object') return out;
  add(p.corpName); add(p.facilityName);
  for (const o of (Array.isArray(p.offices) ? p.offices : [])) { add(o && o.name); add(o && o.formalName); }
  add(p.support && p.support.contactName);
  for (const c of (Array.isArray(p.visitingClinics) ? p.visitingClinics : [])) add(c && c.name);
  return out;
}
/* (c) で「出ている」と数える名前（法人名・施設名・事業所名・正式名）。問い合わせ先・医療機関は (a) だけで見る */
export function displayNames(p) {
  const out = [];
  const add = (v) => { if (typeof v === 'string' && v.trim() && !out.includes(v.trim())) out.push(v.trim()); };
  if (!p || typeof p !== 'object') return out;
  add(p.corpName); add(p.facilityName);
  for (const o of (Array.isArray(p.offices) ? p.offices : [])) { add(o && o.name); add(o && o.formalName); }
  return out;
}

export async function loadProfile(file) {
  if (/\.m?js$/.test(file)) return (await import(pathToFileURL(path.resolve(file)).href)).default;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/* 使い捨てのプロファイル。~/.claude の部品があればそれを使い、無い環境（CI など）では同じ決まりの控えで作って消す（observe.mjs と同じ） */
async function tempProfileMaker() {
  const lib = path.join(os.homedir(), '.claude', 'scripts', 'lib', 'chrome-temp.mjs');
  if (fs.existsSync(lib)) return (await import(pathToFileURL(lib).href)).makeTempProfile;
  return (prefix) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const cleanup = () => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* 消せなければ残る */ } };
    process.once('exit', cleanup);
    return { dir, cleanup, args: [`--user-data-dir=${dir}`, '--no-first-run', '--disk-cache-size=1'] };
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const say = (s) => process.stdout.write(s + '\n');
  const settle = Number(args.settle || 2500);
  const profileFile = args.profile && args.profile !== 'true' ? args.profile : ALT_PROFILE_FILE;
  let profile, sample;
  try { profile = await loadProfile(profileFile); sample = await loadProfile(SAMPLE_PROFILE_FILE); }
  catch (e) { say('施設情報を読めません: ' + String(e.message || e).split('\n')[0]); process.exit(2); }
  const only = args.pages && args.pages !== 'true' ? String(args.pages).split(',') : null;
  if (only) { const unknown = only.filter((f) => !PAGES.some((p) => p.file === f)); if (unknown.length) { say('知らない画面: ' + unknown.join(',')); process.exit(2); } }
  const pages = PAGES.filter((p) => !only || only.includes(p.file));
  const sampleNames = profileNames(sample);
  const wantNames = displayNames(profile);
  const wantFacility = typeof profile.facilityName === 'string' ? profile.facilityName : '';

  let pw, srv, ctx, prof;
  /* Ctrl-C などで止めた時は、Chrome を閉じてから使い捨てのプロファイルを消して終える（observe.mjs と同じ。消すのは終了時の処理） */
  let stopping = false;
  const closeAll = async () => { try { if (ctx) await ctx.close(); } catch (e) { /* 閉じている */ } ctx = null; try { if (prof) prof.cleanup(); } catch (e) { /* 消せない */ } try { if (srv) await srv.close(); } catch (e) { /* 止まっている */ } srv = null; };
  const installStop = () => {
    for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
      process.removeAllListeners(sig);
      process.on(sig, async () => { if (stopping) return; stopping = true; setTimeout(() => process.exit(code), 10000).unref(); await closeAll(); process.exit(code); });
    }
  };
  try {
    pw = loadPlaywright();
    srv = await startServer(ROOT, 0, { facilityProfile: profile });
    const makeTempProfile = await tempProfileMaker();
    prof = makeTempProfile('facility-swap-');
    installStop();
    ctx = await pw.chromium.launchPersistentContext(prof.dir, {
      headless: true, args: prof.args.filter((a) => !a.startsWith('--user-data-dir')),
      viewport: { width: 1280, height: 900 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo', serviceWorkers: 'block',
      handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false,
    });
  } catch (e) {
    say('確かめられません（Chrome を起動できない・配信を立てられない）: ' + String(e.message || e).split('\n')[0]);
    await closeAll();
    process.exit(2);
  }

  /* 手元の配信以外へ出る要求は全部止める（接続先の無い架空の状態で開く）。止めた要求は「除いたもの」に書く */
  const origin = new URL(srv.url).origin;
  let cur = null;
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    let u = null;
    try { u = new URL(url); } catch (e) { u = null; }
    if (u && (u.origin === origin || u.protocol === 'data:' || u.protocol === 'blob:' || u.protocol === 'about:')) return route.fallback();
    if (cur) cur.blocked.push(u ? (u.host + u.pathname).slice(0, 120) : String(url).slice(0, 80));
    return route.abort('blockedbyclient');
  });

  say(`施設の差し替えの確かめ: 配った施設情報 ${path.relative(ROOT, path.resolve(profileFile))}（${wantFacility || '施設名なし'}）／見本の名前 ${sampleNames.length} 語を探す／${pages.length} 画面`);
  const rows = [];
  let unsure = 0;
  for (const pg of pages) {
    const r = { file: pg.file, title: pg.title, reads: pg.reads, shows: pg.shows, hidden: !!pg.hidden, pageErrors: [], excluded: [], blocked: [], found: [], readName: null, shownNames: [], hiddenNames: [], openError: null };
    cur = r;
    const page = await ctx.newPage();
    page.on('pageerror', (e) => r.pageErrors.push(String(e && e.message || e).slice(0, 160)));
    /* CSP で止められた画面のスクリプトも (b) の失敗に数える（例外は出ないが、止められたスクリプトは動かない＝画面が動いていない） */
    page.on('console', (m) => { if (m.type() === 'error' && /Content Security Policy/.test(m.text())) r.pageErrors.push('CSP で止まった: ' + m.text().slice(0, 100)); });
    page.on('dialog', (d) => d.dismiss().catch(() => {}));
    page.on('response', (res) => { if (res.status() >= 400) { try { r.excluded.push(res.status() + ' ' + new URL(res.url()).pathname.slice(0, 120)); } catch (e) { r.excluded.push(String(res.status())); } } });
    page.on('requestfailed', (rq) => { const f = rq.failure(); if (f && /blockedbyclient/i.test(f.errorText)) return; try { r.excluded.push('失敗 ' + new URL(rq.url()).pathname.slice(0, 120)); } catch (e) { r.excluded.push('失敗'); } });
    try {
      await page.goto(srv.url + '/' + pg.file, { waitUntil: 'load', timeout: 30000 });
      /* 施設情報を読む画面は、読めた（または読めないと分かった）のを待つ。読まない画面は待たない */
      /* ワークスケジュール・シフト作成は同じ名前（window.SUFacility）で別の中身を持つので、ready が無ければ待たない（試験の側で例外を出さない） */
      await page.waitForFunction(() => { const F = window.SUFacility; return !F || typeof F.ready !== 'function' || F.ready(); }, null, { timeout: 8000 }).catch(() => { /* 読めないまま＝(c) の「読んだ施設名」で落ちる */ });
      await page.waitForTimeout(settle);
      const seen = await page.evaluate(() => {
        const vals = [];
        for (const el of document.querySelectorAll('input, textarea, select')) { try { vals.push(el.value || ''); } catch (e) { /* 読めない欄 */ } }
        let read = null;
        try { const g = window.SUFacility && window.SUFacility.get && window.SUFacility.get(); read = g ? String(g.facilityName || '') : null; } catch (e) { read = null; }
        return { all: [document.title, document.body ? document.body.textContent : '', vals.join('\n')].join('\n'), visible: document.body ? document.body.innerText : '', read, hasFac: !!window.SUFacility };
      });
      r.found = sampleNames.filter((n) => seen.all.includes(n));
      r.shownNames = wantNames.filter((n) => seen.visible.includes(n));
      r.hiddenNames = wantNames.filter((n) => seen.all.includes(n));
      r.readName = seen.read;
      r.hasFacility = seen.hasFac;
    } catch (e) {
      r.openError = String(e.message || e).split('\n')[0].slice(0, 160);
      unsure++;
    }
    await page.close().catch(() => {});
    cur = null;
    r.a = r.openError ? '確かめられない' : (r.found.length ? '不合格' : '合格');
    r.b = r.openError ? '確かめられない' : (r.pageErrors.length ? '不合格' : '合格');
    if (r.openError) r.c = '確かめられない';
    else if (!pg.reads && !pg.shows) r.c = '対象外';
    else {
      const readOk = !pg.reads || r.readName === wantFacility;
      const showOk = !pg.shows || r.shownNames.length > 0;
      const hiddenOk = !pg.hidden || r.hiddenNames.length > 0;
      r.c = readOk && showOk && hiddenOk ? '合格' : '不合格';
    }
    rows.push(r);
    const cNote = r.c === '対象外' ? `対象外（${pg.why}）`
      : r.c + (pg.reads ? `・読んだ施設名 ${r.readName === wantFacility ? '一致' : '違う（' + (r.readName == null ? '読めていない' : '別の施設') + '）'}` : '')
        + (pg.shows ? `・見える名前 ${r.shownNames.length}語` : (pg.hidden ? `・隠れた部品の名前 ${r.hiddenNames.length}語` : '・名前は出さない画面'));
    const ex = [...new Set(r.excluded)];
    const bl = [...new Set(r.blocked)];
    say(`${pg.title}（${pg.file}）｜(a) ${r.a}${r.found.length ? '（見本の名前: ' + r.found.join('、') + '）' : ''}｜(b) ${r.b} ${r.pageErrors.length}件${r.pageErrors.length ? '（' + r.pageErrors.slice(0, 2).join(' / ') + '）' : ''}｜(c) ${cNote}`
      + (ex.length ? `｜除いたもの: ${ex.join('、')}` : '') + (bl.length ? `｜外へ出ようとして止めた: ${bl.length}件（${bl.slice(0, 3).join('、')}）` : '') + (r.openError ? `｜開けない: ${r.openError}` : ''));
  }
  await closeAll();

  const ng = rows.filter((r) => r.a === '不合格' || r.b === '不合格' || r.c === '不合格');
  const res = { at: new Date().toISOString(), profile: path.relative(ROOT, path.resolve(profileFile)), pages: rows.length, ng: ng.map((r) => r.file), unsure, rows };
  try { writeJson(path.join(ensureDir(path.join(ROOT, 'check', 'out')), 'facility-swap.json'), res); } catch (e) { say('結果のファイルを書けません: ' + e.message); }
  say(`\nまとめ: ${rows.length} 画面のうち 合格 ${rows.filter((r) => !ng.includes(r) && !r.openError).length}／不合格 ${ng.length}${ng.length ? '（' + ng.map((r) => r.file).join('、') + '）' : ''}／確かめられない ${unsure}`);
  process.exit(ng.length ? 1 : (unsure ? 2 : 0));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main();
