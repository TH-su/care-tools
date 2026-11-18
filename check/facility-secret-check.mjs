#!/usr/bin/env node
// 施設情報の Secret（FACILITY_PROFILE_JSON）を貼る前に手元で確かめる道具（2026-10-26 本人指示）
//
// 公開の手順（.github/workflows/pages.yml の「本番の施設情報を置く」）も、この判定（checkFacilityProfile）を使う。
// 手元で OK なら、公開の手順でも同じ理由では止まらない。
//
// ★値は出さない。NG の時に出すのは「どの項目が、どう違うか」だけ（施設名・電話・住所などの中身は1文字も出さない）。
//   JSON として読めない時も、Node のエラー文（中身の一部を含むことがある）は出さず、行と文字の位置だけを出す。
//
// 使い方（ターミナル・care-tools のフォルダで）:
//   node check/facility-secret-check.mjs 施設情報.json      … ファイルを確かめる
//   node check/facility-secret-check.mjs --clip             … クリップボードの中身を確かめる（Mac の pbpaste）。
//     ターミナルから動かすと「コピーしてから Enter」と出て待つ（このコマンドを貼った時点でクリップボードがコマンドの文字に
//     置き換わるため。待っている間に施設情報の全体をコピーし直す）。待たずに読む時は --no-wait
//   pbpaste | node check/facility-secret-check.mjs          … 標準入力から
//   --github を付けると NG を ::error:: の形で出す（公開の手順用）
//   終了コード: 0＝OK／1＝NG／2＝使い方の誤り・ファイルが読めない
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KINDS = ['施設', '訪問', '通所'];
const SUPPORT_KEYS = ['contactName', 'contactTel', 'hours', 'emergency', 'replyTarget'];
// 固定電話・IP電話・フリーダイヤルの形（ハイフンあり・なし）。携帯（070・080・090）は別に断る
const TEL_RE = /^(0\d{1,4}-\d{1,4}-\d{3,4}|0\d{9,10})$/;
const MOBILE_RE = /^0[789]0/;
const TEL_IN_TEXT_RE = /0\d{1,4}-?\d{1,4}-?\d{3,4}/g;
const PLACEHOLDER_RE = /【書き換える】|000-000-0000/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const filled = (v) => isStr(v) && v.trim() !== '';

/* JSON の位置（文字数）から行と文字の位置を出す。エラー文の中身は使わない */
function posOf(text, err) {
  const msg = String(err && err.message);
  const lc = /line (\d+) column (\d+)/.exec(msg);
  if (lc) return `（${lc[1]} 行目 ${lc[2]} 文字目のあたり）`;
  const m = /position (\d+)/.exec(msg);
  if (!m) return '';
  const at = Math.min(Number(m[1]), text.length);
  const before = text.slice(0, at);
  const line = before.split('\n').length;
  const col = at - before.lastIndexOf('\n');
  return `（${line} 行目 ${col} 文字目のあたり）`;
}

/**
 * 施設情報の JSON の文字列を確かめる。値は返さない。
 * @param {string} text 確かめる JSON の文字列
 * @param {string} sampleText 見本 facility-profile.sample.json の文字列（見本のままかの判定に使う）
 * @returns {{ok: boolean, errors: string[], summary: string}}
 */
/* 貼り薬カレンダーの画面から、施設情報を確かめる純関数（pcStr・pcCfgOf・pcKindsOf と決まりの数）だけを切り出して動かす。
   切り出す範囲は「var PC_SITE_MIN」から「/* 施設情報の kinds を読む」の手前まで。外の物（window・document）には触れない範囲。
   読めない・形が変わった時は null（呼んだ側が NG にする＝黙って通さない。切り出せることと、null の時に止まることを試験 facility_secret_check_test の F が確かめる） */
let patchRulesMemo;
export function patchRules() {
  if (patchRulesMemo !== undefined) return patchRulesMemo;
  patchRulesMemo = null;
  try {
    const src = fs.readFileSync(path.join(ROOT, 'patch-calendar.html'), 'utf8');
    const a = src.indexOf('var PC_SITE_MIN');
    const b = src.indexOf('/* 施設情報の kinds を読む', a);
    if (a < 0 || b < 0) return null;
    const box = vm.createContext({});
    vm.runInContext(src.slice(a, b) + '\n;this.__pc = { pcCfgOf: pcCfgOf, pcKindsOf: pcKindsOf };', box, { timeout: 1000 });
    const pc = box.__pc;
    if (pc && typeof pc.pcCfgOf === 'function' && typeof pc.pcKindsOf === 'function') patchRulesMemo = pc;
  } catch (e) { patchRulesMemo = null; }
  return patchRulesMemo;
}
/* 試験だけが使う: 切り出しに失敗した時（null）に止まることを確かめるため、決まりを差し替える。undefined で元に戻す */
export function setPatchRulesForTest(v) { patchRulesMemo = v; }

