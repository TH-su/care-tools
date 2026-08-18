// カレンダー画面 — 月 / 週 / 予定リスト。メール画面と同じ操作感で切り替える。
import React, { useMemo, useRef, useEffect } from 'react';
import { Icon } from '../icons.jsx';
import { cx } from '../util.js';
import { Spinner, EmptyState } from '../common.jsx';
import {
  monthGrid, startOfWeek, addDays, addMonths, startOfDay, dayKey, isToday, isSameDay,
  fmtMonthTitle, fmtDayLabel, fmtTime, eventTimeLabel, sortEvents, eventOnDay,
  dayPosition, layoutColumns, WEEKDAY_JP, relativeDayLabel, DAY_MS,
} from '../calendar-util.js';

const HOUR_H = 46; // 週表示の1時間あたりの高さ(px)

function Toolbar({ view, onView, anchor, onAnchor, onNew, title, loading, onRefresh }) {
  const step = (dir) => {
    if (view === 'week') onAnchor(addDays(anchor, dir * 7));
    else onAnchor(addMonths(anchor, dir));
  };
  return (
    <div className="cal-toolbar">
      <button className="btn secondary sm" onClick={() => onAnchor(new Date())}>今日</button>
      <div className="nav">
        <button className="iconbtn" onClick={() => step(-1)} aria-label="前へ"><Icon name="chevL" size={17} /></button>
        <button className="iconbtn" onClick={() => step(1)} aria-label="次へ"><Icon name="chevR" size={17} /></button>
      </div>
      <h2 className="cal-title">{title}</h2>
      {loading && <Spinner small />}
      <span className="spacer" />
      <div className="segment sm">
        <button className={cx(view === 'month' && 'on')} onClick={() => onView('month')}>月</button>
        <button className={cx(view === 'week' && 'on')} onClick={() => onView('week')}>週</button>
        <button className={cx(view === 'agenda' && 'on')} onClick={() => onView('agenda')}>予定</button>
      </div>
      <button className="iconbtn" title="更新" onClick={onRefresh}><Icon name="refresh" size={16} /></button>
      <button className="btn primary sm" onClick={() => onNew()}><Icon name="plus" size={14} /> 予定</button>
    </div>
  );
}

