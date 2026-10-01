-- SalesMesh database schema
-- LOCAL POSTGRESQL MIRROR of schema.sql. Keep the two in step.
-- Row-level security and the anon/authenticated grants are Supabase-only and left out;
-- the API enforces access rules and is the only writer here.
-- Apply with: npm run db:setup
-- Matches the five ERD entities: User, Deal, Contact, Campaign, Activity

create extension if not exists "uuid-ossp";

-- USERS -------------------------------------------------------------
create table if not exists users (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  email text unique not null,
  password_hash text not null,
  role text not null check (role in ('manager', 'representative', 'admin')),
  created_at timestamptz not null default now()
);

-- CONTACTS ------------------------------------------------------------
create table if not exists contacts (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  company text,
  email text,
  phone text,
  owner_id uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- CAMPAIGNS -----------------------------------------------------------
create table if not exists campaigns (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  budget numeric(12,2) not null default 0,
  start_date date,
  end_date date,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- DEALS -----------------------------------------------------------------
create table if not exists deals (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  value numeric(12,2) not null default 0,
  stage text not null check (
    stage in ('lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost')
  ),
  contact_id uuid references contacts(id) on delete set null,
  campaign_id uuid references campaigns(id) on delete set null,
  owner_id uuid references users(id) on delete set null,
  expected_close_date date,
  priority_score numeric(5,2), -- populated by Iteration 4 prescriptive scoring
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ACTIVITIES --------------------------------------------------------
create table if not exists activities (
  id uuid primary key default uuid_generate_v4(),
  deal_id uuid references deals(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  type text not null check (type in ('call', 'email', 'meeting', 'note', 'stage_change')),
  notes text,
  created_at timestamptz not null default now()
);

-- Helpful indexes -----------------------------------------------------
create index if not exists idx_deals_owner on deals(owner_id);
create index if not exists idx_deals_stage on deals(stage);
create index if not exists idx_activities_deal on activities(deal_id);

-- FUNNEL BENCHMARKS ---------------------------------------------------
-- Target conversion rates between adjacent stages, set by a manager on the
-- Settings page. A transition with no row gets no "below benchmark" warning.
create table if not exists funnel_benchmarks (
  transition text primary key check (
    transition in ('lead->qualified', 'qualified->proposal', 'proposal->negotiation', 'negotiation->won')
  ),
  rate numeric(4,3) not null check (rate >= 0 and rate <= 1),
  updated_by uuid references users(id) on delete set null,
  updated_at timestamptz not null default now()
);
