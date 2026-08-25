// カレンダーの接続設定 — Googleカレンダー（OAuth）／iCal URLの購読／このMac内
import React, { useState, useEffect, useRef } from 'react';
import { Modal, Spinner, Switch, ConfirmDialog } from '../common.jsx';
import { Icon } from '../icons.jsx';
import { cx } from '../util.js';
import { api } from '../api.js';
import { ACCOUNT_COLORS } from '../util.js';

const GOOGLE_CONSOLE = 'https://console.cloud.google.com/apis/credentials';

function GoogleConnect({ redirectUri, onConnected, onError }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ clientId: '', clientSecret: '' });
  const [phase, setPhase] = useState('idle'); // idle | checking | waiting
  const [result, setResult] = useState(null); // {ok, message}
  const pollRef = useRef(null);

  useEffect(() => () => clearInterval(pollRef.current), []);

  // 入力を変えたら前回の判定は消す（古い結果が残って紛らわしいため）
  const set = (patch) => { setForm(f => ({ ...f, ...patch })); setResult(null); };

  // ブラウザを開かずに、IDとシークレットの組み合わせだけを確かめる
  const verify = async () => {
    if (!form.clientId.trim()) { onError('クライアントIDを入力してください'); return; }
    setPhase('checking');
    setResult(null);
    try {
      setResult(await api.googleVerify(form.clientId.trim(), form.clientSecret.trim()));
    } catch (err) {
      setResult({ ok: false, message: err.message });
    } finally {
      setPhase('idle');
    }
  };

  const start = async () => {
    if (!form.clientId.trim()) { onError('クライアントIDを入力してください'); return; }
    setResult(null);
    try {
      const r = await api.googleStart(form.clientId.trim(), form.clientSecret.trim());
      setPhase('waiting');
      window.open(r.authUrl, 'silvermail-google', 'width=520,height=680');
      clearInterval(pollRef.current);
      pollRef.current = setInterval(async () => {
        try {
          const s = await api.googleStatus(r.state);
          if (s.status === 'done') {
            clearInterval(pollRef.current);
            setPhase('idle');
            setOpen(false);
            setForm({ clientId: '', clientSecret: '' });
            onConnected(s.sources);
          } else if (s.status === 'error' || s.status === 'expired') {
            clearInterval(pollRef.current);
            setPhase('idle');
            onError(s.error || '連携の手続きが期限切れになりました。もう一度お試しください。');
          }
        } catch { /* ポーリング失敗は次回に任せる */ }
      }, 1500);
    } catch (err) {
      // 失敗の理由は消えないよう画面に残す
      setResult({ ok: false, message: err.message });
      setPhase('idle');
    }
  };

  return (
    <div className={cx('src-card', open && 'open')}>
      <button className="src-card-head" onClick={() => setOpen(v => !v)}>
        <span className="glyph google"><Icon name="google" size={17} /></span>
        <span className="txt">
          <span className="nm">Googleカレンダー / Google ToDo を接続</span>
          <span className="d">予定の閲覧・追加・変更まで行えます（Googleの許可画面が開きます）</span>
        </span>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} />
      </button>

      {open && (
        <div className="src-card-body">
          <ol className="setup-steps">
            <li>
              <a href={GOOGLE_CONSOLE} target="_blank" rel="noreferrer">Google Cloud Console<Icon name="link" size={12} /></a>
              を開き、プロジェクトで <b>Google Calendar API</b> と <b>Google Tasks API</b> を有効にします
            </li>
            <li>「OAuth同意画面」で User Type を選びます（Google Workspaceなら<b>内部</b>が手間なし）</li>
            <li>「認証情報を作成」→「OAuth クライアント ID」→ 種類は<b>ウェブ アプリケーション</b>を選びます</li>
            <li>「承認済みのリダイレクト URI」に下のURLを<b>そのまま</b>登録します</li>
            <li>表示された<b>クライアントID</b>と<b>クライアントシークレット</b>を下に貼り付け、「設定を確認」を押します</li>
          </ol>
          <div className="redirect-note">
            <span>承認済みのリダイレクト URI（末尾にスラッシュを付けないでください）</span>
            <code>{redirectUri}</code>
          </div>

          <div className="field">
            <label>クライアントID</label>
            <input
              placeholder="000000000000-xxxxxxxx.apps.googleusercontent.com"
              value={form.clientId} onChange={(e) => set({ clientId: e.target.value })}
            />
          </div>
          <div className="field">
            <label>クライアントシークレット</label>
            <input
              type="password" placeholder="GOCSPX-…"
              value={form.clientSecret} onChange={(e) => set({ clientSecret: e.target.value })}
            />
            <div className={cx('hint', !form.clientSecret.trim() && form.clientId.trim() && 'warn')}>
              {!form.clientSecret.trim() && form.clientId.trim()
                ? '「ウェブ アプリケーション」で作成した場合、シークレットは必須です。'
                : 'Macのキーチェーンに保存されます。リポジトリやファイルに平文で残りません。'}
            </div>
          </div>

          {result && (
            <div className={cx('verify-result', result.ok ? 'ok' : 'ng')}>
              <Icon name={result.ok ? 'check' : 'warn'} size={15} className="ic" />
              <span>{result.message}</span>
            </div>
          )}

          <div className="btn-row">
            <button className="btn secondary" onClick={verify} disabled={phase !== 'idle'}>
              {phase === 'checking' ? <><Spinner small /> 確認中…</> : '設定を確認'}
            </button>
            <button className="btn primary" onClick={start} disabled={phase !== 'idle'}>
              {phase === 'waiting' ? <><Spinner small /> Googleの許可を待っています…</> : 'Googleにログインして許可する'}
            </button>
          </div>
          {phase === 'waiting' && (
            <div className="hint" style={{ marginTop: 8 }}>
              別ウインドウでGoogleのログイン画面が開きます。表示されない場合はポップアップの許可をご確認ください。
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function IcsConnect({ onAdded, onError }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', url: '' });
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!form.url.trim()) { onError('カレンダーのURLを入力してください'); return; }
    setBusy(true);
    try {
      const r = await api.addIcsSource(form.name.trim() || '購読カレンダー', form.url.trim(), '#BF5AF2');
      setForm({ name: '', url: '' });
      setOpen(false);
      onAdded(r.sources);
    } catch (err) {
      onError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={cx('src-card', open && 'open')}>
      <button className="src-card-head" onClick={() => setOpen(v => !v)}>
        <span className="glyph ics"><Icon name="link" size={17} /></span>
        <span className="txt">
          <span className="nm">URLで購読する（iCal / .ics）</span>
          <span className="d">設定なしですぐ使えます。表示のみで、予定の追加はできません</span>
        </span>
        <Icon name={open ? 'chevD' : 'chevR'} size={14} />
      </button>
      {open && (
        <div className="src-card-body">
          <div className="hint" style={{ marginBottom: 10 }}>
            Googleカレンダーの場合: 該当カレンダーの「設定と共有」→「カレンダーの統合」→
            <b>限定公開URL（iCal形式）</b>をコピーして貼り付けます。
          </div>
          <div className="field">
            <label>表示名</label>
            <input placeholder="施設の行事予定" value={form.name} onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))} />
          </div>
          <div className="field">
            <label>カレンダーURL</label>
            <input placeholder="https://calendar.google.com/calendar/ical/.../basic.ics" value={form.url} onChange={(e) => setForm(f => ({ ...f, url: e.target.value }))} />
          </div>
          <button className="btn primary" onClick={add} disabled={busy}>{busy ? <Spinner small /> : '追加する'}</button>
        </div>
      )}
    </div>
  );
}

