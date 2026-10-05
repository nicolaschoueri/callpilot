-- CallPilot production data model (PostgreSQL)
create extension if not exists pgcrypto;

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null, trade text not null,
  phone text, timezone text default 'America/Toronto',
  language text default 'bilingual',
  created_at timestamptz default now()
);
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  email text not null, name text, role text default 'owner',
  created_at timestamptz default now(),
  unique(business_id,email)
);
create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text, phone text not null, email text, address text,
  created_at timestamptz default now()
);
create table if not exists technicians (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  name text not null, phone text, email text, active boolean default true
);
create table if not exists service_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id),
  technician_id uuid references technicians(id),
  source text default 'phone',
  issue text, urgency text default 'normal',
  status text default 'new',
  preferred_at timestamptz, scheduled_at timestamptz,
  estimated_value numeric(12,2), outcome text default 'unconfirmed',
  invoice_amount numeric(12,2),
  created_at timestamptz default now(), updated_at timestamptz default now(),
  check (status in ('new','contacted','scheduled','assigned','completed','cancelled')),
  check (outcome in ('unconfirmed','won','lost'))
);
create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  customer_id uuid references customers(id),
  request_id uuid references service_requests(id),
  provider_call_id text unique, direction text default 'inbound',
  started_at timestamptz, ended_at timestamptz,
  recording_url text, transcript text, ai_summary text,
  language text, created_at timestamptz default now()
);
create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  request_id uuid references service_requests(id) on delete cascade,
  call_id uuid references calls(id) on delete cascade,
  event_type text not null, payload jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);
create table if not exists notification_settings (
  business_id uuid primary key references businesses(id) on delete cascade,
  urgent_sms boolean default true, normal_sms boolean default true,
  urgent_email boolean default false, normal_email boolean default true,
  emergency_only boolean default false, fully_booked boolean default false,
  emergency_phone text, notification_email text
);
create table if not exists integration_connections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  provider text not null, kind text not null, status text default 'disconnected',
  external_account_id text, metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now(), updated_at timestamptz default now(),
  unique(business_id,kind,provider)
);
create index if not exists idx_requests_business_status on service_requests(business_id,status);
create index if not exists idx_calls_business_started on calls(business_id,started_at desc);
create index if not exists idx_activity_request on activity_events(request_id,created_at desc);

-- Confirmed revenue must come from won jobs, not estimates.
create or replace view business_performance as
select b.id business_id,
 count(distinct c.id) calls_answered,
 count(distinct r.id) filter (where r.source='phone') requests_captured,
 count(distinct r.id) filter (where r.status in ('scheduled','assigned','completed')) jobs_booked,
 coalesce(sum(r.invoice_amount) filter (where r.outcome='won'),0) confirmed_revenue
from businesses b
left join calls c on c.business_id=b.id
left join service_requests r on r.business_id=b.id
group by b.id;
