-- =============================================================================
-- 02l — Bloque 11: IA
-- =============================================================================
--
-- La IA dentro de CommunityHub: el Asistente de la comunidad (chat con tool
-- calling) y el Asistente de incidencias (clasificación con confirmación
-- humana). La decisión de fondo, AI-1, es que la IA NUNCA toca SQL: solo pide
-- herramientas que el backend valida y autoriza, y las herramientas llaman a
-- los services de los bloques 04-10. Por eso este archivo es corto: la IA no
-- trae reglas de negocio nuevas, compone las que ya existen.
--
-- Este archivo añade las cuatro piezas que no tenían dónde vivir:
--
--   * AI-5: presupuesto diario atómico. `app_ai_usage_today()` y
--     `app_ai_usage_consume()` hacen el UPSERT sobre
--     `ai_usage_user_date_uidx (user_id, usage_date)` y comprueban el techo en
--     la misma operación, para que dos peticiones simultáneas del mismo usuario
--     SUMEN y no se pisen, y ninguna pase por encima del límite.
--   * AI-2/AI-14: `app_confirm_incident_draft()` es el único camino que crea
--     una incidencia desde un borrador de IA. Lo hace con
--     `created_via = 'AI_SUGGESTION'`, con `reporter_id` = actor humano, y solo
--     si el borrador es PENDING y no ha expirado. Reutilizar
--     `app_create_incident()` no valía: graba `'MANUAL'` a fuego.
--   * AI-7: `app_delete_chat_session()` borra una conversación propia. El
--     borrado en cascada del esquema se lleva los mensajes; `app_runtime` NO
--     tiene privilegio de DELETE sobre la tabla (se revoca aquí).
--
-- No crea tablas ni columnas: `ai_chat_sessions` / `ai_chat_messages` (§4.20),
-- `incident_drafts` (§4.21), `ai_usage` y `ai_cache` (§4.22) ya vienen completos
-- de 01_schema.sql (spec 11 §3). Tampoco toca las políticas RLS: `ai_sessions_own`,
-- `ai_messages_own`, `drafts_own` y `ai_usage_own` de 02_rls.sql §5.20-5.22 ya
-- resuelven el alcance "solo lo mío", y la caché ya se sirve por
-- `app_ai_cache_get` / `app_ai_cache_put` (§5.23).
--
-- Orden interno: 1) presupuesto  2) confirmar borrador  3) borrar sesión
--                 4) permisos  5) autocomprobación.
--
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Presupuesto de IA (AI-5)
-- ----------------------------------------------------------------------------
-- El consumo del día, o ceros si todavía no hay fila. Devuelve SIEMPRE una
-- fila (el `select 1` de la izquierda garantiza el LEFT JOIN), para que el
-- service no tenga que distinguir "sin fila" de "todo a cero".
create or replace function app_ai_usage_today(p_user uuid)
returns table (
  requests      integer,
  input_tokens  integer,
  output_tokens integer,
  cache_hits    integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(u.requests, 0),
    coalesce(u.input_tokens, 0),
    coalesce(u.output_tokens, 0),
    coalesce(u.cache_hits, 0)
    from (select 1) as one
    left join ai_usage u
      on u.user_id = p_user
     and u.usage_date = current_date
$$;

-- Suma el consumo y devuelve los totales del día con `exceeded` a `'requests'`
-- o `'tokens'` si el techo se ha pasado (null si va bien).
--
-- El UPSERT y la comprobación van juntos a propósito: comprobar en TypeScript y
-- escribir después deja una ventana entre las dos operaciones por la que dos
-- peticiones a la vez pueden colarse las dos.
--
-- No revierte el consumo al pasarse: la llamada al proveedor ya se hizo y ya
-- gastó cuota. La función informa; el service decide el 429.
create or replace function app_ai_usage_consume(
  p_user        uuid,
  p_requests    integer,
  p_input       integer,
  p_output      integer,
  p_cache_hits  integer,
  p_max_requests integer,
  p_max_tokens  integer
)
returns table (
  requests      integer,
  input_tokens  integer,
  output_tokens integer,
  cache_hits    integer,
  exceeded      text
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_req  integer;
  v_in   integer;
  v_out  integer;
  v_hits integer;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  insert into ai_usage (user_id, usage_date, requests, input_tokens, output_tokens, cache_hits)
  values (p_user, current_date, p_requests, p_input, p_output, p_cache_hits)
  on conflict (user_id, usage_date) do update
    set requests      = ai_usage.requests      + excluded.requests,
        input_tokens  = ai_usage.input_tokens  + excluded.input_tokens,
        output_tokens = ai_usage.output_tokens + excluded.output_tokens,
        cache_hits    = ai_usage.cache_hits    + excluded.cache_hits,
        updated_at    = now();

  select u.requests, u.input_tokens, u.output_tokens, u.cache_hits
    into v_req, v_in, v_out, v_hits
    from ai_usage u
   where u.user_id = p_user
     and u.usage_date = current_date;

  requests      := v_req;
  input_tokens  := v_in;
  output_tokens := v_out;
  cache_hits    := v_hits;

  if v_req > p_max_requests then
    exceeded := 'requests';
  elsif (v_in + v_out) > p_max_tokens then
    exceeded := 'tokens';
  else
    exceeded := null;
  end if;

  return next;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2. Confirmar un borrador de incidencia de IA (AI-2, AI-14)
-- ----------------------------------------------------------------------------
-- El único camino que convierte una propuesta de IA en una incidencia real. El
-- actor es SIEMPRE un humano autenticado: `reporter_id` se firma con
-- `app_current_user_id()` y nunca viaja en el cuerpo. `created_via` se fija a
-- `'AI_SUGGESTION'` para trazabilidad (el enum ya lo contempla desde 01_schema).
--
-- Guardas, en orden (spec 11 §5.4):
--   1. Existe y es del actor           -> draft_not_found        (P0002 -> 404)
--   2. El actor es miembro de la comunidad -> forbidden_role      (42501 -> 403)
--   3. Estado: CONFIRMED               -> draft_already_confirmed (U0001 -> 409)
--              cualquier otro != PENDING -> draft_not_pending     (U0001 -> 409)
--              expirado (expires_at)    -> draft_expired          (U0001 -> 409)
--   4. El patch del humano pisa al proposal campo a campo.
--   5. Alta con created_via='AI_SUGGESTION' y needs_review según la regla del
--      alta manual (CRITICAL + NEIGHBOR).
--   6. El borrador queda CONFIRMED con su incident_id.
--
-- Todo en una transacción: si el alta falla, el borrador sigue PENDING.
create or replace function app_confirm_incident_draft(
  p_draft uuid,
  p_patch jsonb default '{}'
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
#variable_conflict use_column
declare
  v_user      uuid := app_current_user_id();
  d           incident_drafts;
  v_proposal  jsonb;
  v_title     text;
  v_desc      text;
  v_category  incident_category;
  v_priority  incident_priority;
  v_location  text;
  v_needs     boolean;
  v_id        uuid;
begin
  if v_user is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- 1. El borrador existe y es de quien confirma. Un id ajeno y un id
  --    inexistente son el mismo 404, por el motivo de siempre (C-8).
  select * into d from incident_drafts where id = p_draft;

  if d.id is null or d.user_id <> v_user then
    raise exception 'draft_not_found: el borrador no existe o no es tuyo'
      using errcode = 'P0002';
  end if;

  -- 2. Miembro activo de la comunidad del borrador.
  if not app_is_member_of(d.community_id) then
    raise exception 'forbidden_role: no eres miembro de la comunidad del borrador'
      using errcode = '42501';
  end if;

  -- 3. Estado y caducidad.
  if d.status = 'CONFIRMED' then
    raise exception 'draft_already_confirmed: el borrador ya se confirmó'
      using errcode = 'U0001';
  end if;

  if d.status <> 'PENDING' then
    raise exception 'draft_not_pending: el borrador no está pendiente'
      using errcode = 'U0001';
  end if;

  if d.expires_at <= now() then
    update incident_drafts
       set status = 'EXPIRED', updated_at = now()
     where id = p_draft;
    raise exception 'draft_expired: el borrador ha caducado'
      using errcode = 'U0001';
  end if;

  -- 4. Fusión: lo que el humano no toca, sale del proposal.
  v_proposal := d.proposal;

  v_title := coalesce(
    nullif(btrim(p_patch ->> 'title'), ''),
    nullif(btrim(v_proposal ->> 'title'), '')
  );
  v_desc := coalesce(
    nullif(btrim(p_patch ->> 'description'), ''),
    nullif(btrim(v_proposal ->> 'description'), '')
  );
  v_category := coalesce(
    (p_patch ->> 'category')::incident_category,
    (v_proposal ->> 'category')::incident_category,
    'OTHER'
  );
  v_priority := coalesce(
    (p_patch ->> 'priority')::incident_priority,
    (v_proposal ->> 'priority')::incident_priority,
    'MEDIUM'
  );
  v_location := coalesce(
    nullif(btrim(p_patch ->> 'location'), ''),
    nullif(btrim(v_proposal ->> 'location'), '')
  );

  -- Los mínimos son los de los CHECK de `incidents` (5 y 10), no los del
  -- proposal (3 y 1): la fila que se inserta tiene que cumplirlos, y un 400 con
  -- sentinel es mejor que un 23514 de constraint sin nombre.
  if v_title is null or char_length(v_title) < 5 then
    raise exception 'draft_content_invalid: el título necesita al menos 5 caracteres'
      using errcode = '22023';
  end if;

  if v_desc is null or char_length(v_desc) < 10 then
    raise exception 'draft_content_invalid: la descripción necesita al menos 10 caracteres'
      using errcode = '22023';
  end if;

  -- 5. Alta. Misma regla de revisión que el alta manual (02e §4.1): una
  --    incidencia CRITICAL reportada por un NEIGHBOR nace con needs_review.
  v_needs := v_priority = 'CRITICAL'
             and app_role_in(d.community_id) = 'NEIGHBOR';

  insert into incidents (
    community_id, reference_code, title, description, category, priority,
    status, location, reporter_id, created_via, needs_review
  )
  values (
    d.community_id,
    'INC-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('incident_reference_code_seq')::text, 6, '0'),
    v_title,
    v_desc,
    v_category,
    v_priority,
    'OPEN',
    v_location,
    v_user,
    'AI_SUGGESTION',
    v_needs
  )
  returning id into v_id;

  -- 6. El borrador queda cerrado y enlazado.
  update incident_drafts
     set status = 'CONFIRMED', incident_id = v_id, updated_at = now()
   where id = p_draft;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3. Borrar una conversación propia (AI-7)
-- ----------------------------------------------------------------------------
-- `app_runtime` no tiene DELETE sobre `ai_chat_sessions` (se revoca en la
-- sección 4), así que el borrado va por aquí. La cascada del esquema elimina
-- los mensajes. Sin soft delete: una conversación que el usuario borra se borra
-- de verdad.
create or replace function app_delete_chat_session(p_session uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := app_current_user_id();
begin
  if v_user is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  delete from ai_chat_sessions
   where id = p_session
     and user_id = v_user;

  if not found then
    raise exception 'session_not_found: la sesión no existe o no es tuya'
      using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Permisos
-- ----------------------------------------------------------------------------
-- `app_runtime` ejecuta las cuatro funciones nuevas; PUBLIC ninguna.
grant execute on function app_ai_usage_today(uuid) to app_runtime;
grant execute on function app_ai_usage_consume(uuid, integer, integer, integer, integer, integer, integer) to app_runtime;
grant execute on function app_confirm_incident_draft(uuid, jsonb) to app_runtime;
grant execute on function app_delete_chat_session(uuid) to app_runtime;

revoke execute on function app_ai_usage_today(uuid) from public;
revoke execute on function app_ai_usage_consume(uuid, integer, integer, integer, integer, integer, integer) from public;
revoke execute on function app_confirm_incident_draft(uuid, jsonb) from public;
revoke execute on function app_delete_chat_session(uuid) from public;

-- El borrado de sesiones pasa SOLO por la función: se quita el privilegio de la
-- tabla por si algún GRANT futuro lo reintrodujera. 02_rls.sql §5.19 nunca lo
-- concedió, de modo que hoy es un no-op, pero deja la intención escrita.
revoke delete on ai_chat_sessions from app_runtime;
revoke delete on ai_chat_sessions from anon, authenticated;

-- La caché también es solo-por-función (02_rls.sql §5.23). Se repite el revoke
-- por simetría con 02e-02k: quitar una tabla de la lista de permissions no
-- deshace un GRANT ya aplicado.
revoke all on ai_cache from app_runtime;
revoke all on ai_cache from anon, authenticated;

-- ----------------------------------------------------------------------------
-- 5. Autocomprobación
-- ----------------------------------------------------------------------------
-- Que este archivo se aplique sin errores no demuestra nada: si alguien lo
-- reescribe y se le olvida el `security definer`, o deja un privilegio vivo, se
-- aplicaría igual de limpio y el agujero se instalaría solo. Estas comprobaciones
-- son las que fallan en `db:verify` (y las repite 04_verify.sql).
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las cuatro funciones: existen, son SECURITY DEFINER con search_path fijo y
  -- no ejecutables por PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_ai_usage_today', 'app_ai_usage_consume',
         'app_confirm_incident_draft', 'app_delete_chat_session'
       )
  loop
    if not r.prosecdef then
      v_fallos := v_fallos || ' ' || r.proname || ' ya no es SECURITY DEFINER;';
    end if;

    if r.proconfig is null
       or not exists (
         select 1 from unnest(r.proconfig) as c
          where c like 'search\_path=%'
       )
    then
      v_fallos := v_fallos || ' ' || r.proname || ' necesita search_path fijo;';
    end if;

    if exists (
      select 1
        from information_schema.role_routine_grants
       where routine_schema = 'public'
         and routine_name = r.proname
         and grantee = 'PUBLIC'
    ) then
      v_fallos := v_fallos || ' ' || r.proname || ' sigue siendo ejecutable por PUBLIC;';
    end if;
  end loop;

  -- Y que las cuatro estén: el bucle anterior no falla si no hay ninguna.
  for r in
    select unnest(array[
      'app_ai_usage_today', 'app_ai_usage_consume',
      'app_confirm_incident_draft', 'app_delete_chat_session'
    ]) as fn
  loop
    if not exists (
      select 1
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public'
         and p.proname = r.fn
    ) then
      v_fallos := v_fallos || ' falta ' || r.fn || '();';
    end if;
  end loop;

  -- La caché sigue accesible solo por sus dos funciones.
  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_ai_cache_get'
  ) then
    v_fallos := v_fallos || ' falta app_ai_cache_get();';
  end if;

  if not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'app_ai_cache_put'
  ) then
    v_fallos := v_fallos || ' falta app_ai_cache_put();';
  end if;

  -- app_runtime NO tiene privilegio de DELETE sobre ai_chat_sessions (AI-7).
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'ai_chat_sessions'
       and privilege_type = 'DELETE'
       and grantee = 'app_runtime'
  ) then
    v_fallos := v_fallos || ' app_runtime conserva DELETE sobre ai_chat_sessions;';
  end if;

  -- app_runtime NO tiene ningún privilegio sobre ai_cache.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'ai_cache'
       and grantee = 'app_runtime'
  ) then
    v_fallos := v_fallos || ' app_runtime conserva permisos sobre ai_cache;';
  end if;

  -- app_runtime NO puede leer incident_drafts: la confirmación va por función
  -- (spec 11 §4a). Si algún día se concede SELECT, este aviso lo caza.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'incident_drafts'
       and privilege_type = 'SELECT'
       and grantee = 'app_runtime'
  ) then
    v_fallos := v_fallos || ' app_runtime tiene SELECT sobre incident_drafts;';
  end if;

  -- Las políticas RLS de las tablas de IA siguen siendo las de "solo lo mío".
  for r in
    select unnest(array['ai_sessions_own', 'ai_messages_own', 'drafts_own', 'ai_usage_own']) as pol
  loop
    if not exists (
      select 1 from pg_policies where policyname = r.pol
    ) then
      v_fallos := v_fallos || ' falta la politica ' || r.pol || ';';
    end if;
  end loop;

  -- AI-2 escrita: el confirm firma created_via = 'AI_SUGGESTION'.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_confirm_incident_draft'
       and pg_get_functiondef(p.oid) like '%AI_SUGGESTION%'
  ) then
    v_fallos := v_fallos || ' app_confirm_incident_draft deberia marcar AI_SUGGESTION (AI-2);';
  end if;

  -- AI-5 escrita: el consumo es un UPSERT sobre (user_id, usage_date).
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_ai_usage_consume'
       and pg_get_functiondef(p.oid) like '%on conflict (user_id, usage_date)%'
  ) then
    v_fallos := v_fallos || ' app_ai_usage_consume deberia ser un upsert por usuario/día (AI-5);';
  end if;

  if v_fallos <> '' then
    raise exception 'La IA no es segura:%', v_fallos;
  end if;

  raise notice 'OK: IA sin SQL directo (cuatro funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC), confirmación marcada AI_SUGGESTION, presupuesto atómico, caché solo por función, incident_drafts sin SELECT para app_runtime.';
end $$;
