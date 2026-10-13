-- =============================================================================
-- 02k — Bloque 10: votaciones
-- =============================================================================
--
-- Votaciones comunitarias: crear (PRESIDENT/ADMIN), publicar, votar (un voto por
-- vecino, con cambio de voto), cerrar y consultar resultados agregados. La
-- decisión de fondo, V-2, es la contraria a la del bloque 09: aquí el contenido
-- es DE TODOS los miembros y lo que se protege no es el acceso sino el **secreto
-- del voto**: ningún voto individual sale por la API, ni para la administración.
--
-- Cada pieza traduce una decisión V-*:
--
--   * V-1: ven y votan los miembros activos salvo PROVIDER (un profesional
--     externo no gobierna la comunidad); gestionan solo PRESIDENT y ADMIN.
--   * V-2: la rama `or app_is_admin_of(...)` de `responses_select_own_or_admin`
--     se ELIMINA. La política pasa a "solo el propio voto" y el recuento lo
--     hace `app_vote_results()`, que solo devuelve sumas. Sin esto, el secreto
--     de voto sería una promesa de la interfaz y no del backend.
--   * V-3: toda escritura pasa por función SECURITY DEFINER. Se revocan
--     insert/update/delete de `votes`/`vote_options` e insert/update de
--     `vote_responses` a `app_runtime`, y se eliminan las políticas de
--     escritura.
--   * V-4: TODA lectura de votaciones es UNA función, `app_list_votes()`: el
--     listado y el detalle por id comparten el predicado de visibilidad.
--   * V-5: el listado da 403 a quien no puede ver (no-miembro o PROVIDER); el
--     detalle por id da 404 (no confirmar que el id existe, C-8).
--   * V-6: `DRAFT -> OPEN` con publish, `OPEN -> CLOSED` con close, y una OPEN
--     vencida se LEE como CLOSED con `app_vote_effective_status()` sin
--     persistirlo (no hay jobs en el proyecto).
--   * V-7: el PATCH es parcial y solo sobre un DRAFT; publicado o cerrado es
--     inmutable.
--   * V-9: `quorum_percent` obligatorio si y solo si `type = 'QUORUM'`;
--     elegibles = miembros activos no PROVIDER.
--   * V-10: la abstención la genera el sistema (una opción `is_abstention`),
--     re-sincronizada con `allow_abstention`.
--   * V-11: un voto por usuario, "cambiar de voto" es un UPSERT sobre
--     `vote_responses_unique_vote_uidx (vote_id, user_id)`.
--   * V-12: resultados: ADMIN/PRESIDENT siempre; el resto según
--     `result_visibility` (LIVE / AFTER_CLOSE / ADMIN_ONLY).
--   * V-13: el export es CSV del recuento; se genera en el backend, no aquí.
--   * V-14: no hay DELETE de votaciones; `deleted_at` se respeta en lectura.
--
-- Orden interno: 1) CHECK de longitud  2) visibilidad/comunidad de voto
--                 3) estado efectivo  4) opciones  5) lecturas  6) escrituras
--                 7) resultados  8) políticas RLS  9) permisos
--                 10) autocomprobación
--
-- No crea tablas ni columnas: `votes` (§4.14), `vote_options` (§4.15) y
-- `vote_responses` (§4.16) ya vienen completos de 01_schema.sql (spec 10 §3).
--
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Longitudes de texto
-- ----------------------------------------------------------------------------
-- `title`/`question` (not null) no impiden el `''`, y `description`/`label` son
-- texto infinito. Mismo criterio que 02i §4a y 02j §1: `not valid` aplica a
-- filas nuevas sin revalidar las del seed ni las demos (validate es un paso
-- posterior). Los rangos los repite el zod del backend de forma independiente.
do $$
begin
  alter table votes
    add constraint votes_title_length
    check (char_length(title) between 1 and 120) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table votes
    add constraint votes_question_length
    check (char_length(question) between 1 and 200) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table votes
    add constraint votes_description_length
    check (character_length(description) between 1 and 1000) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table vote_options
    add constraint vote_options_label_length
    check (char_length(label) between 1 and 120) not valid;
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 2. Visibilidad de una votación y guarda de gestión
-- ----------------------------------------------------------------------------
-- `app_vote_community` es la pieza de visibilidad del bloque. Devuelve el
-- community_id SOLO si la fila existe, no está borrada, el actor es miembro
-- activo que no sea PROVIDER (V-1) y, si es un BORRADOR, el actor es
-- PRESIDENT/ADMIN (V-5, cierra el hueco de `votes_select_member`). NULL en
-- cualquier otro caso.
--
-- Quien la llama dentro de SQL son los mutadores, con NULL -> `vote_not_found`
-- -> 404; el middleware `requireVote()` la usa para resolver la comunidad de las
-- rutas por id. Que un NEIGHBOR vea una votación abierta no le da permiso para
-- editarla: eso lo decide cada operación con `app_is_leadership_of()`.
create or replace function app_vote_community(p_vote uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select v.community_id
    from votes v
   where v.id = p_vote
     and v.deleted_at is null
     and app_is_member_of(v.community_id)
     and app_role_in(v.community_id) in ('NEIGHBOR', 'PRESIDENT', 'ADMIN')
     and (
       v.status <> 'DRAFT'
       or app_role_in(v.community_id) in ('ADMIN', 'PRESIDENT')
     )
$$;

-- Guarda de "crear/editar/publicar/cerrar" (V-1). No existía un helper
-- equivalente (hay `app_is_admin_of` y `app_role_in` por separado); se añade
-- aquí porque lo usan cinco funciones y escribirlo cinco veces invita a que una
-- se olvide de la membresía.
create or replace function app_is_leadership_of(p_community_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app_is_member_of(p_community_id)
     and app_role_in(p_community_id) in ('ADMIN', 'PRESIDENT')
$$;

-- ----------------------------------------------------------------------------
-- 3. El estado efectivo de una votación
-- ----------------------------------------------------------------------------
-- V-6: una OPEN cuyo `ends_at` ya ha llegado se LEE como CLOSED sin persistirlo
-- (no hay jobs, D-4 de la spec 08 y FN-5 de la 09). `stable` (usa `now()`), en
-- una ÚNICA función compartida por el listado y los resultados para que no
-- diverjan. DRAFT y CLOSED pasan tal cual.
create or replace function app_vote_effective_status(
  p_status  vote_status,
  p_ends_at timestamptz
) returns vote_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'OPEN' and now() >= p_ends_at then 'CLOSED'::vote_status
    else p_status
  end
$$;

-- ----------------------------------------------------------------------------
-- 4. Las opciones de una votación (V-10)
-- ----------------------------------------------------------------------------
-- La única pieza que escribe `vote_options`, compartida por `app_create_vote()`
-- y `app_update_vote()`. Recibe la lista de opciones REALES (array JSON de
-- cadenas) o NULL:
--
--   * Con `p_options` no nulo: exige >= 2 opciones, ninguna vacía tras btrim,
--     ninguna repetida (lower(btrim)) y ninguna igual a 'Abstención' cuando la
--     votación permite abstención; BORRA las opciones y las reinserta con
--     position 1..n e `is_abstention = false`.
--   * Sincroniza la abstención con el `allow_abstention` actual de la fila: si
--     es true y no hay opción de abstención la inserta al final; si es false,
--     borra la que hubiera.
--   * Comprueba al final que quedan >= 2 opciones reales.
--
-- Con `p_options = null` la llamada SOLO re-sincroniza la abstención (lo que
-- hace un PATCH que únicamente cambia `allowAbstention`).
--
-- El `delete`+`insert` solo se ejecuta con `p_options` no nulo y solo sobre un
-- DRAFT (lo garantizan los mutadores que llaman): un DRAFT no tiene respuestas,
-- así que el `on delete cascade` de `vote_responses.option_id` no destruye
-- ningún voto.
create or replace function app_set_vote_options(p_vote uuid, p_options jsonb)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_allow boolean;
  v_count integer;
begin
  select allow_abstention into v_allow from votes where id = p_vote;

  if p_options is not null and jsonb_typeof(p_options) = 'array' then
    v_count := jsonb_array_length(p_options);

    if v_count < 2 then
      raise exception 'vote_options_invalid: se necesitan al menos dos opciones'
        using errcode = '22023';
    end if;

    if exists (
      select 1 from jsonb_array_elements_text(p_options) as e(valor)
       where btrim(e.valor) = ''
    ) then
      raise exception 'vote_options_invalid: las opciones no pueden estar vacias'
        using errcode = '22023';
    end if;

    if (
      select count(distinct lower(btrim(e.valor)))
        from jsonb_array_elements_text(p_options) as e(valor)
    ) < v_count then
      raise exception 'vote_option_duplicate: hay opciones repetidas'
        using errcode = '22023';
    end if;

    if v_allow and exists (
      select 1 from jsonb_array_elements_text(p_options) as e(valor)
       where lower(btrim(e.valor)) = lower('Abstención')
    ) then
      raise exception 'vote_option_duplicate: Abstención la genera el sistema'
        using errcode = '22023';
    end if;

    delete from vote_options where vote_id = p_vote;

    insert into vote_options (vote_id, label, position, is_abstention)
    select p_vote, btrim(e.valor), e.orden::integer, false
      from jsonb_array_elements_text(p_options) with ordinality as e(valor, orden);
  end if;

  if v_allow then
    if not exists (
      select 1 from vote_options where vote_id = p_vote and is_abstention
    ) then
      insert into vote_options (vote_id, label, position, is_abstention)
      values (
        p_vote, 'Abstención',
        coalesce((select max(position) from vote_options where vote_id = p_vote), 0) + 1,
        true
      );
    end if;
  else
    delete from vote_options where vote_id = p_vote and is_abstention;
  end if;

  if (
    select count(*) from vote_options
     where vote_id = p_vote and not is_abstention
  ) < 2 then
    raise exception 'vote_options_invalid: se necesitan al menos dos opciones'
      using errcode = '22023';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Lecturas
-- ----------------------------------------------------------------------------
-- V-4: TODA lectura de votaciones pasa por app_list_votes() — el listado y el
-- detalle por id con el MISMO predicado, para que no haya dos copias de la
-- visibilidad que puedan discrepar.
--
--   * Listado (p_vote null): no-miembro o PROVIDER -> 403 (C-8: no confirmar
--     que la comunidad existe; V-5).
--   * Detalle (p_vote puesto): cero filas -> 404, el mismo que "no existe"
--     (borrador no visible, otra comunidad, borrada, PROVIDER o no-miembro).
--   * `deleted_at is null` (V-14) y `app_vote_community(v.id) is not null`: el
--     único predicado de visibilidad.
--   * El filtro `p_status` compara con el ESTADO EFECTIVO (V-6), de modo que
--     `?status=CLOSED` incluye las vencidas sin que la fila diga CLOSED.
--
-- Añade `created_by` + `created_by_name` (left join a users, la excepción
-- acotada de los bloques 03-09), `options` (jsonb agregado por posición),
-- `my_option_id` (la opción que ESTE actor eligió, o null) y el
-- `status`/`effective_status`. El total sale de `count(*) over ()`.
create or replace function app_list_votes(
  p_community_id uuid,
  p_vote         uuid        default null,
  p_status       vote_status default null,
  p_limit        integer     default 20,
  p_offset       integer     default 0
)
returns table (
  id                uuid,
  community_id      uuid,
  title             text,
  question          text,
  description       text,
  type              vote_type,
  status            vote_status,
  effective_status  vote_status,
  starts_at         timestamptz,
  ends_at           timestamptz,
  allow_abstention  boolean,
  quorum_percent    integer,
  result_visibility vote_result_visibility,
  options           jsonb,
  my_option_id      uuid,
  created_by        uuid,
  created_by_name   text,
  closed_at         timestamptz,
  created_at        timestamptz,
  updated_at        timestamptz,
  total_count       bigint
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  -- V-5: el listado confirma que hay votaciones; el detalle no confirma el id.
  if p_vote is null then
    if not app_is_member_of(p_community_id)
       or app_role_in(p_community_id) = 'PROVIDER' then
      raise exception 'forbidden_role: no puedes ver las votaciones de esta comunidad'
        using errcode = '42501';
    end if;
  end if;

  return query
  select v.id, v.community_id, v.title, v.question, v.description,
         v.type, v.status,
         app_vote_effective_status(v.status, v.ends_at),
         v.starts_at, v.ends_at, v.allow_abstention, v.quorum_percent,
         v.result_visibility,
         coalesce((
           select jsonb_agg(
                    jsonb_build_object(
                      'id', o.id, 'label', o.label,
                      'position', o.position, 'isAbstention', o.is_abstention
                    ) order by o.position)
             from vote_options o
            where o.vote_id = v.id
         ), '[]'::jsonb),
         (select r.option_id
            from vote_responses r
           where r.vote_id = v.id and r.user_id = app_current_user_id()),
         v.created_by, u.full_name, v.closed_at, v.created_at, v.updated_at,
         count(*) over ()
    from votes v
    left join users u on u.id = v.created_by
   where v.deleted_at is null
     and (p_vote is null or v.id = p_vote)
     and (p_community_id is null or v.community_id = p_community_id)
     and (p_status is null
          or app_vote_effective_status(v.status, v.ends_at) = p_status)
     and app_vote_community(v.id) is not null
   order by v.starts_at desc, v.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. Escrituras
-- ----------------------------------------------------------------------------
-- La única puerta de entrada que queda: `votes`/`vote_options` pierden
-- insert/update/delete y `vote_responses` pierde insert/update (sección 9).
-- Ninguna función acepta un usuario como parámetro: el actor sale de
-- app_current_user_id().

-- ----------------------------------------------------------------------------
-- 6.1 Crear una votación (nace en DRAFT, V-6)
-- ----------------------------------------------------------------------------
-- Guardas en orden: contexto -> gestión -> campos obligatorios -> fechas ->
-- quórum. `created_by` sale de la sesión (nunca del cuerpo). Las opciones se
-- delegan en app_set_vote_options() (mínimo, duplicados y abstención, V-10).
create or replace function app_create_vote(
  p_community_id      uuid,
  p_title             text,
  p_question          text,
  p_description       text,
  p_type              vote_type,
  p_starts_at         timestamptz,
  p_ends_at           timestamptz,
  p_allow_abstention  boolean,
  p_quorum_percent    integer,
  p_result_visibility vote_result_visibility,
  p_options           jsonb
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id     uuid;
  v_type   vote_type := coalesce(p_type, 'SINGLE');
  v_quorum integer := p_quorum_percent;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_leadership_of(p_community_id) then
    raise exception 'vote_requires_leadership: solo la presidencia o un administrador gestiona votaciones'
      using errcode = '42501';
  end if;

  if p_title is null or btrim(p_title) = '' then
    raise exception 'vote_content_required: el título es obligatorio'
      using errcode = '22023';
  end if;

  if p_question is null or btrim(p_question) = '' then
    raise exception 'vote_content_required: la pregunta es obligatoria'
      using errcode = '22023';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'vote_dates_invalid: la fecha de cierre debe ser posterior a la de inicio'
      using errcode = '22023';
  end if;

  if v_type = 'QUORUM' then
    if v_quorum is null or v_quorum < 1 or v_quorum > 100 then
      raise exception 'vote_quorum_invalid: el quórum debe estar entre 1 y 100'
        using errcode = '22023';
    end if;
  else
    v_quorum := null;
  end if;

  insert into votes (
    community_id, title, question, description, type, status,
    starts_at, ends_at, allow_abstention, quorum_percent,
    result_visibility, created_by
  ) values (
    p_community_id, btrim(p_title), btrim(p_question),
    nullif(btrim(p_description), ''), v_type, 'DRAFT',
    p_starts_at, p_ends_at, coalesce(p_allow_abstention, true), v_quorum,
    coalesce(p_result_visibility, 'AFTER_CLOSE'), app_current_user_id()
  )
  returning id into v_id;

  perform app_set_vote_options(v_id, p_options);

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6.2 Editar una votación (PATCH parcial, solo DRAFT, V-7)
-- ----------------------------------------------------------------------------
-- Recibe un objeto JSON con SOLO las claves presentes en el cuerpo (D-3): la
-- función distingue "no lo has enviado" (se queda como está) de "lo has
-- mandado" (se escribe). Guardas en orden:
--
--   1. app_vote_community -> NULL: vote_not_found (P0002). Un borrador es
--      visible aquí solo para la gestión, así que un NEIGHBOR ya recibe 404.
--   2. no gestión -> vote_requires_leadership (42501).
--   3. estado almacenado DRAFT; si no, vote_not_draft (U0001): publicado o
--      cerrado es inmutable.
--   4. las claves presentes: title/question no pueden quedar vacíos; fechas
--      ends_at > starts_at; QUORUM exige quórum 1-100, SINGLE fuerza null.
--   5. `options` (si viene) y la re-sincronización de la abstención.
--   6. devuelve la fila (setof votes).
create or replace function app_update_vote(p_vote uuid, p_patch jsonb)
returns setof votes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_status    vote_status;
  v_type      vote_type;
  v_allow     boolean;
  v_quorum    integer;
  v_starts    timestamptz;
  v_ends      timestamptz;
begin
  v_community := app_vote_community(p_vote);

  if v_community is null then
    raise exception 'vote_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_leadership_of(v_community) then
    raise exception 'vote_requires_leadership: solo la presidencia o un administrador'
      using errcode = '42501';
  end if;

  select v.status, v.type, v.allow_abstention, v.quorum_percent, v.starts_at, v.ends_at
    into v_status, v_type, v_allow, v_quorum, v_starts, v_ends
    from votes v
   where v.id = p_vote and v.deleted_at is null;

  if v_status <> 'DRAFT' then
    raise exception 'vote_not_draft: solo se edita un borrador' using errcode = 'U0001';
  end if;

  if p_patch ? 'type'            then v_type   := (p_patch ->> 'type')::vote_type; end if;
  if p_patch ? 'startsAt'        then v_starts := (p_patch ->> 'startsAt')::timestamptz; end if;
  if p_patch ? 'endsAt'          then v_ends   := (p_patch ->> 'endsAt')::timestamptz; end if;
  if p_patch ? 'allowAbstention' then v_allow  := (p_patch ->> 'allowAbstention')::boolean; end if;
  if p_patch ? 'quorumPercent'   then v_quorum := nullif(p_patch ->> 'quorumPercent', '')::integer; end if;

  if p_patch ? 'title' and btrim(coalesce(p_patch ->> 'title', '')) = '' then
    raise exception 'vote_content_required: el título es obligatorio'
      using errcode = '22023';
  end if;

  if p_patch ? 'question' and btrim(coalesce(p_patch ->> 'question', '')) = '' then
    raise exception 'vote_content_required: la pregunta es obligatoria'
      using errcode = '22023';
  end if;

  if v_starts is null or v_ends is null or v_ends <= v_starts then
    raise exception 'vote_dates_invalid: la fecha de cierre debe ser posterior a la de inicio'
      using errcode = '22023';
  end if;

  if v_type = 'QUORUM' then
    if v_quorum is null or v_quorum < 1 or v_quorum > 100 then
      raise exception 'vote_quorum_invalid: el quórum debe estar entre 1 y 100'
        using errcode = '22023';
    end if;
  else
    v_quorum := null;
  end if;

  update votes
     set title             = case when p_patch ? 'title'
                                  then btrim(p_patch ->> 'title') else title end,
         question          = case when p_patch ? 'question'
                                  then btrim(p_patch ->> 'question') else question end,
         description       = case when p_patch ? 'description'
                                  then nullif(btrim(p_patch ->> 'description'), '')
                                  else description end,
         type              = v_type,
         starts_at         = v_starts,
         ends_at           = v_ends,
         allow_abstention  = v_allow,
         quorum_percent    = v_quorum,
         result_visibility = case when p_patch ? 'resultVisibility'
                                  then (p_patch ->> 'resultVisibility')::vote_result_visibility
                                  else result_visibility end,
         updated_at        = now()
   where id = p_vote
     and status = 'DRAFT'
     and deleted_at is null;

  if not found then
    raise exception 'vote_not_draft: solo se edita un borrador' using errcode = 'U0001';
  end if;

  perform app_set_vote_options(p_vote, p_patch -> 'options');

  return query select v.* from votes v where v.id = p_vote;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6.3 Publicar una votación (DRAFT -> OPEN, V-6)
-- ----------------------------------------------------------------------------
-- No se puede "republicar" una abierta ni revivir una cerrada: si no es DRAFT,
-- vote_not_draft (U0001 -> 409).
create or replace function app_publish_vote(p_vote uuid)
returns setof votes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_status    vote_status;
begin
  v_community := app_vote_community(p_vote);

  if v_community is null then
    raise exception 'vote_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_leadership_of(v_community) then
    raise exception 'vote_requires_leadership: solo la presidencia o un administrador'
      using errcode = '42501';
  end if;

  select status into v_status from votes where id = p_vote;

  if v_status <> 'DRAFT' then
    raise exception 'vote_not_draft: solo se publica un borrador' using errcode = 'U0001';
  end if;

  update votes
     set status = 'OPEN', updated_at = now()
   where id = p_vote and status = 'DRAFT' and deleted_at is null;

  if not found then
    raise exception 'vote_not_draft: solo se publica un borrador' using errcode = 'U0001';
  end if;

  return query select v.* from votes v where v.id = p_vote;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6.4 Cerrar una votación (OPEN -> CLOSED, V-6), cierre anticipado permitido
-- ----------------------------------------------------------------------------
-- CLOSED -> vote_already_closed; DRAFT -> vote_not_open. Una OPEN ya vencida por
-- ends_at (su estado ALMACENADO sigue OPEN) SÍ se puede cerrar.
create or replace function app_close_vote(p_vote uuid)
returns setof votes
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_status    vote_status;
begin
  v_community := app_vote_community(p_vote);

  if v_community is null then
    raise exception 'vote_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_leadership_of(v_community) then
    raise exception 'vote_requires_leadership: solo la presidencia o un administrador'
      using errcode = '42501';
  end if;

  select status into v_status from votes where id = p_vote;

  if v_status = 'CLOSED' then
    raise exception 'vote_already_closed: la votación ya está cerrada' using errcode = 'U0001';
  end if;

  if v_status <> 'OPEN' then
    raise exception 'vote_not_open: la votación no está abierta' using errcode = 'U0001';
  end if;

  update votes
     set status = 'CLOSED', closed_at = now(), updated_at = now()
   where id = p_vote and status = 'OPEN' and deleted_at is null;

  if not found then
    raise exception 'vote_already_closed: la votación ya está cerrada' using errcode = 'U0001';
  end if;

  return query select v.* from votes v where v.id = p_vote;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6.5 Votar (upsert de un voto por usuario, V-11)
-- ----------------------------------------------------------------------------
-- Guardas en orden:
--   1. app_vote_community -> NULL: vote_not_found (P0002). Ya excluye a
--      PROVIDER, no-miembros y un DRAFT para quien no gestiona.
--   2. estado EFECTIVO CLOSED (por close o por ends_at) -> vote_closed (U0001);
--      antes de starts_at o estado no OPEN -> vote_not_open (U0001). La ventana
--      [starts_at, ends_at] es la que ya describía la política de INSERT; aquí
--      se reescribe con la fecha como parte de la condición.
--   3. p_option_id debe ser de ESTA votación (la FK no lo comprueba): si no,
--      vote_option_invalid (22023 -> 400 VOTE_OPTION_INVALID).
--   4. insert ... on conflict (vote_id, user_id) do update. El user_id sale de
--      app_current_user_id(); `weight` queda en su default 1 (§4e).
create or replace function app_cast_vote(p_vote uuid, p_option_id uuid)
returns table (
  vote_id    uuid,
  option_id  uuid,
  weight     integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
-- Los OUT de `returns table` se llaman como las columnas de `vote_responses`
-- (vote_id, option_id...). Sin el pragma, la lista de columnas del INSERT y el
-- `on conflict (vote_id, user_id)` se resuelven como variables del bloque y
-- PostgreSQL aborta con "column reference vote_id is ambiguous" (42702). Aqui
-- las columnas mandan; las variables locales van con prefijo `v_`.
#variable_conflict use_column
declare
  v_community uuid;
  v_status    vote_status;
  v_starts    timestamptz;
  v_ends      timestamptz;
begin
  v_community := app_vote_community(p_vote);

  if v_community is null then
    raise exception 'vote_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  select status, starts_at, ends_at
    into v_status, v_starts, v_ends
    from votes where id = p_vote and deleted_at is null;

  if app_vote_effective_status(v_status, v_ends) = 'CLOSED' then
    raise exception 'vote_closed: la votación ya está cerrada' using errcode = 'U0001';
  end if;

  if v_status <> 'OPEN' or now() < v_starts then
    raise exception 'vote_not_open: la votación no está abierta' using errcode = 'U0001';
  end if;

  if not exists (
    select 1 from vote_options o
     where o.id = p_option_id and o.vote_id = p_vote
  ) then
    raise exception 'vote_option_invalid: esa opción no es de esta votación'
      using errcode = '22023';
  end if;

  insert into vote_responses (vote_id, option_id, user_id)
  values (p_vote, p_option_id, app_current_user_id())
  on conflict (vote_id, user_id) do update
    set option_id = excluded.option_id,
        updated_at = now();

  return query
  select r.vote_id, r.option_id, r.weight, r.created_at, r.updated_at
    from vote_responses r
   where r.vote_id = p_vote and r.user_id = app_current_user_id();
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Resultados agregados (V-2, V-12)
-- ----------------------------------------------------------------------------
-- Nunca devuelve una fila de `vote_responses`: solo sumas. Guardas:
--   1. contexto de usuario.
--   2. app_vote_community -> NULL: vote_not_found (P0002).
--   3. estado almacenado DRAFT -> vote_not_published (U0001): los resultados de
--      un borrador no existen (solo la gestión llegaría aquí).
--   4. visibilidad (V-12): ADMIN/PRESIDENT siempre; el resto, LIVE siempre,
--      AFTER_CLOSE solo si el estado efectivo es CLOSED, ADMIN_ONLY nunca. Si no
--      pasa -> vote_results_forbidden (42501 -> 403).
--
-- Devuelve UNA fila (D-2) garantizada por los coalesce/subselects. Los
-- porcentajes por opción son sobre el total de respuestas (turnout); la
-- abstención aparece como una opción más y además aparte (abstention_count).
create or replace function app_vote_results(p_vote uuid)
returns table (
  id                    uuid,
  status                vote_status,
  effective_status      vote_status,
  ends_at               timestamptz,
  allow_abstention      boolean,
  eligible_count        bigint,
  turnout               bigint,
  participation_percent numeric(5,2),
  quorum_required       boolean,
  quorum_percent        integer,
  quorum_met            boolean,
  abstention_count      bigint,
  options               jsonb
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_role      member_role;
  v_status    vote_status;
  v_effective vote_status;
  v_type      vote_type;
  v_ends      timestamptz;
  v_quorum    integer;
  v_allow     boolean;
  v_visible   vote_result_visibility;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  v_community := app_vote_community(p_vote);

  if v_community is null then
    raise exception 'vote_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  select v.status, v.type, v.ends_at, v.quorum_percent, v.allow_abstention, v.result_visibility
    into v_status, v_type, v_ends, v_quorum, v_allow, v_visible
    from votes v
   where v.id = p_vote and v.deleted_at is null;

  if v_status = 'DRAFT' then
    raise exception 'vote_not_published: la votación aún no se ha publicado'
      using errcode = 'U0001';
  end if;

  v_effective := app_vote_effective_status(v_status, v_ends);
  v_role      := app_role_in(v_community);

  if v_role not in ('ADMIN', 'PRESIDENT') then
    if v_visible = 'ADMIN_ONLY'
       or (v_visible = 'AFTER_CLOSE' and v_effective <> 'CLOSED') then
      raise exception 'vote_results_forbidden: los resultados no son visibles'
        using errcode = '42501';
    end if;
  end if;

  return query
  with eligible as (
    select count(*)::bigint as n
      from community_members m
     where m.community_id = v_community
       and m.status = 'ACTIVE'
       and m.role in ('NEIGHBOR', 'PRESIDENT', 'ADMIN')
  ),
  resp as (
    select count(*)::bigint as n from vote_responses where vote_id = p_vote
  ),
  counts as (
    select o.id, o.label, o.position, o.is_abstention,
           coalesce(c.cnt, 0)::bigint as cnt
      from vote_options o
      left join (
        select option_id, count(*) as cnt
          from vote_responses
         where vote_id = p_vote
         group by option_id
      ) c on c.option_id = o.id
     where o.vote_id = p_vote
  )
  select
    p_vote,
    v_status,
    v_effective,
    v_ends,
    v_allow,
    (select n from eligible),
    (select n from resp),
    (case when (select n from eligible) = 0 then 0
          else round((select n from resp) * 100.0 / (select n from eligible), 2)
     end)::numeric(5,2),
    (v_type = 'QUORUM'),
    v_quorum,
    (case when v_type = 'QUORUM'
          then (select n from eligible) > 0
               and ((select n from resp) * 100.0 / (select n from eligible)) >= v_quorum
          else null end),
    (select coalesce(sum(cnt), 0)::bigint from counts where is_abstention),
    coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', c.id, 'label', c.label, 'position', c.position,
                 'isAbstention', c.is_abstention,
                 'votes', c.cnt,
                 'percent', case when (select n from resp) = 0 then 0
                                 else round(c.cnt * 100.0 / (select n from resp), 2) end
               ) order by c.position)
        from counts c
    ), '[]'::jsonb);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8. Políticas RLS
-- ----------------------------------------------------------------------------
-- `votes_select_member` deja ver los BORRADORES a cualquier miembro (y a
-- PROVIDER). Se sustituye por una lectura consciente del estado: fuera de DRAFT
-- para NEIGHBOR/PRESIDENT/ADMIN, un DRAFT solo para PRESIDENT/ADMIN, y PROVIDER
-- fuera siempre (V-1, §4c). Es el hueco de over-exposure del bloque.
drop policy if exists votes_select_member on votes;
drop policy if exists votes_select_visible on votes;

create policy votes_select_visible on votes
  for select using (
    app_is_member_of(community_id)
    and app_role_in(community_id) <> 'PROVIDER'
    and (
      status <> 'DRAFT'
      or app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
    )
  );

-- La escritura pasa por función (V-3).
drop policy if exists votes_write_leadership on votes;

-- Las opciones se ven si la votación es visible y ya no es borrador (la política
-- de la tabla padre sigue mandando para el borrador). Se añade el veto a
-- PROVIDER, que hoy se colaba.
drop policy if exists options_select_visible_vote on vote_options;

create policy options_select_visible_vote on vote_options
  for select using (
    exists (
      select 1 from votes v
       where v.id = vote_id
         and v.deleted_at is null
         and v.status <> 'DRAFT'
         and app_is_member_of(v.community_id)
         and app_role_in(v.community_id) <> 'PROVIDER'
    )
  );

drop policy if exists options_write_leadership on vote_options;

-- V-2: SELECT solo del PROPIO voto. La rama `or app_is_admin_of(...)` se
-- ELIMINA: el recuento va por app_vote_results(), que solo devuelve sumas. Con
-- la rama viva, un ADMIN podría enumerar votos individuales.
drop policy if exists responses_select_own_or_admin on vote_responses;
drop policy if exists responses_select_own on vote_responses;

create policy responses_select_own on vote_responses
  for select using (user_id = app_current_user_id());

-- INSERT/UPDATE se eliminan (V-3): la ventana y la unicidad las hace
-- app_cast_vote(). Sin política de DELETE: cambiar de voto es un UPSERT.
drop policy if exists responses_insert_own_open_vote on vote_responses;
drop policy if exists responses_update_own_open_vote on vote_responses;

-- ----------------------------------------------------------------------------
-- 9. Permisos
-- ----------------------------------------------------------------------------
-- El revoke es la pieza imprescindible: quitar las tablas de la lista de
-- `grant insert, update, delete` de 02_rls.sql §5.19 no deshace un GRANT ya
-- aplicado (mismo argumento que AN-2, DN-2 y FN-2). Se repite contra anon y
-- authenticated por simetría con 02e-02j.
revoke insert, update, delete on votes from app_runtime;
revoke insert, update, delete on vote_options from app_runtime;
revoke insert, update on vote_responses from app_runtime;

revoke insert, update, delete on votes from anon, authenticated;
revoke insert, update, delete on vote_options from anon, authenticated;
revoke insert, update on vote_responses from anon, authenticated;

-- app_runtime ejecuta las once funciones; PUBLIC no ejecuta ninguna (D-5: las
-- `sql stable` podrían ejecutarse sin sesión si PUBLIC conservara execute, y
-- revocar del grupo cubre roles futuros de una vez).
grant execute on function app_vote_community(uuid) to app_runtime;
grant execute on function app_is_leadership_of(uuid) to app_runtime;
grant execute on function app_vote_effective_status(vote_status, timestamptz) to app_runtime;
grant execute on function app_set_vote_options(uuid, jsonb) to app_runtime;
grant execute on function app_list_votes(uuid, uuid, vote_status, integer, integer) to app_runtime;
grant execute on function app_create_vote(uuid, text, text, text, vote_type, timestamptz, timestamptz, boolean, integer, vote_result_visibility, jsonb) to app_runtime;
grant execute on function app_update_vote(uuid, jsonb) to app_runtime;
grant execute on function app_publish_vote(uuid) to app_runtime;
grant execute on function app_close_vote(uuid) to app_runtime;
grant execute on function app_cast_vote(uuid, uuid) to app_runtime;
grant execute on function app_vote_results(uuid) to app_runtime;

revoke execute on function app_vote_community(uuid) from public;
revoke execute on function app_is_leadership_of(uuid) from public;
revoke execute on function app_vote_effective_status(vote_status, timestamptz) from public;
revoke execute on function app_set_vote_options(uuid, jsonb) from public;
revoke execute on function app_list_votes(uuid, uuid, vote_status, integer, integer) from public;
revoke execute on function app_create_vote(uuid, text, text, text, vote_type, timestamptz, timestamptz, boolean, integer, vote_result_visibility, jsonb) from public;
revoke execute on function app_update_vote(uuid, jsonb) from public;
revoke execute on function app_publish_vote(uuid) from public;
revoke execute on function app_close_vote(uuid) from public;
revoke execute on function app_cast_vote(uuid, uuid) from public;
revoke execute on function app_vote_results(uuid) from public;

-- ----------------------------------------------------------------------------
-- 10. Autocomprobación
-- ----------------------------------------------------------------------------
-- Que este archivo se ejecute sin errores no demuestra nada: si alguien lo
-- reescribe y se le olvida el `security definer`, deja un grant de escritura
-- vivo, o no sustituye la política de lectura, el archivo se aplicaría igual de
-- limpio y el agujero se instalaría solo, en silencio. Estas comprobaciones son
-- las que fallan en `db:verify` (y las repite 04_verify.sql).
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las once funciones: existen, son SECURITY DEFINER con search_path fijo y no
  -- ejecutables por PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_vote_community', 'app_is_leadership_of',
         'app_vote_effective_status', 'app_set_vote_options',
         'app_list_votes', 'app_create_vote', 'app_update_vote',
         'app_publish_vote', 'app_close_vote', 'app_cast_vote',
         'app_vote_results'
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

  -- Y que las once estén. El bucle anterior no falla si no hay ninguna.
  for r in
    select unnest(array[
      'app_vote_community', 'app_is_leadership_of',
      'app_vote_effective_status', 'app_set_vote_options',
      'app_list_votes', 'app_create_vote', 'app_update_vote',
      'app_publish_vote', 'app_close_vote', 'app_cast_vote',
      'app_vote_results'
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

  -- Ninguna política de escritura en las tres tablas (V-3).
  if exists (
    select 1 from pg_policies
     where tablename in ('votes', 'vote_options', 'vote_responses')
       and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  ) then
    v_fallos := v_fallos || ' hay una politica de escritura de votaciones;';
  end if;

  -- Las políticas de escritura antiguas no siguen ahí.
  if exists (
    select 1 from pg_policies
     where policyname in (
       'votes_write_leadership', 'options_write_leadership',
       'responses_insert_own_open_vote', 'responses_update_own_open_vote'
     )
  ) then
    v_fallos := v_fallos || ' siguen existiendo politicas de escritura de votaciones;';
  end if;

  -- La lectura consciente del estado sustituye a votes_select_member.
  if exists (
    select 1 from pg_policies
     where tablename = 'votes' and policyname = 'votes_select_member'
  ) then
    v_fallos := v_fallos || ' sigue existiendo votes_select_member;';
  end if;

  if not exists (
    select 1 from pg_policies
     where tablename = 'votes' and policyname = 'votes_select_visible'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta votes_select_visible de SELECT;';
  end if;

  -- Y la política de respuestas es "solo el propio voto" (V-2).
  if exists (
    select 1 from pg_policies
     where tablename = 'vote_responses'
       and policyname = 'responses_select_own_or_admin'
  ) then
    v_fallos := v_fallos || ' sigue existiendo responses_select_own_or_admin;';
  end if;

  if not exists (
    select 1 from pg_policies
     where tablename = 'vote_responses' and policyname = 'responses_select_own'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta responses_select_own de SELECT;';
  end if;

  -- El permiso de escritura no existe para nadie, no solo para app_runtime. Se
  -- excluyen postgres (owner) y service_role (privilegios por default en
  -- Supabase), igual que en 02e-02j.
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name in ('votes', 'vote_options')
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' votes/vote_options conservan escritura para un rol que no debe;';
  end if;

  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'vote_responses'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' vote_responses conserva escritura para un rol que no debe;';
  end if;

  -- Los cuatro CHECK de longitud de la sección 1.
  for r in
    select unnest(array[
      'votes_title_length', 'votes_question_length',
      'votes_description_length', 'vote_options_label_length'
    ]) as con
  loop
    if not exists (
      select 1 from pg_constraint
       where conname = r.con and contype = 'c'
    ) then
      v_fallos := v_fallos || ' falta ' || r.con || ';';
    end if;
  end loop;

  if exists (
    select 1 from pg_constraint
     where conname in (
       'votes_title_length', 'votes_question_length',
       'votes_description_length', 'vote_options_label_length'
     )
       and convalidated = false
  ) then
    raise notice 'AVISO: los CHECK de longitud de votaciones existen pero siguen sin validar (not valid).';
  end if;

  -- V-11 escrita: el voto es un upsert sobre (vote_id, user_id).
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_cast_vote'
       and pg_get_functiondef(p.oid) like '%on conflict (vote_id, user_id)%'
  ) then
    v_fallos := v_fallos || ' app_cast_vote deberia ser un upsert sobre (vote_id, user_id) (V-11);';
  end if;

  -- V-2/V-12 escritas: los resultados salen de app_vote_results, no de la tabla
  -- de respuestas en crudo.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_vote_results'
       and pg_get_functiondef(p.oid) like '%vote_results_forbidden%'
  ) then
    v_fallos := v_fallos || ' app_vote_results deberia aplicar la visibilidad de resultados (V-12);';
  end if;

  -- V-6 escrita: el listado deriva el estado efectivo.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_list_votes'
       and pg_get_functiondef(p.oid) like '%app_vote_effective_status%'
  ) then
    v_fallos := v_fallos || ' el listado deberia derivar el estado efectivo (V-6);';
  end if;

  if v_fallos <> '' then
    raise exception 'Las votaciones no son seguras:%', v_fallos;
  end if;

  raise notice 'OK: voto secreto (solo el propio voto), vote_responses sin escritura directa, 11 funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC, estado efectivo calculado en lectura, CHECK de longitud presentes.';
end $$;
