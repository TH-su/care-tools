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
    // 親のタスクID。Google ToDo と同じく1段だけの入れ子にする
    parent: t.parent || null,
    position: t.position || t.createdAt || '',
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
    parent: t.parent || null,
    position: t.position || '',
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

export async function listTasks({ includeDone = true, sort = 'manual' } = {}) {
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

  // 並び順。'manual' は Google の「自分の順序」（position）、'date' は期限順。
  // 既定は Google に合わせて自分の順序にする。
  if (sort === 'date') {
    const rank = (t) => (t.done ? 2 : 0) + (t.due ? 0 : 0.5);
    tasks.sort((a, b) => rank(a) - rank(b)
      || (a.due || '9999').localeCompare(b.due || '9999')
      || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  } else {
    tasks.sort((a, b) => (a.done === b.done ? 0 : (a.done ? 1 : -1))
      || String(a.position).localeCompare(String(b.position))
      || (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  }
  return { tasks: includeDone ? tasks : tasks.filter(t => !t.done), lists, errors };
}

export async function createTask({ sourceId, listId, task }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    return normalizeLocal(saveLocalTask({
      title: task.title, notes: task.notes || '', due: task.due || null,
      done: Boolean(task.done), sourceMail: task.sourceMail || null,
      parent: task.parent || null,
    }));
  }
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);
  // 親はクエリで渡す。本文に入れてもGoogleは無視する
  const created = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks`, {
    method: 'POST',
    query: task.parent ? { parent: task.parent } : undefined,
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

// ── 手動の並べ替え ────────────────────────────────────────────
// Googleは「その1つ前に来るタスク」を指定して動かす（previous）。
// 先頭へ動かすときは previous を付けない。
// 「このMacのToDo」には順序の考えが無いので、position を自前で振る。
export async function reorderTask({ sourceId, listId, taskId, previousId }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    const all = listLocalTasks();
    const moving = all.find(t => t.id === taskId);
    if (!moving) { const e = new Error('ToDoが見つかりません'); e.status = 404; throw e; }
    if (previousId === taskId) { const e = new Error('自分自身の後ろへは動かせません'); e.status = 400; throw e; }

    // 同じ高さのものだけを並べ替える（親が同じもの同士）
    const siblings = all
      .filter(t => (t.parent || null) === (moving.parent || null))
      .sort((a, b) => String(a.position || a.createdAt || '').localeCompare(String(b.position || b.createdAt || '')));
    const rest = siblings.filter(t => t.id !== taskId);
    const at = previousId ? rest.findIndex(t => t.id === previousId) + 1 : 0;
    if (previousId && at === 0) { const e = new Error('移動先が見つかりません'); e.status = 404; throw e; }
    rest.splice(at, 0, moving);

    // 位置は等間隔の連番。桁を揃えておかないと文字列比較で狂う
    rest.forEach((t, i) => saveLocalTask({ ...t, id: t.id, position: String(i * 10).padStart(10, '0') }));
    return normalizeLocal(listLocalTasks().find(t => t.id === taskId));
  }

  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);
  const moved = await googleFetch(
    source, creds, 'tasks',
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move`,
    { method: 'POST', query: previousId ? { previous: previousId } : undefined },
  );
  return normalizeGoogle(source, { id: listId, title: 'ToDo' }, moved);
}

// ── 完了済みの一括削除 ────────────────────────────────────────
// Googleには tasks.clear があるが、これは「完了済みを一覧から隠す」だけで
// 実体は残る。SilverMailからも見えなくなるので、こちらでは本当に消す。
export async function clearCompleted({ sourceId, listId }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    const done = listLocalTasks().filter(t => t.done);
    for (const t of done) deleteLocalTask(t.id);
    return { ok: true, removed: done.length };
  }
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);
  const data = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks`, {
    query: { maxResults: 100, showCompleted: 'true', showHidden: 'true' },
  });
  const done = (data.items || []).filter(t => t.status === 'completed');
  await Promise.all(done.map(t =>
    googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(t.id)}`, { method: 'DELETE' })
      .catch(() => {})));
  return { ok: true, removed: done.length };
}

// ── リストそのものの管理 ──────────────────────────────────────
// 「このMacのToDo」は1つきりの固定リストなので、作成も改名も削除もできない
function assertGoogleList(sourceId) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    const e = new Error('このMacのToDoは、リストの追加や名前の変更ができません');
    e.status = 400; throw e;
  }
  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  return source;
}

export async function createList({ sourceId, title }) {
  const source = assertGoogleList(sourceId);
  const creds = await getCalendarSecrets(source);
  const created = await googleFetch(source, creds, 'tasks', '/users/@me/lists', {
    method: 'POST', body: { title: String(title || '').trim() || '新しいリスト' },
  });
  return { sourceId: source.id, listId: created.id, name: `${created.title}（${source.email || source.name}）`, sourceType: 'google' };
}

