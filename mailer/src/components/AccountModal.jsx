// アカウント追加/編集モーダル — プロバイダプリセット・自動検出・接続テスト
import React, { useState } from 'react';
import { Icon } from '../icons.jsx';
import { EMAIL_RE, ACCOUNT_COLORS } from '../util.js';
import { Modal, Spinner, ConfirmDialog, useToast } from '../common.jsx';
import { api } from '../api.js';

const PRESETS = [
  {
    key: 'gmail', label: 'Gmail', glyph: 'G', color: '#EA4335',
    desc: 'アプリパスワードが必要',
    imap: { host: 'imap.gmail.com', port: 993, secure: true },
    smtp: { host: 'smtp.gmail.com', port: 465, secure: true },
    skipSentAppend: true,
    note: 'Googleアカウントで2段階認証を有効にし、「アプリパスワード」を作成して入力してください（Googleアカウント → セキュリティ → 2段階認証プロセス → アプリパスワード）。',
  },
  {
    key: 'icloud', label: 'iCloud メール', glyph: '', color: '#3693F3',
    desc: 'アプリ用パスワードが必要',
    imap: { host: 'imap.mail.me.com', port: 993, secure: true },
    smtp: { host: 'smtp.mail.me.com', port: 587, secure: false },
    note: 'appleid.apple.com にサインインし、「アプリ用パスワード」を発行して入力してください。',
  },
  {
    key: 'yahoo', label: 'Yahoo!メール', glyph: 'Y!', color: '#720E9E',
    desc: 'IMAPアクセスを有効化',
    imap: { host: 'imap.mail.yahoo.co.jp', port: 993, secure: true },
    smtp: { host: 'smtp.mail.yahoo.co.jp', port: 465, secure: true },
    note: 'Yahoo!メールの設定画面で「IMAP・POP・SMTPアクセス」を有効にしてください。',
  },
  {
    key: 'outlook', label: 'Outlook / Microsoft 365', glyph: 'O', color: '#0078D4',
    desc: '組織アカウント向け',
    imap: { host: 'outlook.office365.com', port: 993, secure: true },
    smtp: { host: 'smtp.office365.com', port: 587, secure: false },
    note: '個人のOutlook.comは基本認証が廃止されたため接続できない場合があります。Microsoft 365（組織）は管理者がIMAP/SMTP AUTHを許可している場合に利用できます。',
  },
  {
    key: 'custom', label: 'その他', glyph: '@', color: '#8E8E93',
    desc: '独自ドメイン・レンタルサーバー',
    imap: { host: '', port: 993, secure: true },
    smtp: { host: '', port: 465, secure: true },
    note: 'Xserver・さくら・ロリポップ等のレンタルサーバーや会社のメールに。サーバー情報が不明な場合は「サーバーを自動検出」をお試しください。',
  },
];