export function checkFacilityProfile(text, sampleText) {
  const errors = [];
  const ng = (where, why) => errors.push(`${where}：${why}`);
  if (!isStr(text) || text.trim() === '') return { ok: false, errors: ['全体：空です（何も貼られていません）'], summary: '' };
  const body = text.replace(/^\uFEFF/, '');
  const head = body.trimStart().charAt(0);
  if (head !== '{' && head !== '[') {
    return { ok: false, errors: ['全体：先頭が { ではありません。施設情報ではないもの（コマンドの文字など）が入っていないかを見てください。--clip の時は、施設情報の全体をコピーし直してから確かめてください'], summary: '' };
  }
  let p;
  try { p = JSON.parse(body); } catch (e) {
    const fw = /[“”＂：，｛｝]/.test(text) ? '。全角の “ ” ： ， ｛ ｝ が混ざっていないかも見てください' : '';
    return { ok: false, errors: [`全体：JSON として読めません${posOf(text, e)}。カンマの抜け・余り、かっこの対応を見てください${fw}`], summary: '' };
  }
  if (!isObj(p)) return { ok: false, errors: ['全体：{ } で囲んだ1つのかたまりではありません（一部分だけを貼っていないか）'], summary: '' };
  let s = {};
  try { s = JSON.parse(sampleText || '{}'); } catch (e) { s = {}; }

  // 必須の項目
  for (const k of ['corpName', 'facilityName']) {
    if (!(k in p)) ng(k, 'ありません（必須）');
    else if (!filled(p[k])) ng(k, '文字が入っていません（必須・文字）');
  }
  if (!Array.isArray(p.offices)) ng('offices', (('offices' in p) ? '一覧（[ ]）ではありません' : 'ありません（必須）'));
  else {
    p.offices.forEach((o, i) => {
      const w = `offices[${i}]`;
      if (!isObj(o)) { ng(w, '{ } のかたまりではありません'); return; }
      if (!filled(o.kind)) ng(`${w}.kind`, '文字が入っていません');
      if (!filled(o.name)) ng(`${w}.name`, '文字が入っていません');
      if ('tel' in o && !isStr(o.tel)) ng(`${w}.tel`, '文字ではありません');
      else if (filled(o.tel) && !TEL_RE.test(o.tel.trim())) ng(`${w}.tel`, '電話の形ではありません（例 096-000-0000 の形・空でもよい）');
    });
    const kinds = p.offices.filter(isObj).map((o) => o.kind).sort();
    if (JSON.stringify(kinds) !== JSON.stringify([...KINDS].sort())) ng('offices', '施設・訪問・通所 の3つがそろっていません（kind が1つずつ）');
  }

  // 見本のまま
  if ((filled(s.facilityName) && p.facilityName === s.facilityName) || (filled(s.corpName) && p.corpName === s.corpName)) {
    ng('corpName / facilityName', '見本（架空の施設）のままです');
  }

  // 型だけ確かめる項目（無くてもよい）
  if ('version' in p && typeof p.version !== 'number') ng('version', '数ではありません');
  if ('municipality' in p && !isStr(p.municipality)) ng('municipality', '文字ではありません');
  // 適格請求書の登録番号（2026-11-13 第6段 SP-03）。読む部品（su-facility.js の norm）と同じ読み方: 空白・ハイフンを除き、全角の英数字を半角に直して T と13桁の数字か。
  // 形が違うと紙に黙って出ないので、入っている時だけ確かめて止める（値は出さない）
  if ('invoiceNo' in p) {
    if (!isStr(p.invoiceNo)) ng('invoiceNo', '文字ではありません');
    else if (filled(p.invoiceNo)) {
      const inv = p.invoiceNo.replace(/[\s\-‐－−]/g, '').replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
      if (!/^T[0-9]{13}$/.test(inv)) ng('invoiceNo', 'T と13桁の数字の形ではありません（空白・ハイフンは除いて読みます。このままでは明細・料金表に出ません）');
    }
  }
  if ('corpSettings' in p) {
    if (!isObj(p.corpSettings)) ng('corpSettings', '{ } のかたまりではありません');
    else {
      const u = p.corpSettings.homeGuidelineUrl;
      if (u !== undefined && !isStr(u)) ng('corpSettings.homeGuidelineUrl', '文字ではありません');
      else if (filled(u) && !/^https:\/\/[^\s"<>]+$/.test(u.trim())) ng('corpSettings.homeGuidelineUrl', 'https:// で始まる URL ではありません（画面には出ません）');
      /* 職員マスタの事業所の区分の名前（第6段 SM-02）。読む部品（staff-master-calc.js の normSiteLabels）と同じ判定で、崩れていれば止める（画面は黙って今の名前に戻るため） */
      if ('siteLabels' in p.corpSettings) {
        let okSl = false;
        try { okSl = !!createRequire(import.meta.url)(path.join(ROOT, 'staff-master-calc.js')).normSiteLabels(p.corpSettings.siteLabels); } catch (e) { okSl = false; }
        if (!okSl) ng('corpSettings.siteLabels', 'facility・visit・day・cm の4つ全部を、1〜6字の互いに別の名前（空白・記号・CSV の見出しの語（事業所・備考・厨房など）・ほかの区分の今の名前は使えない）で書いてください（崩れていると職員マスタは今の名前のまま出します）');
      }
    }
  }
  if ('floors' in p) {
    if (!Array.isArray(p.floors)) ng('floors', '一覧（[ ]）ではありません');
    else p.floors.forEach((f, i) => {
      if (!isObj(f) || typeof f.no !== 'number' || !Number.isInteger(f.no) || f.no < 1 || f.no > 9) ng(`floors[${i}].no`, '1〜9 の整数ではありません');
    });
  }
  /* デイ利用表の外部の利用者の区画（2026-11-17 D-02）。読む画面（daycare-roster.html の dcrOutside_）と同じ決まり:
     { label } の1つだけ・label は1〜4字の文字（前後の空白・改行などの制御文字・{ } なし）。崩れていると画面は黙って今のまま（外部の方も階未設定）に戻るので、ここで止める。
     ★片方を変えたら両方を同じにする（値は出さない） */
  if ('daycareOutside' in p) {
    const v = p.daycareOutside;
    const w = isObj(v) ? v.label : undefined;
    const ok = isObj(v) && Object.keys(v).length === 1 && Object.keys(v)[0] === 'label' && isStr(w)
      && [...w].length >= 1 && [...w].length <= 4 && w.trim() === w && !/[\u0000-\u001f\u007f{}]/.test(w);
    if (!ok) ng('daycareOutside', '{"label": "外部"} の形で、label だけを1〜4字（前後の空白・改行・{ } なし）で書いてください（崩れているとデイ利用表は外部の区画を作らず、今のまま出します）');
  }
  /* 貼り薬カレンダーの薬の名前・貼る場所・別の種類（2026-11-18 第8回の監査の気づき2）。読む画面（patch-calendar.html の pcCfgOf・pcKindsOf）の
     関数そのものを切り出して使う（同じ決まりを2か所に書かない）。崩れていると画面は黙って既定（今の1種類・背中8箇所）に戻る・kinds だけ捨てるので、ここで止める（値は出さない） */
  if ('patchCalendar' in p) {
    const v = p.patchCalendar;
    const pc = patchRules();
    if (!pc) ng('patchCalendar', '確かめる決まり（貼り薬カレンダーの画面の読み方）を読めませんでした。道具の不具合なので管理者に知らせてください');
    else if (isObj(v) && JSON.stringify(v).length > 50000) ng('patchCalendar', '大きすぎます（JSON にして5万字まで。超えると貼り薬カレンダーは塊ごと読まず、既定の薬の名前と背中8箇所のまま出します）');
    else if (!isObj(v)) ng('patchCalendar', '{ } のかたまりではありません（崩れていると貼り薬カレンダーは既定の薬の名前と背中8箇所のまま出します）');
    else {
      if (v.drug === undefined && v.sites === undefined && v.kinds === undefined) ng('patchCalendar', 'drug・sites・kinds のどれも書いていません（書かない時は patchCalendar ごと消してください）');
      if ((v.drug !== undefined || v.sites !== undefined) && !pc.pcCfgOf({ drug: v.drug, sites: v.sites })) {
        ng('patchCalendar', 'drug は1〜20字・sites は2〜8か所（name は1〜12字で互いに別・short は6字まで・name が7字以上なら short が要る・< > と改行は使えない）で書いてください（崩れていると貼り薬カレンダーは既定の薬の名前と背中8箇所のまま出します）');
      }
      if (v.kinds !== undefined && !pc.pcKindsOf(v)) {
        ng('patchCalendar.kinds', '1〜7つの一覧で、1つずつ no（2〜8 の整数・重ならない）と drug（1〜20字）を書き、sites は書くなら drug・sites と同じ決まりで書いてください（崩れていると貼り薬カレンダーは種類を選ばせず、既定の種類だけで出します）');
      }
    }
  }
  if ('visitingClinics' in p) {
    if (!Array.isArray(p.visitingClinics)) ng('visitingClinics', '一覧（[ ]）ではありません');
    else p.visitingClinics.forEach((c, i) => { if (!isObj(c) || !filled(c.name)) ng(`visitingClinics[${i}].name`, '文字が入っていません'); });
  }
  if ('roomPlan' in p && p.roomPlan !== null) {
    if (!isObj(p.roomPlan)) ng('roomPlan', '{ } のかたまりではありません');
    else for (const k of Object.keys(p.roomPlan)) {
      if (!isObj(p.roomPlan[k]) || !Array.isArray(p.roomPlan[k].cells)) ng(`roomPlan.${k}`, 'cells の一覧がありません');
    }
  }

  // 問い合わせ先（support）
  if ('support' in p) {
    if (!isObj(p.support)) ng('support', '{ } のかたまりではありません');
    else {
      for (const k of SUPPORT_KEYS) {
        const v = p.support[k];
        if (v !== undefined && !isStr(v)) { ng(`support.${k}`, '文字ではありません'); continue; }
        if (filled(v) && PLACEHOLDER_RE.test(v)) ng(`support.${k}`, '見本の値（000-000-0000）か【書き換える】が残っています');
      }
      const tel = p.support.contactTel;
      if (filled(tel) && !PLACEHOLDER_RE.test(tel)) {
        const t = tel.trim();
        if (!TEL_RE.test(t)) ng('support.contactTel', '電話の形ではありません（例 096-000-0000 の形）');
        else if (MOBILE_RE.test(t)) ng('support.contactTel', '携帯の番号の形（070・080・090）です。公表済みの事業所の番号だけを入れる決まりです');
      }
      if (filled(p.support.emergency) && (p.support.emergency.match(TEL_IN_TEXT_RE) || []).some((n) => MOBILE_RE.test(n))) {
        ng('support.emergency', '携帯の番号の形（070・080・090）が入っています。公表済みの事業所の番号だけを入れる決まりです');
      }
    }
  }

  const nSup = isObj(p.support) ? SUPPORT_KEYS.filter((k) => filled(p.support[k])).length : 0;
  const summary = `事業所 ${Array.isArray(p.offices) ? p.offices.length : 0} つ・項目 ${Object.keys(p).filter((k) => !k.startsWith('_')).length} 個・問い合わせ先 ${nSup}/5 項目・見本ではない`;
  return { ok: errors.length === 0, errors, summary };
}

/* ── 手元・公開の手順から呼ぶ入口 ── */
function main(argv) {
  const gh = argv.includes('--github');
  const clip = argv.includes('--clip');
  const files = argv.filter((a) => !a.startsWith('--'));
  let text;
  try {
    if (clip) {
      if (process.stdin.isTTY && !argv.includes('--no-wait')) {
        process.stdout.write('施設情報の全体（{ から } まで）をコピーしてから、ここで Enter を押してください: ');
        try { fs.readSync(0, Buffer.alloc(1024)); } catch (e) { /* 読めなければ待たずに進む */ }
      }
      text = execFileSync('pbpaste', { encoding: 'utf8' });
    }
    else if (files[0]) text = fs.readFileSync(files[0], 'utf8');
    else if (!process.stdin.isTTY) text = fs.readFileSync(0, 'utf8');
    else { console.error('使い方: node check/facility-secret-check.mjs <ファイル>｜--clip｜（標準入力）'); return 2; }
  } catch (e) { console.error('読めませんでした（' + (e.code || 'エラー') + '）'); return 2; }
  let sample = '';
  try { sample = fs.readFileSync(path.join(ROOT, 'facility-profile.sample.json'), 'utf8'); } catch (e) { sample = ''; }
  const r = checkFacilityProfile(text, sample);
  if (r.ok) { console.log('施設情報: 形はOK（' + r.summary + '）'); return 0; }
  for (const e of r.errors) console.log(gh ? '::error::施設情報 ' + e : 'NG ' + e);
  console.log(`施設情報: ${r.errors.length} 件の違いがあります。直してから、もう一度確かめてください（値は表示していません）`);
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(main(process.argv.slice(2)));
