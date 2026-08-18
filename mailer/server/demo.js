// デモモード — 実サーバーなしでUI全機能を試せるインメモリのメールストア
// 介護施設の現実的な受信トレイを再現する。アカウント2つで統合受信も体験できる。
import crypto from 'node:crypto';

const H = 3600 * 1000;
const D = 24 * H;

// 最小構成の正当なPDFを生成（デモ添付用）
function makePdf(title, lines) {
  const content = [
    'BT /F1 16 Tf 60 780 Td (' + title.replace(/[()\\]/g, '') + ') Tj ET',
    ...lines.map((l, i) => 'BT /F1 10 Tf 60 ' + (750 - i * 18) + ' Td (' + l.replace(/[()\\]/g, '') + ') Tj ET'),
  ].join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj ${o} endobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach(off => { pdf += `${String(off).padStart(10, '0')} 00000 n \n`; });
  pdf += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

let uidCounter = 1000;
const nextUid = () => ++uidCounter;

function msg(o) {
  return {
    uid: nextUid(),
    messageId: `<demo-${crypto.randomUUID()}@demo.silvermail>`,
    attachments: [],
    to: [],
    cc: [],
    text: '',
    html: null,
    ...o,
    flags: new Set(o.flags || []),
  };
}

const MAILBOXES = [
  { path: 'INBOX', specialUse: '\\Inbox', name: '受信' },
  { path: 'Drafts', specialUse: '\\Drafts', name: '下書き' },
  { path: 'Sent', specialUse: '\\Sent', name: '送信済み' },
  { path: 'Junk', specialUse: '\\Junk', name: '迷惑メール' },
  { path: 'Trash', specialUse: '\\Trash', name: 'ゴミ箱' },
  { path: 'Archive', specialUse: '\\Archive', name: 'アーカイブ' },
];

// accountId -> { path -> [messages] }
const stores = new Map();

export const DEMO_ACCOUNTS = [
  {
    id: 'demo-1', type: 'demo', color: '#0A84FF',
    name: 'ラウレアハレ（施設代表）', email: 'info@laulea-hale.demo',
    signature: '――――――――――――――――\n住宅型有料老人ホーム ラウレアハレ\n〒860-0000 熊本市中央区○○1-2-3\nTEL 096-000-0000',
  },
  {
    id: 'demo-2', type: 'demo', color: '#BF5AF2',
    name: 'TAKESHI（代表）', email: 'takeshi@silver-unix.demo',
    signature: 'シルバーユニックス株式会社\n代表取締役 ○○ ○○',
  },
];

function now() { return Date.now(); }

function seedInfo() {
  const boxes = Object.fromEntries(MAILBOXES.map(b => [b.path, []]));
  const from = (name, address) => ({ name, address });
  const me = { name: 'ラウレアハレ（施設代表）', address: 'info@laulea-hale.demo' };

  boxes.INBOX = [
    msg({
      from: from('居宅介護支援事業所 ひまわり（田中）', 'himawari-cm@example.jp'),
      to: [me], subject: '【入居相談】要介護3の男性のご入居について',
      date: now() - 35 * 60 * 1000,
      text: 'ラウレアハレ\nご担当者様\n\nいつもお世話になっております。\n居宅介護支援事業所ひまわりの田中です。\n\n現在担当しております利用者様（80代男性・要介護3）について、ご家族よりホームへの入居を検討したいとご相談をいただきました。\n\nつきましては、下記についてご教示いただけますでしょうか。\n\n・現在の空床状況\n・医療対応の可否（インスリン注射・朝夕2回）\n・月額費用の概算\n\nご家族は今週末の見学を希望されています。\nお忙しいところ恐れ入りますが、ご返信のほどよろしくお願いいたします。\n\n――\n居宅介護支援事業所 ひまわり\n介護支援専門員 田中',
    }),
    msg({
      from: from('佐藤 恵子', 'keiko.sato@example.com'),
      to: [me], subject: '面会予約のお願い（母・佐藤トメ）',
      date: now() - 2 * H,
      text: 'お世話になっております。\n302号室でお世話になっております佐藤トメの長女、佐藤恵子です。\n\n今度の日曜日（16日）の午後に、孫を連れて面会に伺いたいのですが、14時ごろは可能でしょうか。\n\n母の最近の様子も伺えればうれしいです。\nよろしくお願いいたします。',
    }),
    msg({
      from: from('株式会社くまもと給食サービス 経理部', 'billing@kumamoto-kyushoku.example.jp'),
      to: [me], subject: '【請求書送付】2026年7月分 給食委託費のご請求',
      date: now() - 5 * H, flags: ['\\Seen'],
      text: 'ラウレアハレ様\n\n平素より格別のお引き立てを賜り、誠にありがとうございます。\n2026年7月分の給食委託費につきまして、請求書を添付のとおりお送りいたします。\n\n請求金額：1,247,400円（税込）\nお支払期限：2026年8月31日\n\nご不明な点がございましたら、下記までお問い合わせください。\n\n株式会社くまもと給食サービス 経理部\nTEL 096-000-1111',
      attachments: [{ filename: '請求書_202607_ラウレアハレ様.pdf', contentType: 'application/pdf', content: makePdf('Invoice 2026-07', ['Kyushoku Service Co., Ltd.', 'Total: JPY 1,247,400', 'Due: 2026-08-31']) }],
    }),
    msg({
      from: from('熊本市 介護事業指導課', 'kaigo-shido@city.kumamoto.example.lg.jp'),
      to: [me], subject: '令和8年度 集団指導（住宅型有料老人ホーム）開催のお知らせ',
      date: now() - 26 * H, flags: ['\\Seen', '\\Flagged'],
      text: '各施設 管理者様\n\n令和8年度の集団指導を下記のとおり開催しますので、必ずご出席ください。\n\n日時：令和8年9月10日（木）14:00〜16:00\n会場：熊本市役所 別館ホール\n対象：住宅型有料老人ホーム 設置者・管理者\n\n当日は重要事項説明書の直近版を持参してください。\n出欠は8月25日までに電子申請システムから登録をお願いします。\n\n熊本市 介護事業指導課',
    }),
    msg({
      from: from('求人ナビ 応募通知', 'no-reply@kyujin-navi.example.com'),
      to: [me], subject: '【応募がありました】介護職員（正社員・夜勤あり）に1件の新規応募',
      date: now() - 28 * H,
      text: 'ラウレアハレ 採用ご担当者様\n\n掲載中の求人「介護職員（正社員・夜勤あり）」に新しい応募がありました。\n\n応募者：40代女性／介護福祉士／経験8年\n希望連絡時間帯：平日 10:00〜15:00\n\n応募者への連絡はお早めにお願いいたします。48時間以内の初回連絡で面接設定率が大きく向上します。\n\n▼応募者詳細はこちら\nhttps://example.com/applicants/12345',
    }),
    msg({
      from: from('熊本みなと病院 地域連携室', 'renkei@kumamoto-minato.example.jp'),
      to: [me], subject: '退院前カンファレンスのご案内（入居予定者様）',
      date: now() - 2 * D - 3 * H, flags: ['\\Seen'],
      text: 'ラウレアハレ ご担当者様\n\nお世話になっております。熊本みなと病院 地域連携室です。\n\n貴施設へ入居予定の患者様について、退院前カンファレンスを下記のとおり開催いたします。\n\n日時：8月20日（木）15:00〜\n場所：当院3階 カンファレンス室\n出席予定：主治医・病棟看護師・退院調整看護師・ケアマネジャー\n\n施設看護師様のご同席をお願いできれば幸いです。\nご都合をお知らせください。',
    }),
    msg({
      from: from('つばめ薬局 くまもと店', 'tsubame-ph@example.jp'),
      to: [me], subject: '処方変更のご連絡（304号室 入居者様）',
      date: now() - 2 * D - 6 * H, flags: ['\\Flagged'],
      text: 'ラウレアハレ 看護師様\n\nいつもお世話になっております。つばめ薬局です。\n\n本日受診分より、304号室の入居者様の処方が変更になりましたのでご連絡します。\n\n【変更内容】\n・降圧剤：アムロジピン 2.5mg → 5mg（朝1錠）\n・眠前の睡眠導入剤は中止\n\n次回配達は明日午前を予定しています。服薬セットの差し替えをお願いいたします。\n血圧の推移で気になる点があればご一報ください。',
    }),
    msg({
      from: from('介護経営ウィークリー編集部', 'newsletter@kaigo-weekly.example.com'),
      to: [me], subject: '【介護経営ウィークリー】処遇改善加算の算定率が過去最高に／2026年度改定の論点整理',
      date: now() - 3 * D, flags: ['\\Seen'],
      html: `<div style="margin:0;padding:0;background:#f4f4f5;font-family:sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 0;"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;">
<tr><td style="background:#134e4a;padding:28px 32px;">
<h1 style="margin:0;color:#ffffff;font-size:22px;">介護経営ウィークリー</h1>
<p style="margin:6px 0 0;color:#99f6e4;font-size:12px;">2026年8月第2週号</p></td></tr>
<tr><td style="padding:28px 32px;">
<img src="https://newsletter.example.com/img/header-2026-08.png" width="496" alt="今週の特集" style="border-radius:8px;">
<h2 style="font-size:17px;color:#134e4a;margin:20px 0 8px;">① 処遇改善加算、算定率が過去最高の94.2%に</h2>
<p style="font-size:14px;line-height:1.8;color:#374151;margin:0 0 16px;">厚労省の最新集計によると、介護職員等処遇改善加算の算定率が過去最高を更新。一方で「職場環境等要件」の実施内容の形骸化を指摘する声も上がっています。実地指導では実施記録の確認が増えており、記録の整備が急務です。</p>
<h2 style="font-size:17px;color:#134e4a;margin:20px 0 8px;">② 2026年度改定の論点</h2>
<p style="font-size:14px;line-height:1.8;color:#374151;margin:0 0 16px;">住宅型有料老人ホームにおける訪問介護の同一建物減算の見直し議論が本格化。収益構造への影響試算を早めに準備しておきましょう。</p>
<a href="https://example.com/weekly/2026-08-2" style="display:inline-block;background:#0d9488;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;">続きを読む</a>
</td></tr>
<tr><td style="padding:20px 32px;background:#f9fafb;color:#9ca3af;font-size:11px;">配信停止は<a href="https://example.com/unsubscribe" style="color:#0d9488;">こちら</a></td></tr>
</table></td></tr></table></div>`,
      text: '介護経営ウィークリー 2026年8月第2週号\n① 処遇改善加算、算定率が過去最高の94.2%に\n② 2026年度改定の論点',
    }),
    msg({
      from: from('あんしん損害保険 法人営業部', 'hojin@anshin-sonpo.example.co.jp'),
      to: [me], subject: '施設賠償責任保険 更新手続きのご案内（9月末満期）',
      date: now() - 4 * D, flags: ['\\Seen'],
      text: 'ラウレアハレ様\n\n平素より弊社保険をご利用いただきありがとうございます。\n\nご契約中の施設賠償責任保険が9月30日に満期を迎えます。\n更新のお手続きについて、来週あらためてお電話にてご案内いたします。\n\n補償内容の見直し（送迎中の事故補償の拡充など）もご提案可能です。\nご希望の日時がございましたら、本メールにご返信ください。',
    }),
    msg({
      from: from('夜勤リーダー 山本', 'yamamoto@silver-unix.demo'),
      to: [me], subject: '【申し送り】8/14 夜勤帯の報告（305号室 発熱）',
      date: now() - 4 * D - 8 * H, flags: ['\\Seen'],
      text: 'おつかれさまです。夜勤の山本です。\n\n8/14 夜勤帯の申し送りです。\n\n・305号室：22時の巡回時 37.8℃。クーリング実施し、朝5時には36.9℃まで解熱。朝食は全量摂取。日勤帯でも経過観察をお願いします。\n・301号室：ナースコール頻回（計6回）。不安の訴えあり、傾聴で落ち着かれました。\n・その他フロア異常なし。\n\nよろしくお願いします。',
    }),
  ];

  boxes.Junk = [
    msg({
      from: from('お得情報センター', 'spam@example-ad.com'),
      to: [me], subject: '【本日限定】介護施設向け備品が最大90%OFF！！今すぐクリック',
      date: now() - 1 * D,
      text: '本日限定の特別セールのご案内です。今すぐ以下のリンクをクリックしてください。\nhttps://example-ad.com/sale',
    }),
  ];

  boxes.Sent = [
    msg({
      from: me, to: [from('佐藤 恵子', 'keiko.sato@example.com')],
      subject: 'Re: 面会予約のお願い（母・佐藤トメ）',
      date: now() - 1 * H, flags: ['\\Seen'],
      text: '佐藤恵子様\n\nいつもお世話になっております。ラウレアハレでございます。\n\n16日（日）14時のご面会、承りました。\nお孫様もご一緒とのこと、トメ様もきっとお喜びになると思います。\n\n当日は1階受付にお声がけください。\nお気をつけてお越しくださいませ。',
    }),
    msg({
      from: me, to: [from('株式会社くまもと給食サービス 経理部', 'billing@kumamoto-kyushoku.example.jp')],
      subject: 'Re: 【請求書送付】2026年7月分 給食委託費のご請求',
      date: now() - 4 * H, flags: ['\\Seen'],
      text: 'くまもと給食サービス 経理部御中\n\nお世話になっております。\n請求書を確かに受領いたしました。期日までにお振込いたします。\n\n今後ともよろしくお願いいたします。',
    }),
  ];

  boxes.Drafts = [
    msg({
      from: me, to: [from('居宅介護支援事業所 ひまわり（田中）', 'himawari-cm@example.jp')],
      subject: 'Re: 【入居相談】要介護3の男性のご入居について',
      date: now() - 20 * 60 * 1000, flags: ['\\Draft', '\\Seen'],
      text: '田中様\n\nいつもお世話になっております。ラウレアハレでございます。\n\nお問い合わせいただいた件、下記のとおりご回答いたします。\n\n・空床状況：現在2室（トイレ付き個室）\n・インスリン注射：看護職員の配置時間内で対応可能です（詳細は面談にて）\n・月額費用：',
    }),
  ];

  return boxes;
}

function seedTakeshi() {
  const boxes = Object.fromEntries(MAILBOXES.map(b => [b.path, []]));
  const from = (name, address) => ({ name, address });
  const me = { name: 'TAKESHI（代表）', address: 'takeshi@silver-unix.demo' };

  boxes.INBOX = [
    msg({
      from: from('肥後みらい銀行 法人融資部 松田', 'matsuda@higo-mirai-bank.example.jp'),
      to: [me], subject: '設備資金のご融資について（面談日程のご相談）',
      date: now() - 50 * 60 * 1000, flags: ['\\Flagged'],
      text: 'シルバーユニックス株式会社\n代表取締役様\n\nいつもお世話になっております。肥後みらい銀行 法人融資部の松田です。\n\n先日ご相談いただきました設備資金（送迎車両の入替）の件、行内で前向きに検討を進めております。\n\nつきましては、事業計画の詳細を伺いたく、来週中に一度お時間をいただけないでしょうか。\n下記の候補日でご都合はいかがでしょうか。\n\n・8月19日（水）10:00〜\n・8月21日（金）14:00〜\n\n直近の試算表と資金繰り表をご準備いただけますと幸いです。',
    }),
    msg({
      from: from('みなみ税理士事務所', 'minami-tax@example.jp'),
      to: [me], subject: '2026年7月分 月次試算表の送付',
      date: now() - 7 * H, flags: ['\\Seen'],
      text: 'TAKESHI様\n\nお世話になっております。みなみ税理士事務所です。\n\n7月分の月次試算表を添付いたします。\n\n概況として、稼働率の改善により売上は前月比+3.2%。一方で水道光熱費が夏季で増加しています。\n詳細は次回の定例でご説明します。\n\nよろしくお願いいたします。',
      attachments: [{ filename: '月次試算表_202607.pdf', contentType: 'application/pdf', content: makePdf('Trial Balance 2026-07', ['Silver Unix Co., Ltd.', 'Sales: +3.2% MoM', 'Utilities: increased (summer)']) }],
    }),
    msg({
      from: from('熊本県薬剤師会 研修担当', 'kenshu@kuma-yaku.example.or.jp'),
      to: [me], subject: '【ご案内】高齢者のポリファーマシー対策研修会（9月開催）',
      date: now() - 30 * H,
      text: '会員各位\n\n熊本県薬剤師会より研修会のご案内です。\n\nテーマ：高齢者のポリファーマシー対策 —施設現場での減薬の進め方—\n日時：9月18日（金）19:00〜20:30\n形式：オンライン（Zoom）\n単位：日病薬病院薬学認定 1単位\n\n参加をご希望の方は9月10日までに会員ページからお申し込みください。',
    }),
    msg({
      from: from('中村（くまもと経営者会）', 'nakamura@example.com'),
      to: [me], subject: '来月の定例会、日程きまりました',
      date: now() - 3 * D - 2 * H, flags: ['\\Seen'],
      text: 'TAKESHIさん\n\nおつかれさまです。中村です。\n\n来月の定例会、9/5（金）19時から、いつもの店で決まりました。\n今回は事業承継をテーマに話そうという声が出ています。\n\n参加できそうか、返信もらえたら助かります。\nでは！',
    }),
    msg({
      from: from('カイゴ経営セミナー事務局', 'seminar@kaigo-keiei.example.com'),
      to: [me], subject: '【受講確認】9/2「小規模施設の増収戦略」セミナー',
      date: now() - 5 * D, flags: ['\\Seen'],
      html: `<div style="font-family:sans-serif;background:#ffffff;">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px;">
<table width="520" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
<tr><td style="background:#1e3a8a;padding:20px 28px;"><h2 style="margin:0;color:#fff;font-size:18px;">お申し込み確認</h2></td></tr>
<tr><td style="padding:24px 28px;">
<p style="font-size:14px;color:#111827;line-height:1.8;margin:0 0 16px;">以下のセミナーへのお申し込みを受け付けました。</p>
<table cellpadding="6" style="font-size:14px;color:#374151;border-collapse:collapse;">
<tr><td style="color:#6b7280;">セミナー</td><td><strong>小規模施設の増収戦略 —保険外サービスの設計—</strong></td></tr>
<tr><td style="color:#6b7280;">日時</td><td>2026年9月2日（水）14:00〜17:00</td></tr>
<tr><td style="color:#6b7280;">会場</td><td>熊本市国際交流会館 6F</td></tr>
<tr><td style="color:#6b7280;">受講料</td><td>18,000円（税込・請求書払い）</td></tr>
</table>
<p style="font-size:13px;color:#6b7280;line-height:1.7;margin:16px 0 0;">当日は名刺を2枚お持ちください。キャンセルは開催3日前まで無料です。</p>
</td></tr></table></td></tr></table></div>`,
      text: 'お申し込み確認\nセミナー：小規模施設の増収戦略\n日時：2026年9月2日（水）14:00〜17:00\n会場：熊本市国際交流会館 6F',
    }),
  ];

  boxes.Sent = [
    msg({
      from: me, to: [from('みなみ税理士事務所', 'minami-tax@example.jp')],
      subject: 'Re: 2026年7月分 月次試算表の送付',
      date: now() - 6 * H, flags: ['\\Seen'],
      text: 'みなみ先生\n\nお世話になっております。試算表ありがとうございます。\n\n水道光熱費の件、了解しました。デイの浴室ボイラーの稼働時間も一度見直してみます。\n定例は予定どおりでお願いします。',
    }),
  ];

  return boxes;
}

export function ensureDemoStore(accountId) {
  if (stores.has(accountId)) return stores.get(accountId);
  const boxes = accountId === 'demo-2' ? seedTakeshi() : seedInfo();
  stores.set(accountId, boxes);
  return boxes;
}

export function resetDemo() {
  stores.clear();
  uidCounter = 1000;
}

// ── imap.js と同じ操作インターフェース ─────────────────────────
export async function listMailboxes(account) {
  ensureDemoStore(account.id);
  return MAILBOXES.map(b => ({ ...b, delimiter: '/', parent: null }));
}

export async function findSpecial(account, use) {
  return MAILBOXES.find(b => b.specialUse === use) || null;
}

function getBox(account, path) {
  const boxes = ensureDemoStore(account.id);
  const box = boxes[path];
  if (!box) { const e = new Error('メールボックスが見つかりません'); e.status = 404; throw e; }
  return box;
}

function toRow(account, path, m) {
  return {
    accountId: account.id,
    mailbox: path,
    uid: m.uid,
    subject: m.subject || '',
    from: m.from,
    to: m.to,
    date: new Date(m.date).toISOString(),
    seen: m.flags.has('\\Seen'),
    flagged: m.flags.has('\\Flagged'),
    answered: m.flags.has('\\Answered'),
    draft: m.flags.has('\\Draft'),
    hasAttachment: m.attachments.length > 0,
    size: (m.text || '').length + m.attachments.reduce((s, a) => s + a.content.length, 0),
    messageId: m.messageId,
  };
}

export async function listMessages(account, path, { limit = 50, offset = 0, search = '', unseenOnly = false, flaggedOnly = false } = {}) {
  let items = [...getBox(account, path)];
  if (unseenOnly) items = items.filter(m => !m.flags.has('\\Seen'));
  if (flaggedOnly) items = items.filter(m => m.flags.has('\\Flagged'));
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(m =>
      (m.subject || '').toLowerCase().includes(q)
      || (m.from?.name || '').toLowerCase().includes(q)
      || (m.from?.address || '').toLowerCase().includes(q)
      || (m.text || '').toLowerCase().includes(q));
  }
  items.sort((a, b) => b.date - a.date);
  const total = items.length;
  const rows = items.slice(offset, offset + limit).map(m => toRow(account, path, m));
  return { rows, total };
}

