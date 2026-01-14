-- =====================================================
-- EXTENSIONS
-- =====================================================
create extension if not exists "pgcrypto";

-- =====================================================
-- 1. ESTATES
-- =====================================================
create table if not exists estates (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  address text,
  lat numeric,
  lng numeric,
  created_at timestamptz default now()
);

-- =====================================================
-- 2. USERS (AUTH CANONICAL)
-- =====================================================
create table if not exists users (
  id uuid default gen_random_uuid() primary key,
  email text unique not null,

  username text,
  full_name text,

  password_hash text not null,

  role text not null default 'resident', 
  -- resident | estate_admin | security | platform_admin

  estate_id uuid references estates(id) on delete set null,
  home_id uuid references homes(id) on delete set null,

  created_at timestamptz default now()
);

create index if not exists idx_users_estate on users(estate_id);
create index if not exists idx_users_home on users(home_id);

-- =====================================================
-- 3. HOMES (UNITS)
-- =====================================================
create table if not exists homes (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid references estates(id) on delete cascade,

  name text not null,
  unit text,
  block text,
  description text,

  electricity_meter text,
  water_meter text,
  internet_id text,
  gate_code text,

  lat numeric,
  lng numeric,

  resident_id uuid references users(id) on delete set null,

  created_at timestamptz default now()
);

create index if not exists idx_homes_estate on homes(estate_id);
create index if not exists idx_homes_resident on homes(resident_id);

-- =====================================================
-- 4. ROOMS
-- =====================================================
create table if not exists rooms (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete cascade,

  name text not null,
  type text,
  floor int,

  ai_profile jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_rooms_estate on rooms(estate_id);
create index if not exists idx_rooms_home on rooms(home_id);

-- =====================================================
-- 5. ROOM ASSIGNMENTS
-- =====================================================
create table if not exists room_assignments (
  id uuid default gen_random_uuid() primary key,
  room_id uuid references rooms(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,

  role text,
  permissions jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_room_assignments_room on room_assignments(room_id);
create index if not exists idx_room_assignments_user on room_assignments(user_id);

-- =====================================================
-- 6. ROOM AUTOMATION RULES
-- =====================================================
create table if not exists room_rules (
  id uuid default gen_random_uuid() primary key,
  room_id uuid references rooms(id) on delete cascade,

  trigger jsonb,
  condition jsonb,
  action jsonb,

  enabled boolean default true,
  created_at timestamptz default now()
);

create index if not exists idx_room_rules_room on room_rules(room_id);

-- =====================================================
-- 7. DEVICES (DISCOVERY + BINDING)
-- =====================================================
create table if not exists devices (
  id uuid default gen_random_uuid() primary key,

  estate_id uuid references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,

  name text not null,
  type text,

  adapter text not null,          -- tuya | ble | wifi | mqtt
  vendor text,                    -- Tuya, Philips, Generic
  external_id text not null,      -- vendor device ID

  bind_state text not null default 'discovered',
  -- discovered | estate_bound | home_bound | room_bound

  status text default 'offline',
  metadata jsonb default '{}'::jsonb,

  lat numeric,
  lng numeric,
  icon text,

  created_at timestamptz default now()
);

create index if not exists idx_devices_estate on devices(estate_id);
create index if not exists idx_devices_home on devices(home_id);
create index if not exists idx_devices_room on devices(room_id);
create index if not exists idx_devices_external on devices(external_id);

-- =====================================================
-- 8. AI SUGGESTIONS
-- =====================================================
create table if not exists suggestions (
  id uuid default gen_random_uuid() primary key,

  estate_id uuid references estates(id) on delete cascade,
  device_id uuid references devices(id) on delete cascade,

  message text not null,
  action text not null,
  payload jsonb default '{}'::jsonb,

  status text default 'pending',
  created_at timestamptz default now(),
  resolved_at timestamptz
);

create index if not exists idx_suggestions_estate on suggestions(estate_id);

-- =====================================================
-- 9. VISITORS
-- =====================================================
create table if not exists visitors (
  id uuid default gen_random_uuid() primary key,

  full_name text,
  phone text,
  email text,

  estate_id uuid references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,

  status text default 'idle',
  current_lat numeric,
  current_lng numeric,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_visitors_estate on visitors(estate_id);

-- =====================================================
-- 10. NOTIFICATIONS
-- =====================================================
create table if not exists notifications (
  id uuid default gen_random_uuid() primary key,

  user_id uuid references users(id) on delete cascade,
  title text not null,
  message text not null,
  type text,

  payload jsonb default '{}'::jsonb,
  status text default 'unread',

  created_at timestamptz default now()
);

create index if not exists idx_notifications_user on notifications(user_id);

-- =====================================================
-- 11. USER WALLETS (1:1)
-- =====================================================
create table if not exists wallets (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references users(id) on delete cascade unique,

  balance numeric default 0,
  currency text default 'NGN',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================
-- 12. ESTATE WALLETS
-- =====================================================
create table if not exists estate_wallets (
  id uuid default gen_random_uuid() primary key,
  estate_id uuid references estates(id) on delete cascade unique,

  balance numeric default 0,
  currency text default 'NGN',

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- =====================================================
-- 13. WALLET TRANSACTIONS
-- =====================================================
create table if not exists wallet_transactions (
  id uuid default gen_random_uuid() primary key,

  wallet_id uuid references wallets(id) on delete cascade,

  direction text not null, -- debit | credit
  type text not null,      -- funding | service_charge | power | water | internet

  amount numeric not null,
  reference text,

  status text default 'pending',
  metadata jsonb default '{}'::jsonb,

  created_at timestamptz default now()
);

create index if not exists idx_wallet_tx_wallet on wallet_transactions(wallet_id);

-- =====================================================
-- 14. ESTATE SERVICES (UTILITIES)
-- =====================================================
create table if not exists estate_services (
  id uuid default gen_random_uuid() primary key,

  estate_id uuid references estates(id) on delete cascade,
  name text not null,
  unit_cost numeric,

  created_at timestamptz default now()
);

create index if not exists idx_estate_services_estate on estate_services(estate_id);

-- =====================================================
-- 15. MAINTENANCE REQUESTS
-- =====================================================
create table if not exists maintenance_requests (
  id uuid default gen_random_uuid() primary key,

  estate_id uuid references estates(id) on delete cascade,
  home_id uuid references homes(id) on delete set null,
  room_id uuid references rooms(id) on delete set null,
  user_id uuid references users(id) on delete cascade,

  title text not null,
  description text,

  status text default 'open',
  assigned_to text,

  attachments jsonb default '[]'::jsonb,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_maintenance_estate on maintenance_requests(estate_id);
create index if not exists idx_maintenance_status on maintenance_requests(status);
