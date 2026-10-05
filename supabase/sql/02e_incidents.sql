-- =============================================================================
-- 02e — Bloque 04: incidencias
-- =============================================================================
--
-- Es el primer bloque donde la escritura NO pasa por una política RLS, sino por
-- funciones. En 02b/02c/02d ya pasó con usuarios, comunidades e invitaciones; aquí
-- se repite el patrón porque las reglas de `incidents` no se pueden expresar como
-- un predicado de política:
--
--   * `reference_code` es not null y no tiene default. Nadie, ni el backend ni un
--     INSERT manual, puede inventarse un código que después choque con el índice
--     único por comunidad.
--   * Las transiciones son un GRAFO (OPEN -> IN_PROGRESS -> RESOLVED, CANCELLED es
--     final) y además dependen de QUIÉN las recorre: el proveedor solo si tiene
--     la incidencia asignada, el ADMIN siempre.
--   * Una regla de este tipo necesita leer la fila y escribirla en la misma
--     transacción. Una política `with check` evalúa el AFTER, cuando la escritura
--     ya ha ocurrido, y no puede leer el estado anterior.
--
-- Por eso se revoca INSERT y UPDATE de `incidents` a app_runtime y se dejan ocho
-- funciones como única puerta de entrada. La política de SELECT se queda, porque
-- una vista de solo lectura no necesita una función, y hace de red de seguridad
-- para cualquier lectura directa que alguien escriba en el futuro.
--
-- Orden interno:  1) secuencia y columnas  2) predicado de visibilidad
--                 3) lecturas  4) escrituras  5) políticas  6) permisos
--                 7) autocomprobación
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Secuencia y columnas nuevas
-- ----------------------------------------------------------------------------
--
-- El código legible (INC-2026-0001) se genera aquí, no en el backend, por lo mismo
-- que el código de las invitaciones en 02d: si el cliente lo enviara, un ADMIN
-- podría poner "INC-2026-0001" y hacer que dos incidencias tuvieran el mismo código
-- en una comunidad, que es justo lo que el índice único prohíbe. Lo único que se
-- compara es el código ya generado.
--
-- Se genera en un `sequence` y no con `count(*) + 1` a propósito: contar y
-- escribir no es atómico, y dos altas simultáneas sacarían el mismo número. El
-- `nextval` sí lo es.
create sequence if not exists incident_reference_code_seq
  start 1
  increment 1;

-- I-9 / D-1: una CRITICAL creada por un vecino necesita revisión. Sin una columna
-- donde dejarlo escrito, "requiere revisión" es una idea y no un dato, y no hay
-- forma de listar las pendientes.
--
-- `default false` en PG 11+ es un default materializado: no reescribe la tabla, así
-- que se puede añadir con la tabla llena y sin bloquear escrituras.
alter table incidents
  add column if not exists needs_review boolean not null default false;

-- I-9, segunda mitad: cambiar la prioridad a CRITICAL por un ADMIN es la revisión
-- hecha, así que se limpia. Si no, un "pendiente de revisar" que ya se revisó
-- seguiría apareciendo en la lista de pendientes para siempre.
--
-- La razón (quién la puso y cuándo) no se guarda, y es una decisión: esta columna
-- es una Bandera de trabajo, no un registro de auditoría. Si algún día hace falta
-- saberlo, el sitio es audit_logs, que ya existe.

