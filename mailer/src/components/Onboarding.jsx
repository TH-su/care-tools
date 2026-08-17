// 初回起動画面 — アカウント未設定時のウェルカム
import React, { useState } from 'react';
import { Icon } from '../icons.jsx';
import { Spinner, useToast } from '../common.jsx';
import { api } from '../api.js';

export function Onboarding({ onAddAccount, onDemoAdded }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const tryDemo = async () => {
    setBusy(true);
    try {
      await api.addDemo();
      await onDemoAdded();
    } catch (err) {
      toast(err.message, 'error');
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <div className="onboard-card">
        <div className="onboard-icon"><Icon name="mail" size={38} /></div>
        <h1>すべてのメールを、ひとつに。</h1>
        <p className="lead">
          SilverMailは、Gmail・iCloud・独自ドメインなど複数のメールアカウントを
          まとめて管理できる、あなたのMacのためのメールクライアントです。
        </p>
        <div className="actions">
          <button className="btn primary lg" onClick={onAddAccount}>
            <Icon name="plus" size={16} />
            アカウントを追加
          </button>
          <button className="btn secondary lg" onClick={tryDemo} disabled={busy}>
            {busy ? <Spinner small /> : <Icon name="sparkle" size={16} />}
            デモメールで試す
          </button>
        </div>
        <div className="onboard-features">
          <div className="onboard-feature">
            <span className="ic"><Icon name="inboxes" size={17} /></span>
            <span>
              <div className="t">統合受信ボックス</div>
              <div className="d">すべてのアカウントの受信メールを1つの一覧で。アカウントカラーでひと目で見分けられます。</div>
            </span>
          </div>
          <div className="onboard-feature">
            <span className="ic"><Icon name="shield" size={17} /></span>
            <span>
              <div className="t">プライバシー第一</div>
              <div className="d">パスワードはmacOSキーチェーンに保存。データはこのMacの外に出ません。リモート画像の追跡もブロックします。</div>
            </span>
          </div>
          <div className="onboard-feature">
            <span className="ic"><Icon name="keyboard" size={17} /></span>
            <span>
              <div className="t">キーボードで素早く</div>
              <div className="d">↑↓で移動、Eでアーカイブ、Rで返信、⌘Enterで送信。手を止めずにメールを片付けられます。</div>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
