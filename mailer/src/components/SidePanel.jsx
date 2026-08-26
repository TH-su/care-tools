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

// 親のすぐ下に、その子を並べる。Google ToDo と同じく入れ子は1段だけ
function withChildren(items, all) {
  const shown = new Set(items.map(t => t.id));
  const out = [];
  for (const t of items) {
    if (t.parent && shown.has(`${t.sourceId}::${t.listId}::${t.parent}`)) continue;   // 親と一緒に出す
    out.push(t);
    const kids = all
      .filter(c => c.parent === t.taskId && c.sourceId === t.sourceId && c.listId === t.listId)
      .sort((a, b) => String(a.position).localeCompare(String(b.position)));
    out.push(...kids);
  }
  return out;
}

function TaskGroup({ label, items, all = [], tone, onToggle, onOpen, onMenu, onOpenMail }) {
  if (items.length === 0) return null;
  const rows = withChildren(items, all);
  return (
    <div className="task-group">
      <div className={cx('task-group-label', tone)}>{label}<span className="n">{items.length}</span></div>
      {rows.map(t => {
        const due = dueLabel(t.due);
        return (
          <div className={cx('task-item', t.done && 'done', t.parent && 'child')} key={t.id}>
            <button
              className="tick" onClick={() => onToggle(t)}
              aria-label={t.done ? '未完了に戻す' : '完了にする'} title={t.done ? '未完了に戻す' : '完了にする'}
            >
              <Icon name={t.done ? 'checkCircle' : 'circle'} size={17} />
            </button>
            <button className="task-body" onClick={() => onOpen(t)}>
              <span className="ttl">{t.title}</span>
              {/* 詳細（メモ）の1行目。中身があることが一覧で分かるようにする */}
              {t.notes && <span className="notes">{t.notes.split('\n').find(l => l.trim()) || ''}</span>}
              <span className="meta">
                {due && <span className={cx('due', !t.done && due.tone)}>{due.text}</span>}
                {t.sourceMail && (
                  <span className="from-mail" title={t.sourceMail.subject || ''}>
                    <Icon name="mail" size={11} />
                    {t.sourceMail.from || 'メールから'}
                  </span>
                )}
                {t.sourceType === 'google' && <span className="src">{t.listName}</span>}
                {(() => {
                  const kids = all.filter(c => c.parent === t.taskId && c.sourceId === t.sourceId && c.listId === t.listId);
                  if (kids.length === 0) return null;
                  const doneCount = kids.filter(k => k.done).length;
                  return <span className="subs"><Icon name="list" size={11} />{doneCount}/{kids.length}</span>;
                })()}
              </span>
            </button>
            {t.sourceMail && (
              <button
                className="task-mail" onClick={(e) => { e.stopPropagation(); onOpenMail(t.sourceMail); }}
                title={`元のメールを開く: ${t.sourceMail.subject || '（件名なし）'}`} aria-label="元のメールを開く"
              >
                <Icon name="mailOpen" size={15} />
              </button>
            )}
            <button className="task-more" onClick={(e) => onMenu(e, t)} aria-label="操作" title="操作">
              <Icon name="more" size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function TasksTab({
  tasks, loading, errors, onToggle, onAdd, onOpen, onMenu, onOpenMail,
  lists = [], dest, filter, onFilter, onDestMenu,
}) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);
  const multi = lists.length > 1;
  // Googleアカウントが1つだけなら、チップの表示から「（メールアドレス）」を省いて短くする
  const oneAccount = new Set(lists.filter(l => l.sourceType === 'google').map(l => l.sourceId)).size <= 1;
  const shortName = (l) => (oneAccount ? l.name.replace(/（[^（）]*@[^（）]*）\s*$/, '') : l.name);
  const destList = lists.find(l => l.sourceId === dest?.sourceId && l.listId === dest?.listId) || lists[0];
  const destName = destList ? shortName(destList) : 'このMacのToDo';
  const shown = filter === 'all'
    ? tasks
    : tasks.filter(t => `${t.sourceId}|${t.listId}` === filter);

  const groups = useMemo(() => {
    const todayEnd = startOfDay(new Date()).getTime() + DAY_MS;
    const open = shown.filter(t => !t.done);
    return {
      overdue: open.filter(t => t.due && new Date(t.due).getTime() < todayEnd - DAY_MS),
      today: open.filter(t => t.due && new Date(t.due).getTime() >= todayEnd - DAY_MS && new Date(t.due).getTime() < todayEnd),
      upcoming: open.filter(t => t.due && new Date(t.due).getTime() >= todayEnd),
      someday: open.filter(t => !t.due),
      done: shown.filter(t => t.done).slice(0, 20),
    };
  }, [shown]);

  const submit = (e) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    onAdd(title);
    inputRef.current?.focus();
  };

  const openCount = shown.filter(t => !t.done).length;

  return (
    <>
      {multi && (
        <div className="list-chips">
          <button className={cx(filter === 'all' && 'on')} onClick={() => onFilter('all')}>すべて</button>
          {lists.map(l => (
            <button
              key={`${l.sourceId}|${l.listId}`}
              className={cx(filter === `${l.sourceId}|${l.listId}` && 'on')}
              onClick={() => onFilter(`${l.sourceId}|${l.listId}`)}
              title={l.name}
            >
              {l.sourceType === 'google' && <Icon name="google" size={11} />}
              {shortName(l)}
            </button>
          ))}
        </div>
      )}

      <form className="task-add" onSubmit={submit}>
        <Icon name="plus" size={15} className="ic" />
        <input
          ref={inputRef} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder="ToDoを追加（Enterで登録）"
        />
        {multi && (
          <button
            type="button" className="dest" onClick={onDestMenu}
            title={`保存先: ${destList?.name || destName}（クリックで変更）`}
          >
            <span className="nm">{destName}</span>
            <Icon name="chevD" size={11} />
          </button>
        )}
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
        <TaskGroup label="期限を過ぎています" tone="overdue" items={groups.overdue} all={tasks} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onOpenMail={onOpenMail} />
        <TaskGroup label="今日" tone="today" items={groups.today} all={tasks} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onOpenMail={onOpenMail} />
        <TaskGroup label="これから" items={groups.upcoming} all={tasks} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onOpenMail={onOpenMail} />
        <TaskGroup label="期限なし" items={groups.someday} all={tasks} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onOpenMail={onOpenMail} />
        <TaskGroup label="完了" tone="muted" items={groups.done} all={tasks} onToggle={onToggle} onOpen={onOpen} onMenu={onMenu} onOpenMail={onOpenMail} />
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
  onToggleTask, onAddTask, onOpenTask, onTaskMenu, onOpenTaskMail, onRefresh,
  taskLists, taskDest, taskFilter, onTaskFilter, onTaskDestMenu,
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
                  onOpenMail={onOpenTaskMail}
                  lists={taskLists} dest={taskDest} filter={taskFilter}
                  onFilter={onTaskFilter} onDestMenu={onTaskDestMenu}
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
