// routes/index.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const { requireAuth, pool } = require('./users');
const JWT_SECRET =  'dev-secret-change-me';
const STATUSES = ['Backlog', 'In Progress', 'Review', 'Done'];
const PRIORITIES = ['Low', 'Medium', 'High'];

// Cookie-based page guard (redirects to /auth if missing/invalid)
function requirePageAuth(req, res, next) {
  console.log(req.cookies)
  const token = (req.cookies && req.cookies.token) || null;
  console.log(token)
  if (!token) return res.redirect('/auth');
  try {
    console.log(token, JWT_SECRET)
    const payload = jwt.verify(token, JWT_SECRET); // { uid, email }
    console.log(payload)
    req.user = payload;
    console.log(req.user)
    next();
  } catch {
    return res.redirect('/auth');
  }
}

// Compute badge in JS from DB fields
function computeBadge(task) {
  const now = Date.now();
  const due = task.due_date ? new Date(task.due_date).getTime() : null;

  if (!due) return 'On Track';
  if (task.status === 'Done') return 'On Track';
  if (now > due) return 'Overdue';
  const diffHours = (due - now) / (1000 * 60 * 60);
  return diffHours <= 24 ? 'At Risk' : 'On Track';
}

// ---- Page routes ----

// Optional: redirect home → /board (protected). If not logged in, /board will bounce to /auth.
// Example route
 
router.get('/',(req,res)=>{
  res.render('auth', { title: 'Sign Up / Login' });
})
// Auth (public)
// Auth (public). If logged in, you can choose to redirect to /board or show logout UI.
router.get('/auth', (req, res) => {
  const token=req.cookies.token
  if(token){
    const payload = jwt.verify(token, JWT_SECRET); // { uid, email }
    console.log(payload)
    req.user = payload;
  }
  if (req.user) {
    // Send title + user (so auth.jade can show "Welcome back, #{user.email}")
    return res.render('auth', { title: 'Sign Up / Login', user: req.user });
  }
  // No user -> send only title as requested
  res.render('auth', { title: 'Sign Up / Login' });
});

// Board (protected)
router.get('/board', requirePageAuth, (req, res) => {
  res.render('board', { title: 'Task Board', user: req.user });
});

// Task details viewer (protected)
router.get('/tasks/view', requirePageAuth, (req, res) => {
  res.render('task_view', { title: 'Task Details', user: req.user });
});

// ---- API routes (JWT via header OR cookie) ----

// GET /tasks?assigneeId=&priority=
router.get('/tasks', requirePageAuth, async (req, res, next) => {
  try {
    const { assigneeId, priority } = req.query;
    const where = [];
    const vals = [];
    if (assigneeId) { vals.push(Number(assigneeId)); where.push(`assignee_id = $${vals.length}`); }
    if (priority)   { vals.push(priority);           where.push(`priority = $${vals.length}`); }

    const sql = `
      SELECT id, title, description, priority, assignee_id, status, due_date, created_at, updated_at
      FROM tasks
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY id DESC
    `;
    const r = await pool.query(sql, vals);
    const tasks = r.rows.map(t => ({
      ...t,
      statusBadge: computeBadge(t)
    }));
    res.json({ tasks });
  } catch (e) { next(e); }
});

// GET /tasks/:id
router.get('/tasks/:id', requirePageAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const tr = await pool.query(
      'SELECT id, title, description, priority, assignee_id, status, due_date, created_at, updated_at FROM tasks WHERE id=$1',
      [id]
    );
    if (tr.rowCount === 0) return res.status(404).json({ error: 'task not found' });
    const task = tr.rows[0];

    const cr = await pool.query(
      'SELECT id, task_id, author_id, body, created_at FROM comments WHERE task_id=$1 ORDER BY id ASC',
      [id]
    );
    res.json({ task: { ...task, statusBadge: computeBadge(task) }, comments: cr.rows });
  } catch (e) { next(e); }
});

// POST /tasks
router.post('/tasks', requirePageAuth, async (req, res, next) => {
  try {
    const { title, description = '', priority = 'Medium', assigneeId = null, dueDate = null } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title required' });
    if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'invalid priority' });

    if (assigneeId !== null) {
      const ar = await pool.query('SELECT id FROM users WHERE id=$1', [Number(assigneeId)]);
      if (ar.rowCount === 0) return res.status(400).json({ error: 'assignee not found' });
    }

    const r = await pool.query(
      `INSERT INTO tasks (title, description, priority, assignee_id, status, due_date)
       VALUES ($1,$2,$3,$4,'Backlog',$5)
       RETURNING id, title, description, priority, assignee_id, status, due_date, created_at, updated_at`,
      [title, description, priority, assigneeId, dueDate]
    );
    const task = r.rows[0];
    res.status(201).json({ task: { ...task, statusBadge: computeBadge(task) } });
  } catch (e) { next(e); }
});

// PATCH /tasks/:id
router.patch('/tasks/:id', requirePageAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const { title, description, priority, assigneeId, status, dueDate } = req.body || {};

    const sets = [];
    const vals = [];
    const set = (col, val) => { vals.push(val); sets.push(`${col} = $${vals.length}`); };

    if (title !== undefined) set('title', title);
    if (description !== undefined) set('description', description);
    if (priority !== undefined) {
      if (!PRIORITIES.includes(priority)) return res.status(400).json({ error: 'invalid priority' });
      set('priority', priority);
    }
    if (assigneeId !== undefined) {
      if (assigneeId !== null) {
        const ar = await pool.query('SELECT id FROM users WHERE id=$1', [Number(assigneeId)]);
        if (ar.rowCount === 0) return res.status(400).json({ error: 'assignee not found' });
      }
      set('assignee_id', assigneeId);
    }
    if (status !== undefined) {
      if (!STATUSES.includes(status)) return res.status(400).json({ error: 'invalid status' });
      set('status', status);
    }
    if (dueDate !== undefined) set('due_date', dueDate);

    if (sets.length === 0) return res.status(400).json({ error: 'no changes provided' });

    vals.push(id);
    const sql = `
      UPDATE tasks SET ${sets.join(', ')}
      WHERE id = $${vals.length}
      RETURNING id, title, description, priority, assignee_id, status, due_date, created_at, updated_at
    `;
    const r = await pool.query(sql, vals);
    if (r.rowCount === 0) return res.status(404).json({ error: 'task not found' });

    const task = r.rows[0];
    res.json({ task: { ...task, statusBadge: computeBadge(task) } });
  } catch (e) { next(e); }
});

// DELETE /tasks/:id
router.delete('/tasks/:id', requirePageAuth, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const r = await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'task not found' });
    res.status(204).end();
  } catch (e) { next(e); }
});

// POST /tasks/:id/comments
router.post('/tasks/:id/comments', requirePageAuth, async (req, res, next) => {
  try {
    const taskId = Number(req.params.id);
    const { body } = req.body || {};
    if (!body || !String(body).trim()) return res.status(400).json({ error: 'comment body required' });

    const tr = await pool.query('SELECT id FROM tasks WHERE id=$1', [taskId]);
    if (tr.rowCount === 0) return res.status(404).json({ error: 'task not found' });

    const cr = await pool.query(
      'INSERT INTO comments (task_id, author_id, body) VALUES ($1,$2,$3) RETURNING id, task_id, author_id, body, created_at',
      [taskId, req.user.uid, String(body).trim()]
    );
    res.status(201).json({ comment: cr.rows[0] });
  } catch (e) { next(e); }
});

module.exports = router;
