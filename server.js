import 'dotenv/config';
import express from 'express';

const app = express();
app.use(express.json());

const API = 'https://api.todoist.com/api/v1';
const PORT = process.env.PORT ?? 3010;

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
    if (!projectId) return res.json({ ok: false, error: 'projectId required' })
    const r = await fetch(`${API}/tasks?project_id=${projectId}`, { headers: authHeaders() })
    const data = await r.json()
    if (!r.ok) return res.json({ ok: false, error: data })
    res.json({ ok: true, tasks: data.results ?? data })
  } catch (e) {
    console.warn('[todoist] GET /tasks error:', e.message)
    res.json({ ok: false, error: e.message })
  }
})

// GET /tasks/:id
// Returns: { ok: true, task: {...} } | { ok: false, error }
app.get('/tasks/:id', async (req, res) => {
  try {
    const r = await fetch(`${API}/tasks/${req.params.id}`, { headers: authHeaders() })
    const data = await r.json()
    if (!r.ok) return res.json({ ok: false, error: data })
    res.json({ ok: true, task: data })
  } catch (e) {
    console.warn('[todoist] GET /tasks/:id error:', e.message)
    res.json({ ok: false, error: e.message })
  }
})

// POST /tasks
// Body: { content, title (alias), description?, dueDate?, projectId, sectionId? }
// Returns: { ok: true, taskId } | { ok: false, error }
app.post('/tasks', async (req, res) => {
  try {
    const { content, title, description, dueDate, projectId, sectionId } = req.body;
    const body = { content: content ?? title, project_id: projectId };
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
      return res.json({ ok: false, error: data });
    }
    res.json({ ok: true, taskId: data.id });
  } catch (e) {
    console.warn('[todoist] POST /tasks error:', e.message);
    res.json({ ok: false, error: e.message });
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
      return res.json({ ok: false, error: data });
    }
    res.json({ ok: true });
  } catch (e) {
    console.warn('[todoist] POST /tasks/:id/close error:', e.message);
    res.json({ ok: false, error: e.message });
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
      return res.json({ ok: false, error: data });
    }
    res.json({ ok: true });
  } catch (e) {
    console.warn('[todoist] PATCH /tasks/:id error:', e.message);
    res.json({ ok: false, error: e.message });
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
      return res.json({ ok: false, error: data });
    }
    res.json({ ok: true });
  } catch (e) {
    console.warn('[todoist] DELETE /tasks/:id error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

// POST /sections/get-or-create
// Body: { name, projectId }
// Returns: { ok: true, sectionId } | { ok: false, error }
app.post('/sections/get-or-create', async (req, res) => {
  try {
    const { name, projectId } = req.body;

    const listRes = await fetch(`${API}/sections?project_id=${projectId}`, {
      headers: authHeaders(),
    });
    const listData = await listRes.json();
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
      return res.json({ ok: false, error: newSection });
    }
    res.json({ ok: true, sectionId: newSection.id });
  } catch (e) {
    console.warn('[todoist] POST /sections/get-or-create error:', e.message);
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => console.log(`todoist-service running on :${PORT}`));