export async function getPreviews(account, path, uids) {
  const box = getBox(account, path);
  const result = {};
  for (const uid of uids) {
    const m = box.find(x => x.uid === Number(uid));
    result[uid] = m ? (m.text || '').replace(/\s+/g, ' ').trim().slice(0, 140) : '';
  }
  return result;
}

export async function getMessage(account, path, uid, { markSeen = true } = {}) {
  const box = getBox(account, path);
  const m = box.find(x => x.uid === Number(uid));
  if (!m) { const e = new Error('メッセージが見つかりません'); e.status = 404; throw e; }
  if (markSeen) m.flags.add('\\Seen');
  // mailparser互換の形へ
  const parsed = {
    subject: m.subject,
    from: { value: [m.from] },
    to: { value: m.to },
    cc: { value: m.cc || [] },
    replyTo: undefined,
    date: new Date(m.date),
    messageId: m.messageId,
    inReplyTo: m.inReplyTo,
    references: m.references,
    html: m.html || false,
    text: m.text || '',
    attachments: m.attachments.map(a => ({ ...a, size: a.content.length, contentDisposition: 'attachment' })),
  };
  return { parsed, flags: m.flags };
}

export async function getAttachment(account, path, uid, index) {
  const box = getBox(account, path);
  const m = box.find(x => x.uid === Number(uid));
  const att = m?.attachments[index];
  if (!att) { const e = new Error('添付ファイルが見つかりません'); e.status = 404; throw e; }
  return { ...att, size: att.content.length };
}

