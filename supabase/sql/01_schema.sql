-- ============================================================================
-- CommunityHub · 01_schema.sql
-- ============================================================================
-- Ejecutar PRIMERO, en el SQL Editor de Supabase (o `psql`).
--
-- Crea: extensiones, tipos ENUM, tablas, índices, claves foráneas y triggers
-- de `updated_at`.
--
-- Es la fuente de verdad del modelo de datos. Prisma se deriva de aquí con
-- `npx prisma db pull`, nunca al revés: así el SQL que se ejecuta en la base de
-- datos y el schema.prisma no pueden divergir.
--
-- Reejecutable: usa IF NOT EXISTS en todo lo que lo permita.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Extensiones
-- ----------------------------------------------------------------------------
-- El orden importa: las extensiones se habilitan ANTES de usarlas en un índice.
-- pg_trgm aporta la clase de operadores gin_trgm_ops que necesita el índice de
-- búsqueda por texto de incidents (más abajo, sección 4.4).
create extension if not exists pg_trgm;
create extension if not exists pgcrypto;
-- gen_random_uuid() vive en pgcrypto en Postgres < 13. En Supabase (PG 15+)
-- ya está en el catálogo, pero la dejamos explícita para que el script también
-- funcione en un Postgres local creado con `prisma dev`.

-- ----------------------------------------------------------------------------
-- 2. Tipos ENUM
-- ----------------------------------------------------------------------------
-- Cada estado y prioridad del enunciado es un ENUM, no un VARCHAR. Así el
-- motor rechaza valores inventados y Prisma los conoce en tiempo de compilación.

do $$ begin
  -- Rol global del usuario en la plataforma SaaS
  create type user_global_role as enum ('NEIGHBOR', 'ADMIN_SA');
exception when duplicate_object then null; end $$;

do $$ begin
  -- Rol dentro de una comunidad concreta (RBAC)
  create type member_role as enum ('NEIGHBOR', 'PRESIDENT', 'ADMIN', 'PROVIDER');
exception when duplicate_object then null; end $$;

do $$ begin
  create type member_status as enum ('ACTIVE', 'SUSPENDED', 'LEFT');
exception when duplicate_object then null; end $$;

-- --- Incidencias ---
do $$ begin
  create type incident_status as enum ('OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_priority as enum ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type incident_category as enum (
    'ELEVATOR', 'ELECTRICITY', 'PLUMBING',
    'CLEANING', 'SECURITY', 'HEATING', 'OTHER'
  );
exception when duplicate_object then null; end $$;

-- Cómo llegó la incidencia. Permite auditar cuánto se crea con ayuda de la IA
-- y distinguir una creation humana de una propuesta.
do $$ begin
  create type incident_created_via as enum ('MANUAL', 'AI_SUGGESTION');
exception when duplicate_object then null; end $$;

