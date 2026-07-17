import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Load .env by absolute path (not cwd) so env vars apply regardless of the working
// directory pm2 launches this process from.
dotenv.config({ path: path.join(__dirname, '.env') });

const app = express();
app.use(express.json());

const API = 'https://api.todoist.com/api/v1';
const PORT = process.env.PORT ?? 3010;

// This service can mutate Todoist state, so require Cloudflare Access' identity
// header unless explicitly disabled for local smoke tests.
if (process.env.ALLOW_NO_ACCESS_HEADER !== '1') {
  app.use((req, res, next) => {
    if (!req.headers['cf-access-authenticated-user-email']) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    next();
  });
}

if (!process.env.TODOIST_API_TOKEN) {
  console.warn('[todoist] WARNING: TODOIST_API_TOKEN is not set — all upstream calls will 401.');
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// GET /tasks?projectId=X
// If projectId is omitted, returns all active tasks.
// Returns: { ok: true, tasks: [...] } | { ok: false, error }
app.get('/tasks', async (req, res) => {
  try {
    const { projectId } = req.query
    const url = projectId
      ? `${API}/tasks?project_id=${encodeURIComponent(projectId)}`
      : `${API}/tasks`
    const r = await fetch(url, { headers: authHeaders() })
    const data = await readJson(r)
    if (!r.ok) return res.status(r.status).json({ ok: false, error: data })
    res.json({ ok: true, tasks: data.results ?? data })
  } catch (e) {
    console.warn('[todoist] GET /tasks error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// GET /tasks/:id
// Returns: { ok: true, task: {...} } | { ok: false, error }
app.get('/tasks/:id', async (req, res) => {
  try {
    const r = await fetch(`${API}/tasks/${encodeURIComponent(req.params.id)}`, { headers: authHeaders() })
    const data = await readJson(r)
    if (!r.ok) return res.status(r.status).json({ ok: false, error: data })
    res.json({ ok: true, task: data })
  } catch (e) {
    console.warn('[todoist] GET /tasks/:id error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /tasks
// Body: { content, title (alias), description?, dueDate?, deadlineDate?, priority?, projectId, sectionId? }
// deadlineDate is Todoist's hard "deadline" (YYYY-MM-DD), distinct from the due date;
// priority is Todoist-native (1 = normal … 4 = urgent). Both are dropped with a retry
// if the account's plan rejects them (deadlines are Pro-only) — see createTask().
// Returns: { ok: true, taskId, deadlineDropped? } | { ok: false, error }
app.post('/tasks', async (req, res) => {
  try {
    const result = await createTask(req.body);
    if (!result.ok) {
      console.warn('[todoist] create task failed:', result.error);
      return res.status(result.status ?? 500).json({ ok: false, error: result.error });
    }
    res.json(result);
  } catch (e) {
    console.warn('[todoist] POST /tasks error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /tasks/:id/close
// Returns: { ok: true } | { ok: false, error }
app.post('/tasks/:id/close', async (req, res) => {
  try {
    const r = await fetch(`${API}/tasks/${encodeURIComponent(req.params.id)}/close`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!r.ok) {
      const data = await readJson(r);
      console.warn('[todoist] close task failed:', data);
      return res.status(r.status).json({ ok: false, error: data });
    }
    res.json({ ok: true });
  } catch (e) {
    console.warn('[todoist] POST /tasks/:id/close error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// PATCH /tasks/:id
// Body: { content?, description?, dueDate?, deadlineDate?, priority? }
// deadlineDate: YYYY-MM-DD or null to clear; priority is Todoist-native (1–4).
// If the plan rejects the deadline (Pro-only), retries the update without it.
// Returns: { ok: true, deadlineDropped? } | { ok: false, error }
app.patch('/tasks/:id', async (req, res) => {
  try {
    const { content, description, dueDate, deadlineDate, priority } = req.body;
    const body = {};
    if (content !== undefined) body.content = content;
    if (description !== undefined) body.description = description;
    if (dueDate !== undefined) body.due_date = dueDate;
    if (deadlineDate !== undefined) body.deadline_date = deadlineDate;
    if (priority !== undefined) body.priority = priority;

    const url = `${API}/tasks/${encodeURIComponent(req.params.id)}`;
    let r = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    let data = await readJson(r);
    let deadlineDropped = false;
    if (!r.ok && 'deadline_date' in body && isPremiumOnlyError(data)) {
      console.warn('[todoist] deadline_date rejected (premium only) — retrying update without it');
      delete body.deadline_date;
      deadlineDropped = true;
      if (Object.keys(body).length === 0) return res.json({ ok: true, deadlineDropped });
      r = await fetch(url, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
      data = await readJson(r);
    }
    if (!r.ok) {
      console.warn('[todoist] update task failed:', data);
      return res.status(r.status).json({ ok: false, error: data });
    }
    res.json(deadlineDropped ? { ok: true, deadlineDropped } : { ok: true });
  } catch (e) {
    console.warn('[todoist] PATCH /tasks/:id error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /tasks/:id
// Returns: { ok: true } | { ok: false, error }
app.delete('/tasks/:id', async (req, res) => {
  try {
    const r = await fetch(`${API}/tasks/${encodeURIComponent(req.params.id)}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!r.ok) {
      const data = await readJson(r);
      console.warn('[todoist] delete task failed:', data);
      return res.status(r.status).json({ ok: false, error: data });
    }
    res.json({ ok: true });
  } catch (e) {
    console.warn('[todoist] DELETE /tasks/:id error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /sections/get-or-create
// Body: { name, projectId }
// Returns: { ok: true, sectionId } | { ok: false, error }
app.post('/sections/get-or-create', async (req, res) => {
  try {
    const { name, projectId } = req.body;
    if (!name || !projectId) return res.status(400).json({ ok: false, error: 'name and projectId required' });

    const listRes = await fetch(`${API}/sections?project_id=${encodeURIComponent(projectId)}`, {
      headers: authHeaders(),
    });
    const listData = await readJson(listRes);
    if (!listRes.ok) {
      console.warn('[todoist] list sections failed:', listData);
      return res.status(listRes.status).json({ ok: false, error: listData });
    }
    const sections = listData.results ?? [];

    const existing = sections.find(s => s.name === name);
    if (existing) return res.json({ ok: true, sectionId: existing.id });

    const createRes = await fetch(`${API}/sections`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ name, project_id: projectId }),
    });
    const newSection = await readJson(createRes);
    if (!createRes.ok) {
      console.warn('[todoist] create section failed:', newSection);
      return res.status(createRes.status).json({ ok: false, error: newSection });
    }
    res.json({ ok: true, sectionId: newSection.id });
  } catch (e) {
    console.warn('[todoist] POST /sections/get-or-create error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Todoist rejects plan-gated fields (e.g. deadlines on the free plan) with this error.
function isPremiumOnlyError(data) {
  return data?.error_tag === 'PREMIUM_ONLY' || data?.error_code === 32;
}

// Create a single task against the Todoist API. Returns a per-item result object.
// If deadline_date is rejected as premium-only, retries without it so the task is
// still created; the result then carries deadlineDropped: true.
async function createTask({ content, title, description, dueDate, deadlineDate, priority, projectId, sectionId }) {
  const taskContent = content ?? title;
  if (!taskContent) return { ok: false, status: 400, error: 'content (or title) required' };
  if (!projectId) return { ok: false, status: 400, error: 'projectId required' };

  const body = { content: taskContent, project_id: projectId };
  if (description) body.description = description;
  if (dueDate) body.due_date = dueDate;
  if (deadlineDate) body.deadline_date = deadlineDate;
  if (priority) body.priority = priority;
  if (sectionId) body.section_id = sectionId;

  let r = await fetch(`${API}/tasks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  let data = await readJson(r);
  let deadlineDropped = false;
  if (!r.ok && body.deadline_date && isPremiumOnlyError(data)) {
    console.warn('[todoist] deadline_date rejected (premium only) — retrying without it');
    delete body.deadline_date;
    deadlineDropped = true;
    r = await fetch(`${API}/tasks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
    data = await readJson(r);
  }
  if (!r.ok) return { ok: false, status: r.status, error: data };
  return deadlineDropped ? { ok: true, taskId: data.id, deadlineDropped } : { ok: true, taskId: data.id };
}

// POST /tasks/batch
// Body: { tasks: [{ content|title, projectId, description?, dueDate?, deadlineDate?, priority?, sectionId? }, ...] }
// Returns: { ok, created, failed, results: [...] } — 207-style: each item reports its own ok.
app.post('/tasks/batch', async (req, res) => {
  try {
    const tasks = req.body?.tasks;
    if (!Array.isArray(tasks) || tasks.length === 0) {
      return res.status(400).json({ ok: false, error: 'tasks array required' });
    }
    const results = [];
    for (const t of tasks) results.push(await createTask(t));
    const created = results.filter(r => r.ok).length;
    res.json({ ok: created > 0, created, failed: results.length - created, results });
  } catch (e) {
    console.warn('[todoist] POST /tasks/batch error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /tasks/batch-close
// Body: { ids: [taskId, ...] }
// Returns: { ok, closed, failed, results: [{ id, ok, error? }, ...] }
app.post('/tasks/batch-close', async (req, res) => {
  try {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'ids array required' });
    }
    const results = [];
    for (const id of ids) {
      const r = await fetch(`${API}/tasks/${id}/close`, { method: 'POST', headers: authHeaders() });
      if (r.ok) results.push({ id, ok: true });
      else results.push({ id, ok: false, error: await r.json().catch(() => r.statusText) });
    }
    const closed = results.filter(r => r.ok).length;
    res.json({ ok: closed > 0, closed, failed: results.length - closed, results });
  } catch (e) {
    console.warn('[todoist] POST /tasks/batch-close error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// GET /health — token presence check for callers / monitoring.
app.get('/health', (req, res) => {
  res.json({ ok: true, tokenConfigured: Boolean(process.env.TODOIST_API_TOKEN) });
});

app.listen(PORT, () => console.log(`todoist-service running on :${PORT}`));
