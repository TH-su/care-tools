// 設定モーダル — アカウント管理と一般設定
import React, { useState } from 'react';
import { Icon } from '../icons.jsx';
import { Modal, Segmented, Switch, useToast } from '../common.jsx';
import { api } from '../api.js';

export function SettingsModal({
  accounts, settings, onChangeSettings, onEditAccount, onAddAccount, onClose, onAccountsChanged,
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const hasDemo = accounts.some(a => a.type === 'demo');

  const update = async (patch) => {
    onChangeSettings({ ...settings, ...patch }); // 楽観的更新
    try {
      await api.saveSettings(patch);
    } catch (err) {
      toast(`設定の保存に失敗: ${err.message}`, 'error');
    }
  };

  const toggleNotifications = async (on) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      if (p !== 'granted') {
        toast('ブラウザの通知が許可されませんでした', 'error');
        return;
      }
    }
    update({ notifications: on });
  };

  const toggleDemo = async () => {
    setBusy(true);
    try {
      if (hasDemo) await api.removeDemo();
      else await api.addDemo();
      await onAccountsChanged();
      toast(hasDemo ? 'デモアカウントを削除しました' : 'デモアカウントを追加しました', 'success');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="設定" icon="gear" onClose={onClose}>
      <div className="modal-body">
        <div className="settings-section">アカウント</div>
        {accounts.length === 0 && (
          <p style={{ fontSize: 12.5, color: 'var(--text-2)', margin: '4px 0 10px' }}>アカウントがまだありません。</p>
        )}
        {accounts.map(a => (
          <div className="acct-row" key={a.id}>
            <span className="dot" style={{ background: a.color, width: 11, height: 11 }} />
            <span className="info">
              <div className="nm">
                {a.name || a.email}
                {a.type === 'demo' && <span className="tag" style={{ marginLeft: 6 }}>デモ</span>}
                {settings.defaultAccountId === a.id && <span className="tag" style={{ marginLeft: 6 }}>既定</span>}
              </div>
              <div className="em">{a.email}</div>
            </span>
            {a.type !== 'demo' && settings.defaultAccountId !== a.id && (
              <button className="btn ghost" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => update({ defaultAccountId: a.id })}>
                既定にする
              </button>
            )}
            {a.type !== 'demo' && (
              <button className="btn secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => onEditAccount(a)}>
                編集
              </button>
            )}
          </div>
        ))}
        <button className="btn ghost" onClick={onAddAccount}>
          <Icon name="plus" size={14} />
          アカウントを追加
        </button>

        <div className="settings-section">一般</div>
        <div className="settings-row">
          <span className="lbl">
            <div className="t">外観</div>
            <div className="d">アプリのテーマを選択します</div>
          </span>
          <Segmented
            value={settings.theme}
            onChange={v => update({ theme: v })}
            options={[{ value: 'auto', label: '自動' }, { value: 'light', label: 'ライト' }, { value: 'dark', label: 'ダーク' }]}
          />
        </div>
        <div className="settings-row">
          <span className="lbl">
            <div className="t">新着メールのチェック間隔</div>
            <div className="d">この間隔で自動的に受信を確認します</div>
          </span>
          <select
            value={settings.checkIntervalMin}
            style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-strong)', background: 'var(--bg-app)' }}
            onChange={e => update({ checkIntervalMin: Number(e.target.value) })}
          >
            <option value={1}>1分ごと</option>
            <option value={3}>3分ごと</option>
            <option value={5}>5分ごと</option>
            <option value={15}>15分ごと</option>
          </select>
        </div>
        <div className="settings-row">
          <span className="lbl">
            <div className="t">リモート画像を常に読み込む</div>
            <div className="d">オフの場合、メール内の外部画像は「画像を読み込む」を押すまでブロックされます（推奨）</div>
          </span>
          <Switch on={settings.remoteImages === 'allow'} onChange={on => update({ remoteImages: on ? 'allow' : 'block' })} />
        </div>
        <div className="settings-row">
          <span className="lbl">
            <div className="t">新着メールのデスクトップ通知</div>
            <div className="d">新しいメールが届いたときに通知します</div>
          </span>
          <Switch on={Boolean(settings.notifications)} onChange={toggleNotifications} />
        </div>

        <div className="settings-section">デモ</div>
        <div className="settings-row">
          <span className="lbl">
            <div className="t">デモアカウント</div>
            <div className="d">サンプルメールでSilverMailの機能を試せます（実サーバーには接続しません）</div>
          </span>
          <button className="btn secondary" onClick={toggleDemo} disabled={busy}>
            {hasDemo ? '削除' : '追加'}
          </button>
        </div>

        <div className="settings-section">情報</div>
        <p style={{ fontSize: 12, color: 'var(--text-2)', lineHeight: 1.8 }}>
          SilverMail 1.0 — シルバーユニックス株式会社のためのローカルメールクライアント。<br />
          パスワードはmacOSキーチェーン（または <code>~/.silvermail/</code>）にのみ保存され、外部に送信されることはありません。
        </p>
      </div>
    </Modal>
  );
}