-- ----------------------------------------------------------------------------
-- 1.b Longitudes de texto en la base de datos
-- ----------------------------------------------------------------------------
--
-- `incidents_title_length` ya existe desde 01_schema.sql. Estas dos no existían y
-- eran responsabilidad exclusiva del zod del backend, que se puede saltar con una
-- llamada directa a la base de datos. `not valid` a propósito: no revalida las
-- filas existentes, que es lo que permite añadir la restricción sin downtime, y a
-- partir de ahí toda fila nueva pasa por el CHECK.
do $$
begin
  alter table incidents
    add constraint incidents_description_length
    check (char_length(description) between 10 and 4000) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table incident_comments
    add constraint incident_comments_body_length
    check (char_length(body) between 1 and 2000) not valid;
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 2. El predicado de visibilidad
-- ----------------------------------------------------------------------------
--
-- I-1. Este es el predicado más repetido del proyecto y el más peligroso de
-- divergir, porque aparece en el listado, en el detalle, en el contexto de la ruta,
-- en cada escritura y en los comentarios. Se escribe UNA vez aquí.
--
-- SECURITY DEFINER por lo mismo que app_is_member_of(): si fuera SECURITY
-- INVOKER, esta función se ejecutaría con los permisos de app_runtime, que solo ve
-- la propia fila de `users` (users_select_self) y nada de `incidents` en cuanto RLS
-- filtra. La función se quedaría siempre en false y devolvería un 404 a todo el
-- mundo.
--
-- El `app_is_member_of` no sobra aunque `app_role_in` ya exija ACTIVE: `app_role_in`
-- solo cubre la rama de los gestores. Sin él, las otras dos ramas —reporter y
-- proveedor asignado— seguirían dando acceso a un miembro SUSPENDED, que es
-- justo lo que la suspensión tiene que quitar.
create or replace function app_can_see_incident(target uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from incidents i
     where i.id = target
       and i.deleted_at is null
       and app_is_member_of(i.community_id)
       and (
         app_role_in(i.community_id) in ('ADMIN', 'PRESIDENT')
         or i.reporter_id = app_current_user_id()
         or app_is_assigned_provider(i.id)
       )
  )
$$;

