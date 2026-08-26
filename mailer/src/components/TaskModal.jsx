// ToDoの詳細 — Google ToDo（Gmailのサイドパネル）と同じことが出来るようにする。
// タイトル・詳細・期限・保存先リスト・完了/未完了・削除、そして元メールの確認。
import React, { useState } from 'react';
import { Modal, Spinner } from '../common.jsx';
import { Icon } from '../icons.jsx';
import { cx } from '../util.js';
import { toDateInput, toTimeInput, fromInputs } from '../calendar-util.js';

const listKey = (l) => `${l.sourceId}|${l.listId}`;

export function TaskModal({ task, lists = [], busy, onSave, onDelete, onClose, onOpenMail }) {
  const isEdit = Boolean(task?.taskId);
  const current = lists.find(l => l.sourceId === task?.sourceId && l.listId === task?.listId) || lists[0];

  const [form, setForm] = useState({
    title: task?.title || '',
    notes: task?.notes || '',
    hasDue: Boolean(task?.due),
    dueDate: toDateInput(task?.due || new Date().toISOString()),
    dueTime: task?.due ? toTimeInput(task.due) : '09:00',
    withTime: Boolean(task?.due) && toTimeInput(task.due) !== '00:00',
    done: Boolean(task?.done),
    list: current ? listKey(current) : '',
  });
  const [error, setError] = useState(null);

  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  const target = lists.find(l => listKey(l) === form.list) || current;
  // Google ToDo は日付だけを持つ仕様で、時刻は保存されずに落ちる。黙って消えると驚くので先に伝える
  const googleDropsTime = target?.sourceType === 'google';

  const submit = () => {
    const title = form.title.trim();
    if (!title) { setError('タイトルを入力してください'); return; }
    const due = form.hasDue
      ? fromInputs(form.dueDate, form.withTime ? form.dueTime : '00:00')
      : null;
    onSave({
      title,
      notes: form.notes,
      due,
      done: form.done,
      list: target ? { sourceId: target.sourceId, listId: target.listId } : null,
    });
  };

  return (
    <Modal
      title={isEdit ? 'ToDoの詳細' : 'ToDoを追加'}
      icon="todo"
      onClose={onClose}
      className="task-modal"
    >
      <form className="modal-body" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <div className="task-title-row">
          <button
            type="button"
            className={cx('tick lg', form.done && 'on')}
            onClick={() => set({ done: !form.done })}
            title={form.done ? '未完了に戻す' : '完了にする'}
            aria-label={form.done ? '未完了に戻す' : '完了にする'}
          >
            <Icon name={form.done ? 'checkCircle' : 'circle'} size={22} />
          </button>
          <input
            className={cx('task-title-input', form.done && 'done')}
            placeholder="タイトル"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            autoFocus
          />
        </div>

        <div className="field">
          <label>詳細</label>
          <textarea
            rows={6}
            placeholder="メモ・手順・リンクなど"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>

        <div className="field">
          <label>期限</label>
          {form.hasDue ? (
            <div className="datetime-row">
              <input type="date" value={form.dueDate} onChange={(e) => set({ dueDate: e.target.value })} />
              {form.withTime
                ? (
                  <input type="time" step="300" value={form.dueTime} onChange={(e) => set({ dueTime: e.target.value })} />
                )
                : (
                  <button type="button" className="btn secondary sm" onClick={() => set({ withTime: true })}>
                    時刻を足す
                  </button>
                )}
              <button type="button" className="btn secondary sm" onClick={() => set({ hasDue: false, withTime: false })}>
                外す
              </button>
            </div>
          ) : (
            <button type="button" className="btn secondary sm" onClick={() => set({ hasDue: true })}>
              <Icon name="today" size={14} /> 期限を決める
            </button>
          )}
          {form.hasDue && form.withTime && googleDropsTime && (
            <div className="hint">Google ToDo は日付だけを保存します。時刻は残りません。</div>
          )}
        </div>

        <div className="field">
          <label>リスト</label>
          <select value={form.list} onChange={(e) => set({ list: e.target.value })}>
            {lists.length === 0 && <option value="">（リストがありません）</option>}
            {lists.map(l => (
              <option key={listKey(l)} value={listKey(l)}>{l.name}</option>
            ))}
          </select>
        </div>

        {task?.sourceMail && (
          <button type="button" className="mail-link" onClick={() => onOpenMail?.(task.sourceMail)}>
            <Icon name="mail" size={14} />
            <span className="ml-body">
              <span className="ml-sub">{task.sourceMail.subject || '（件名なし）'}</span>
              {task.sourceMail.from && <span className="ml-from">{task.sourceMail.from}</span>}
            </span>
            <span className="ml-go">開く</span>
          </button>
        )}

        {error && <div className="form-error">{error}</div>}
      </form>

      <div className="modal-foot">
        {isEdit && (
          <button className="btn danger-text" onClick={onDelete} disabled={busy}>削除</button>
        )}
        <span className="spacer" />
        <button className="btn secondary" onClick={onClose} disabled={busy}>キャンセル</button>
        <button className="btn primary" onClick={submit} disabled={busy || lists.length === 0}>
          {busy ? <Spinner small /> : (isEdit ? '保存' : '追加')}
        </button>
      </div>
    </Modal>
  );
}
