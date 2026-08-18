// 右サイドパネル — メールを見ながら「予定」と「ToDo」を並べて確認する（Gmailのサイドパネル方式）
import React, { useState, useMemo, useRef } from 'react';
import { Icon } from '../icons.jsx';
import { cx } from '../util.js';
import { Spinner } from '../common.jsx';
import {
  addDays, startOfDay, dayKey, isToday, relativeDayLabel, eventTimeLabel,
  sortEvents, eventOnDay, dueLabel, DAY_MS,
} from '../calendar-util.js';

const AGENDA_DAYS = 14;

function AgendaTab({ events, loading, errors, onNew, onOpen, onOpenCalendar, hasSources, onManage }) {
  const days = useMemo(() => {
    const today = startOfDay(new Date());
    return Array.from({ length: AGENDA_DAYS }, (_, i) => addDays(today, i))
      .map(day => ({ day, list: sortEvents(events.filter(ev => eventOnDay(ev, day))) }))
      .filter((d, i) => i === 0 || d.list.length > 0);
  }, [events]);

  const total = days.reduce((s, d) => s + d.list.length, 0);

  return (
    <>
      <div className="panel-actions">
        <button className="btn primary sm" onClick={() => onNew()}>
          <Icon name="plus" size={14} /> 予定を追加
        </button>
        <button className="btn secondary sm" onClick={onOpenCalendar}>
          <Icon name="calendar" size={14} /> カレンダー
        </button>
      </div>

      {errors.map(e => (
        <div className="panel-error" key={e.sourceId}>
          <Icon name="warn" size={13} /><span>{e.name}: {e.error}</span>
        </div>
      ))}

      {loading && total === 0 && <div className="panel-loading"><Spinner small /></div>}

      {!hasSources && !loading && (
        <div className="panel-empty">
          <Icon name="calendar" size={30} className="ic" />
          <div className="t">カレンダーを繋ぐ</div>
          <div className="d">GoogleカレンダーやiCalのURLを追加すると、メールの横に予定が並びます。</div>
          <button className="btn primary sm" onClick={onManage}>カレンダーを追加</button>
        </div>
      )}

      <div className="agenda">
        {days.map(({ day, list }) => (
          <div className="agenda-day" key={dayKey(day)}>
            <div className={cx('agenda-date', isToday(day) && 'today')}>
              <span className="lbl">{relativeDayLabel(day)}</span>
              {isToday(day) && <span className="badge-today">TODAY</span>}
            </div>
            {list.length === 0 && <div className="agenda-none">予定はありません</div>}
            {list.map(ev => (
              <button className="agenda-item" key={ev.id} onClick={() => onOpen(ev)} title={ev.title}>
                <span className="bar" style={{ background: ev.color || 'var(--accent)' }} />
                <span className="body">
                  <span className="tm">{eventTimeLabel(ev)}</span>
                  <span className="ttl">{ev.title}</span>
                  {ev.location && <span className="loc"><Icon name="pin" size={11} />{ev.location}</span>}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function TaskGroup({ label, items, tone, onToggle, onOpen, onMenu }) {
  if (items.length === 0) return null;
  return (
    <div className="task-group">
      <div className={cx('task-group-label', tone)}>{label}<span className="n">{items.length}</span></div>
      {items.map(t => {
        const due = dueLabel(t.due);
        return (
          <div className={cx('task-item', t.done && 'done')} key={t.id}>
            <button
              className="tick" onClick={() => onToggle(t)}
              aria-label={t.done ? '未完了に戻す' : '完了にする'} title={t.done ? '未完了に戻す' : '完了にする'}
            >
              <Icon name={t.done ? 'checkCircle' : 'circle'} size={17} />
            </button>
            <button className="task-body" onClick={() => onOpen(t)}>
              <span className="ttl">{t.title}</span>
              <span className="meta">
                {due && <span className={cx('due', !t.done && due.tone)}>{due.text}</span>}
                {t.sourceMail && <span className="from-mail"><Icon name="mail" size={11} />メールから</span>}
                {t.sourceType === 'google' && <span className="src">{t.listName}</span>}
              </span>
            </button>
            <button className="task-more" onClick={(e) => onMenu(e, t)} aria-label="操作" title="操作">
              <Icon name="more" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TasksTab({ tasks, loading, errors, onToggle, onAdd, onOpen, onMenu }) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  const groups = useMemo(() => {
    const todayEnd = startOfDay(new Date()).getTime() + DAY_MS;
    const open = tasks.filter(t => !t.done);
    return {
      overdue: open.filter(t => t.due && new Date(t.due).getTime() < todayEnd - DAY_MS),
      today: open.filter(t => t.due && new Date(t.due).getTime() >= todayEnd - DAY_MS && new Date(t.due).getTime() < todayEnd),
      upcoming: open.filter(t => t.due && new Date(t.due).getTime() >= todayEnd),
      someday: open.filter(t => !t.due),
      done: tasks.filter(t => t.done).slice(0, 20),
    };
  }, [tasks]);

  const submit = (e) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    onAdd(title);
    inputRef.current?.focus();
  };

  const openCount = tasks.filter(t => !t.done).length;

  return (
    <>
      <form className="task-add" onSubmit={submit}>
        <Icon name="plus" size={15} className="ic" />
        <input
          ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="ToDoを追加（Enterで登録）"
        />
      </form>

      {errors.map(e => (
        <div className="panel-error" key={e.sourceId}>
          <Icon name="warn" size={13} /><span>{e.name}: {e.error}</span>
        </div>
      ))}

      {loading && tasks.length === 0 && <div className="panel-loading"><Spinner small /></div>}
      {!loading && tasks.length === 0 && (
        <div className="panel-empty">
          <Icon name="todo" size={30} className="ic" />
          <div className="t">ToDoはありません</div>
          <div className="d">メールを開いて「ToDoに追加」を押すと、件名がそのままタスクになります。</div>
        </div>
      )}

      <div className="task-list">
        <TaskGroup label="期限を過ぎています" tone="overdue" items={groups.overdue} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} />
        <TaskGroup label="今日" tone="today" items={groups.today} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} />
        <TaskGroup label="これから" items={groups.upcoming} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} />
        <TaskGroup label="期限なし" items={groups.someday} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} />
        <TaskGroup label="完了" tone="muted" items={groups.done} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} />
      </div>
      {openCount > 0 && <div className="task-foot">未完了 {openCount} 件</div>}
    </>
  );
}

export function SidePanel({
  open, tab, onToggle, width,
  events, eventsLoading, eventErrors = [],
  tasks, tasksLoading, taskErrors = [],
  hasSources,
  onNewEvent, onOpenEvent, onOpenCalendar, onManageSources,
  onToggleTask, onAddTask, onOpenTask, onTaskMenu, onRefresh,
}) {
  const todayCount = events.filter(ev => eventOnDay(ev, new Date())).length;
  const openTasks = tasks.filter(t => !t.done).length;

  return (
    <>
      {open && (
        <aside className="side-panel" style={{ width }}>
          <div className="panel-head">
            <div className="panel-tabs">
              <button className={cx(tab === 'calendar' && 'on')} onClick={() => onToggle('calendar')}>予定</button>
              <button className={cx(tab === 'tasks' && 'on')} onClick={() => onToggle('tasks')}>ToDo</button>
            </div>
            <span className="spacer" />
            <button className="iconbtn" title="更新" onClick={onRefresh}><Icon name="refresh" size={15} /></button>
            <button className="iconbtn" title="カレンダーの設定" onClick={onManageSources}><Icon name="gear" size={15} /></button>
          </div>
          <div className="panel-scroll">
            {tab === 'calendar'
              ? (
                <AgendaTab
                  events={events} loading={eventsLoading} errors={eventErrors}
                  onNew={onNewEvent} onOpen={onOpenEvent} onOpenCalendar={onOpenCalendar}
                  hasSources={hasSources} onManage={onManageSources}
                />
              )
              : (
                <TasksTab
                  tasks={tasks} loading={tasksLoading} errors={taskErrors}
                  onToggle={onToggleTask} onAdd={onAddTask} onOpen={onOpenTask} onMenu={onTaskMenu}
                />
              )}
          </div>
        </aside>
      )}

      <div className="side-rail">
        <button
          className={cx('rail-btn', open && tab === 'calendar' && 'on')}
          title="予定（カレンダー）" aria-label="予定"
          onClick={() => onToggle('calendar')}
        >
          <Icon name="calendar" size={19} />
          {todayCount > 0 && <span className="rail-badge">{todayCount}</span>}
        </button>
        <button
          className={cx('rail-btn', open && tab === 'tasks' && 'on')}
          title="ToDo" aria-label="ToDo"
          onClick={() => onToggle('tasks')}
        >
          <Icon name="todo" size={19} />
          {openTasks > 0 && <span className="rail-badge">{openTasks}</span>}
        </button>
      </div>
    </>
  );
}
