import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

const API = 'https://api.todoist.com/api/v1';
const PORT = process.env.PORT ?? 3010;

if (!process.env.TODOIST_API_TOKEN) {
  console.warn('[todoist] WARNING: TODOIST_API_TOKEN is not set — all upstream calls will 401.');
}

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.TODOIST_API_TOKEN}`,
    'Content-Type': 'application/json',
  };
}

// GET /tasks?projectId=X
// Returns: { ok: true, tasks: [...] } | { ok: false, error }
app.get('/tasks', async (req, res) => {
  try {
    const { projectId } = req.query
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId required' })
    const r = await fetch(`${API}/tasks?project_id=${projectId}`, { headers: authHeaders() })
    const data = await r.json()
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
    const r = await fetch(`${API}/tasks/${req.params.id}`, { headers: authHeaders() })
    const data = await r.json()
    if (!r.ok) return res.status(r.status).json({ ok: false, error: data })
    res.json({ ok: true, task: data })
  } catch (e) {
    console.warn('[todoist] GET /tasks/:id error:', e.message)
    res.status(500).json({ ok: false, error: e.message })
  }
})

// POST /tasks
// Body: { content, title (alias), description?, dueDate?, projectId, sectionId? }
// Returns: { ok: true, taskId } | { ok: false, error }
app.post('/tasks', async (req, res) => {
  try {
    const { content, title, description, dueDate, projectId, sectionId } = req.body;
    const taskContent = content ?? title;
    if (!taskContent) return res.status(400).json({ ok: false, error: 'content (or title) required' });
    if (!projectId) return res.status(400).json({ ok: false, error: 'projectId required' });

    const body = { content: taskContent, project_id: projectId };
    if (description) body.description = description;
    if (dueDate) body.due_date = dueDate;
    if (sectionId) body.section_id = sectionId;

    const r = await fetch(`${API}/tasks`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      console.warn('[todoist] create task failed:', data);
      return res.status(r.status).json({ ok: false, error: data });
    }
    res.json({ ok: true, taskId: data.id });
  } catch (e) {
    console.warn('[todoist] POST /tasks error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// POST /tasks/:id/close
// Returns: { ok: true } | { ok: false, error }
app.post('/tasks/:id/close', async (req, res) => {
  try {
    const r = await fetch(`${API}/tasks/${req.params.id}/close`, {
      method: 'POST',
      headers: authHeaders(),
    });
    if (!r.ok) {
      const data = await r.json();
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
// Body: { content?, description?, dueDate? }
// Returns: { ok: true } | { ok: false, error }
app.patch('/tasks/:id', async (req, res) => {
  try {
    const { content, description, dueDate } = req.body;
    const body = {};
    if (content !== undefined) body.content = content;
    if (description !== undefined) body.description = description;
    if (dueDate !== undefined) body.due_date = dueDate;

    const r = await fetch(`${API}/tasks/${req.params.id}`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) {
      console.warn('[todoist] update task failed:', data);
      return res.status(r.status).json({ ok: false, error: data });
    }
    res.json({ ok: true });
  } catch (e) {
    console.warn('[todoist] PATCH /tasks/:id error:', e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// DELETE /tasks/:id
// Returns: { ok: true } | { ok: false, error }
app.delete('/tasks/:id', async (req, res) => {
  try {
    const r = await fetch(`${API}/tasks/${req.params.id}`, {
      method: 'DELETE',
      headers: authHeaders(),
    });
    if (!r.ok) {
      const data = await r.json();
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

    const listRes = await fetch(`${API}/sections?project_id=${projectId}`, {
      headers: authHeaders(),
    });
    const listData = await listRes.json();
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
    const newSection = await createRes.json();
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

// Create a single task against the Todoist API. Returns a per-item result object.
async function createTask({ content, title, description, dueDate, projectId, sectionId }) {
  const taskContent = content ?? title;
  if (!taskContent) return { ok: false, error: 'content (or title) required' };
  if (!projectId) return { ok: false, error: 'projectId required' };

  const body = { content: taskContent, project_id: projectId };
  if (description) body.description = description;
  if (dueDate) body.due_date = dueDate;
  if (sectionId) body.section_id = sectionId;

  const r = await fetch(`${API}/tasks`, { method: 'POST', headers: authHeaders(), body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) return { ok: false, error: data };
  return { ok: true, taskId: data.id };
}

// POST /tasks/batch
// Body: { tasks: [{ content|title, projectId, description?, dueDate?, sectionId? }, ...] }
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
