# SalesMesh

**Sales analytics for Kenyan small and medium enterprises.**

[![CI](https://github.com/GibsonKingori/salesmesh-/actions/workflows/ci.yml/badge.svg)](https://github.com/GibsonKingori/salesmesh-/actions/workflows/ci.yml)

SalesMesh is a web-based sales pipeline and analytics platform built for SMEs in Kenya. It gives sales representatives, managers and administrators a shared, role-aware view of deals, contacts and campaigns. It turns a business's existing records (spreadsheets, exports or even photos of a ledger) into clear performance metrics, and it keeps working when the internet connection does not.

---

## Contents

- [Key features](#key-features)
- [Technology stack](#technology-stack)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [User roles](#user-roles)
- [Importing business records](#importing-business-records)
- [Offline operation](#offline-operation)
- [Security](#security)
- [Testing and CI](#testing-and-ci)
- [Project structure](#project-structure)

---

## Key features

| Area | Capabilities |
| --- | --- |
| **Role-based dashboards** | Separate workspaces for Sales Representatives, Sales Managers and Administrators |
| **Multi-company tenancy** | Each company is fully isolated and joined by invitation code. Managers see only the reps assigned to them |
| **Pipeline management** | Kanban pipeline board, stage tracking, close dates, and a per-deal activity log. Contacts and campaigns are managed alongside deals |
| **Analytics** | KPIs, conversion funnel against targets, win rate, sales-cycle length, campaign ROI and revenue forecast, with CSV report export |
| **Flexible data import** | CSV, Excel/ODS, delimited text, JSON, and AI-assisted reading of screenshots, photos and PDFs, all previewed before saving |
| **Offline resilience** | A local PostgreSQL mirror takes over when Supabase is unreachable, and changes are synchronised automatically on reconnection |
| **Security** | JWT authentication, row-level security, account lockout, rate limiting, password-reset links and a full audit trail |
| **Accessibility** | Light, dark and system themes, with text colours chosen for WCAG AA contrast |

## Technology stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, React Router, Tailwind CSS, Recharts, Vite |
| Backend | Node.js, Express, Helmet, JSON Web Tokens, bcrypt |
| Database | Supabase (PostgreSQL) as the primary store, with an optional local PostgreSQL mirror |
| AI (optional) | Ollama (local, free) or the Claude API, for document reading and column matching |
| Testing | Jest and Supertest, run on GitHub Actions |

---

## Getting started

### Prerequisites

- **Node.js 22** or later
- A **Supabase** project ([supabase.com](https://supabase.com))
- *Optional:* **PostgreSQL** for offline mode, and **Ollama** for free local AI imports

### 1. Set up the database

1. Create a project in Supabase.
2. Open **SQL Editor**, then paste and run `backend/schema.sql`.
3. In **Project Settings → API**, copy the Project URL and the `service_role` key.

### 2. Start the API

```bash
cd backend
cp .env.example .env    # add SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and JWT_SECRET
npm install
npm run dev             # http://localhost:4000
```

### 3. Start the web app

```bash
cd frontend
npm install
npm run dev             # http://localhost:5173 (API requests are proxied to port 4000)
```

### 4. Create your company

1. Open <http://localhost:5173/login> and select **Register → Start a company**. You become the company's **Administrator**.
2. Share the **join code** shown on the admin overview with your team. Team members register with **Join a company** and start as Sales Representatives.
3. Under **Accounts**, assign roles and allocate each representative to a manager.

### 5. Load demo data (optional)

The `sample-data/` folder contains the Maven Analytics CRM sample dataset, converted to Kenyan shillings.

```bash
cd backend
DEMO_PASSWORD=<shared password> DEMO_JOIN_CODE=<your join code> \
  node scripts/seedDemoAccounts.js ../sample-data/maven-sales-teams.csv
```

This creates the demo managers and representatives (for example `moses.frase@maventech.demo`), each linked to their manager. Then sign in as an administrator or manager and import `sample-data/maven-crm-deals-kes.csv` through **Deals → Import deals**.

---

## Configuration

All server settings live in `backend/.env`. `backend/.env.example` documents every option.

| Variable | Purpose | Default |
| --- | --- | --- |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase connection | *required* |
| `JWT_SECRET` | Secret used to sign session tokens | *required* |
| `JWT_EXPIRES_IN` | Session length | `8h` |
| `DATABASE_URL` | Local PostgreSQL mirror; enables offline mode | *unset* |
| `DATA_SOURCE` | `auto`, `local` (always local) or `supabase` (never offline) | `auto` |
| `MIRROR_RETRY_SECONDS` | Delay before retrying a failed mirror write | `30` |
| `MIRROR_FULL_SYNC_MINUTES` | Interval between full mirror resyncs | `10` |
| `AI_PROVIDER` | `ollama` or `claude` | `claude` when `ANTHROPIC_API_KEY` is set, otherwise `ollama` |
| `ANTHROPIC_API_KEY` | Claude API key | *unset* |
| `OLLAMA_URL`, `OLLAMA_TEXT_MODEL`, `OLLAMA_VISION_MODEL` | Local AI settings | see `.env.example` |
| `PORT` | API port | `4000` |
| `NODE_ENV` | `development` or `production` | `development` |

Administrators can review the active server settings under **System configuration**.

---

## User roles

| Role | Route | Responsibilities |
| --- | --- | --- |
| **Sales Representative** | `/rep` | Personal dashboard; manage own deals, contacts and activities; view campaign results |
| **Sales Manager** | `/manager` | Team KPIs, pipeline and campaign analytics, team deals and contacts, CSV report export |
| **Administrator** | `/admin` | Account management (roles, enable/disable, manager assignment), conversion targets, system configuration and the audit log |

Role changes take effect on the user's next request. A disabled account cannot sign in, and any session it already has ends within about 15 seconds.

---

## Importing business records

Records are imported through **Deals → Import deals**. Supported formats:

- **Spreadsheets:** Excel (`.xlsx`, `.xls`), OpenDocument (`.ods`), CSV, and tab- or semicolon-separated text
- **Structured data:** JSON exports
- **Images and documents:** screenshots, photos and PDFs, read by AI. Files can be dragged in, or a screenshot pasted with Ctrl+V

Every import is validated and previewed before anything is saved. The preview shows the number of deals, total value, stage breakdown, new contacts, and any skipped rows with the reason. A template is provided at `sample-data/deals-import-template.csv`.

### Designed for real-world records

Businesses do not need to reformat their data to fit SalesMesh:

- **Any column names, in any order.** Common headings are matched directly. Other wording, Swahili, or files with no header row are matched by AI from the headings and sample rows, including the business's own status terms (for example "Imelipwa" or "Deposit"). Every column mapping can be reviewed and adjusted in the preview.
- **Minimal required data.** Unnamed deals take the customer's name, blank amounts become Ksh 0, and rows without a status use the stage selected in the preview. Formats such as `Ksh 45,000/=`, `22k`, `05 Mar 2026` and Excel serial dates are recognised.
- **Rows are skipped only when they cannot be used:** an amount that is not a number, a future date, or a row with no deal details. A salesperson or campaign that does not yet exist does not block the deal; it is imported without that link, and the preview says so.

### Recommended workflow

1. **Set up first.** Create user accounts and campaigns so imported deals link to them by name.
2. **Include dates** wherever possible. Without them the import date is used, which affects forecasting and sales-cycle metrics.
3. **Upload the file as-is,** then review the column mapping and status choices in the preview.
4. **Reconcile once.** Compare the Overview's won value, deal count and win rate against a spreadsheet total of the same file.

A deal's close date is recorded when it moves to won or lost, and later edits do not change it.

---

## Offline operation

Supabase remains the source of truth. When `DATABASE_URL` is set, every write is also copied to a local PostgreSQL database with matching IDs.

```bash
npm run db:setup    # create the local "salesmesh" database and tables
npm run db:sync     # copy all data from Supabase
npm run db:verify   # compare both databases row by row
```

**Self-healing mirror.** While the API is running, the local copy resyncs at startup, within 30 seconds of a failed write, and every 10 minutes. The 10-minute resync also picks up changes made directly in the Supabase dashboard.

**Automatic failover.** The API checks every 15 seconds whether Supabase can be reached. If it cannot, all reads and writes switch to the local database and an **Offline mode** banner appears in the app.

**Reconciliation.** Offline changes are logged in the `offline_changes` table. When the connection returns, they are sent to Supabase first, and only then is Supabase copied back down, so offline work is never lost. If a record was changed in both places, the offline version is kept.

**Offline AI.** Fonts are bundled with the app, and image and PDF imports work offline with Ollama. The Claude provider requires an internet connection.

Run `npm run db:verify` while connected before relying on offline mode. `GET /api/health` reports the active database, the mirror's sync status and the number of changes waiting to be sent.

---

## Security

- **Authentication:** bcrypt password hashing and signed JWT sessions
- **Authorisation:** role-based middleware on every route, plus row-level security on every table
- **Tenant isolation:** each company's data is isolated, and managers see only their assigned representatives
- **Abuse protection:** per-account login lockout, rate limiting and Helmet security headers
- **Password resets:** single-use links that expire after 30 minutes; only a hash of each link is stored
- **Auditing:** sign-ins, account changes, data changes and password resets are all recorded in a searchable, exportable audit log

### Password recovery

Users request a reset through **Forgot password?** on the login page. SalesMesh does not send email yet, so:

- **In development** (`NODE_ENV` is not `production`), the user goes straight to the reset step.
- **In production**, an administrator opens the account, selects **Create password reset link**, and sends the link to the user.

---

## Testing and CI

```bash
cd backend
npm test
```

The backend suite uses Jest and Supertest, with Supabase, PostgreSQL and the AI providers mocked. Set `TEST_DATABASE_URL` to any PostgreSQL instance to also run the offline-mode query tests.

GitHub Actions (`.github/workflows/ci.yml`) runs the backend tests and the frontend production build on every push to `main` and on every pull request.

---

## Project structure

```
salesmesh/
├── backend/
│   ├── schema.sql              # Supabase schema
│   ├── schema.postgres.sql     # Local mirror schema
│   ├── scripts/                # Database sync and demo-data seeding
│   └── src/
│       ├── config/             # Supabase, PostgreSQL and data-source selection
│       ├── middleware/         # Authentication and role checks
│       ├── routes/             # REST API endpoints
│       └── services/           # Analytics, import, AI, sync and audit logic
├── frontend/
│   └── src/
│       ├── api/                # HTTP client
│       ├── components/         # Shared UI components
│       ├── context/            # Authentication and theme state
│       └── pages/              # Role-specific pages
└── sample-data/                # Demo dataset and import template
```
