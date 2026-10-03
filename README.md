# SalesMesh

Web-based sales analytics dashboard for Kenyan SMEs. PERN stack (PostgreSQL/Supabase, Express, React, Node).

## Iteration 1 checklist (target: 30% by Oct 2)
- [x] Repo structure
- [x] Express skeleton + JWT auth (register/login)
- [x] Role-based middleware (`requireAuth`, `requireRole`)
- [x] Supabase schema for User, Deal, Contact, Campaign, Activity
- [x] React + Tailwind skeleton with role-based routing
- [x] Supabase project actually created and schema run
- [x] `.env` filled in and both servers running locally
- [x] First real login working end-to-end
- [x] First commit made locally
- [ ] Push to GitHub (no remote configured yet)

## Ahead of Iteration 1 (pulled forward from later iterations)
- [x] Deal CRUD (create + list) with a real "Add deal" UI
- [x] CSV bulk import for deals, with per-row validation and error reporting
- [x] Contacts CRUD (API)
- [x] Activity log CRUD (API)
- [x] Row-Level Security enabled on all five tables (`users`, `contacts`, `campaigns` were flagged by Supabase's advisor and have since been locked to `service_role` only)

## Setup

### 1. Supabase
1. Create a project at supabase.com.
2. Go to SQL Editor → paste and run `backend/schema.sql`.
3. Go to Project Settings → API → copy the Project URL and `service_role` key.

### 2. Backend
```bash
cd backend
cp .env.example .env   # fill in SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET
npm install
npm run dev             # http://localhost:4000
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev              # http://localhost:5173
```

### 4. Create your first user
```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Gibson","email":"gibson@example.com","password":"changeme123"}'
```
Then log in at http://localhost:5173/login.

Every sign-up starts as a **representative**, and the API ignores any `role` sent to it. An admin changes roles under **Settings → Team & roles**. For a brand-new database with no admin yet, promote the first one in the Supabase SQL Editor, then run `npm run db:sync` so local PostgreSQL gets the change too:
```sql
update users set role = 'admin' where email = 'gibson@example.com';
```

## What's next (Iteration 2, Oct 3–14)
- Pipeline-stage board view, descriptive analytics charts (Recharts)
- Contacts and activity-log UI (backend already done)
- Deal edit/delete UI (currently create + list only)
- Push repo to GitHub, wire up GitHub Actions to run Jest/Supertest on push
