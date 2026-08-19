// ToDo — このMac内のリストと、Google ToDo（Google Tasks）を同じ形で扱う。
// Google連携はカレンダーと同じ認可（同一のsource）を使い回す。
import {
  listCalendarSources, getCalendarSource, getCalendarSecrets,
  listLocalTasks, saveLocalTask, deleteLocalTask,
} from './store.js';
import { googleFetch } from './google.js';
import { dateKey, startOfDay, localTimeZone } from './datetime.js';

export const LOCAL_TASK_SOURCE = 'local';
export const LOCAL_TASK_LIST = 'local';

// Google ToDo の期限は日付だけを見る仕様なので、その日の0時(UTC)に丸める
function toGoogleDue(iso) {
  if (!iso) return null;
  return `${dateKey(new Date(iso), localTimeZone())}T00:00:00.000Z`;
}
function fromGoogleDue(due) {
  if (!due) return null;
  const key = String(due).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return new Date(due).toISOString();
  return startOfDay(key, localTimeZone()).toISOString();
}

function normalizeLocal(t) {
  return {
    id: `${LOCAL_TASK_SOURCE}::${LOCAL_TASK_LIST}::${t.id}`,
    sourceId: LOCAL_TASK_SOURCE,
    sourceType: 'local',
    listId: LOCAL_TASK_LIST,
    listName: 'ToDo',
    taskId: t.id,
    title: t.title || '',
    notes: t.notes || '',
    due: t.due || null,
    done: Boolean(t.done),
    doneAt: t.doneAt || null,
    sourceMail: t.sourceMail || null,
    updatedAt: t.updatedAt || t.createdAt || null,
  };
}

function normalizeGoogle(source, list, t) {
  // メール由来のToDoは notes の末尾に印を入れて往復させる
  const notes = t.notes || '';
  const m = notes.match(/\n?\[silvermail:mail\]([^\n]*)$/);
  let sourceMail = null;
  if (m) {
    try { sourceMail = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); } catch { sourceMail = null; }
  }
  return {
    id: `${source.id}::${list.id}::${t.id}`,
    sourceId: source.id,
    sourceType: 'google',
    listId: list.id,
    listName: list.title,
    taskId: t.id,
    title: t.title || '',
    notes: m ? notes.slice(0, m.index).trimEnd() : notes,
    due: fromGoogleDue(t.due),
    done: t.status === 'completed',
    doneAt: t.completed || null,
    sourceMail,
    updatedAt: t.updated || null,
  };
}

function encodeMailMark(sourceMail) {
  if (!sourceMail) return '';
  return `\n[silvermail:mail]${Buffer.from(JSON.stringify(sourceMail), 'utf8').toString('base64')}`;
}

async function googleLists(source, creds) {
  const data = await googleFetch(source, creds, 'tasks', '/users/@me/lists', { query: { maxResults: 100 } });
  return (data.items || []).map(l => ({ id: l.id, title: l.title || 'ToDo' }));
}

export async function listTasks({ includeDone = true } = {}) {
  const errors = [];
  const lists = [{ sourceId: LOCAL_TASK_SOURCE, listId: LOCAL_TASK_LIST, name: 'このMacのToDo', sourceType: 'local' }];
  const tasks = listLocalTasks().map(normalizeLocal);

  const sources = listCalendarSources().filter(s => s.type === 'google' && s.enabled !== false);
  await Promise.all(sources.map(async (source) => {
    try {
      const creds = await getCalendarSecrets(source);
      const ls = await googleLists(source, creds);
      for (const l of ls) lists.push({ sourceId: source.id, listId: l.id, name: `${l.title}（${source.email || source.name}）`, sourceType: 'google' });
      const got = await Promise.all(ls.map(async (l) => {
        const data = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(l.id)}/tasks`, {
          query: { maxResults: 100, showCompleted: String(includeDone), showHidden: String(includeDone) },
        });
        return (data.items || []).map(t => normalizeGoogle(source, l, t));
      }));
      tasks.push(...got.flat());
    } catch (err) {
      errors.push({ sourceId: source.id, name: source.name, error: err.message, authFailed: Boolean(err.authFailed) });
    }
  }));

  const rank = (t) => (t.done ? 2 : 0) + (t.due ? 0 : 0.5);
  tasks.sort((a, b) => rank(a) - rank(b)
    || (a.due || '9999').localeCompare(b.due || '9999')
    || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  return { tasks: includeDone ? tasks : tasks.filter(t => !t.done), lists, errors };
}

export async function createTask({ sourceId, listId, task }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    return normalizeLocal(saveLocalTask({
      title: task.title, notes: task.notes || '', due: task.due || null,
      done: Boolean(task.done), sourceMail: task.sourceMail || null,
    }));
  }
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);
  const created = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks`, {
    method: 'POST',
    body: {
      title: task.title || '',
      notes: `${task.notes || ''}${encodeMailMark(task.sourceMail)}`.trim() || undefined,
      due: toGoogleDue(task.due) || undefined,
      status: task.done ? 'completed' : 'needsAction',
    },
  });
  return normalizeGoogle(source, { id: listId, title: 'ToDo' }, created);
}

export async function updateTask({ sourceId, listId, taskId, patch }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    const current = listLocalTasks().find(t => t.id === taskId);
    if (!current) { const e = new Error('ToDoが見つかりません'); e.status = 404; throw e; }
    return normalizeLocal(saveLocalTask({ ...current, ...patch, id: taskId }));
  }
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);
  const body = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.notes !== undefined) body.notes = patch.notes;
  if (patch.due !== undefined) body.due = toGoogleDue(patch.due);
  if (patch.done !== undefined) {
    body.status = patch.done ? 'completed' : 'needsAction';
    if (!patch.done) body.completed = null;
  }
  const updated = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, {
    method: 'PATCH', body,
  });
  return normalizeGoogle(source, { id: listId, title: 'ToDo' }, updated);
}

export async function removeTask({ sourceId, listId, taskId }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) { deleteLocalTask(taskId); return { ok: true }; }
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);
  await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' });
  return { ok: true };
}

// ── 1件取得とリスト間の移動 ──────────────────────────────────
export async function getTask({ sourceId, listId, taskId }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    const t = listLocalTasks().find(x => x.id === taskId);
    return t ? normalizeLocal(t) : null;
  }
  const source = getCalendarSource(sourceId);
  if (!source) return null;
  const creds = await getCalendarSecrets(source);
  const data = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`);
  return data?.id ? normalizeGoogle(source, { id: listId, title: 'ToDo' }, data) : null;
}

// 「このMacのToDo」⇄「Google ToDo」の付け替え。
// APIに移動そのものが無いため、移動先に作ってから元を消す。
export async function moveTask({ from, to }) {
  const sameList = (from.sourceId || LOCAL_TASK_SOURCE) === (to.sourceId || LOCAL_TASK_SOURCE)
    && (from.listId || LOCAL_TASK_LIST) === (to.listId || LOCAL_TASK_LIST);
  if (sameList) return getTask(from);

  const current = await getTask(from);
  if (!current) { const e = new Error('移動するToDoが見つかりません'); e.status = 404; throw e; }

  const created = await createTask({
    sourceId: to.sourceId,
    listId: to.listId,
    task: {
      title: current.title, notes: current.notes, due: current.due,
      done: current.done, sourceMail: current.sourceMail,
    },
  });
  try {
    await removeTask(from);
  } catch (err) {
    // 元が消せなかった場合は二重に残るため、作った側を戻して整合を保つ
    await removeTask({ sourceId: created.sourceId, listId: created.listId, taskId: created.taskId }).catch(() => {});
    throw err;
  }
  return created;
}
