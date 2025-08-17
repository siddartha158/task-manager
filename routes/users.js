// routes/users.js
const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

/**
 * ENV required:
 *   DATABASE_URL="postgres://user:pass@host:5432/dbname"
 * Optional:
 *   DATABASE_SSL=true   // enables ssl: { rejectUnauthorized: false }
 *   JWT_SECRET="something-strong"
 */
const JWT_SECRET =  'dev-secret-change-me';
const TOKEN_TTL = '7d';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://neondb_owner:npg_8OKpTwAoP5NZ@ep-icy-mode-a1j6br72-pooler.ap-southeast-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
  ssl: (process.env.DATABASE_SSL || '').toLowerCase() === 'true'
    ? { rejectUnauthorized: false }
    : undefined,
});

// --- Inline migrations (runs once per process start) ---
let _migrated = false;
async function migrate() {
  if (_migrated) return;
  _migrated = true;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL CHECK (priority IN ('Low','Medium','High')),
      assignee_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      status TEXT NOT NULL CHECK (status IN ('Backlog','In Progress','Review','Done')) DEFAULT 'Backlog',
      due_date TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS comments (
      id SERIAL PRIMARY KEY,
      task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    -- Trigger to keep updated_at fresh
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_trigger WHERE tgname = 'tasks_set_updated_at'
      ) THEN
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $f$
        BEGIN
          NEW.updated_at = now();
          RETURN NEW;
        END;$f$ LANGUAGE plpgsql;

        CREATE TRIGGER tasks_set_updated_at
        BEFORE UPDATE ON tasks
        FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
      END IF;
    END$$;
  `);
}

// Helpers
function signToken(user) {
  return jwt.sign({ uid: user.id, email: user.email }, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function requireAuth(req, res, next) {
  const hdr = req.headers.authorization || '';
  const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload; // { uid, email }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Ensure migration before any route work
router.use(async (req, res, next) => {
  try { await migrate(); next(); } catch (e) { next(e); }
});

// POST /users/signup
router.post('/signup', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });

    const exists = await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)', [email]);
    if (exists.rowCount > 0) return res.status(409).json({ error: 'email already registered' });

    const passwordHash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
      [email, passwordHash]
    );

    const user = inserted.rows[0];
    const token = signToken(user);
    res.status(201).json({ token, user });
  } catch (e) { next(e); }
});

function cookieOpts() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    sameSite: true ? "lax" : "lax",
    secure: true, // must be true in HTTPS (prod)
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  };
}
// POST /users/login
router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = req.body || {};
    console.log("[LOGIN] Incoming body:", req.body);

    if (!email || !password) {
      console.warn("[LOGIN] Missing email or password");
      return res.status(400).json({ error: 'email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password_hash FROM users WHERE lower(email)=lower($1)',
      [email]
    );
    console.log("[LOGIN] Query result:", result.rowCount, result.rows);

    if (result.rowCount === 0) {
      console.warn("[LOGIN] No user found with email:", email);
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const user = result.rows[0];
    console.log("[LOGIN] Found user:", user);

    const ok = await bcrypt.compare(password, user.password_hash);
    console.log("[LOGIN] Password check:", ok);

    if (!ok) {
      console.warn("[LOGIN] Invalid password for email:", email);
      return res.status(401).json({ error: 'invalid credentials' });
    }

    const token = signToken({ id: user.id, email: user.email });
    console.log("[LOGIN] Login success. Token generated.");
    
    res.cookie("token", token, cookieOpts());


    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (e) {
    console.error("[LOGIN] Error occurred:", e);
    next(e);
  }
});

// GET /users/me
router.get('/me', requireAuth, async (req, res, next) => {
  try {
    const r = await pool.query('SELECT id, email FROM users WHERE id=$1', [req.user.uid]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'not found' });
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});


// routes/users.js
function cookieClearOpts() {
  const crossSite = !!process.env.CROSS_SITE_COOKIES; // set "1" if FE & BE are different origins
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure:   crossSite ? true   : isProd,
    path: '/', // match the path you used when setting the cookie
  };
}

// POST /users/logout (for form submits)
router.post('/logout', (req, res) => {
  res.clearCookie('token', cookieClearOpts());
  return res.redirect(303, '/auth');
});

// GET /users/logout (optional: for simple links)
router.get('/logout', (req, res) => {
  res.clearCookie('token', cookieClearOpts());
  return res.redirect(303, '/auth');
});

module.exports = { router, requireAuth, pool };
