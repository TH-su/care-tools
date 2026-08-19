// 予定の作成・編集 — メールから開いたときは日時候補をワンタップで反映できる
import React, { useState, useMemo } from 'react';
import { Modal, Spinner } from '../common.jsx';
import { Icon } from '../icons.jsx';
import { cx } from '../util.js';
import {
  toDateInput, toTimeInput, fromInputs, fmtDayLabel, fmtTime, eventTimeLabel,
} from '../calendar-util.js';

const roundNext = (d) => {
  const x = new Date(d);
  x.setMinutes(x.getMinutes() > 30 ? 60 : 30, 0, 0);
  return x;
};

export function EventModal({ initial = {}, targets = [], hints = [], busy, onSave, onDelete, onClose, onOpenMail }) {
  const isEdit = Boolean(initial.eventId);
  const defaultStart = initial.start || roundNext(new Date()).toISOString();
  const defaultEnd = initial.end || new Date(new Date(defaultStart).getTime() + 3600000).toISOString();

  const [form, setForm] = useState({
    title: initial.title || '',
    allDay: Boolean(initial.allDay),
    startDate: toDateInput(defaultStart),
    startTime: toTimeInput(defaultStart),
    endDate: toDateInput(defaultEnd),
    endTime: toTimeInput(defaultEnd),
    location: initial.location || '',
    description: initial.description || '',
    attendees: (initial.attendees || []).map(a => a.email || a).join(', '),
    target: initial.sourceId
      ? `${initial.sourceId}|${initial.calendarId}`
      : (targets[0] ? `${targets[0].sourceId}|${targets[0].calendarId}` : ''),
  });
  const [error, setError] = useState(null);

  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  // 開始を動かしたら、それまでの所要時間を保ったまま終了もずらす
  const changeStart = (patch) => {
    const prevStart = fromInputs(form.startDate, form.startTime);
    const prevEnd = fromInputs(form.endDate, form.endTime);
    const next = { ...form, ...patch };
    const newStart = fromInputs(next.startDate, next.startTime);
    if (prevStart && prevEnd && newStart) {
      const span = Math.max(new Date(prevEnd) - new Date(prevStart), 0);
      const newEnd = new Date(new Date(newStart).getTime() + span);
      next.endDate = toDateInput(newEnd.toISOString());
      next.endTime = toTimeInput(newEnd.toISOString());
    }
    setForm(next);
  };

  const applyHint = (hint) => {
    setForm(f => ({
      ...f,
      allDay: Boolean(hint.allDay),
      startDate: toDateInput(hint.start),
      startTime: toTimeInput(hint.start),
      endDate: toDateInput(hint.end),
      endTime: toTimeInput(hint.end),
    }));
  };

  const targetInfo = useMemo(
    () => targets.find(t => `${t.sourceId}|${t.calendarId}` === form.target) || targets[0] || null,
    [targets, form.target],
  );
  const canInvite = targetInfo && targetInfo.sourceId !== 'local';

  const submit = (e) => {
    e?.preventDefault();
    if (!form.title.trim()) { setError('予定のタイトルを入力してください'); return; }
    if (!targetInfo) { setError('保存先のカレンダーがありません'); return; }
    const start = fromInputs(form.startDate, form.allDay ? '00:00' : form.startTime);
    let end = fromInputs(form.endDate, form.allDay ? '00:00' : form.endTime);
    if (!start || !end) { setError('日付を正しく入力してください'); return; }
    if (form.allDay && end <= start) end = new Date(new Date(start).getTime() + 86400000).toISOString();
    if (new Date(end) <= new Date(start)) { setError('終了は開始より後にしてください'); return; }
    setError(null);
    onSave({
      sourceId: targetInfo.sourceId,
      calendarId: targetInfo.calendarId,
      eventId: initial.eventId,
      event: {
        title: form.title.trim(),
        start,
        end,
        allDay: form.allDay,
        location: form.location.trim(),
        description: form.description,
        attendees: canInvite
          ? form.attendees.split(/[,、\s]+/).map(s => s.trim()).filter(s => s.includes('@'))
          : [],
        sourceMail: initial.sourceMail || undefined,
      },
    });
  };

  const preview = (() => {
    const s = fromInputs(form.startDate, form.allDay ? '00:00' : form.startTime);
    const e = fromInputs(form.endDate, form.allDay ? '00:00' : form.endTime);
    if (!s) return '';
    if (form.allDay) return `${fmtDayLabel(s)}${e && toDateInput(e) !== toDateInput(s) ? ` 〜 ${fmtDayLabel(e)}` : ''}・終日`;
    return `${fmtDayLabel(s)} ${fmtTime(s)}${e ? ` – ${fmtTime(e)}` : ''}`;
  })();

  return (
    <Modal
      title={isEdit ? '予定を編集' : '予定を作成'}
      icon="calendarPlus"
      onClose={onClose}
      className="event-modal"
    >
      <form className="modal-body" onSubmit={submit}>
        {hints.length > 0 && !isEdit && (
          <div className="hint-chips">
            <span className="hint-chips-label">
              <Icon name="sparkle" size={13} /> メールから読み取った日時
            </span>
            <div className="chips">
              {hints.map((hint, i) => (
                <button
                  type="button" key={i} className="chip"
                  onClick={() => applyHint(hint)}
                  title={hint.matched}
                >
                  {eventTimeLabel({ start: hint.start, end: hint.end, allDay: hint.allDay })}
                  <span className="chip-date">{fmtDayLabel(hint.start)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <input
            className="event-title" autoFocus placeholder="タイトルを入力"
            value={form.title} onChange={(e) => set({ title: e.target.value })}
          />
        </div>

        <div className="field row-between">
          <label className="inline-check">
            <input type="checkbox" checked={form.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
            <span>終日</span>
          </label>
          <span className="when-preview">{preview}</span>
        </div>

        <div className="field">
          <label>開始</label>
          <div className="datetime-row">
            <input type="date" value={form.startDate} onChange={(e) => changeStart({ startDate: e.target.value })} />
            {!form.allDay && (
              <input type="time" step="300" value={form.startTime} onChange={(e) => changeStart({ startTime: e.target.value })} />
            )}
          </div>
        </div>

        <div className="field">
          <label>終了</label>
          <div className="datetime-row">
            <input type="date" value={form.endDate} onChange={(e) => set({ endDate: e.target.value })} />
            {!form.allDay && (
              <input type="time" step="300" value={form.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            )}
          </div>
        </div>

        <div className="field">
          <label>保存先</label>
          <select value={form.target} onChange={(e) => set({ target: e.target.value })} disabled={isEdit}>
            {targets.length === 0 && <option value="">（カレンダーがありません）</option>}
            {targets.map(t => (
              <option key={`${t.sourceId}|${t.calendarId}`} value={`${t.sourceId}|${t.calendarId}`}>{t.label}</option>
            ))}
          </select>
          {isEdit && <div className="hint">保存先の変更はできません。移動したい場合は削除して作り直してください。</div>}
        </div>

        <div className="field">
          <label>場所</label>
          <input placeholder="会議室・オンライン会議のURLなど" value={form.location} onChange={(e) => set({ location: e.target.value })} />
        </div>

        {canInvite && (
          <div className="field">
            <label>参加者</label>
            <input
              placeholder="メールアドレスをカンマ区切りで（招待メールが送られます）"
              value={form.attendees} onChange={(e) => set({ attendees: e.target.value })}
            />
          </div>
        )}

        <div className="field">
          <label>メモ</label>
          <textarea rows={4} value={form.description} onChange={(e) => set({ description: e.target.value })} />
        </div>

        {initial.sourceMail && (
          <button type="button" className="mail-link" onClick={() => onOpenMail?.(initial.sourceMail)}>
            <Icon name="mail" size={14} />
            <span>元のメール: {initial.sourceMail.subject || '（件名なし）'}</span>
          </button>
        )}

        {error && <div className="form-error">{error}</div>}
      </form>

      <div className="modal-foot">
        {isEdit && initial.editable !== false && (
          <button className="btn danger-text" onClick={onDelete} disabled={busy}>削除</button>
        )}
        <span className="spacer" />
        <button className="btn secondary" onClick={onClose} disabled={busy}>キャンセル</button>
        <button className={cx('btn primary')} onClick={submit} disabled={busy || targets.length === 0}>
          {busy ? <Spinner small /> : (isEdit ? '保存' : '追加')}
        </button>
      </div>
    </Modal>
  );
}
