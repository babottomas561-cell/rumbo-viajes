create extension if not exists pgcrypto;
create extension if not exists postgis;

create type public.search_status as enum ('queued', 'running', 'complete', 'partial', 'failed');
create type public.provider_kind as enum ('stayingapi', 'booking', 'expedia', 'duffel', 'amadeus', 'open_meteo');

create table public.trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  starts_on date,
  ends_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on)
);

create table public.search_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  trip_id uuid references public.trips(id) on delete set null,
  kind text not null check (kind in ('stay', 'flight', 'destination')),
  request_hash text not null,
  criteria jsonb not null,
  status public.search_status not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);

create index search_requests_user_created_idx on public.search_requests (user_id, created_at desc);
create index search_requests_hash_idx on public.search_requests (request_hash, created_at desc);

create table public.provider_calls (
  id bigint generated always as identity primary key,
  search_request_id uuid not null references public.search_requests(id) on delete cascade,
  provider public.provider_kind not null,
  operation text not null,
  http_status integer,
  duration_ms integer check (duration_ms is null or duration_ms >= 0),
  result_count integer check (result_count is null or result_count >= 0),
  error_code text,
  response_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index provider_calls_search_idx on public.provider_calls (search_request_id, created_at);

create table public.stay_offers (
  id uuid primary key default gen_random_uuid(),
  search_request_id uuid not null references public.search_requests(id) on delete cascade,
  provider public.provider_kind not null,
  platform text not null check (platform in ('airbnb', 'booking', 'vrbo', 'expedia', 'google')),
  platform_listing_id text not null,
  name text not null,
  destination_label text,
  location geography(point, 4326),
  currency char(3),
  nightly_price numeric(12,2) check (nightly_price is null or nightly_price >= 0),
  total_price numeric(12,2) check (total_price is null or total_price >= 0),
  price_basis text,
  booking_url text not null,
  payload jsonb not null default '{}'::jsonb,
  fetched_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (search_request_id, platform, platform_listing_id)
);

create index stay_offers_search_price_idx on public.stay_offers (search_request_id, total_price);
create index stay_offers_location_gix on public.stay_offers using gist (location);
create index stay_offers_expiry_idx on public.stay_offers (expires_at);

alter table public.trips enable row level security;
alter table public.search_requests enable row level security;
alter table public.provider_calls enable row level security;
alter table public.stay_offers enable row level security;

create policy "owners manage trips" on public.trips for all
using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "users read their searches" on public.search_requests for select
using (user_id = auth.uid());

create policy "users read offers from their searches" on public.stay_offers for select
using (
  exists (
    select 1 from public.search_requests s
    where s.id = stay_offers.search_request_id and s.user_id = auth.uid()
  )
);

comment on table public.provider_calls is
  'Auditoría server-side. Sin políticas de cliente: sólo la clave secreta puede escribir o leer.';