function SourceRow({ source, onChange, onDelete, onSync, onError }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);

  const patch = async (body) => {
    setBusy(true);
    try { onChange((await api.updateSource(source.id, body)).sources); }
    catch (err) { onError(err.message); }
    finally { setBusy(false); }
  };

  const sync = async () => {
    setBusy(true);
    try { onSync((await api.syncSource(source.id)).sources); }
    catch (err) { onError(err.message); }
    finally { setBusy(false); }
  };

  const kindLabel = source.type === 'google' ? 'Google' : source.type === 'ics' ? '購読URL' : 'このMac';

  return (
    <div className="src-row">
      <div className="src-main">
        <span className="dot" style={{ background: source.color }} />
        <div className="src-txt">
          <div className="nm">{source.name}</div>
          <div className="d">
            {kindLabel}
            {source.type === 'google' && source.calendars?.length > 0 && `・${source.calendars.filter(c => c.selected !== false).length}/${source.calendars.length}件を表示`}
            {source.type === 'ics' && source.url && `・${source.url.replace(/^https?:\/\//, '').slice(0, 42)}…`}
          </div>
        </div>
        {busy && <Spinner small />}
        <Switch on={source.enabled !== false} onChange={(v) => patch({ enabled: v })} />
        {source.type !== 'local' && (
          <button className="iconbtn" title="削除" onClick={onDelete}><Icon name="trash" size={15} /></button>
        )}
        <button className="iconbtn" title="詳細" onClick={() => setExpanded(v => !v)}>
          <Icon name={expanded ? 'chevD' : 'chevR'} size={14} />
        </button>
      </div>

      {expanded && (
        <div className="src-detail">
          <div className="field">
            <label>表示名</label>
            <input defaultValue={source.name} onBlur={(e) => e.target.value !== source.name && patch({ name: e.target.value })} />
          </div>
          <div className="field">
            <label>色</label>
            <div className="color-row">
              {ACCOUNT_COLORS.map(c => (
                <button
                  key={c} className={cx('swatch', source.color === c && 'on')}
                  style={{ background: c }} onClick={() => patch({ color: c })} aria-label={`色 ${c}`}
                />
              ))}
            </div>
          </div>
          {source.type === 'google' && (
            <>
              <div className="field">
                <label>表示するカレンダー</label>
                <div className="cal-checks">
                  {(source.calendars || []).map(c => (
                    <label className="inline-check" key={c.id}>
                      <input
                        type="checkbox" checked={c.selected !== false}
                        onChange={(e) => patch({ calendars: [{ id: c.id, selected: e.target.checked }] })}
                      />
                      <span className="sw" style={{ background: c.color || source.color }} />
                      <span>{c.summary}</span>
                      {c.accessRole !== 'owner' && c.accessRole !== 'writer' && <span className="ro">閲覧のみ</span>}
                    </label>
                  ))}
                  {(source.calendars || []).length === 0 && <div className="hint">カレンダーが取得できていません。「一覧を取り直す」を押してください。</div>}
                </div>
              </div>
              <button className="btn secondary sm" onClick={sync}>カレンダー一覧を取り直す</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function CalendarSourceModal({ sources, redirectUri, onChanged, onClose, toast }) {
  const [confirm, setConfirm] = useState(null);
  const onError = (m) => toast(m, 'error');

  const remove = async (source) => {
    setConfirm(null);
    try {
      const r = await api.deleteSource(source.id);
      onChanged(r.sources);
      toast(`${source.name} を削除しました`, 'success');
    } catch (err) { onError(err.message); }
  };

  return (
    <Modal title="カレンダーとToDoの接続" icon="calendar" onClose={onClose} className="source-modal">
      <div className="modal-body">
        <div className="src-list">
          {sources.map(s => (
            <SourceRow
              key={s.id} source={s}
              onChange={onChanged} onSync={onChanged} onError={onError}
              onDelete={() => setConfirm(s)}
            />
          ))}
        </div>

        <div className="section-label">追加する</div>
        <GoogleConnect
          redirectUri={redirectUri}
          onConnected={(next) => { onChanged(next); toast('Googleカレンダーに接続しました', 'success'); }}
          onError={onError}
        />
        <IcsConnect
          onAdded={(next) => { onChanged(next); toast('カレンダーを追加しました', 'success'); }}
          onError={onError}
        />
      </div>

      <div className="modal-foot">
        <span className="spacer" />
        <button className="btn primary" onClick={onClose}>閉じる</button>
      </div>

      {confirm && (
        <ConfirmDialog
          title="カレンダーを削除しますか？"
          message={`${confirm.name} の連携を解除します。Google側の予定は消えません（このMac内の予定は削除されます）。`}
          confirmLabel="削除" danger
          onConfirm={() => remove(confirm)} onCancel={() => setConfirm(null)}
        />
      )}
    </Modal>
  );
}
