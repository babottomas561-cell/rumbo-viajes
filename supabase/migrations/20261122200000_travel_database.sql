-- Base grande de viajes: aeropuertos, destinos, cotizaciones de vuelos (todas las mediciones),
-- casas, clima y vistas para "lo último" y "tendencia". Lectura pública (datos no personales),
-- escritura sólo con la clave secreta (el actualizador).

create table public.airports (
  iata char(3) primary key,
  name text not null,
  city text,
  country char(2),
  is_origin boolean not null default false,
  lat double precision,
  lon double precision
);

create table public.destinations (
  k text primary key,
  name text not null,
  zone text,
  airport char(3) references public.airports(iata),
  lat double precision,
  lon double precision
);

create table public.flight_quotes (
  id bigint generated always as identity primary key,
  origin char(3) not null,
  dest char(3) not null,
  depart_on date not null,
  return_on date not null,
  price_usd integer not null check (price_usd > 0),
  stops smallint not null default 0,
  airline text not null,
  airlines text[] not null default '{}',
  dep_time text not null default '',
  arr_time text not null default '',
  duration text,
  source text not null default 'google_flights',
  fetched_at timestamptz not null,
  unique (origin, dest, depart_on, return_on, airline, dep_time, fetched_at)
);
create index flight_quotes_route_idx on public.flight_quotes (origin, dest, depart_on, fetched_at desc);
create index flight_quotes_fetched_idx on public.flight_quotes (fetched_at desc);
create index flight_quotes_airlines_gin on public.flight_quotes using gin (airlines);

create table public.stay_listings (
  k text not null references public.destinations(k),
  month smallint not null check (month between 1 and 12),
  adults smallint not null,
  listing_id text not null,
  name text,
  stay_price_usd numeric(10,2),
  rating real, reviews integer, bedrooms real, beds real, baths real,
  lat double precision, lon double precision,
  fetched_at timestamptz not null,
  primary key (k, month, adults, listing_id)
);

create table public.stay_medians (
  k text not null, month smallint not null, adults smallint not null,
  fetched_at timestamptz not null, n integer, median_usd numeric(10,2),
  primary key (k, month, adults, fetched_at)
);

create table public.climate (
  k text not null, month smallint not null,
  tmax real, rain_mm real, rain_days real, sea_temp real,
  primary key (k, month)
);

create table public.sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  source text not null,
  quotes integer, stays integer, note text
);

-- Última medición de cada ruta+fecha, una fila por aerolínea (la más barata).
create view public.flight_latest with (security_invoker = true) as
with last as (
  select origin, dest, depart_on, return_on, max(fetched_at) as fetched_at
  from public.flight_quotes group by 1,2,3,4
)
select distinct on (q.origin, q.dest, q.depart_on, q.return_on, q.airline)
  q.origin, q.dest, q.depart_on, q.return_on, q.airline, q.airlines,
  q.price_usd, q.stops, q.dep_time, q.arr_time, q.duration, q.fetched_at
from public.flight_quotes q join last l using (origin, dest, depart_on, return_on, fetched_at)
order by q.origin, q.dest, q.depart_on, q.return_on, q.airline, q.price_usd;

-- Precio mínimo por ruta y día de medición: sirve para gráficos de tendencia.
create view public.flight_trend with (security_invoker = true) as
select origin, dest, depart_on, return_on, date_trunc('hour', fetched_at) as measured_at,
       min(price_usd) as min_usd, count(distinct airline) as airlines
from public.flight_quotes group by 1,2,3,4,5;

alter table public.airports enable row level security;
alter table public.destinations enable row level security;
alter table public.flight_quotes enable row level security;
alter table public.stay_listings enable row level security;
alter table public.stay_medians enable row level security;
alter table public.climate enable row level security;
alter table public.sync_runs enable row level security;

create policy "public read" on public.airports for select using (true);
create policy "public read" on public.destinations for select using (true);
create policy "public read" on public.flight_quotes for select using (true);
create policy "public read" on public.stay_listings for select using (true);
create policy "public read" on public.stay_medians for select using (true);
create policy "public read" on public.climate for select using (true);
create policy "public read" on public.sync_runs for select using (true);

insert into public.airports (iata, name, city, country, is_origin) values
 ('TUC','Teniente Benjamín Matienzo','Tucumán','AR',true),
 ('SLA','Martín Miguel de Güemes','Salta','AR',true),
 ('BUE','Buenos Aires (todos)','Buenos Aires','AR',true),
 ('COR','Ingeniero Taravella','Córdoba','AR',true),
 ('IGR','Cataratas del Iguazú','Puerto Iguazú','AR',true),
 ('IGU','Foz do Iguaçu','Foz do Iguaçu','BR',true);