export async function renameList({ sourceId, listId, title }) {
  const source = assertGoogleList(sourceId);
  const creds = await getCalendarSecrets(source);
  const updated = await googleFetch(source, creds, 'tasks', `/users/@me/lists/${encodeURIComponent(listId)}`, {
    method: 'PATCH', body: { title: String(title || '').trim() || '新しいリスト' },
  });
  return { sourceId: source.id, listId: updated.id, name: `${updated.title}（${source.email || source.name}）`, sourceType: 'google' };
}

export async function removeList({ sourceId, listId }) {
  const source = assertGoogleList(sourceId);
  const creds = await getCalendarSecrets(source);
  // リストを消すと中身も消える。何件消えるのかは、先に数えて呼び出し元へ返す
  const data = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks`, {
    query: { maxResults: 100, showCompleted: 'true', showHidden: 'true' },
  }).catch(() => ({ items: [] }));
  await googleFetch(source, creds, 'tasks', `/users/@me/lists/${encodeURIComponent(listId)}`, { method: 'DELETE' });
  return { ok: true, removed: (data.items || []).length };
}

// ── 親子関係（サブタスク） ────────────────────────────────────
// Google ToDo の入れ子は1段だけ。孫は作れないので、親に親がいるときは
// その親（＝いちばん上）に付ける。PATCHでは親を変えられないため move を使う。
export async function setTaskParent({ sourceId, listId, taskId, parent }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) {
    const all = listLocalTasks();
    const current = all.find(t => t.id === taskId);
    if (!current) { const e = new Error('ToDoが見つかりません'); e.status = 404; throw e; }
    if (parent === taskId) { const e = new Error('自分自身を親にはできません'); e.status = 400; throw e; }
    let top = parent || null;
    if (top) {
      const p = all.find(t => t.id === top);
      if (!p) { const e = new Error('親のToDoが見つかりません'); e.status = 404; throw e; }
      if (p.parent) top = p.parent;   // 孫は作らない
      // 自分の子を親にすると輪になる
      if (all.some(t => t.id === top && t.parent === taskId)) {
        const e = new Error('自分の下にあるToDoは親にできません'); e.status = 400; throw e;
      }
    } else {
      // 親から外すとき、自分の子は自分と同じ高さへ繰り上げる
      for (const child of all.filter(t => t.parent === taskId)) {
        saveLocalTask({ ...child, parent: null });
      }
    }
    return normalizeLocal(saveLocalTask({ ...current, id: taskId, parent: top }));
  }

  const source = getCalendarSource(sourceId);
  if (!source) { const e = new Error('ToDoの保存先が見つかりません'); e.status = 404; throw e; }
  const creds = await getCalendarSecrets(source);

  let top = parent || null;
  if (top) {
    if (top === taskId) { const e = new Error('自分自身を親にはできません'); e.status = 400; throw e; }
    const p = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(top)}`);
    if (p?.parent) top = p.parent;   // 孫は作らない
  }
  const moved = await googleFetch(
    source, creds, 'tasks',
    `/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}/move`,
    { method: 'POST', query: top ? { parent: top } : { parent: '' } },
  );
  return normalizeGoogle(source, { id: listId, title: 'ToDo' }, moved);
}

// 親を完了にしたら、その下も完了にする（Gmailのタスクと同じ動き）
// 1つのリストの中だけを見る。子を探すのに全アカウントを取りに行かない
async function tasksInList({ sourceId, listId }) {
  if (!sourceId || sourceId === LOCAL_TASK_SOURCE) return listLocalTasks().map(normalizeLocal);
  const source = getCalendarSource(sourceId);
  if (!source) return [];
  const creds = await getCalendarSecrets(source);
  const data = await googleFetch(source, creds, 'tasks', `/lists/${encodeURIComponent(listId)}/tasks`, {
    query: { maxResults: 100, showCompleted: 'true', showHidden: 'true' },
  });
  return (data.items || []).map(t => normalizeGoogle(source, { id: listId, title: 'ToDo' }, t));
}

export async function setDoneWithChildren({ sourceId, listId, taskId, done }) {
  const updated = await updateTask({ sourceId, listId, taskId, patch: { done } });
  const siblings = await tasksInList({ sourceId, listId }).catch(() => []);
  const children = siblings.filter(t => t.parent === taskId && t.done !== done);
  // 子は互いに独立しているので、順番待ちさせる理由がない
  await Promise.all(children.map(c =>
    updateTask({ sourceId, listId, taskId: c.taskId, patch: { done } }).catch(() => {})));
  return updated;
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
