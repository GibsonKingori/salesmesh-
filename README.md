# SalesMesh

Web-based sales analytics dashboard for Kenyan SMEs. PERN stack (PostgreSQL/Supabase, Express, React, Node).

## Iteration 1 checklist (target: 30% by Oct 2)
- [x] Repo structure
- [x] Express skeleton + JWT auth (register/login)
- [x] Role-based middleware (`requireAuth`, `requireRole`)
- [x] Supabase schema for User, Deal, Contact, Campaign, Activity
- [x] React + Tailwind skeleton with role-based routing
- [ ] Supabase project actually created and schema run
- [ ] `.env` filled in and both servers running locally
- [ ] First real login working end-to-end
- [ ] Push to GitHub, first commit

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
  -d '{"name":"Gibson","email":"gibson@example.com","password":"changeme","role":"manager"}'
```
Then log in at http://localhost:5173/login.

## What's next (Iteration 2, Oct 3–14)
- Full deal CRUD UI, pipeline-stage board, descriptive analytics charts (Recharts)
- Contacts CRUD
- CSV import endpoint
