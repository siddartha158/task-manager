# Team Task Board — Express + Jade + Postgres

 
## 🚀 Quick Start

### 1) Prereqs

* Node.js 18+
* PostgreSQL (Neon/Railway/local)

### 2) Clone & install

```bash
git clone <your-repo-url> taskboard
cd taskboard
npm install
```

### 3) Environment

Create `.env`:

```bash
PORT=3000
NODE_ENV=development

# Postgres
DATABASE_URL=postgres://user:pass@host:5432/dbname
DATABASE_SSL=false   # true if your DB requires SSL

# JWT
JWT_SECRET=super-secret
# Set this only if FE/BE are different origins (cross-site cookies)
# CROSS_SITE_COOKIES=1
```

### 4) Run

```bash
npm run dev       # nodemon
# or
npm start
```

Open: `http://localhost:3000`

> Migrations run **inline on boot** (tables + trigger for `updated_at`).

---

## 📁 Folder Structure

```
taskboard/
├─ app.js
├─ package.json
├─ .env
├─ routes/
│  ├─ index.js            # pages + task & comment APIs
│  └─ users.js            # users: signup/login/logout/me; pool; migrations; requireAuth
├─ middleware/
│  ├─ attachUser.js       # optional: attaches req.user from cookie to res.locals.user
│  └─ requirePageAuth.js  # redirect to /auth if no cookie user
├─ views/
│  ├─ layout.jade         # global layout (topbar/footer)
│  ├─ index.jade          # landing (tiles differ if logged-in)
│  ├─ auth.jade           # signup/login (or logout if logged-in)
│  ├─ board.jade          # task board + create, filter, move, comment
│  └─ task_view.jade      # view task details by ID
├─ public/
│  └─ stylesheets/style.css  # optional (we mostly use inline styles)
```

---

## 🔐 Auth Model

* **Signup/Login** returns JSON *and* sets `token` **httpOnly cookie**:

  * `sameSite=lax` in same-origin dev
  * `sameSite=none; secure=true` if `CROSS_SITE_COOKIES=1` (for cross-origin)
* **Page guard** (`requirePageAuth`) verifies cookie and redirects to `/auth`.
* **API guard** (`requireAuth`) accepts **Authorization: Bearer** or cookie.

---

## 🌐 Page Routes (Views)

| Route             | Guard                                               | View              | Notes                                           |
| ----------------- | --------------------------------------------------- | ----------------- | ----------------------------------------------- |
| `GET /`           | —                                                   | redirect→`/board` |                                                 |
| `GET /auth`       | public; if logged-in → redirect→`/board` (optional) | `auth.jade`       | Shows signup/login or logout if `user` exists   |
| `GET /board`      | `requirePageAuth`                                   | `board.jade`      | Create tasks, filter, move status, add comments |
| `GET /tasks/view` | `requirePageAuth`                                   | `task_view.jade`  | Fetch task by ID and view JSON                  |

---

## 🧭 REST API

### Users

```
POST   /users/signup
Body: { "email":"a@b.com", "password":"secret" }
Resp: { "token":"<jwt>", "user": { "id":1, "email":"a@b.com" } } + sets cookie

POST   /users/login
Body: { "email":"a@b.com", "password":"secret" }
Resp: { "token":"<jwt>", "user": { "id":1, "email":"a@b.com" } } + sets cookie

POST   /users/logout
Resp: 204 + clears cookie, typically redirects to /auth (if using GET route)

GET    /users/me
Auth:  Cookie or Bearer token
Resp: { "id":1, "email":"a@b.com" }
```

### Tasks

```
GET    /tasks?assigneeId=&priority=
Auth:  Cookie or Bearer
Resp:  { "tasks":[
          { id, title, description, priority, assignee_id, status, due_date,
            created_at, updated_at, statusBadge: "On Track|At Risk|Overdue" }
        ]}

GET    /tasks/:id
Auth:  Cookie or Bearer
Resp:  { task: {..., statusBadge}, comments: [{ id, author_id, body, created_at }, ...] }

POST   /tasks
Auth:  Cookie or Bearer
Body:  { title, description?, priority?("Low|Medium|High"), assigneeId?, dueDate? (ISO) }
Resp:  { task: {..., statusBadge} }

PATCH  /tasks/:id
Auth:  Cookie or Bearer
Body:  Any of { title, description, priority, assigneeId, status("Backlog|In Progress|Review|Done"), dueDate }
Resp:  { task: {..., statusBadge} }

DELETE /tasks/:id
Auth:  Cookie or Bearer
Resp:  204
```

### Comments

```
POST   /tasks/:id/comments
Auth:  Cookie or Bearer
Body:  { body }
Resp:  { comment: { id, task_id, author_id, body, created_at } }
```

---

## 🗄️ Database Schema (Postgres)

* **users**: `id`, `email` (unique), `password_hash`, `created_at`
* **tasks**: `id`, `title`, `description`, `priority`(`Low|Medium|High`), `assignee_id` (FK users), `status`(`Backlog|In Progress|Review|Done`), `due_date`, `created_at`, `updated_at`
* **comments**: `id`, `task_id` (FK tasks), `author_id` (FK users), `body`, `created_at`

A trigger maintains `tasks.updated_at` on update. All created by the **inline migration** on server start.

---

## 🔧 Sample cURL

```bash
# Signup (cookie set)
curl -i -X POST http://localhost:3000/users/signup \
 -H "Content-Type: application/json" \
 -d '{"email":"a@b.com","password":"secret"}'

# Login (cookie set)
curl -i -X POST http://localhost:3000/users/login \
 -H "Content-Type: application/json" \
 -d '{"email":"a@b.com","password":"secret"}'

# Create a task (using cookie)
curl -i -X POST http://localhost:3000/tasks \
 -H "Content-Type: application/json" \
 -d '{"title":"Draft PRD","priority":"High","assigneeId":1,"dueDate":"2025-09-01T09:00:00.000Z"}'

# Move task to "In Progress"
curl -i -X PATCH http://localhost:3000/tasks/1 \
 -H "Content-Type: application/json" \
 -d '{"status":"In Progress"}'
```

---
 