export function AccountModal({ mode, account, accountCount, onClose, onSaved, onDeleted }) {
  const toast = useToast();
  const isEdit = mode === 'edit';
  const [step, setStep] = useState(isEdit ? 'form' : 'provider');
  const [preset, setPreset] = useState(isEdit ? null : PRESETS[0]);
  const [form, setForm] = useState(() => (isEdit
    ? {
        name: account.name || '', email: account.email || '', user: account.user || '',
        password: '',
        imapHost: account.imap?.host || '', imapPort: account.imap?.port || 993, imapSecure: account.imap?.secure !== false,
        smtpHost: account.smtp?.host || '', smtpPort: account.smtp?.port || 465, smtpSecure: account.smtp?.secure !== false,
        color: account.color || ACCOUNT_COLORS[0], signature: account.signature || '',
        skipSentAppend: Boolean(account.skipSentAppend),
      }
    : {
        name: '', email: '', user: '', password: '',
        imapHost: '', imapPort: 993, imapSecure: true,
        smtpHost: '', smtpPort: 465, smtpSecure: true,
        color: ACCOUNT_COLORS[accountCount % ACCOUNT_COLORS.length], signature: '',
        skipSentAppend: false,
      }));
  const [advanced, setAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [forceAdd, setForceAdd] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [fieldErr, setFieldErr] = useState({});

  const set = (k, v) => { setForm(f => ({ ...f, [k]: v })); setTestResult(null); };

  const choosePreset = (p) => {
    setPreset(p);
    setForm(f => ({
      ...f,
      imapHost: p.imap.host, imapPort: p.imap.port, imapSecure: p.imap.secure,
      smtpHost: p.smtp.host, smtpPort: p.smtp.port, smtpSecure: p.smtp.secure,
      skipSentAppend: Boolean(p.skipSentAppend),
    }));
    setStep('form');
  };

  const buildAccount = () => ({
    ...(isEdit ? { id: account.id } : {}),
    name: form.name.trim() || form.email.split('@')[0],
    email: form.email.trim(),
    user: form.user.trim() || undefined,
    color: form.color,
    signature: form.signature,
    skipSentAppend: form.skipSentAppend,
    imap: { host: form.imapHost.trim(), port: Number(form.imapPort) || 993, secure: form.imapSecure },
    smtp: { host: form.smtpHost.trim(), port: Number(form.smtpPort) || 465, secure: form.smtpSecure },
  });

  // Gmail・iCloudは「アプリパスワード」（16文字）が必須。通常のログインパスワードを
  // 入れて拒否されるのが最も多い失敗なので、入力段階で気づけるようにする。
  const appPwProvider = /(^|\.)gmail\.com$/i.test(form.imapHost.trim()) ? 'Google'
    : /(^|\.)(icloud|me)\.com$/i.test(form.imapHost.trim()) ? 'Apple' : null;
  // 表示上の区切り（Googleは空白、Appleはハイフン）は入力に含まれても無視してよい
  const normalizedPassword = appPwProvider ? form.password.replace(/[\s-]/g, '') : form.password;
  const appPwWarning = appPwProvider && normalizedPassword.length > 0 && normalizedPassword.length !== 16
    ? `${appPwProvider}のアプリパスワードは16文字です（入力は${normalizedPassword.length}文字）。`
      + '通常のログインパスワードでは接続できません。'
    : null;

  const validate = () => {
    const errs = {};
    if (!EMAIL_RE.test(form.email.trim())) errs.email = 'メールアドレスの形式が正しくありません';
    if (!isEdit && !form.password) errs.password = 'パスワードを入力してください';
    if (!form.imapHost.trim()) errs.imapHost = '受信サーバーを入力してください';
    if (!form.smtpHost.trim()) errs.smtpHost = '送信サーバーを入力してください';
    setFieldErr(errs);
    return Object.keys(errs).length === 0;
  };

  const detect = async () => {
    if (!EMAIL_RE.test(form.email.trim())) {
      setFieldErr({ email: '先にメールアドレスを入力してください' });
      return;
    }
    setDetecting(true);
    try {
      const r = await api.autodetect(form.email.trim());
      if (r.imap || r.smtp) {
        setForm(f => ({
          ...f,
          imapHost: r.imap?.host || f.imapHost, imapPort: r.imap?.port || f.imapPort,
          imapSecure: r.imap ? r.imap.secure : f.imapSecure,
          smtpHost: r.smtp?.host || f.smtpHost, smtpPort: r.smtp?.port || f.smtpPort,
          smtpSecure: r.smtp ? r.smtp.secure : f.smtpSecure,
        }));
        toast('サーバーを検出しました。接続テストで確認してください', 'success');
      } else {
        toast('サーバーを自動検出できませんでした。プロバイダの設定情報をご確認ください', 'error');
      }
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setDetecting(false);
    }
  };

  const runTest = async () => {
    if (!validate()) return null;
    setTesting(true);
    setTestResult(null);
    try {
      const body = { account: buildAccount(), password: normalizedPassword || undefined };
      if (isEdit && !form.password) body.accountId = account.id;
      const r = await api.testAccount(body.account, body.password, body.accountId);
      setTestResult(r);
      return r;
    } catch (err) {
      setTestResult({ imap: { ok: false, error: err.message }, smtp: { ok: false, error: err.message } });
      return null;
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      let result = testResult;
      if (!isEdit && !forceAdd && (!result || !result.imap?.ok)) {
        result = await runTest();
        if (!result?.imap?.ok) { setSaving(false); return; }
      }
      const acct = buildAccount();
      if (isEdit) await api.updateAccount(account.id, acct, normalizedPassword || undefined);
      else await api.saveAccount(acct, normalizedPassword);
      toast(isEdit ? 'アカウントを更新しました' : 'アカウントを追加しました', 'success');
      onSaved();
    } catch (err) {
      toast(err.message, 'error');
      setSaving(false);
    }
  };

  const field = (label, key, props = {}, hint) => (
    <div className="field">
      <label>{label}</label>
      <input
        type={props.type || 'text'}
        value={form[key]}
        className={fieldErr[key] ? 'invalid' : ''}
        onChange={e => set(key, e.target.value)}
        {...props}
      />
      {fieldErr[key] && <div className="err">{fieldErr[key]}</div>}
      {hint && !fieldErr[key] && <div className="hint">{hint}</div>}
    </div>
  );

  return (
    <Modal
      title={isEdit ? 'アカウントを編集' : step === 'provider' ? 'アカウントを追加' : `${preset?.label} を追加`}
      icon={isEdit ? 'gear' : 'plus'}
      onClose={onClose}
    >
      {step === 'provider' && (
        <div className="modal-body">
          <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 14, lineHeight: 1.7 }}>
            メールプロバイダを選択してください。サーバー設定は自動で入力されます。
          </p>
          <div className="provider-grid">
            {PRESETS.map(p => (
              <button key={p.key} className="provider-card" onClick={() => choosePreset(p)}>
                <span className="glyph" style={{ background: p.color }}>{p.glyph}</span>
                <span>
                  <div className="nm">{p.label}</div>
                  <div className="d">{p.desc}</div>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 'form' && (
        <>
          <div className="modal-body">
            {preset?.note && (
              <div className="remote-banner" style={{ margin: '0 0 16px' }}>
                <Icon name="shield" size={15} className="ic" />
                <span className="txt">{preset.note}</span>
              </div>
            )}

            <div className="field-row">
              {field('表示名', 'name', { placeholder: '例）施設代表' })}
              {field('メールアドレス', 'email', { type: 'email', placeholder: 'you@example.com' })}
            </div>
            <div className="field">
              <label>パスワード</label>
              <input
                type="password"
                value={form.password}
                className={fieldErr.password ? 'invalid' : ''}
                autoComplete="new-password"
                placeholder={isEdit ? '（変更する場合のみ入力）'
                  : appPwProvider ? 'アプリパスワード（16文字）' : 'メールのパスワード'}
                onChange={e => set('password', e.target.value)}
              />
              {fieldErr.password && <div className="err">{fieldErr.password}</div>}
              {!fieldErr.password && appPwWarning && <div className="hint warn">{appPwWarning}</div>}
              {!fieldErr.password && !appPwWarning && isEdit && account.hasPassword
                && <div className="hint">保存済みのパスワードを使用中です</div>}
            </div>

            {preset?.key === 'custom' && (
              <div style={{ marginBottom: 14 }}>
                <button className="btn secondary" onClick={detect} disabled={detecting}>
                  {detecting ? <Spinner small /> : <Icon name="search" size={14} />}
                  サーバーを自動検出
                </button>
              </div>
            )}

            <div className="field-row">
              {field('受信サーバー（IMAP）', 'imapHost', { placeholder: 'imap.example.com' })}
              {field('ポート', 'imapPort', { type: 'number' })}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={form.imapSecure} onChange={e => set('imapSecure', e.target.checked)} />
              SSL/TLSを使用（通常はオン・ポート993）
            </label>

            <div className="field-row">
              {field('送信サーバー（SMTP）', 'smtpHost', { placeholder: 'smtp.example.com' })}
              {field('ポート', 'smtpPort', { type: 'number' })}
            </div>
            <label className="check-row">
              <input type="checkbox" checked={form.smtpSecure} onChange={e => set('smtpSecure', e.target.checked)} />
              SSL/TLSを使用（465はオン・587はオフ=STARTTLS）
            </label>

            <button className="btn ghost" style={{ padding: '4px 8px', marginBottom: 10 }} onClick={() => setAdvanced(v => !v)}>
              <Icon name={advanced ? 'chevD' : 'chevR'} size={12} />
              詳細設定
            </button>
            {advanced && (
              <>
                {field('ユーザー名', 'user', { placeholder: '（空欄の場合はメールアドレス）' })}
                <label className="check-row">
                  <input type="checkbox" checked={form.skipSentAppend} onChange={e => set('skipSentAppend', e.target.checked)} />
                  送信済みフォルダへの保存をサーバーに任せる（Gmail等）
                </label>
                <div className="field">
                  <label>署名</label>
                  <textarea rows={3} value={form.signature} onChange={e => set('signature', e.target.value)} placeholder="送信メールの末尾に自動で追加されます" />
                </div>
              </>
            )}

            {isEdit && (
              <div className="field">
                <label>アカウントカラー</label>
                <div className="color-swatches">
                  {ACCOUNT_COLORS.map(c => (
                    <button
                      key={c} className={form.color === c ? 'swatch on' : 'swatch'}
                      style={{ background: c }} aria-label={c}
                      onClick={() => set('color', c)}
                    />
                  ))}
                </div>
              </div>
            )}

            {testResult && (
              <div className={testResult.imap?.ok && testResult.smtp?.ok ? 'test-result ok' : 'test-result err'}>
                <div className="row">
                  <Icon name={testResult.imap?.ok ? 'check' : 'x'} size={14} />
                  <span>受信（IMAP）: {testResult.imap?.ok ? '接続できました' : testResult.imap?.error}</span>
                </div>
                <div className="row">
                  <Icon name={testResult.smtp?.ok ? 'check' : 'x'} size={14} />
                  <span>送信（SMTP）: {testResult.smtp?.ok ? '接続できました' : testResult.smtp?.error}</span>
                </div>
              </div>
            )}
            {!isEdit && testResult && !testResult.imap?.ok && (
              <label className="check-row" style={{ color: 'var(--text-2)' }}>
                <input type="checkbox" checked={forceAdd} onChange={e => setForceAdd(e.target.checked)} />
                テストに失敗しても追加する
              </label>
            )}
          </div>

          <div className="modal-foot">
            {!isEdit && step === 'form' && (
              <button className="btn ghost" onClick={() => { setStep('provider'); setTestResult(null); }}>
                ← 戻る
              </button>
            )}
            {isEdit && (
              <button className="btn danger-ghost" onClick={() => setConfirmDelete(true)}>削除…</button>
            )}
            <span className="spacer" />
            <button className="btn secondary" onClick={runTest} disabled={testing || saving}>
              {testing ? <Spinner small /> : null}
              {testing ? 'テスト中…' : '接続テスト'}
            </button>
            <button className="btn primary" onClick={save} disabled={saving || testing}>
              {saving ? <Spinner small /> : null}
              {saving ? '保存中…' : isEdit ? '保存' : '追加'}
            </button>
          </div>
        </>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="アカウントを削除"
          message={`「${account.name || account.email}」をSilverMailから削除しますか？ サーバー上のメールは削除されません。`}
          confirmLabel="削除"
          danger
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            try {
              await api.deleteAccount(account.id);
              toast('アカウントを削除しました', 'success');
              onDeleted();
            } catch (err) {
              toast(err.message, 'error');
            }
          }}
        />
      )}
    </Modal>
  );
}
