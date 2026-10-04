-- SalesMesh database schema
-- Run this in the Supabase SQL Editor (Project > SQL Editor > New Query)
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
  channel text, -- e.g. social media, radio, SMS, email (ERD: Campaign.channel)
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

-- Row-Level Security (defense-in-depth, per the architecture section) --
alter table deals enable row level security;
alter table activities enable row level security;

-- Representatives can only see their own deals; managers/admins see all.
-- (These policies assume you're using Supabase Auth's auth.uid(); if you
-- stick with the custom JWT approach in auth.routes.js instead, enforce
-- this filtering at the API layer as already coded, and treat these
-- policies as the second layer once you migrate to Supabase Auth.)
create policy "reps see own deals" on deals
  for select using (owner_id = auth.uid() or auth.role() = 'service_role');

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

alter table funnel_benchmarks enable row level security;
revoke all on funnel_benchmarks from anon, authenticated;

-- Databases created before campaigns had a channel column
alter table campaigns add column if not exists channel text;

-- AUDIT LOG -----------------------------------------------------------
-- Who did what, shown to admins on the Audit Log page (Chapter 4 use case).
-- Rows are only ever inserted by the API; nothing updates or deletes them.
create table if not exists audit_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references users(id) on delete set null,
  user_name text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_audit_logs_created on audit_logs(created_at desc);

alter table audit_logs enable row level security;
revoke all on audit_logs from anon, authenticated;

-- ACCOUNT STATUS & PASSWORD RESETS -------------------------------------
-- Admins can disable an account; a disabled user can't log in and their open
-- sessions stop working on the next request.
alter table users add column if not exists is_active boolean not null default true;

-- One row per "forgot password" request. Only a SHA-256 hash of the token is
-- stored, so a database leak can't be used to reset anyone's password.
create table if not exists password_resets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_by uuid references users(id) on delete set null, -- set when an admin issued the link
  created_at timestamptz not null default now()
);
create index if not exists idx_password_resets_user on password_resets(user_id);

alter table password_resets enable row level security;
revoke all on password_resets from anon, authenticated;

-- CLOSE DATE ------------------------------------------------------------
-- When a deal was won or lost. Set by the API on the stage change (or from the
-- SME's records on CSV import) and not touched by later edits, so the forecast
-- and sales velocity use the real close date.
alter table deals add column if not exists closed_at timestamptz;
update deals set closed_at = updated_at where stage in ('won', 'lost') and closed_at is null;