export async function setFlags(account, path, uids, flags, add) {
  const box = getBox(account, path);
  for (const uid of uids) {
    const m = box.find(x => x.uid === Number(uid));
    if (!m) continue;
    for (const f of flags) add ? m.flags.add(f) : m.flags.delete(f);
  }
  return { ok: true };
}

export async function moveMessages(account, path, uids, targetPath) {
  const box = getBox(account, path);
  const target = getBox(account, targetPath);
  const ids = new Set(uids.map(Number));
  const moved = box.filter(m => ids.has(m.uid));
  for (const m of moved) box.splice(box.indexOf(m), 1);
  target.push(...moved);
  return { ok: true };
}

export async function deleteMessages(account, path, uids) {
  if (path === 'Trash') {
    const box = getBox(account, path);
    const ids = new Set(uids.map(Number));
    stores.get(account.id).Trash = box.filter(m => !ids.has(m.uid));
    return { ok: true };
  }
  return moveMessages(account, path, uids, 'Trash');
}

export async function getStatus(account, path) {
  const box = getBox(account, path);
  return { unseen: box.filter(m => !m.flags.has('\\Seen')).length, total: box.length };
}

// デモの送信 — Sentへ格納するだけ（外部送信はしない）
export async function sendMail(account, message) {
  const box = getBox(account, 'Sent');
  const signature = account.signature && message.appendSignature !== false ? `\n\n${account.signature}` : '';
  box.push(msg({
    from: { name: account.name, address: account.email },
    to: parseAddressList(message.to),
    cc: parseAddressList(message.cc),
    subject: message.subject || '',
    date: now(), flags: ['\\Seen'],
    text: `${message.text || ''}${signature}`,
    inReplyTo: message.inReplyTo,
    attachments: (message.attachments || []).map(a => ({
      filename: a.filename, contentType: a.contentType || 'application/octet-stream',
      content: Buffer.from(a.contentBase64, 'base64'),
    })),
  }));
  return { ok: true, messageId: `<demo-sent-${Date.now()}@demo.silvermail>`, savedToSent: true, demo: true };
}

