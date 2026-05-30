-- Camera AI profile persistence for facility camera intelligence center

create table if not exists camera_ai_profiles (
  id uuid default gen_random_uuid() primary key,
  camera_id uuid not null unique references facility_cameras(id) on delete cascade,
  estate_id uuid not null references estates(id) on delete cascade,
  armed boolean not null default true,
  mode text not null default 'home',
  sensitivity integer not null default 70,
  min_confidence integer not null default 70,
  detect_human boolean not null default true,
  detect_vehicle boolean not null default true,
  detect_animal boolean not null default false,
  detect_face boolean not null default false,
  detect_loitering boolean not null default false,
  detect_intrusion boolean not null default true,
  notify_in_app boolean not null default true,
  notify_push boolean not null default true,
  notify_sms boolean not null default false,
  auto_record_on_detect boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  updated_by uuid null references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint camera_ai_profiles_sensitivity_range check (sensitivity >= 0 and sensitivity <= 100),
  constraint camera_ai_profiles_min_confidence_range check (min_confidence >= 0 and min_confidence <= 100),
  constraint camera_ai_profiles_mode_valid check (mode in ('home', 'away', 'night', 'vacation'))
);

create index if not exists idx_camera_ai_profiles_estate on camera_ai_profiles(estate_id);
create index if not exists idx_camera_ai_profiles_updated on camera_ai_profiles(updated_at desc);

create or replace function set_camera_ai_profiles_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_camera_ai_profiles_updated_at on camera_ai_profiles;
create trigger trg_camera_ai_profiles_updated_at
before update on camera_ai_profiles
for each row execute function set_camera_ai_profiles_updated_at();