-- --- Zonas comunes y reservas ---
do $$ begin
  create type common_area_type as enum (
    'SWIMMING_POOL', 'PADEL_COURT', 'COMMUNITY_ROOM', 'GYM',
    'TERRACE', 'PLAYGROUND', 'GARAGE', 'OTHER'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type reservation_status as enum ('PENDING', 'CONFIRMED', 'CANCELLED');
exception when duplicate_object then null; end $$;

-- --- Avisos ---
do $$ begin
  create type announcement_type as enum ('GENERAL', 'URGENT', 'MAINTENANCE', 'MEETING');
exception when duplicate_object then null; end $$;

do $$ begin
  create type announcement_priority as enum ('LOW', 'MEDIUM', 'HIGH');
exception when duplicate_object then null; end $$;

-- --- Documentos ---
do $$ begin
  create type document_category as enum (
    'MINUTES', 'STATUTES', 'INVOICE', 'BUDGET', 'MAINTENANCE', 'OTHER'
  );
exception when duplicate_object then null; end $$;

-- --- Finanzas ---
do $$ begin
  create type expense_category as enum (
    'MAINTENANCE', 'CLEANING', 'SECURITY', 'UTILITIES', 'ADMIN', 'INSURANCE', 'OTHER'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type invoice_status as enum ('PENDING', 'PAID', 'OVERDUE', 'CANCELLED');
exception when duplicate_object then null; end $$;

-- --- Votaciones ---
do $$ begin
  create type vote_type as enum ('SINGLE', 'QUORUM');
exception when duplicate_object then null; end $$;

do $$ begin
  create type vote_status as enum ('DRAFT', 'OPEN', 'CLOSED');
exception when duplicate_object then null; end $$;

-- Quién puede ver los resultados antes del cierre
do $$ begin
  create type vote_result_visibility as enum ('AFTER_CLOSE', 'LIVE', 'ADMIN_ONLY');
exception when duplicate_object then null; end $$;

-- --- Notificaciones ---
do $$ begin
  create type notification_type as enum (
    'INCIDENT_CREATED', 'INCIDENT_UPDATED', 'INCIDENT_COMMENT',
    'RESERVATION_CREATED', 'RESERVATION_CANCELLED',
    'ANNOUNCEMENT_NEW', 'VOTE_OPEN', 'VOTE_CLOSED',
    'INVOICE_DUE', 'MEMBER_JOINED', 'AI_DRAFT_READY'
  );
exception when duplicate_object then null; end $$;

-- --- Sesiones ---
do $$ begin
  create type session_status as enum ('ACTIVE', 'REVOKED');
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 3. Función compartida para mantener `updated_at`
-- ----------------------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Tablas
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 4.1 users
-- ----------------------------------------------------------------------------
-- `password_hash` almacena argon2id. Nunca una contraseña en claro.
-- `global_role` es el rol de plataforma (staff del SaaS), NO el rol de la
-- comunidad: ese vive en community_members. La separación permite que un
-- ADMIN de la comunidad siga siendo un usuario normal en el resto del sistema.
create table if not exists users (
  id                uuid primary key default gen_random_uuid(),
  email             text        not null,
  password_hash     text        not null,
  full_name         text        not null,
  phone             text,
  avatar_url        text,
  global_role       user_global_role not null default 'NEIGHBOR',
  status            text        not null default 'ACTIVE',
  email_verified_at timestamptz,
  last_login_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);

-- Case-insensitive: "Ana@x.com" y "ana@x.com" son la misma cuenta.
create unique index if not exists users_email_lower_uidx on users (lower(email));
create index if not exists users_deleted_at_idx on users (deleted_at) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4.2 communities
-- ----------------------------------------------------------------------------
-- lat/lng alimentan el widget de meteorología (Open-Meteo).
-- timezone es necesario porque las reservas son horas locales: sin él, un
-- servidor en UTC mostraría "08:00" para una reserva de las 10:00 en Madrid.
create table if not exists communities (
  id                  uuid primary key default gen_random_uuid(),
  name                text        not null,
  slug                text        not null,
  description         text,
  address_line1       text        not null,
  city                text        not null,
  province            text,
  postal_code         text,
  country             text        not null default 'ES',
  -- Anulables a propósito (spec 02, C-7). NULL significa "sin localizar todavía",
  -- no "en el centro del mapa". Un vecino no escribe 39.474, -0.379, y poner
  -- 0,0 por defecto daría meteorología y mapa del Atlántico sin avisar.
  -- Quien las rellena es el bloque de integraciones, con la dirección.
  latitude            numeric(9,6),
  longitude           numeric(9,6),
  timezone            text        not null default 'Europe/Madrid',
  registration_number text,
  is_active           boolean     not null default true,
  created_by          uuid references users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz
);

create unique index if not exists communities_slug_uidx on communities (slug);
create index if not exists communities_city_idx on communities (city);
create index if not exists communities_deleted_at_idx on communities (deleted_at) where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4.3 community_members
-- ----------------------------------------------------------------------------
-- Tabla pivote entre users y communities, y aquí vive el RBAC por comunidad.
-- La unicidad en (community_id, user_id) impide que un usuario tenga dos roles
-- en la misma comunidad, que sería una vía trivial de escalada de privilegios.
create table if not exists community_members (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references communities (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,
  role          member_role not null default 'NEIGHBOR',
  status        member_status not null default 'ACTIVE',
  unit_number   text,
  invited_by    uuid references users (id) on delete set null,
  joined_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists community_members_scope_uidx
  on community_members (community_id, user_id);
create index if not exists community_members_user_idx on community_members (user_id);
create index if not exists community_members_lookup_idx
  on community_members (community_id, role)
  where status = 'ACTIVE';

-- ----------------------------------------------------------------------------
-- 4.4 incidents
-- ----------------------------------------------------------------------------
-- `reporter_id` y `assigned_to_id` son usuarios. El proveedor (PROVIDER) es un
-- usuario con role PROVIDER en la comunidad, no una tabla aparte: así hereda
-- login, sesión y auditoría sin duplicar ese trabajo.
create table if not exists incidents (
  id             uuid primary key default gen_random_uuid(),
  community_id   uuid not null references communities (id) on delete cascade,
  reference_code text        not null,
  title          text        not null,
  description    text        not null,
  category       incident_category not null default 'OTHER',
  priority       incident_priority not null default 'MEDIUM',
  status         incident_status not null default 'OPEN',
  location       text,
  reporter_id    uuid not null references users (id) on delete restrict,
  assigned_to_id uuid references users (id) on delete set null,
  created_via    incident_created_via not null default 'MANUAL',
  ai_confidence  numeric(4,3),
  resolved_at    timestamptz,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint incidents_title_length check (char_length(title) between 5 and 200)
);

-- Código legible por humanos (INC-2026-0001). Único por comunidad, que es el
-- ámbito en el que un vecino realmente lo cita ("la incidencia 42").
create unique index if not exists incidents_reference_code_uidx
  on incidents (community_id, reference_code);
-- Índice compuesto: el patrón de consulta real es "incidencias de MI comunidad
-- con estado X". Un índice solo por community_id obligaría a filtrar después.
create index if not exists incidents_community_status_idx
  on incidents (community_id, status)
  where deleted_at is null;
create index if not exists incidents_community_priority_idx
  on incidents (community_id, priority)
  where deleted_at is null;
create index if not exists incidents_reporter_idx on incidents (reporter_id);
create index if not exists incidents_assigned_idx on incidents (assigned_to_id)
  where assigned_to_id is not null;
-- Búsqueda por texto. Necesita la extensión pg_trgm, habilitada en la sección 1.
create index if not exists incidents_title_trgm_idx
  on incidents using gin (title gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- 4.5 incident_comments
-- ----------------------------------------------------------------------------
create table if not exists incident_comments (
  id          uuid primary key default gen_random_uuid(),
  incident_id uuid not null references incidents (id) on delete cascade,
  author_id   uuid not null references users (id) on delete restrict,
  body        text not null,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists incident_comments_incident_idx
  on incident_comments (incident_id, created_at);

-- ----------------------------------------------------------------------------
-- 4.6 common_areas
-- ----------------------------------------------------------------------------
-- slot_minutes es la rejilla de reserva. 90 significa que las reservas se
-- hacen en bloques de 1h30. Es lo que permite el modelo de slots que resuelve
-- los solapes sin condición de carrera (ver tabla area_slots).
create table if not exists common_areas (
  id                     uuid primary key default gen_random_uuid(),
  community_id           uuid not null references communities (id) on delete cascade,
  name                   text        not null,
  type                   common_area_type not null default 'OTHER',
  description            text,
  capacity               integer,
  slot_minutes           integer not null default 60,
  open_time              time        not null default '08:00',
  close_time             time        not null default '22:00',
  max_daily_reservations integer,
  requires_approval      boolean     not null default false,
  is_active              boolean     not null default true,
  created_by             uuid references users (id) on delete set null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint common_areas_slot_valid check (slot_minutes in (30, 60, 90, 120)),
  constraint common_areas_hours_valid check (close_time > open_time)
);

create unique index if not exists common_areas_community_name_uidx
  on common_areas (community_id, lower(name));
create index if not exists common_areas_community_idx on common_areas (community_id);

-- ----------------------------------------------------------------------------
-- 4.7 reservations
-- ----------------------------------------------------------------------------
-- La reserva en sí. Los slots ocupados viven en area_slots.
create table if not exists reservations (
  id            uuid primary key default gen_random_uuid(),
  community_id  uuid not null references communities (id) on delete cascade,
  common_area_id uuid not null references common_areas (id) on delete cascade,
  user_id       uuid not null references users (id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        reservation_status not null default 'CONFIRMED',
  attendees     integer,
  notes         text,
  cancelled_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint reservations_time_valid check (ends_at > starts_at),
  constraint reservations_attendees_valid check (attendees is null or attendees > 0)
);

create index if not exists reservations_community_start_idx
  on reservations (community_id, starts_at desc);
create index if not exists reservations_user_idx on reservations (user_id, starts_at desc);
create index if not exists reservations_area_idx on reservations (common_area_id, starts_at);

-- ----------------------------------------------------------------------------
-- 4.8 area_slots
-- ----------------------------------------------------------------------------
-- CLAVE DEL DISEÑO DE RESERVAS.
--
-- Cada reserva ocupa N filas (una por bloque de slot_minutes). El índice único de
-- abajo hace que dos intentos de reservar el mismo bloque FOILEN de forma
-- atómica, en el motor, sin un "comprobar y luego insertar" que deja una
-- ventana de carrera entre dos peticiones concurrentes.
--
-- El enfoque alternativo (SELECT para ver si está libre, luego INSERT) es
-- incorrecto bajo concurrencia, y una reserva doble en la piscina es
-- exactamente el tipo de bug que un usuario reporta.
--
-- on delete cascade: si se cancela la reserva, sus slots se liberan solos.
create table if not exists area_slots (
  id             uuid primary key default gen_random_uuid(),
  common_area_id uuid not null references common_areas (id) on delete cascade,
  reservation_id uuid not null references reservations (id) on delete cascade,
  starts_at      timestamptz not null,
  ends_at        timestamptz not null
);

create unique index if not exists area_slots_no_overlap_uidx
  on area_slots (common_area_id, starts_at);
create index if not exists area_slots_reservation_idx on area_slots (reservation_id);
create index if not exists area_slots_lookup_idx on area_slots (common_area_id, starts_at);

-- ----------------------------------------------------------------------------
-- 4.9 announcements
-- ----------------------------------------------------------------------------
create table if not exists announcements (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  title        text        not null,
  body         text        not null,
  type         announcement_type not null default 'GENERAL',
  priority     announcement_priority not null default 'MEDIUM',
  is_pinned    boolean     not null default false,
  publish_at   timestamptz not null default now(),
  expires_at   timestamptz,
  author_id    uuid references users (id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint announcements_dates_valid check (
    expires_at is null or expires_at > publish_at
  )
);

create index if not exists announcements_community_publish_idx
  on announcements (community_id, is_pinned desc, publish_at desc)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4.10 documents
-- ----------------------------------------------------------------------------
-- El binario NUNCA está aquí: vive en Supabase Storage (bucket privado).
-- Esta tabla guarda metadatos y el control de acceso.
-- `storage_path` es la clave dentro del bucket, con una primera carpeta por
-- comunidad para que el aislamiento sea también estructural en el storage.
create table if not exists documents (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  title        text        not null,
  description  text,
  category     document_category not null default 'OTHER',
  storage_path text        not null,
  mime_type    text        not null,
  size_bytes   bigint      not null,
  checksum     text,
  min_role     member_role not null default 'NEIGHBOR',
  is_public    boolean     not null default false,
  uploaded_by  uuid references users (id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint documents_size_positive check (size_bytes > 0)
);

-- storage_path es único en todo el sistema (no por comunidad) porque es la clave
-- real dentro del bucket.
create unique index if not exists documents_storage_path_uidx on documents (storage_path);
create index if not exists documents_community_idx on documents (community_id)
  where deleted_at is null;
create index if not exists documents_category_idx on documents (community_id, category);

-- ----------------------------------------------------------------------------
-- 4.11 document_acl
-- ----------------------------------------------------------------------------
-- Permisos finos por usuario, por encima del min_role general.
-- Si no hay filas para un documento, se aplica solo min_role.
create table if not exists document_acl (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  user_id     uuid not null references users (id) on delete cascade,
  can_view    boolean not null default true,
  can_download boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists document_acl_uidx on document_acl (document_id, user_id);
create index if not exists document_acl_user_idx on document_acl (user_id);

-- ----------------------------------------------------------------------------
-- 4.12 expenses
-- ----------------------------------------------------------------------------
-- numeric(12,2), nunca float. Los importes en coma flotante producen errores de
-- redondeo que en un balance de comunidad son inaceptables: 0.1 + 0.2 = 0.30000000000000004.
create table if not exists expenses (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  concept      text        not null,
  category     expense_category not null default 'OTHER',
  amount       numeric(12,2) not null,
  expense_date date        not null,
  supplier     text,
  invoice_id   uuid,
  notes        text,
  created_by   uuid references users (id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint expenses_amount_positive check (amount > 0)
);

create index if not exists expenses_community_date_idx
  on expenses (community_id, expense_date desc)
  where deleted_at is null;
create index if not exists expenses_community_category_idx on expenses (community_id, category);

-- ----------------------------------------------------------------------------
-- 4.13 invoices
-- ----------------------------------------------------------------------------
create table if not exists invoices (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  number       text        not null,
  concept      text,
  amount       numeric(12,2) not null,
  issue_date   date        not null,
  due_date     date        not null,
  paid_at      timestamptz,
  status       invoice_status not null default 'PENDING',
  supplier     text,
  is_generated boolean     not null default false,
  created_by   uuid references users (id) on delete set null,
  deleted_at   timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint invoices_amount_positive check (amount > 0),
  constraint invoices_dates_valid check (due_date >= issue_date)
);

create unique index if not exists invoices_community_number_uidx
  on invoices (community_id, number);
create index if not exists invoices_community_status_idx
  on invoices (community_id, status, due_date);
create index if not exists invoices_community_due_idx
  on invoices (community_id, due_date)
  where status = 'PENDING' and deleted_at is null;

-- La FK de expenses.invoice_id se añade ahora que invoices existe.
do $$ begin
  alter table expenses
    add constraint expenses_invoice_id_fkey
    foreign key (invoice_id) references invoices (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ----------------------------------------------------------------------------
-- 4.14 votes
-- ----------------------------------------------------------------------------
create table if not exists votes (
  id               uuid primary key default gen_random_uuid(),
  community_id     uuid not null references communities (id) on delete cascade,
  title            text        not null,
  question         text        not null,
  description      text,
  type             vote_type not null default 'SINGLE',
  status           vote_status not null default 'DRAFT',
  starts_at        timestamptz not null,
  ends_at          timestamptz not null,
  allow_abstention boolean     not null default true,
  quorum_percent   integer,
  result_visibility vote_result_visibility not null default 'AFTER_CLOSE',
  created_by       uuid references users (id) on delete set null,
  closed_at        timestamptz,
  deleted_at       timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint votes_dates_valid check (ends_at > starts_at),
  constraint votes_quorum_valid check (
    quorum_percent is null or (quorum_percent between 1 and 100)
  )
);

create index if not exists votes_community_status_idx
  on votes (community_id, status, ends_at)
  where deleted_at is null;

-- ----------------------------------------------------------------------------
-- 4.15 vote_options
-- ----------------------------------------------------------------------------
create table if not exists vote_options (
  id         uuid primary key default gen_random_uuid(),
  vote_id    uuid not null references votes (id) on delete cascade,
  label      text        not null,
  position   integer     not null,
  is_abstention boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists vote_options_vote_position_uidx
  on vote_options (vote_id, position);
create unique index if not exists vote_options_vote_label_uidx
  on vote_options (vote_id, lower(label));

-- ----------------------------------------------------------------------------
-- 4.16 vote_responses
-- ----------------------------------------------------------------------------
-- Un voto por usuario, garantizado por la BD y no por el código de la
-- aplicación. Si la lógica dice "un voto" pero el índice no lo impone, la
-- siguiente pantalla que allows elegir la opción múltiple rompe la promesa.
create table if not exists vote_responses (
  id         uuid primary key default gen_random_uuid(),
  vote_id    uuid not null references votes (id) on delete cascade,
  option_id  uuid not null references vote_options (id) on delete cascade,
  user_id    uuid not null references users (id) on delete cascade,
  weight     integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vote_responses_weight_valid check (weight > 0)
);

create unique index if not exists vote_responses_unique_vote_uidx
  on vote_responses (vote_id, user_id);
create index if not exists vote_responses_option_idx on vote_responses (option_id);
create index if not exists vote_responses_user_idx on vote_responses (user_id);

-- ----------------------------------------------------------------------------
-- 4.17 notifications
-- ----------------------------------------------------------------------------
create table if not exists notifications (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  community_id uuid references communities (id) on delete cascade,
  type         notification_type not null,
  title        text        not null,
  body         text,
  payload      jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists notifications_user_unread_idx
  on notifications (user_id, created_at desc)
  where read_at is null;
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4.18 sessions (refresh tokens)
-- ----------------------------------------------------------------------------
-- Token opaco, no JWT. Solo su hash: si alguien lee esta tabla no puede
-- suplantar una sesión.
-- `family_id` agrupa todos los tokens derivados de un mismo login. Si llega un
-- token ya revocado, se revoca la familia entera: eso es detección de robo.
create table if not exists sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  family_id    uuid not null,
  token_hash   text        not null,
  status       session_status not null default 'ACTIVE',
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  replaced_by  uuid references sessions (id) on delete set null,
  user_agent   text,
  ip_address   inet,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create unique index if not exists sessions_token_hash_uidx on sessions (token_hash);
create index if not exists sessions_user_idx on sessions (user_id, status);
create index if not exists sessions_family_idx on sessions (family_id);
create index if not exists sessions_expires_idx on sessions (expires_at)
  where status = 'ACTIVE';

-- ----------------------------------------------------------------------------
-- 4.19 audit_logs
-- ----------------------------------------------------------------------------
-- Append-only. No se actualiza ni se borra: es el rastro de qué hizo cada actor.
-- Incluye acciones hechas por IA, con agent_name para distinguirlas.
create table if not exists audit_logs (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references users (id) on delete set null,
  actor_role   text,
  agent_name   text,
  community_id uuid references communities (id) on delete set null,
  action       text        not null,
  entity       text        not null,
  entity_id    text,
  metadata     jsonb,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now()
);

create index if not exists audit_logs_community_idx on audit_logs (community_id, created_at desc);
create index if not exists audit_logs_actor_idx on audit_logs (actor_id, created_at desc);
create index if not exists audit_logs_entity_idx on audit_logs (entity, entity_id);

-- Bloquea UPDATE y DELETE a nivel de motor, no solo por convención.
create or replace function audit_logs_are_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_logs es append-only: % no permitido', tg_op
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists audit_logs_no_update on audit_logs;
create trigger audit_logs_no_update
  before update or delete on audit_logs
  for each row execute function audit_logs_are_immutable();

-- ----------------------------------------------------------------------------
-- 4.20 ai_chat_sessions / ai_chat_messages
-- ----------------------------------------------------------------------------
-- Trazabilidad del asistente. Sirve para evaluar calidad, depurar una
-- respuesta mala y cumplir con el derecho al borrado (DELETE en cascada).
create table if not exists ai_chat_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users (id) on delete cascade,
  community_id uuid references communities (id) on delete cascade,
  title        text,
  model_used   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists ai_chat_sessions_user_idx
  on ai_chat_sessions (user_id, updated_at desc);

create table if not exists ai_chat_messages (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references ai_chat_sessions (id) on delete cascade,
  role       text        not null,
  content    text        not null,
  tool_calls jsonb,
  citations  jsonb,
  tokens_in  integer,
  tokens_out integer,
  created_at timestamptz not null default now(),
  constraint ai_chat_messages_role_valid check (
    role in ('user', 'assistant', 'system', 'tool')
  )
);

create index if not exists ai_chat_messages_session_idx
  on ai_chat_messages (session_id, created_at);

-- ----------------------------------------------------------------------------
-- 4.21 incident_drafts
-- ----------------------------------------------------------------------------
-- Propuesta del AI Incident Assistant. NUNCA crea una incidencia.
-- Se guarda como draft, el humano la revisa, y solo al confirmar se inserta en
-- incidents (dentro de una transacción, y con created_via = 'AI_SUGGESTION').
create table if not exists incident_drafts (
  id           uuid primary key default gen_random_uuid(),
  community_id uuid not null references communities (id) on delete cascade,
  user_id      uuid not null references users (id) on delete cascade,
  raw_input    text        not null,
  proposal     jsonb       not null,
  status       text        not null default 'PENDING',
  confidence   numeric(4,3),
  needs_human_review boolean not null default true,
  incident_id  uuid references incidents (id) on delete set null,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint incident_drafts_status_valid check (
    status in ('PENDING', 'CONFIRMED', 'DISMISSED', 'EXPIRED')
  )
);

create index if not exists incident_drafts_user_idx on incident_drafts (user_id, created_at desc);
create index if not exists incident_drafts_expiry_idx on incident_drafts (expires_at)
  where status = 'PENDING';

-- ----------------------------------------------------------------------------
-- 4.22 ai_usage
-- ----------------------------------------------------------------------------
-- Control de presupuesto. Los proveedores gratuitos (Groq: 1 000 req/día,
-- 200 000 tokens/día) imponen techo, y sin esto un usuario puede agotar la
-- cuota del día y dejar sin IA a los demás.
create table if not exists ai_usage (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references users (id) on delete cascade,
  usage_date    date        not null default current_date,
  requests      integer     not null default 0,
  input_tokens  integer     not null default 0,
  output_tokens integer     not null default 0,
  cache_hits    integer     not null default 0,
  updated_at    timestamptz not null default now(),
  constraint ai_usage_non_negative check (
    requests >= 0 and input_tokens >= 0 and output_tokens >= 0 and cache_hits >= 0
  )
);

create unique index if not exists ai_usage_user_date_uidx on ai_usage (user_id, usage_date);

-- Caché de clasificaciones. La misma descripción ("no hay agua caliente")
-- produce la misma propuesta; responderla de nuevo es gastar tokens gratis.
create table if not exists ai_cache (
  input_hash   text primary key,
  kind         text        not null,
  result       jsonb       not null,
  hit_count    integer     not null default 0,
  expires_at   timestamptz not null default (now() + interval '7 days'),
  created_at   timestamptz not null default now()
);

create index if not exists ai_cache_expiry_idx on ai_cache (expires_at);

-- ----------------------------------------------------------------------------
-- 5. Triggers de updated_at
-- ----------------------------------------------------------------------------
-- Todas las tablas con updated_at. Se centraliza aquí en lugar de repetir la
-- definición 20 veces arriba.
do $$
declare
  t text;
begin
  foreach t in array array[
    'users', 'communities', 'community_members', 'incidents',
    'incident_comments', 'common_areas', 'reservations', 'announcements',
    'documents', 'document_acl', 'expenses', 'invoices',
    'vote_options', 'vote_responses', 'ai_chat_sessions', 'incident_drafts'
  ] loop
    execute format('drop trigger if exists %I on %I', t || '_set_updated_at', t);
    execute format(
      'create trigger %I before update on %I
         for each row execute function set_updated_at()',
      t || '_set_updated_at', t
    );
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 6. Resumen
-- ----------------------------------------------------------------------------
-- Verificación rápida de que todo se creó. Debe devolver 20.
do $$
declare
  n integer;
begin
  select count(*) into n
  from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE';

  raise notice 'CommunityHub · tablas creadas: %', n;
end $$;