function MonthView({ anchor, events, weekStart, onOpen, onNew }) {
  const days = useMemo(() => monthGrid(anchor, weekStart), [anchor, weekStart]);
  const headers = Array.from({ length: 7 }, (_, i) => WEEKDAY_JP[(i + weekStart) % 7]);

  return (
    <div className="cal-month">
      <div className="month-head">
        {headers.map((h, i) => (
          <div key={h} className={cx('h', (i + weekStart) % 7 === 0 && 'sun', (i + weekStart) % 7 === 6 && 'sat')}>{h}</div>
        ))}
      </div>
      <div className="month-grid">
        {days.map(day => {
          const list = sortEvents(events.filter(ev => eventOnDay(ev, day)));
          const other = day.getMonth() !== anchor.getMonth();
          const shown = list.slice(0, 3);
          return (
            <div
              className={cx('month-cell', other && 'other', isToday(day) && 'today')}
              key={dayKey(day)}
              onDoubleClick={() => onNew(day)}
            >
              <div className="cell-head">
                <button
                  className={cx('daynum', day.getDay() === 0 && 'sun', day.getDay() === 6 && 'sat')}
                  onClick={() => onNew(day)}
                  title="この日に予定を追加"
                >
                  {day.getDate() === 1 ? `${day.getMonth() + 1}/1` : day.getDate()}
                </button>
              </div>
              <div className="cell-events">
                {shown.map(ev => (
                  <button
                    className={cx('mini-event', ev.allDay && 'allday')} key={ev.id}
                    onClick={(e) => { e.stopPropagation(); onOpen(ev); }}
                    title={`${eventTimeLabel(ev)} ${ev.title}`}
                    style={ev.allDay ? { background: ev.color || 'var(--accent)' } : undefined}
                  >
                    {!ev.allDay && <span className="dot" style={{ background: ev.color || 'var(--accent)' }} />}
                    {!ev.allDay && <span className="tm">{fmtTime(ev.start)}</span>}
                    <span className="ttl">{ev.title}</span>
                  </button>
                ))}
                {list.length > shown.length && (
                  <button className="more" onClick={(e) => { e.stopPropagation(); onOpen(list[shown.length]); }}>
                    ほか{list.length - shown.length}件
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WeekView({ anchor, events, weekStart, onOpen, onNew }) {
  const scrollRef = useRef(null);
  const days = useMemo(() => {
    const s = startOfWeek(anchor, weekStart);
    return Array.from({ length: 7 }, (_, i) => addDays(s, i));
  }, [anchor, weekStart]);

  useEffect(() => {
    // 朝8時あたりが最初に見えるようにする
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR_H * 7.5;
  }, []);

  const allDayOf = (day) => sortEvents(events.filter(ev => ev.allDay && eventOnDay(ev, day)));
  const timedOf = (day) => events.filter(ev => !ev.allDay && eventOnDay(ev, day));

  const clickGrid = (day) => (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(Math.max((e.clientY - rect.top) / rect.height, 0), 0.98);
    const minutes = Math.round((ratio * 24 * 60) / 30) * 30;
    const at = new Date(startOfDay(day).getTime() + minutes * 60000);
    onNew(at, { withTime: true });
  };

  return (
    <div className="cal-week">
      <div className="week-head">
        <div className="gutter" />
        {days.map(day => (
          <div className={cx('wh', isToday(day) && 'today')} key={dayKey(day)}>
            <span className={cx('wd', day.getDay() === 0 && 'sun', day.getDay() === 6 && 'sat')}>{WEEKDAY_JP[day.getDay()]}</span>
            <span className="dn">{day.getDate()}</span>
          </div>
        ))}
      </div>
      <div className="week-allday">
        <div className="gutter">終日</div>
        {days.map(day => (
          <div className="ad-cell" key={dayKey(day)}>
            {allDayOf(day).map(ev => (
              <button
                className="ad-event" key={ev.id} onClick={() => onOpen(ev)}
                style={{ background: ev.color || 'var(--accent)' }} title={ev.title}
              >{ev.title}</button>
            ))}
          </div>
        ))}
      </div>
      <div className="week-body" ref={scrollRef}>
        <div className="week-grid" style={{ height: HOUR_H * 24 }}>
          <div className="gutter">
            {Array.from({ length: 24 }, (_, h) => (
              <div className="hour-label" style={{ height: HOUR_H }} key={h}>
                {h > 0 && <span>{String(h).padStart(2, '0')}:00</span>}
              </div>
            ))}
          </div>
          {days.map(day => {
            const laid = layoutColumns(timedOf(day));
            return (
              <div className={cx('day-col', isToday(day) && 'today')} key={dayKey(day)} onClick={clickGrid(day)}>
                {Array.from({ length: 24 }, (_, h) => <div className="hour-line" style={{ height: HOUR_H }} key={h} />)}
                {laid.map(({ ev, col, total }) => {
                  const { top, height } = dayPosition(ev, day);
                  // 30分などの短い予定は、タイトルと時刻が重ならないよう1行にする
                  const short = height * 24 * 60 < 45;
                  return (
                    <button
                      className={cx('week-event', short && 'short')} key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onOpen(ev); }}
                      style={{
                        top: `${top * 100}%`, height: `${height * 100}%`,
                        left: `${(col / total) * 100}%`, width: `${(1 / total) * 100}%`,
                        background: ev.color || 'var(--accent)',
                      }}
                      title={`${eventTimeLabel(ev)} ${ev.title}`}
                    >
                      {short ? (
                        <span className="t">{fmtTime(ev.start)} {ev.title}</span>
                      ) : (
                        <>
                          <span className="t">{ev.title}</span>
                          <span className="s">{fmtTime(ev.start)}</span>
                        </>
                      )}
                    </button>
                  );
                })}
                {isToday(day) && <NowLine />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NowLine() {
  const now = new Date();
  const ratio = (now.getHours() * 60 + now.getMinutes()) / (24 * 60);
  return <div className="now-line" style={{ top: `${ratio * 100}%` }}><span className="knob" /></div>;
}

function AgendaView({ anchor, events, onOpen }) {
  const days = useMemo(() => {
    const from = startOfDay(anchor);
    return Array.from({ length: 62 }, (_, i) => addDays(from, i))
      .map(day => ({ day, list: sortEvents(events.filter(ev => eventOnDay(ev, day))) }))
      .filter(d => d.list.length > 0);
  }, [anchor, events]);

  if (days.length === 0) {
    return <EmptyState icon="calendar" title="この先の予定はありません" desc="「＋ 予定」から追加できます" />;
  }
  return (
    <div className="cal-agenda">
      {days.map(({ day, list }) => (
        <div className="ag-day" key={dayKey(day)}>
          <div className={cx('ag-date', isToday(day) && 'today')}>
            <span className="dn">{day.getDate()}</span>
            <span className="wd">{WEEKDAY_JP[day.getDay()]}</span>
            <span className="rel">{relativeDayLabel(day)}</span>
          </div>
          <div className="ag-items">
            {list.map(ev => (
              <button className="ag-item" key={ev.id} onClick={() => onOpen(ev)}>
                <span className="bar" style={{ background: ev.color || 'var(--accent)' }} />
                <span className="tm">{eventTimeLabel(ev)}</span>
                <span className="ttl">{ev.title}</span>
                {ev.location && <span className="loc"><Icon name="pin" size={12} />{ev.location}</span>}
                <span className="cal">{ev.calendarName}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function CalendarView({
  events, loading, errors = [], sources = [],
  anchor, view, weekStart = 0,
  onAnchor, onView, onNew, onOpen, onRefresh, onManageSources, onToggleSource,
}) {
  const title = view === 'week'
    ? (() => {
      const s = startOfWeek(anchor, weekStart);
      const e = addDays(s, 6);
      return s.getMonth() === e.getMonth()
        ? `${fmtMonthTitle(s)} ${s.getDate()}–${e.getDate()}日`
        : `${s.getMonth() + 1}月${s.getDate()}日 – ${e.getMonth() + 1}月${e.getDate()}日`;
    })()
    : view === 'agenda' ? `${fmtMonthTitle(anchor)}以降の予定` : fmtMonthTitle(anchor);

  return (
    <main className="calendar-pane">
      <Toolbar
        view={view} onView={onView} anchor={anchor} onAnchor={onAnchor}
        onNew={onNew} title={title} loading={loading} onRefresh={onRefresh}
      />

      {errors.length > 0 && (
        <div className="cal-errors">
          {errors.map(e => (
            <div className="cal-error" key={e.sourceId}>
              <Icon name="warn" size={14} />
              <span>{e.name}: {e.error}</span>
            </div>
          ))}
        </div>
      )}

      <div className="cal-body">
        {view === 'month' && <MonthView anchor={anchor} events={events} weekStart={weekStart} onOpen={onOpen} onNew={onNew} />}
        {view === 'week' && <WeekView anchor={anchor} events={events} weekStart={weekStart} onOpen={onOpen} onNew={onNew} />}
        {view === 'agenda' && <AgendaView anchor={anchor} events={events} onOpen={onOpen} />}
      </div>

      <div className="cal-legend">
        {sources.map(s => (
          <button
            key={s.id}
            className={cx('legend-item', s.enabled === false && 'off')}
            onClick={() => onToggleSource(s.id, s.enabled === false)}
            title={s.enabled === false ? 'このカレンダーを表示する' : 'このカレンダーを隠す'}
          >
            <span className="sw" style={{ background: s.color }} />
            <span className="nm">{s.name}</span>
          </button>
        ))}
        <span className="spacer" />
        <button className="legend-manage" onClick={onManageSources}>
          <Icon name="plus" size={13} /> カレンダーを追加・管理
        </button>
      </div>
    </main>
  );
}
