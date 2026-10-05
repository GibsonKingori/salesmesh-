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
- [x] Bulk import for deals from CSV, Excel/ODS, text, JSON, or a screenshot/PDF read by AI, with per-row validation and error reporting
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

### 2b. Local PostgreSQL mirror (optional)
Supabase is the source of truth. When `DATABASE_URL` is set in `backend/.env`, every write is also copied into a local PostgreSQL database with the same IDs.
```bash
npm run db:setup    # create the UTF-8 "salesmesh" database and tables (schema.postgres.sql)
npm run db:sync     # copy everything from Supabase; remove local rows Supabase no longer has
npm run db:verify   # row-by-row comparison of both databases
```
The local copy repairs itself while the API is running. It resyncs at startup, within 30s of a failed copy (for example, PostgreSQL was stopped), and every 10 minutes, which also picks up edits made in the Supabase dashboard. Check `GET /api/health` → `postgresMirror` for `inSync` and `lastError`. To change the timing, set `MIRROR_RETRY_SECONDS` and `MIRROR_FULL_SYNC_MINUTES`.

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

On the **Register** tab, choose **Start a company** to create a new company: you become its **Admin**, and the admin overview shows a join code to share with your team. Everyone else chooses **Join a company** and enters that code; they join as **Sales Reps**. The admin then changes roles and assigns each rep to a manager under **Accounts**. Companies never see each other's data, and a manager only sees the reps assigned to them.

### Dashboards by role (Chapter 4 use case diagram)
- **Sales Representative** (`/rep`): own dashboard, deals, contacts, activities and campaign results.
- **Sales Manager** (`/manager`): team KPIs, pipeline and campaign analytics, deals, contacts, and **Export report** (CSV) on the Overview and Campaigns pages.
- **Administrator** (`/admin`): system overview with account search, **Accounts** (search, change roles, enable/disable, and open an account to add or delete its deals and campaigns), **System configuration** (conversion targets plus server settings) and the **Audit log** (filter by day, person and area; export to CSV).

### Importing an SME's records
Use **Deals → Import deals**. Upload a spreadsheet (Excel `.xlsx`/`.xls`, OpenDocument `.ods`, CSV, or tab/semicolon-separated text), a JSON export, or a **screenshot, photo or PDF** of the records (drag it in, or paste a screenshot with Ctrl+V). Pictures and PDFs are read by AI: free on your own computer with Ollama (`AI_PROVIDER=ollama`, see `backend/.env.example`), or Claude with an API key (`AI_PROVIDER=claude`); the rows it read are shown so you can check them against the picture, and exactly those rows are imported. The app checks the file first and shows what it will do (deals, total value, stages, new contacts, skipped rows and why). Nothing is saved until you confirm. The template is `sample-data/deals-import-template.csv`.

The business doesn't need to change its records to fit SalesMesh:
- **Any column names, in any order.** Known headings ("Amount", "Customer", "Date sold", ...) are matched directly; anything else (other wording, Swahili, no heading row at all) is matched by AI from the headings and sample rows, along with the business's own status words ("Imelipwa", "Deposit", ...). Without AI, amount, date and phone columns are recognised from their contents. The preview lists every column and what it was read as, and any of them can be changed before importing.
- **Nothing is strictly required.** A deal with no name is named after its customer, a blank amount is Ksh 0, and rows with no status are imported as the stage you choose in the preview (completed sales by default). One date on a sale is used as both its start and close date. Amounts like `Ksh 45,000/=`, `22k` and dates like `05 Mar 2026` or Excel date numbers are understood.
- **Rows are only skipped when they can't be used** (an amount that isn't a number, a date in the future, or no deal details at all). A salesperson or campaign that isn't in SalesMesh yet doesn't stop the deal: it's imported without that link, and the preview says so.

For the most accurate results:
1. **Set up first:** create every salesperson's account and the campaigns (Campaigns page), so deals are linked to them by name.
2. **Include dates** where you have them: when the enquiry came in and when the deal was won or lost. Without them the import day is used, which skews the forecast and sales cycle.
3. **Upload the file as it is,** check the preview (especially the columns list and the status choice), and import.
4. **Check once:** compare the Overview's won value, deal count and win rate with a spreadsheet total of the same file.

A deal's close date (`closed_at`) is recorded when it moves to won or lost and isn't changed by later edits.


A disabled user can't log in, and any session they already have stops working within about 15 seconds. Role changes also apply on the user's next request.

### Forgotten passwords
**Forgot password?** on the login page asks for an email, then opens a page to choose a new password. Reset links work once and expire after 30 minutes; only a hash of each link is stored. SalesMesh doesn't send email yet, so:
- outside production (`NODE_ENV` not `production`), the page goes straight to the reset step;
- in production, an admin opens the account and uses **Create password reset link**, then sends the link to the user.

Requests, completed resets and admin-issued links all appear in the audit log.

## What's next (Iteration 2, Oct 3–14)
- Pipeline-stage board view, descriptive analytics charts (Recharts)
- Contacts and activity-log UI (backend already done)
- Deal edit/delete UI (currently create + list only)
- Push repo to GitHub, wire up GitHub Actions to run Jest/Supertest on push
