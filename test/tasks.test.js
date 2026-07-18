import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';

process.env.NODE_ENV = 'test';
process.env.ALLOW_NO_ACCESS_HEADER = '1';
process.env.TODOIST_API_TOKEN = 'test-token';

const { app } = await import('../server.js');

const nativeFetch = global.fetch;

let server;
let baseUrl;
let calls;
let responses;

before(async () => {
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  calls = [];
  responses = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options, body: options.body ? JSON.parse(options.body) : null });
    const next = responses.shift() ?? { status: 200, body: { id: 'task-1' } };
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { 'content-type': 'application/json' } });
  };
});

async function request(path, options) {
  const response = await nativeFetch(`${baseUrl}${path}`, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options?.headers ?? {}) },
  });
  return { response, body: await response.json() };
}

test('POST /tasks forwards dueDate and deadlineDate to Todoist fields', async () => {
  const { response, body } = await request('/tasks', {
    method: 'POST',
    body: JSON.stringify({
      content: 'Heat pump - Service',
      description: 'home-task:42',
      dueDate: '2026-08-15',
      deadlineDate: '2026-08-31',
      priority: 4,
      projectId: 'home-project',
    }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true, taskId: 'task-1' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.todoist.com/api/v1/tasks');
  assert.deepEqual(calls[0].body, {
    content: 'Heat pump - Service',
    project_id: 'home-project',
    description: 'home-task:42',
    due_date: '2026-08-15',
    deadline_date: '2026-08-31',
    priority: 4,
  });
});

test('POST /tasks remains backward compatible when deadlineDate is omitted', async () => {
  const { response } = await request('/tasks', {
    method: 'POST',
    body: JSON.stringify({ content: 'Change filter', dueDate: '2026-08-15', projectId: 'home-project' }),
  });

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body, {
    content: 'Change filter',
    project_id: 'home-project',
    due_date: '2026-08-15',
  });
});

test('PATCH /tasks/:id forwards dueDate and deadlineDate to Todoist update fields', async () => {
  responses.push({ status: 200, body: { id: 'task-1' } });

  const { response, body } = await request('/tasks/task-1', {
    method: 'PATCH',
    body: JSON.stringify({ dueDate: '2026-09-01', deadlineDate: '2026-09-10', priority: 2 }),
  });

  assert.equal(response.status, 200);
  assert.deepEqual(body, { ok: true });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.todoist.com/api/v1/tasks/task-1');
  assert.equal(calls[0].options.method, 'POST');
  assert.deepEqual(calls[0].body, { due_date: '2026-09-01', deadline_date: '2026-09-10', priority: 2 });
});

test('create and update reject invalid dates and deadline before due date before upstream calls', async () => {
  for (const [path, method, payload] of [
    ['/tasks', 'POST', { content: 'Bad', projectId: 'home-project', dueDate: '2026-2-01' }],
    ['/tasks', 'POST', { content: 'Bad', projectId: 'home-project', dueDate: '2026-08-15', deadlineDate: '2026-08-14' }],
    ['/tasks/task-1', 'PATCH', { deadlineDate: 'not-a-date' }],
    ['/tasks/task-1', 'PATCH', { dueDate: '2026-08-15', deadlineDate: '2026-08-14' }],
  ]) {
    const { response, body } = await request(path, { method, body: JSON.stringify(payload) });
    assert.equal(response.status, 400);
    assert.equal(body.ok, false);
  }

  assert.equal(calls.length, 0);
});

test('upstream non-2xx create failures return safe error envelope', async () => {
  responses.push({ status: 503, body: { error: 'todoist unavailable' } });

  const { response, body } = await request('/tasks', {
    method: 'POST',
    body: JSON.stringify({ content: 'Try later', dueDate: '2026-08-15', deadlineDate: '2026-08-31', projectId: 'home-project' }),
  });

  assert.equal(response.status, 503);
  assert.deepEqual(body, { ok: false, error: { error: 'todoist unavailable' } });
  assert.equal(calls.length, 1);
});