export async function saveDraft(account, message) {
  const box = getBox(account, 'Drafts');
  box.push(msg({
    from: { name: account.name, address: account.email },
    to: parseAddressList(message.to),
    subject: message.subject || '',
    date: now(), flags: ['\\Draft', '\\Seen'],
    text: message.text || '',
  }));
  return { ok: true, mailbox: 'Drafts' };
}

function parseAddressList(v) {
  if (!v) return [];
  return String(v).split(/[,;]/).map(s => s.trim()).filter(Boolean)
    .map(s => {
      const m = s.match(/^(.*?)\s*<([^>]+)>$/);
      return m ? { name: m[1].replace(/^"|"$/g, ''), address: m[2] } : { name: '', address: s };
    });
}

// ── デモ用のカレンダー / ToDo ────────────────────────────────
// 起動時に「このMacの予定」へ入れるサンプル。実データがある場合は入れない。
const atDay = (offset, hh, mm = 0) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  d.setHours(hh, mm, 0, 0);
  return d.toISOString();
};
const allDayOf = (offset, days = 1) => {
  const s = new Date(); s.setDate(s.getDate() + offset); s.setHours(0, 0, 0, 0);
  const e = new Date(s); e.setDate(e.getDate() + days);
  return { start: s.toISOString(), end: e.toISOString(), allDay: true };
};