-- Contexto de la ruta: a qué comunidad pertenece una incidencia. Lo necesita el
-- middleware porque las rutas de incidencia no llevan `communityId` en la URL.
--
-- SELECT en lugar de EXCEPTION para no abortar la transacción: se usa desde
-- consultas que pueden no encontrar nada, y un 404 como excepción PostgreSQL
-- aborta la transacción en curso salvo que el backend la capture con un savepoint.
create or replace function app_incident_community(p_incident uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.community_id
    from incidents i
   where i.id = p_incident
     and app_can_see_incident(i.id)
$$;

-- ----------------------------------------------------------------------------
-- 3. Lecturas
-- ----------------------------------------------------------------------------
--
-- Las tres lecturas devuelven también `reporter_name` y `assigned_name` (D-2), que
-- salen de `users`. `users_select_self` impide leerlos desde el backend, así que
-- el JOIN tiene que ocurrir aquí, dentro de una función SECURITY DEFINER. Es la
-- misma excepción acotada que 02d abrió con app_get_community_member().
--
-- Solo se hace JOIN con `users`, nunca con `community_members`, con role,
-- información financiera ni datos de otros usuarios: lo mínimo que hace falta para
-- poner un nombre al lado de una incidencia.

-- ----------------------------------------------------------------------------
-- 3.1 Listado de incidencias
-- ----------------------------------------------------------------------------
--
-- I-1, I-2, I-12.
--
-- El predicado de visibilidad va EN LÍNEA y no calling a app_can_see_incident().
-- Sería tentador, pero el listado no tiene una fila de la que partir: envolver cada
-- fila en una llamada a función sería una función por fila, y el planner no puede
-- usar un índice si tiene que evaluar una función por cada elemento que sale. Con
-- el predicado en línea, el motor resuelve `limit`/`offset` de verdad y el
-- `incidents_community_status_idx` se puede usar. El precio es una segunda copia
-- del predicado, y por eso 04_verify.sql comprueba que las dos copias siguen
-- citando las mismas tres condiciones.
--
-- `count(*) over ()` da el total sin paginar en la MISMA pasada, que es lo que
-- quiere el `meta` de la API. Con un COUNT aparte, el listado de la página 5 de 3
-- saldría con total 0.
create or replace function app_list_incidents(
  p_community_id uuid,
  p_status       incident_status     default null,
  p_priority     incident_priority   default null,
  p_category     incident_category   default null,
  p_q            text                default null,
  p_limit        integer             default 20,
  p_offset       integer             default 0
)
returns table (
  id            uuid,
  community_id  uuid,
  reference_code text,
  title         text,
  description   text,
  category      incident_category,
  priority      incident_priority,
  status        incident_status,
  location      text,
  reporter_id   uuid,
  reporter_name text,
  assigned_to_id uuid,
  assigned_name text,
  needs_review  boolean,
  created_via   incident_created_via,
  resolved_at   timestamptz,
  created_at    timestamptz,
  updated_at    timestamptz,
  total_count   bigint
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

  -- Un miembro de otra comunidad no obtiene una lista vacía sino un 403: decir
  -- "no hay incidencias" a quien no es miembro confirma que esa comunidad existe.
  if not app_is_member_of(p_community_id) then
    raise exception 'no es miembro de la comunidad' using errcode = '42501';
  end if;

  return query
  select i.id, i.community_id, i.reference_code, i.title, i.description,
         i.category, i.priority, i.status, i.location,
         i.reporter_id, ru.full_name,
         i.assigned_to_id, au.full_name,
         i.needs_review, i.created_via,
         i.resolved_at, i.created_at, i.updated_at,
         count(*) over ()
    from incidents i
    join users ru on ru.id = i.reporter_id
    left join users au on au.id = i.assigned_to_id
   where i.community_id = p_community_id
     and i.deleted_at is null
     and (
       app_role_in(i.community_id) in ('ADMIN', 'PRESIDENT')
       or i.reporter_id = app_current_user_id()
       or app_is_assigned_provider(i.id)
     )
     and (p_status   is null or i.status   = p_status)
     and (p_priority is null or i.priority = p_priority)
     and (p_category is null or i.category = p_category)
     and (p_q        is null or i.title ilike '%' || p_q || '%')
     order by i.created_at desc, i.id
     limit least(greatest(coalesce(p_limit, 20), 1), 100)
     offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 3.2 Detalle de una incidencia
-- ----------------------------------------------------------------------------
create or replace function app_get_incident(p_incident uuid)
returns table (
  id            uuid,
  community_id  uuid,
  reference_code text,
  title         text,
  description   text,
  category      incident_category,
  priority      incident_priority,
  status        incident_status,
  location      text,
  reporter_id   uuid,
  reporter_name text,
  assigned_to_id uuid,
  assigned_name text,
  needs_review  boolean,
  created_via   incident_created_via,
  resolved_at   timestamptz,
  created_at    timestamptz,
  updated_at    timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.id, i.community_id, i.reference_code, i.title, i.description,
         i.category, i.priority, i.status, i.location,
         i.reporter_id, ru.full_name,
         i.assigned_to_id, au.full_name,
         i.needs_review, i.created_via,
         i.resolved_at, i.created_at, i.updated_at
    from incidents i
    join users ru on ru.id = i.reporter_id
    left join users au on au.id = i.assigned_to_id
   where i.id = p_incident
     and app_can_see_incident(i.id)
$$;

-- ----------------------------------------------------------------------------
-- 3.3 Comentarios de una incidencia
-- ----------------------------------------------------------------------------
--
-- Heredan la visibilidad de su incidencia a través de app_can_see_incident(), no
-- con un predicado propio: si el alcance se escribiera dos veces, el comentario y
-- la incidencia dejarían de estar de acuerdo en algún momento futuro, que es como
-- se filtran datos en un sistema de incidencias.
--
-- `deleted_at is null` sale de nuevo por la vía larga: el DELETE lógico de
-- comentarios no se usa en este bloque (I-7), pero la columna existe y filtrarla no
-- cuesta nada.
create or replace function app_list_incident_comments(p_incident uuid)
returns table (
  id          uuid,
  incident_id uuid,
  author_id   uuid,
  author_name text,
  body        text,
  created_at  timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.id, c.incident_id, c.author_id, u.full_name, c.body, c.created_at
    from incident_comments c
    join users u on u.id = c.author_id
   where c.incident_id = p_incident
     and c.deleted_at is null
     and app_can_see_incident(c.incident_id)
   order by c.created_at, c.id
$$;

-- ----------------------------------------------------------------------------
-- 4. Escrituras
-- ----------------------------------------------------------------------------
--
-- Todas devuelven `void` o el id, nunca la fila entera. La respuesta se construye
-- con app_get_incident() después de la escritura, dentro de la misma transacción,
-- para que solo haya UNA forma de leer una incidencia y no dos que puedan
-- discrepar.

-- ----------------------------------------------------------------------------
-- 4.1 Crear una incidencia
-- ----------------------------------------------------------------------------
--
-- Cualquier miembro activo puede abrir una incidencia, sea ADMIN, PRESIDENT,
-- PROVIDER o NEIGHBOR. Lo que NO puede es abrirla en nombre de otro: p_reporter no
-- existe como parámetro, y el reporter sale de app_current_user_id().
--
-- El rol determines la necesidad de revisión: una CRITICAL de un vecino queda
-- pendiente; una de un gestor no, porque quien la escala es quien la revisa (I-9).
create or replace function app_create_incident(
  p_community_id uuid,
  p_title        text,
  p_description  text,
  p_category     incident_category,
  p_priority     incident_priority,
  p_location     text default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id       uuid;
  v_priority incident_priority;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_member_of(p_community_id) then
    raise exception 'no es miembro de la comunidad' using errcode = '42501';
  end if;

  v_priority := coalesce(p_priority, 'MEDIUM');

  insert into incidents (
    community_id, reference_code, title, description, category, priority,
    status, location, reporter_id, created_via, needs_review
  )
  values (
    p_community_id,
    'INC-' || to_char(now(), 'YYYY') || '-'
      || lpad(nextval('incident_reference_code_seq')::text, 6, '0'),
    btrim(p_title),
    btrim(p_description),
    coalesce(p_category, 'OTHER'),
    v_priority,
    'OPEN',
    nullif(btrim(p_location), ''),
    app_current_user_id(),
    'MANUAL',
    v_priority = 'CRITICAL'
      and app_role_in(p_community_id) = 'NEIGHBOR'
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.2 Editar el contenido
-- ----------------------------------------------------------------------------
--
-- D-3. ADMIN y PRESIDENT editan el contenido de cualquier incidencia de su
-- comunidad; el reporter, solo la suya; un PROVIDER no edita contenido, tenga o no
-- la incidencia asignada.
--
-- Es un PUT: los cuatro parámetros son el valor nuevo completo, y es deliberado que
-- no exista `priority`, `assigned_to_id` ni `status` en la lista de parámetros. Un
-- endpoint de contenido que acepta campos que no toca es un endpoint que alguien
-- acaba tocando.
--
-- Los CHECK de longitud de 01_schema.sql y de la sección 1.b de este archivo
-- saltan con 23514 si el título o la descripción no cumplen, y el backend traduce
-- ese código a un 400 con el mensaje de zod.
create or replace function app_update_incident_content(
  p_incident     uuid,
  p_title        text,
  p_description  text,
  p_category     incident_category,
  p_location     text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_reporter  uuid;
begin
  if not app_can_see_incident(p_incident) then
    raise exception 'incidencia no encontrada' using errcode = 'P0002';
  end if;

  select i.community_id, i.reporter_id into v_community, v_reporter
    from incidents i where i.id = p_incident;

  -- Primero el rol, luego la pertenencia: quien no puede ver la incidencia ya se
  -- fue por el 404 de arriba.
  if v_reporter <> app_current_user_id()
     and app_role_in(v_community) not in ('ADMIN', 'PRESIDENT')
  then
    raise exception 'solo el reporter, un ADMIN o un PRESIDENT pueden editar el contenido'
      using errcode = '42501';
  end if;

  update incidents
     set title       = btrim(p_title),
         description = btrim(p_description),
         category    = coalesce(p_category, 'OTHER'),
         location    = nullif(btrim(p_location), '')
   where id = p_incident;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.3 Cambiar la prioridad
-- ----------------------------------------------------------------------------
--
-- I-8: solo ADMIN. Ni el reporter ni el PRESIDENT cambian la prioridad de su
-- incidencia, aunque la política de UPDATE de 02_rls.sql se lo permitiera a los
-- dos; esa política desaparece con este bloque.
--
-- needs_review se limpia aquí y no antes: un CRITICAL pendiente que un ADMIN baja
-- a HIGH ya no está pendiente, y un CRITICAL pendiente que un ADMIN sube a
-- CRITICAL ya ha sido revisado. La Bandera guarda trabajo pendiente, no historial.
create or replace function app_set_incident_priority(
  p_incident uuid,
  p_priority incident_priority
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  if not app_can_see_incident(p_incident) then
    raise exception 'incidencia no encontrada' using errcode = 'P0002';
  end if;

  select i.community_id into v_community from incidents i where i.id = p_incident;

  if not app_is_admin_of(v_community) then
    raise exception 'solo un ADMIN puede cambiar la prioridad' using errcode = '42501';
  end if;

  if p_priority is null then
    raise exception 'prioridad obligatoria' using errcode = '22023';
  end if;

  update incidents
     set priority = p_priority,
         needs_review = false
   where id = p_incident;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.4 Asignar o desasignar
-- ----------------------------------------------------------------------------
--
-- I-4: solo ADMIN. No hay endpoint aparte: la asignación viaja en el PUT de
-- prioridad, porque un ADMIN que sube a CRITICAL y asigna al proveedor está haciendo
-- una sola operación.
--
-- p_provider_user_id nulo desasigna. No es un caso límite, es el caso real: el
-- proveedor dejó de estar disponible y hay que devolver la incidencia a la bandeja
-- de pendientes, sin un endpoint nuevo.
--
-- La comprobación de la membresía y el UPDATE van en la MISMA transacción, que es
-- el punto: entre el SELECT y el UPDATE no puede colarse una suspensión. Por eso
-- no se delega en la política `app_is_assigned_provider` y se escribe aquí.
create or replace function app_assign_incident(
  p_incident          uuid,
  p_provider_user_id  uuid default null
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  if not app_can_see_incident(p_incident) then
    raise exception 'incidencia no encontrada' using errcode = 'P0002';
  end if;

  select i.community_id into v_community from incidents i where i.id = p_incident;

  if not app_is_admin_of(v_community) then
    raise exception 'solo un ADMIN puede asignar' using errcode = '42501';
  end if;

  if p_provider_user_id is not null and not exists (
    select 1
      from community_members m
     where m.community_id = v_community
       and m.user_id = p_provider_user_id
       and m.role = 'PROVIDER'
       and m.status = 'ACTIVE'
  ) then
    raise exception 'el usuario indicado no es un proveedor activo de esta comunidad'
      using errcode = '22023';
  end if;

  update incidents
     set assigned_to_id = p_provider_user_id
   where id = p_incident;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.5 Transición de estado
-- ----------------------------------------------------------------------------
--
-- I-3, I-4, D-4. El grafo es cerrado y las aristas importantes son las que dependen
-- del rol:
--
--   OPEN          -> IN_PROGRESS   ADMIN o el PROVIDER asignado
--   IN_PROGRESS   -> RESOLVED     ADMIN o el PROVIDER asignado
--   RESOLVED      -> OPEN          solo ADMIN (reapertura)
--   *  -> CANCELLED                 solo ADMIN
--   CANCELLED     -> (nada)         estado final
--
-- PRESIDENT no aparece en ninguna arista. ARCHITECTURE.md §5 le da un "—" explícito
-- en "Cambiar estado de incidencia" (D-4), y ese "—" es el dato, no una falta de
-- detalle del documento.
--
-- EL ORDEN DE LAS DOS GUARDAS IMPORTA. La de actor va antes que la del grafo, y el
-- motivo es observable desde fuera: un NEIGHBOR que pide una transición que además
-- sería inválida tiene que recibir 403, no 409. Un 409 confirmaría que existe la
-- arista, que es información sobre la incidencia que el vecino no tenía.
--
-- EL UPDATE ES CONDICIONAL Y ESO ES LO QUE CIERRA LA CARRERA. `where id = ... and
-- status = v_from` hace que dos PATCH simultáneos no se cuelguen los dos: el
-- segundo bloquea en el lock de fila, y al reevaluar el WHERE en READ COMMITTED ya
-- encuentra el status nuevo, no toca nada y cae en el 409. Con un UPDATE sin
-- condición, los dos leen OPEN, los dos escriben IN_PROGRESS y los dos devuelven
-- 200, que es la respuesta que un cliente concurrente interpreta como "funciona".
create or replace function app_transition_incident(
  p_incident   uuid,
  p_new_status incident_status
)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_from      incident_status;
  v_is_admin  boolean;
  v_is_assigned_provider boolean;
begin
  if not app_can_see_incident(p_incident) then
    raise exception 'incidencia no encontrada' using errcode = 'P0002';
  end if;

  select i.community_id, i.status into v_community, v_from
    from incidents i where i.id = p_incident;

  v_is_admin := app_is_admin_of(v_community);
  v_is_assigned_provider := app_is_assigned_provider(p_incident);

  -- Guarda de actor.
  if not v_is_admin and not v_is_assigned_provider then
    raise exception 'no puede cambiar el estado de esta incidencia'
      using errcode = '42501';
  end if;

  -- Guarda de grafo. Se escribe como una tabla de pares para que el caso
  -- CANCELLED -> CANCELLED no tenga que tratarlo aparte: no está en la tabla, así
  -- que cae en el 409 igual que cualquier otra arista imposible.
  if not (
       (v_from = 'OPEN'        and p_new_status = 'IN_PROGRESS')
    or (v_from = 'IN_PROGRESS' and p_new_status = 'RESOLVED')
    or (v_from = 'RESOLVED'    and p_new_status = 'OPEN'      and v_is_admin)
    or (v_from in ('OPEN', 'IN_PROGRESS', 'RESOLVED')
        and p_new_status = 'CANCELLED' and v_is_admin)
  ) then
    raise exception 'transicion invalida de % a %', v_from, p_new_status
      using errcode = '22023';
  end if;

  -- resolved_at se escribe con el estado y no en un trigger aparte: el estado y su
  -- marca de tiempo tienen que cambiar en la misma sentencia o se puede quedar uno
  -- de los dos.
  update incidents
     set status = p_new_status,
         resolved_at = case
           when p_new_status = 'RESOLVED' then now()
           when p_new_status = 'OPEN'      then null
           else resolved_at
         end
   where id = p_incident
     and status = v_from;

  if not found then
    -- Solo llega aquí si otra transacción cambió el estado entre el SELECT y este
    -- UPDATE. El grafo era válido para el estado que ella leyó, no para el actual.
    raise exception 'transicion invalida desde el estado actual'
      using errcode = '22023';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4.6 Borrado lógico
-- ----------------------------------------------------------------------------
--
-- I-6: solo ADMIN, y el borrado es lógico porque una incidencia con comentarios es
-- histórico. `deleted_at` y no DELETE físico; por eso el GET de una incidencia
-- borrada responde 404 y no 410, porque para el cliente no existe.
--
-- El `and deleted_at is null` del UPDATE es lo que hace que borrar dos veces no
-- salga bien: la segunda vez no toca filas y cae en el mismo 404.
create or replace function app_soft_delete_incident(p_incident uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  if not app_can_see_incident(p_incident) then
    raise exception 'incidencia no encontrada' using errcode = 'P0002';
  end if;

  select i.community_id into v_community from incidents i where i.id = p_incident;

  if not app_is_admin_of(v_community) then
    raise exception 'solo un ADMIN puede borrar una incidencia' using errcode = '42501';
  end if;

  update incidents set deleted_at = now()
   where id = p_incident and deleted_at is null;

  if not found then
    raise exception 'incidencia no encontrada' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Políticas RLS
-- ----------------------------------------------------------------------------
--
-- incidents se queda con UNA política, de solo lectura. Las de INSERT y UPDATE se
-- borran, y no se sustituyen por una versión más restrictiva: sin permiso de
-- INSERT ni de UPDATE para app_runtime no hay nada que una política pueda
-- decidimos. La política sigue importando porque un SELECT directo del backend, del
-- panel o de una vista nueva sigue pasando por ella.
--
-- El comentario se queda con INSERT directo, que es lo único aquí que no pasa por
-- función. Es aceptable porque `author_id = app_current_user_id()` en el WITH CHECK
-- es una identidad, no una regla, y el alcance lo hereda del `exists` sobre la
-- incidencia, que para esa consulta pasa por esta política de SELECT. Eso significa
-- que el comentario tampoco se puede añadir a una incidencia borrada lógicamente,
-- sin tener que decirlo dos veces.

-- I-6, I-1: el borrado lógico entra en el predicado. Antes se leía la fila y la
-- aplicación la filtraba, con lo que un SELECT directo la devolvía.
drop policy if exists incidents_insert_member on incidents;
drop policy if exists incidents_update_scoped on incidents;
drop policy if exists incidents_select_scoped on incidents;

create policy incidents_select_scoped on incidents
  for select using (
    deleted_at is null
    and app_is_member_of(community_id)
    and (
      app_role_in(community_id) in ('ADMIN', 'PRESIDENT')
      or reporter_id = app_current_user_id()
      or app_is_assigned_provider(id)
    )
  );

-- ----------------------------------------------------------------------------
-- 6. Permisos
-- ----------------------------------------------------------------------------
--
-- El revoke de INSERT y UPDATE es la pieza que convierte este bloque en el primero
-- en que el modelo no depende de que la política se lea bien. Los comentarios
-- conservan su INSERT: es la única escritura directa que queda, y es la única que
-- no tiene reglas de dominio más allá de la identidad del autor.
revoke insert, update on incidents from app_runtime;
revoke insert, update on incidents from anon, authenticated;

-- La secuencia no se concede a nadie. app_create_incident() corre como su propietario
-- y es la única que llama a nextval.
--
-- El revoke va de app_runtime y no solo de PUBLIC porque 02_rls.sql (5.19) tiene
-- `grant usage on all sequences in schema public to app_runtime`, pensado para un
-- futuro SERIAL. "ON ALL SEQUENCES" en el momento en que se aplica no incluye esta
-- secuencia, que aún no existe, pero el GRANT es sobre el esquema y se cumple para
-- cualquier secuencia que se cree después. Sin este revoke, el backend podría pedir
-- el siguiente código, y eso no es un problema de permisos sino de información: un
-- contador global de incidencias de toda la plataforma que cualquiera que tenga el
-- token de la app puede leer.
revoke all on sequence incident_reference_code_seq from public;
revoke all on sequence incident_reference_code_seq from app_runtime;

grant execute on function app_can_see_incident(uuid) to app_runtime;
grant execute on function app_incident_community(uuid) to app_runtime;
grant execute on function app_list_incidents(uuid, incident_status, incident_priority, incident_category, text, integer, integer) to app_runtime;
grant execute on function app_get_incident(uuid) to app_runtime;
grant execute on function app_list_incident_comments(uuid) to app_runtime;
grant execute on function app_create_incident(uuid, text, text, incident_category, incident_priority, text) to app_runtime;
grant execute on function app_update_incident_content(uuid, text, text, incident_category, text) to app_runtime;
grant execute on function app_set_incident_priority(uuid, incident_priority) to app_runtime;
grant execute on function app_assign_incident(uuid, uuid) to app_runtime;
grant execute on function app_transition_incident(uuid, incident_status) to app_runtime;
grant execute on function app_soft_delete_incident(uuid) to app_runtime;

-- El revoke va de public y no de anon/authenticated a propósito: revocar del grupo
-- PUBLIC los cubre a todos de una vez y no deja al autor acordarse de un cuarto rol
-- mañana. Es el mismo criterio que 02b, 02c y 02d.
revoke execute on function app_can_see_incident(uuid) from public;
revoke execute on function app_incident_community(uuid) from public;
revoke execute on function app_list_incidents(uuid, incident_status, incident_priority, incident_category, text, integer, integer) from public;
revoke execute on function app_get_incident(uuid) from public;
revoke execute on function app_list_incident_comments(uuid) from public;
revoke execute on function app_create_incident(uuid, text, text, incident_category, incident_priority, text) from public;
revoke execute on function app_update_incident_content(uuid, text, text, incident_category, text) from public;
revoke execute on function app_set_incident_priority(uuid, incident_priority) from public;
revoke execute on function app_assign_incident(uuid, uuid) from public;
revoke execute on function app_transition_incident(uuid, incident_status) from public;
revoke execute on function app_soft_delete_incident(uuid) from public;

-- ----------------------------------------------------------------------------
-- 7. Autocomprobación
-- ----------------------------------------------------------------------------
--
-- Que este archivo se ejecutara sin errores no demuestra nada. Lo que importa es
-- que las funciones hayan QUEDADO como deben: si alguien las reescribe y se le
-- olvida el `security definer` o el `search_path` fijo, el archivo se aplicaría
-- igual de limpio y el agujero se instalaría solo, en silencio.
do $$
declare
  v_fallos text := '';
  r        record;
  v_count  integer;
begin
  -- Las once funciones: SECURITY DEFINER, search_path fijo y no ejecutables por
  -- PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_can_see_incident', 'app_incident_community',
         'app_list_incidents', 'app_get_incident', 'app_list_incident_comments',
         'app_create_incident', 'app_update_incident_content',
         'app_set_incident_priority', 'app_assign_incident',
         'app_transition_incident', 'app_soft_delete_incident'
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
      'app_can_see_incident', 'app_incident_community',
      'app_list_incidents', 'app_get_incident', 'app_list_incident_comments',
      'app_create_incident', 'app_update_incident_content',
      'app_set_incident_priority', 'app_assign_incident',
      'app_transition_incident', 'app_soft_delete_incident'
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

  -- incidents: solo lectura. Cualquier política de escritura es un fallo, porque
  -- reabre el camino que este bloque entero cierra.
  if exists (
    select 1
      from pg_policies
     where tablename = 'incidents'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' incidents tiene politica de escritura; deberia ser solo lectura;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'incidents'
       and policyname = 'incidents_select_scoped'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta incidents_select_scoped de SELECT;';
  end if;

  -- Y que el permiso de escritura no exista para nadie, no solo para app_runtime.
  --
  -- Se excluyen a propósito el dueño (postgres, owner y por tanto puede todo) y
  -- service_role (la clave de administración de Supabase, que recibe todos los
  -- privilegios por defecto en cualquier tabla nueva por ALTER DEFAULT PRIVILEGES).
  -- Lo que importa es que app_runtime, anon, authenticated y PUBLIC no puedan
  -- escribir: la escritura va por función.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'incidents'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' incidents tiene INSERT/UPDATE/DELETE concedido a un rol que no debe;';
  end if;

  -- La columna de la decisión D-1.
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'incidents'
       and column_name = 'needs_review'
       and data_type = 'boolean'
       and is_nullable = 'NO'
       and column_default = 'false'
  ) then
    v_fallos := v_fallos || ' incidents.needs_review deberia ser boolean not null default false;';
  end if;

  -- La secuencia del código legible no se puede usar desde fuera.
  --
  -- Se mira el ACL con aclexplode y NO information_schema.role_usage_grants,
  -- porque esa vista no lista concessiones: calcula has_sequence_privilege para
  -- CADA rol del clúster, y como postgres es owner y hay superusuarios de Supabase
  -- en la instancia, siempre aparecerían como "concesionarios" aunque no se les
  -- haya concedido nada. Se comprobaría así una escalada que no existe y, peor,
  -- no se comprobaría la real.
  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      cross join lateral aclexplode(c.relacl) as a
     where n.nspname = 'public'
       and c.relname = 'incident_reference_code_seq'
       and (
         a.grantee = 0
         or a.grantee in (
              select oid from pg_roles
               where rolname in ('app_runtime', 'anon', 'authenticated')
            )
       )
  ) then
    v_fallos := v_fallos || ' incident_reference_code_seq no debería ser usable fuera del owner;';
  end if;

  -- Las dos copias del predicado de visibilidad. Si alguien edita
  -- app_can_see_incident y olvida app_list_incidents, el listado y el detalle
  -- empiezan a discrepar sin que nada falle; es el fallo más difícil de detectar
  -- de todo el bloque, porque las dos consultas funcionan.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_can_see_incident'
       and pg_get_functiondef(p.oid) like '%app_is_member_of(%'
  ) then
    v_fallos := v_fallos || ' app_can_see_incident deberia exigir pertenencia activa;';
  end if;

  select count(*) into v_count
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'app_list_incidents'
     and pg_get_functiondef(p.oid) like '%app_is_member_of(%'
     and pg_get_functiondef(p.oid) like '%app_role_in(%'
     and pg_get_functiondef(p.oid) like '%app_is_assigned_provider(%';

  if v_count = 0 then
    v_fallos := v_fallos || ' el listado deberia inlinear las mismas condiciones que app_can_see_incident;';
  end if;

  -- Y que el listado y el predicado no se hayan separado con el tiempo: los dos
  -- tienen que mencionar las mismas tres condiciones.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_can_see_incident'
       and pg_get_functiondef(p.oid) like '%app_is_member_of(%'
       and pg_get_functiondef(p.oid) like '%app_role_in(%'
       and pg_get_functiondef(p.oid) like '%app_is_assigned_provider(%'
  ) then
    v_fallos := v_fallos || ' app_can_see_incident y app_list_incidents ya no coinciden;';
  end if;

  -- D-3 y D-4, escritas en SQL para que no dependan de que nadie lea el documento:
  -- el contenido acepta a PRESIDENT, y el estado no.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_update_incident_content'
       and pg_get_functiondef(p.oid) like '%PRESIDENT%'
  ) then
    v_fallos := v_fallos || ' D-3: el contenido deberia admitir a PRESIDENT;';
  end if;

  if exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_transition_incident'
       and pg_get_functiondef(p.oid) like '%PRESIDENT%'
  ) then
    v_fallos := v_fallos || ' D-4: el estado no deberia admitir a PRESIDENT;';
  end if;

  if v_fallos <> '' then
    raise exception 'Las incidencias no son seguras:%', v_fallos;
  end if;

  raise notice 'OK: incidencias solo lectura, ocho escrituras por funcion, once funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC.';
end $$;