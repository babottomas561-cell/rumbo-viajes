create table public.app_snapshots (
  key text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_snapshots enable row level security;
create policy "public read" on public.app_snapshots for select using (true);