export function demoEvents() {
  return [
    { title: '朝礼・申し送り', start: atDay(0, 9, 0), end: atDay(0, 9, 30), allDay: false, location: '1階 スタッフルーム' },
    { title: 'ご家族面談（佐藤様）', start: atDay(0, 14, 0), end: atDay(0, 15, 0), allDay: false, location: '相談室', description: '302号室 佐藤トメ様のご長女との面談' },
    { title: '事故防止委員会', start: atDay(-1, 16, 0), end: atDay(-1, 17, 0), allDay: false, location: '会議室' },
    { title: 'サービス担当者会議', start: atDay(1, 13, 30), end: atDay(1, 14, 30), allDay: false, location: 'オンライン' },
    { title: '訪問診療 立ち会い', start: atDay(2, 9, 0), end: atDay(2, 10, 0), allDay: false, location: '各居室' },
    { title: '夏季レクリエーション', ...allDayOf(3), location: '中庭' },
    { title: '設備資金のご相談（肥後みらい銀行）', start: atDay(5, 15, 0), end: atDay(5, 16, 0), allDay: false, location: '本店 法人融資部' },
    { title: '集団指導（住宅型有料老人ホーム）', ...allDayOf(9), location: '熊本市役所' },
  ];
}

export function demoTasks() {
  return [
    { title: '面会予約のお願いに返信する', due: atDay(0, 0), notes: '佐藤恵子様（302号室 佐藤トメ様のご長女）' },
    { title: '7月分 給食委託費の請求書を確認して振込', due: atDay(1, 0) },
    { title: '集団指導の提出資料を印刷しておく', due: atDay(8, 0) },
    { title: '処遇改善加算の実績報告の準備', due: null },
    { title: '9月のシフト表を配布する', due: atDay(-2, 0), done: true },
  ];
}
