-- =============================================================================
-- 02j — Bloque 09: finanzas
-- =============================================================================
--
-- Gastos, facturas y resumen económico de la comunidad. Es el bloque de los
-- datos más sensibles del producto y por eso la decisión FN-1, ratificada por
-- el usuario: **todo finanzas es 100 % solo ADMIN**. Ni el PRESIDENT recibe un
-- "resumen": la matriz de ARCHITECTURE.md §5 apuntaba a `✅ (resumen)`, pero lo
-- implementado (02_rls.sql §5.12, el seed, API.md y 04_verify) dice que no ve
-- nada, y FN-1 la ratifica.
--
-- La asimetría de permisos es la inversa de los avisos y hereda la de los
-- documentos, al extremo: aquí ningún no-ADMIN lee ni escribe. Cada pieza
-- traduce una decisión FN-*:
--
--   * FN-1: todo pasa por funciones SECURITY DEFINER que exigen el rol ADMIN
--     dentro de la transacción; las políticas de lectura de invoices se
--     reemplazan por `invoices_admin_only` (cerrando `invoices_select_scoped`,
--     que dejaba ver TODAS las facturas a cualquier miembro activo sin tener
--     columna de destinatario — FN-13).
--   * FN-2: toda escritura pasa por función dedicada. `invoices_write_admin`
--     se elimina y `invoices` pierde insert/update/delete para `app_runtime`.
--   * FN-3/FN-8: el listado y el detalle de una entidad son UNA sola función
--     (`app_list_expenses()` / `app_list_invoices()`) con `p_*` puesto para el
--     detalle; el borrado de gastos es soft delete; las facturas no se borran
--     ni se editan (no hay ruta en ARCHITECTURE.md §6).
--   * FN-4: el listado da 403 a cualquier no-ADMIN; el detalle por id da 404
--     (C-8: no confirmar que el id existe).
--   * FN-5: `OVERDUE` se calcula en lectura con `app_invoice_effective_status()`
--     (stable, no immutable: usa current_date); nunca se persiste — no hay jobs.
--   * FN-7: `PUT /expenses/:id` es reemplazo completo; `supplier`/`notes`/
--     `invoiceId` con `nullif` limpian el valor.
--   * FN-10: `expenses.invoice_id` debe ser de la misma comunidad.
--   * FN-12: los tres 409 del bloque viajan con SQLSTATE U0001 (nunca 23505,
--     que Prisma P2010 se come) y cada uno con su sentinel.
--
-- Orden interno: 1) CHECK de longitud  2) comunidad de gasto/factura
--                 3) estado efectivo  4) lecturas  5) escrituras
--                 6) resumen  7) políticas RLS  8) permisos  9) autocomprobación
--
-- No crea tablas ni columnas: `expenses` e `invoices` ya vienen completos de
-- 01_schema.sql (spec 09 §3.3).
--
-- Idempotente: se puede reejecutar sin efecto.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. Longitudes de texto
-- ----------------------------------------------------------------------------
-- `concept` (not null) no impide el `''`, y `notes`/`supplier`/`number` son
-- texto infinito. Mismo criterio que 02i §4a: `not valid` aplica a filas
-- nuevas sin revalidar las del seed ni las demos (validate es un paso
-- posterior). Quien pone los rangos por dos veces —aquí y en el zod del
-- backend— es porque la capa de entrada se puede saltar con una llamada
-- directa a la base de datos.
do $$
begin
  alter table expenses
    add constraint expenses_concept_length
    check (char_length(concept) between 1 and 120) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table expenses
    add constraint expenses_notes_length
    check (character_length(notes) between 1 and 1000) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table expenses
    add constraint expenses_supplier_length
    check (character_length(supplier) between 1 and 200) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table invoices
    add constraint invoices_number_length
    check (char_length(number) between 1 and 50) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table invoices
    add constraint invoices_concept_length
    check (character_length(concept) between 1 and 120) not valid;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table invoices
    add constraint invoices_supplier_length
    check (character_length(supplier) between 1 and 200) not valid;
exception
  when duplicate_object then null;
end $$;

-- ----------------------------------------------------------------------------
-- 2. La comunidad de un gasto y de una factura
-- ----------------------------------------------------------------------------
-- §7.2: PUT y DELETE /expenses/:id no llevan comunidad en la URL; POST
-- /invoices/:invoiceId/pay la lleva, pero la función resuelve la factura por
-- su fila igualmente. El hermano `app_invoice_community` se escribe antes que
-- `app_pay_invoice`, con el mismo contrato.
--
-- Devuelven el community_id SOLO si la fila existe, no está borrada y el
-- actor es miembro activo de su comunidad (app_is_member_of filtra por
-- ACTIVE). NULL -> `*_not_found` (P0002), mismo criterio C-8 de los bloques
-- 04-08: un 403 confirmaría que ese id existe. Un gasto/factura de otra
-- comunidad es NULL para este llamante: no confirmar nada de él.
--
-- Nótese lo que NO filtra: la comprobación de ADMIN va DESPUÉS, en cada
-- operación. Un gasto invisible "existe" para gestionarlo —gestionar es lo
-- que hay que hacer con esos— pero solo si el actor es ADMIN.
create or replace function app_expense_community(p_expense uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select e.community_id
    from expenses e
   where e.id = p_expense
     and e.deleted_at is null
     and app_is_member_of(e.community_id)
$$;

create or replace function app_invoice_community(p_invoice uuid)
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select i.community_id
    from invoices i
   where i.id = p_invoice
     and i.deleted_at is null
     and app_is_member_of(i.community_id)
$$;

-- ----------------------------------------------------------------------------
-- 3. El estado efectivo de una factura
-- ----------------------------------------------------------------------------
-- FN-5: OVERDUE no se persiste (no hay jobs en el proyecto, D-4 de la spec 08).
-- Se calcula en lectura, en una ÚNICA función compartida por el listado y el
-- resumen para que no diverjan. `stable` (no `immutable`): usa `current_date`.
-- app_invoice_effective_status('PENDING', due < hoy) -> OVERDUE; todo lo demás
-- pasa tal cual (PAID, CANCELLED, y PENDING a futuro).
create or replace function app_invoice_effective_status(
  p_status   invoice_status,
  p_due_date date
) returns invoice_status
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_status = 'PENDING' and p_due_date < current_date then 'OVERDUE'::invoice_status
    else p_status
  end
$$;

-- ----------------------------------------------------------------------------
-- 4. Lecturas
-- ----------------------------------------------------------------------------
-- FN-3: TODA lectura de gastos pasa por app_list_expenses() y TODA lectura de
-- facturas por app_list_invoices() —el listado, y el detalle por id con el
-- MISMO predicado, para que no haya dos copias de la visibilidad que puedan
-- discrepar. Aquí vive el perímetro de FN-1:

--   * Listado (p_* null): no-miembro -> 403 (C-8: no confirmar que la
--     comunidad existe); miembro no-ADMIN -> 403 (FN-1: a este bloque nadie
--     más entra).
--   * Detalle (p_* puesto): cero filas o no-ADMIN -> 404, el mismo (C-8: un
--     403 confirmaría que el id existe).
--   * deleted_at is null: borrado es borrado, para nadie (FN-8).
--   * El predicado de fila es `app_is_admin_of(d.community_id)`: la
--     pertenencia la da la propia fila, no un `app_is_member_of` previo.

-- El total sale de `count(*) over ()` (la misma técnica que 02e/02h/02i) y el
-- detalle por id la trae igual; el backend la ignora. El orden de gastos es
-- `expense_date desc, id` — cubierto por `expenses_community_date_idx`
-- (spec 09 §3.1). El de facturas, `issue_date desc, id`.

-- Añade created_by + created_by_name (left join a users) e invoice_id +
-- invoice_number (left join a invoices), la misma excepción acotada de los
-- bloques 02d-08. En gastos, `invoice_id`/`invoice_number` salen en el detalle
-- y el listado (FN-10 se demuestra con datos en el seed).
create or replace function app_list_expenses(
  p_community_id uuid,
  p_expense      uuid              default null,
  p_category     expense_category  default null,
  p_from         date              default null,
  p_to           date              default null,
  p_limit        integer           default 20,
  p_offset       integer           default 0
)
returns table (
  id               uuid,
  community_id     uuid,
  concept          text,
  category         expense_category,
  amount           numeric(12,2),
  expense_date     date,
  supplier         text,
  notes            text,
  invoice_id       uuid,
  invoice_number   text,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz,
  updated_at       timestamptz,
  total_count      bigint
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

  -- FN-4: el listado confirma que hay datos; el detalle no confirma el id.
  if p_expense is null then
    if not app_is_member_of(p_community_id) then
      raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
    end if;
    if not app_is_admin_of(p_community_id) then
      raise exception 'forbidden_role: las finanzas son solo de ADMIN' using errcode = '42501';
    end if;
  end if;

  return query
  select d.id, d.community_id, d.concept, d.category, d.amount,
         d.expense_date, d.supplier, d.notes,
         d.invoice_id, i.number,
         d.created_by, u.full_name, d.created_at, d.updated_at,
         count(*) over ()
    from expenses d
    left join invoices i on i.id = d.invoice_id      -- on delete set null
    left join users u on u.id = d.created_by         -- on delete set null
   where d.deleted_at is null                         -- FN-8
     and (p_expense is null or d.id = p_expense)
     and (p_community_id is null or d.community_id = p_community_id)
     and (p_category is null or d.category = p_category)
     and (p_from is null or d.expense_date >= p_from)
     and (p_to is null or d.expense_date <= p_to)
     and app_is_admin_of(d.community_id)              -- FN-1
   order by d.expense_date desc, d.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- Igual esqueleto para facturas, con el filtro `p_status` comparando con el
-- ESTADO EFECTIVO (FN-14): así `?status=OVERDUE` devuelve las vencidas sin que
-- exista la fila 'OVERDUE'. Se exponen los dos: `status` (el guardado) y
-- `effective_status` (el derivado), para que el cliente no rehaga la cuenta.
create or replace function app_list_invoices(
  p_community_id uuid,
  p_invoice      uuid            default null,
  p_status       invoice_status  default null,
  p_limit        integer         default 20,
  p_offset       integer         default 0
)
returns table (
  id               uuid,
  community_id     uuid,
  number           text,
  concept          text,
  amount           numeric(12,2),
  issue_date       date,
  due_date         date,
  paid_at          timestamptz,
  status           invoice_status,
  effective_status invoice_status,
  supplier         text,
  is_generated     boolean,
  created_by       uuid,
  created_by_name  text,
  created_at       timestamptz,
  updated_at       timestamptz,
  total_count      bigint
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

  if p_invoice is null then
    if not app_is_member_of(p_community_id) then
      raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
    end if;
    if not app_is_admin_of(p_community_id) then
      raise exception 'forbidden_role: las finanzas son solo de ADMIN' using errcode = '42501';
    end if;
  end if;

  return query
  select d.id, d.community_id, d.number, d.concept, d.amount,
         d.issue_date, d.due_date, d.paid_at,
         d.status, app_invoice_effective_status(d.status, d.due_date),
         d.supplier, d.is_generated,
         d.created_by, u.full_name, d.created_at, d.updated_at,
         count(*) over ()
    from invoices d
    left join users u on u.id = d.created_by
   where d.deleted_at is null
     and (p_invoice is null or d.id = p_invoice)
     and (p_community_id is null or d.community_id = p_community_id)
     and (p_status is null or app_invoice_effective_status(d.status, d.due_date) = p_status)
     and app_is_admin_of(d.community_id)           -- FN-1
   order by d.issue_date desc, d.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5. Escrituras
-- ----------------------------------------------------------------------------
-- La única puerta de entrada que queda: `expenses` ya era de solo lectura para
-- app_runtime (grant select de 02_rls §5.19) y aquí `invoices` pierde
-- INSERT/UPDATE/DELETE (sección 8). Ninguna función acepta un usuario como
-- parámetro: el actor sale de app_current_user_id().
--
-- Orden de guardas común: contexto -> rol ADMIN -> campos obligatorios ->
-- valores de dominio (importe, fechas, factura vinculada). El zod del backend
-- adelanta los mismos rangos; estas guardas son la red para una llamada
-- directa a la función.

-- ----------------------------------------------------------------------------
-- 5.1 Crear un gasto
-- ----------------------------------------------------------------------------
-- FN-1: solo ADMIN. FN-9: importe > 0 (red para el CHECK
-- expenses_amount_positive). FN-10: invoice_id de la misma comunidad, no
-- borrada. `created_by` sale de la sesión, jamás del cuerpo (como DN-8).
-- `coalesce(p_category, 'OTHER')` y `nullif(btrim(...), '')` para textos, para
-- que "no lo mandaste" y "lo mandaste vacío" acaben en el mismo sitio.
create or replace function app_create_expense(
  p_community_id uuid,
  p_concept      text,
  p_category     expense_category,
  p_amount       numeric,
  p_expense_date date,
  p_supplier     text,
  p_invoice_id   uuid,
  p_notes        text
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'forbidden_role: las finanzas son solo de ADMIN'
      using errcode = '42501';
  end if;

  -- Guarda interna, inalcanzable desde la API (el zod exige concepto):
  -- existe para que una llamada directa no choque con el not null crudo (23502
  -- es un error que nada traduce).
  if p_concept is null then
    raise exception 'expense_content_required: el concepto es obligatorio'
      using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'expense_amount_invalid: el importe debe ser mayor que 0'
      using errcode = '22023';
  end if;

  -- FN-10: la FK `expenses_invoice_id_fkey` valida que la fila exista (on
  -- delete set null), pero no puede comprobar que sea de la misma comunidad.
  -- Eso lo hace la función, aquí y en el PUT.
  if p_invoice_id is not null and not exists (
    select 1 from invoices i
     where i.id = p_invoice_id
       and i.community_id = p_community_id
       and i.deleted_at is null
  ) then
    raise exception 'expense_invoice_mismatch: la factura debe ser de la misma comunidad'
      using errcode = '22023';
  end if;

  insert into expenses (
    community_id, concept, category, amount, expense_date,
    supplier, invoice_id, notes, created_by
  ) values (
    p_community_id, btrim(p_concept), coalesce(p_category, 'OTHER'), p_amount,
    p_expense_date, nullif(btrim(p_supplier), ''), p_invoice_id,
    nullif(btrim(p_notes), ''), app_current_user_id()
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5.2 Actualizar un gasto (PUT, reemplazo completo)
-- ----------------------------------------------------------------------------
-- FN-7: el PUT es una foto del estado nuevo. `supplier`/`notes`/`invoiceId`
-- con null (o texto vacío vía nullif) limpian el valor; un cliente que quiere
-- mantenerlos los reenvía. Misma semántica que app_update_announcement (bloque
-- 07).
--
-- Guardas en orden:
--   1. app_expense_community() -> NULL: expense_not_found (P0002). Un gasto
--      invisible para el actor no es "suyo de editar" (C-8).
--   2. app_is_admin_of(v_community); si no, expense_requires_admin (42501).
--      Ni PRESIDENT ni NEIGHBOR tocan la tesorería (FN-1).
--   3. concepto e importe, como en el alta.
--   4. mismo chequeo de invoice_id (FN-10), contra la comunidad de la FILA.
--   5. update ... and deleted_at is null; si not found, P0002 (borrado en
--      carrera). Devuelve la fila (setof expenses), como app_update_announcement.
create or replace function app_update_expense(
  p_expense      uuid,
  p_concept      text,
  p_category     expense_category,
  p_amount       numeric,
  p_expense_date date,
  p_supplier     text,
  p_invoice_id   uuid,
  p_notes        text
) returns setof expenses
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  v_community := app_expense_community(p_expense);

  if v_community is null then
    raise exception 'expense_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_admin_of(v_community) then
    raise exception 'expense_requires_admin: las finanzas son solo de ADMIN'
      using errcode = '42501';
  end if;

  if p_concept is null then
    raise exception 'expense_content_required: el concepto es obligatorio'
      using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'expense_amount_invalid: el importe debe ser mayor que 0'
      using errcode = '22023';
  end if;

  if p_invoice_id is not null and not exists (
    select 1 from invoices i
     where i.id = p_invoice_id
       and i.community_id = v_community
       and i.deleted_at is null
  ) then
    raise exception 'expense_invoice_mismatch: la factura debe ser de la misma comunidad'
      using errcode = '22023';
  end if;

  update expenses
     set concept      = btrim(p_concept),
         category     = coalesce(p_category, 'OTHER'),
         amount       = p_amount,
         expense_date = p_expense_date,
         supplier     = nullif(btrim(p_supplier), ''),
         invoice_id   = p_invoice_id,
         notes        = nullif(btrim(p_notes), ''),
         updated_at   = now()
   where id = p_expense
     and deleted_at is null;

  if not found then
    -- Solo si otra transacción lo borró entre la guarda y este UPDATE.
    raise exception 'expense_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  return query select e.* from expenses e where e.id = p_expense;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5.3 Borrar un gasto (soft delete)
-- ----------------------------------------------------------------------------
-- FN-8: soft delete —el histórico de una tesorería no se pierde— y único
-- DELETE del bloque (las facturas no se borran ni se editan). Guardas
-- idénticas en orden a app_delete_document (DN-11): comunidad -> ADMIN ->
-- update con deleted_at is null (borrado dos veces en carrera = P0002 = 404).
create or replace function app_delete_expense(p_expense uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
begin
  v_community := app_expense_community(p_expense);

  if v_community is null then
    raise exception 'expense_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_admin_of(v_community) then
    raise exception 'expense_requires_admin: solo un ADMIN puede borrar gastos'
      using errcode = '42501';
  end if;

  update expenses
     set deleted_at = now()
   where id = p_expense
     and deleted_at is null;

  if not found then
    raise exception 'expense_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5.4 Crear una factura
-- ----------------------------------------------------------------------------
-- FN-1: solo ADMIN. `number` es único por comunidad
-- (invoices_community_number_uidx): el 23505 se captura y se re-lanza con
-- sentinel `invoice_number_taken` y SQLSTATE U0001 (FN-12).
--
-- POR QUÉ U0001 y no 23505: Prisma (P2010) traduce cualquier 23505 a su
-- mensaje genérico "Unique constraint failed: ..." y se come el sentinel. Con
-- un SQLSTATE propio (clase U, sin significado estándar) el mensaje llega
-- íntegro al cliente y translate() puede exigir la pareja (U0001,
-- invoice_number_taken). Un 23505 que sí llegue al cliente sigue significando
-- un bug del esquema.
--
-- `is_generated` nace false siempre (fuera de alcance generar facturas),
-- `status` nace PENDING, `created_by` de la sesión. Red para
-- `invoices_dates_valid`: p_due_date >= p_issue_date -> invoice_dates_invalid.
create or replace function app_create_invoice(
  p_community_id uuid,
  p_number       text,
  p_concept      text,
  p_amount       numeric,
  p_issue_date   date,
  p_due_date     date,
  p_supplier     text
) returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'forbidden_role: las finanzas son solo de ADMIN'
      using errcode = '42501';
  end if;

  if p_number is null then
    raise exception 'invoice_content_required: el numero de factura es obligatorio'
      using errcode = '22023';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'invoice_amount_invalid: el importe debe ser mayor que 0'
      using errcode = '22023';
  end if;

  if p_due_date is null or p_issue_date is null or p_due_date < p_issue_date then
    raise exception 'invoice_dates_invalid: vencimiento anterior a emision'
      using errcode = '22023';
  end if;

  begin
    insert into invoices (
      community_id, number, concept, amount, issue_date, due_date,
      supplier, created_by
    ) values (
      p_community_id, btrim(p_number), nullif(btrim(p_concept), ''), p_amount,
      p_issue_date, p_due_date, nullif(btrim(p_supplier), ''),
      app_current_user_id()
    )
    returning id into v_id;
  exception
    when unique_violation then
      if SQLERRM like '%invoices_community_number_uidx%' then
        raise exception 'invoice_number_taken: ya existe una factura con ese numero'
          using errcode = 'U0001';
      end if;
      raise;
  end;

  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- 5.5 Pagar una factura
-- ----------------------------------------------------------------------------
-- La única mutación de estado de factura (FN-6). Pagar una PENDING vencida
-- (que se LEE como OVERDUE) es un pago normal: la columna guarda PENDING y
-- aquí pasa a PAID con paid_at.
--
-- Guardas:
--   1. app_invoice_community -> NULL: invoice_not_found (P0002).
--   2. no ADMIN -> invoice_requires_admin (42501).
--   3. estado actual: PAID -> invoice_already_paid (U0001 -> 409);
--      CANCELLED -> invoice_cancelled (U0001 -> 409). FN-6: un doble POST pay
--      no es un 200 idempotente, es un conflicto que el cliente debe ver.
--   4. update ... and deleted_at is null; si not found (borrado en carrera),
--      P0002. Devuelve la fila actualizada.
create or replace function app_pay_invoice(p_invoice uuid)
returns setof invoices
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_status    invoice_status;
begin
  v_community := app_invoice_community(p_invoice);

  if v_community is null then
    raise exception 'invoice_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  if not app_is_admin_of(v_community) then
    raise exception 'invoice_requires_admin: las finanzas son solo de ADMIN'
      using errcode = '42501';
  end if;

  select status into v_status
    from invoices
   where id = p_invoice;

  if v_status = 'PAID' then
    raise exception 'invoice_already_paid: ya esta pagada' using errcode = 'U0001';
  end if;

  if v_status = 'CANCELLED' then
    raise exception 'invoice_cancelled: una factura cancelada no se paga' using errcode = 'U0001';
  end if;

  update invoices
     set paid_at    = now(),
         status     = 'PAID',
         updated_at = now()
   where id = p_invoice
     and deleted_at is null;

  if not found then
    raise exception 'invoice_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  return query select i.* from invoices i where i.id = p_invoice;
end;
$$;

-- ----------------------------------------------------------------------------
-- 6. El resumen económico
-- ----------------------------------------------------------------------------
-- El dashboard económico en su parte de servidor (el UI es la fase 10).
-- FN-1: ADMIN único (usuario -> membresía -> ADMIN, los tres 403 con el mismo
-- sentinel). Devuelve UNA fila (D-2): los `coalesce` y los sub-select
-- garantizan la fila incluso con la comunidad vacía.
--
-- FN-5/FN-14: los contadores de pendiente/vencida separan con
-- `due_date >= current_date` / `< current_date` sobre status = 'PENDING', y
-- `invoice_open_amount` es la suma de todo lo PENDING (pendiente + vencida).
create or replace function app_finance_summary(p_community_id uuid)
returns table (
  expense_total         numeric(12,2),
  expense_count         bigint,
  expense_by_category   jsonb,
  expense_recent        jsonb,
  invoice_total         numeric(12,2),
  invoice_count         bigint,
  invoice_open_amount   numeric(12,2),
  invoice_paid_amount   numeric(12,2),
  invoice_pending_count bigint,
  invoice_overdue_count bigint
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

  if not app_is_member_of(p_community_id) then
    raise exception 'forbidden_role: no es miembro de la comunidad' using errcode = '42501';
  end if;

  if not app_is_admin_of(p_community_id) then
    raise exception 'forbidden_role: las finanzas son solo de ADMIN' using errcode = '42501';
  end if;

  return query
  with e as (
    select amount from expenses
     where community_id = p_community_id and deleted_at is null
  ),
  i2 as (
    select status, amount, due_date from invoices
     where community_id = p_community_id and deleted_at is null
  ),
  cat as (
    select d.category,
           sum(d.amount)::numeric(12,2) as total,
           count(*) as cnt
      from expenses d
     where d.community_id = p_community_id and d.deleted_at is null
     group by d.category
  ),
  rec as (
    select d.id, d.concept, d.category,
           d.amount::numeric(12,2) as total, d.expense_date, d.supplier
      from expenses d
     where d.community_id = p_community_id and d.deleted_at is null
     order by d.expense_date desc, d.id
     limit 5
  )
  select coalesce((select sum(amount) from e), 0)::numeric(12,2),
         (select count(*) from e),
         coalesce((
           select jsonb_agg(
             jsonb_build_object('category', c.category, 'total', c.total, 'count', c.cnt)
             order by c.total desc
           ) from cat c
         ), '[]'::jsonb),
         coalesce((
           select jsonb_agg(
             jsonb_build_object('id', r.id, 'concept', r.concept, 'category', r.category,
                                'amount', r.total, 'expenseDate', r.expense_date,
                                'supplier', r.supplier)
           ) from rec r
         ), '[]'::jsonb),
         coalesce((select sum(amount) from i2), 0)::numeric(12,2),
         (select count(*) from i2),
         coalesce((select sum(amount) from i2 where status = 'PENDING'), 0)::numeric(12,2),
         coalesce((select sum(amount) from i2 where status = 'PAID'), 0)::numeric(12,2),
         (select count(*) from i2
           where status = 'PENDING' and due_date >= current_date),
         (select count(*) from i2
           where status = 'PENDING' and due_date < current_date);
end;
$$;

-- ----------------------------------------------------------------------------
-- 7. Políticas RLS
-- ----------------------------------------------------------------------------
-- expenses se queda SOLO con `expenses_admin_only` (ALL admin, §5.12 de
-- 02_rls) como guarda gruesa de lectura; app_runtime ya solo tiene SELECT.
--
-- invoices es donde cierra el hueco FN-13: `invoices_select_scoped` (SELECT,
-- ADMIN o CUALQUIER miembro activo) se elimina y se sustituye por
-- `invoices_admin_only` (SELECT, solo ADMIN). La rama de miembros dejaba ver
-- TODAS las facturas de la comunidad a un vecino ("sus propias" era
-- inexpresable: la tabla no tiene user_id). `invoices_write_admin` (ALL) se
-- elimina (FN-2): la escritura pasa por app_create_invoice/app_pay_invoice.
--
-- La de SELECT de invoices queda tan restrictiva como el predicado de la
-- sección 4: como en 02e-02h, las funciones son la única puerta de datos del
-- bloque y la política es la red que garantiza que ni una lectura con Prisma
-- salte el perímetro.
drop policy if exists invoices_select_scoped on invoices;
drop policy if exists invoices_write_admin on invoices;
drop policy if exists invoices_admin_only on invoices;

create policy invoices_admin_only on invoices
  for select using (app_is_admin_of(community_id));

-- ----------------------------------------------------------------------------
-- 8. Permisos
-- ----------------------------------------------------------------------------
-- El revoke es la pieza imprescindible, no decorativa: quitar `invoices` de la
-- lista de `grant insert, update, delete` de 02_rls.sql §5.19 no deshace un
-- GRANT ya aplicado (mismo argumento que AN-2 en 02h y DN-2 en 02i). Y se
-- repite contra anon, authenticated por simetría con 02e-02i.
revoke insert, update, delete on invoices from app_runtime;
revoke insert, update, delete on invoices from anon, authenticated;

-- `app_runtime` ejecuta las once funciones; PUBLIC no ejecuta ninguna (D-5:
-- las `sql stable` podrían ejecutarse sin sesión si PUBLIC conservara execute,
-- y revocar del grupo cubre roles futuros de una vez).
grant execute on function app_expense_community(uuid) to app_runtime;
grant execute on function app_invoice_community(uuid) to app_runtime;
grant execute on function app_invoice_effective_status(invoice_status, date) to app_runtime;
grant execute on function app_list_expenses(uuid, uuid, expense_category, date, date, integer, integer) to app_runtime;
grant execute on function app_list_invoices(uuid, uuid, invoice_status, integer, integer) to app_runtime;
grant execute on function app_create_expense(uuid, text, expense_category, numeric, date, text, uuid, text) to app_runtime;
grant execute on function app_update_expense(uuid, text, expense_category, numeric, date, text, uuid, text) to app_runtime;
grant execute on function app_delete_expense(uuid) to app_runtime;
grant execute on function app_create_invoice(uuid, text, text, numeric, date, date, text) to app_runtime;
grant execute on function app_pay_invoice(uuid) to app_runtime;
grant execute on function app_finance_summary(uuid) to app_runtime;

revoke execute on function app_expense_community(uuid) from public;
revoke execute on function app_invoice_community(uuid) from public;
revoke execute on function app_invoice_effective_status(invoice_status, date) from public;
revoke execute on function app_list_expenses(uuid, uuid, expense_category, date, date, integer, integer) from public;
revoke execute on function app_list_invoices(uuid, uuid, invoice_status, integer, integer) from public;
revoke execute on function app_create_expense(uuid, text, expense_category, numeric, date, text, uuid, text) from public;
revoke execute on function app_update_expense(uuid, text, expense_category, numeric, date, text, uuid, text) from public;
revoke execute on function app_delete_expense(uuid) from public;
revoke execute on function app_create_invoice(uuid, text, text, numeric, date, date, text) from public;
revoke execute on function app_pay_invoice(uuid) from public;
revoke execute on function app_finance_summary(uuid) from public;

-- ----------------------------------------------------------------------------
-- 9. Autocomprobación
-- ----------------------------------------------------------------------------
-- Que este archivo se ejecute sin errores no demuestra nada: si alguien lo
-- reescribe y se le olvida el `security definer`, o deja un grant de escritura
-- vivo, o no sustituye la política de lectura, el archivo se aplicaría igual
-- de limpio y el agujero se instalaría solo, en silencio. Estas comprobaciones
-- son las que fallan en `db:verify`.
do $$
declare
  v_fallos text := '';
  r        record;
begin
  -- Las once funciones: existen, son SECURITY DEFINER con search_path fijo y
  -- no ejecutables por PUBLIC.
  for r in
    select p.proname, p.prosecdef, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in (
         'app_expense_community', 'app_invoice_community',
         'app_invoice_effective_status', 'app_list_expenses',
         'app_list_invoices', 'app_create_expense', 'app_update_expense',
         'app_delete_expense', 'app_create_invoice', 'app_pay_invoice',
         'app_finance_summary'
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
      'app_expense_community', 'app_invoice_community',
      'app_invoice_effective_status', 'app_list_expenses',
      'app_list_invoices', 'app_create_expense', 'app_update_expense',
      'app_delete_expense', 'app_create_invoice', 'app_pay_invoice',
      'app_finance_summary'
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

  -- invoices: sin políticas de escritura (FN-2) y con la única lectura siendo
  -- ADMIN (FN-13). expenses conserva su política ADMIN (FN-1).
  if exists (
    select 1
      from pg_policies
     where tablename = 'invoices'
       and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    v_fallos := v_fallos || ' invoices tiene politica de escritura;';
  end if;

  if exists (
    select 1
      from pg_policies
     where tablename = 'invoices'
       and policyname in ('invoices_select_scoped', 'invoices_write_admin')
  ) then
    v_fallos := v_fallos || ' siguen existiendo invoices_select_scoped/invoices_write_admin;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'invoices'
       and policyname = 'invoices_admin_only'
       and cmd = 'SELECT'
  ) then
    v_fallos := v_fallos || ' falta invoices_admin_only de SELECT;';
  end if;

  if not exists (
    select 1
      from pg_policies
     where tablename = 'expenses'
       and policyname = 'expenses_admin_only'
  ) then
    v_fallos := v_fallos || ' falta expenses_admin_only;';
  end if;

  -- Y que el permiso de escritura de invoices no exista para nadie, no solo
  -- para app_runtime. Se excluyen postgres (owner) y service_role (recibe
  -- todos los privilegios por ALTER DEFAULT PRIVILEGIES de Supabase), igual
  -- que en 02e-02i.
  if exists (
    select 1
      from information_schema.role_table_grants
     where table_schema = 'public'
       and table_name = 'invoices'
       and privilege_type in ('INSERT', 'UPDATE', 'DELETE')
       and grantee not in ('postgres', 'service_role')
  ) then
    v_fallos := v_fallos || ' invoices tiene INSERT/UPDATE/DELETE concedido a un rol que no debe;';
  end if;

  -- Los seis CHECK de longitud de la sección 1.
  for r in
    select unnest(array[
      'expenses_concept_length', 'expenses_notes_length',
      'expenses_supplier_length', 'invoices_number_length',
      'invoices_concept_length', 'invoices_supplier_length'
    ]) as con
  loop
    if not exists (
      select 1
        from pg_constraint
       where conname = r.con
         and contype = 'c'
    ) then
      v_fallos := v_fallos || ' falta ' || r.con || ';';
    end if;
  end loop;

  if exists (
    select 1
      from pg_constraint
     where conname in (
       'expenses_concept_length', 'expenses_notes_length',
       'expenses_supplier_length', 'invoices_number_length',
       'invoices_concept_length', 'invoices_supplier_length'
     )
       and convalidated = false
  ) then
    raise notice 'AVISO: los CHECK de longitud de finanzas existen pero siguen sin validar (not valid).';
  end if;

  -- FN-1 escrita: created_by sale de app_current_user_id(), jamás del cuerpo.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_create_expense'
       and pg_get_functiondef(p.oid) like '%app_current_user_id()%'
  ) then
    v_fallos := v_fallos || ' el alta de gastos deberia firmar created_by con app_current_user_id;';
  end if;

  -- FN-12 escrita: el alta de facturas captura el 23505 y lo re-lanza con
  -- U0001. Si el unique ya no se captura, un número repetido sería un 500.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_create_invoice'
       and pg_get_functiondef(p.oid) like '%invoices_community_number_uidx%'
  ) then
    v_fallos := v_fallos || ' el alta de facturas deberia capturar invoices_community_number_uidx (FN-12);';
  end if;

  -- FN-8 escrita: el borrado de gastos es soft delete con deleted_at.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_delete_expense'
       and pg_get_functiondef(p.oid) like '%deleted_at = now()%'
  ) then
    v_fallos := v_fallos || ' el borrado de gastos deberia ser soft delete (FN-8);';
  end if;

  -- FN-5 escrita: OVERDUE se calcula en lectura (se comparte la función). Si el
  -- listado dejara de usar el estado efectivo, ?status=OVERDUE jamás daría nada.
  if not exists (
    select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname = 'app_list_invoices'
       and pg_get_functiondef(p.oid) like '%app_invoice_effective_status%'
  ) then
    v_fallos := v_fallos || ' el listado de facturas deberia derivar el estado efectivo (FN-5);';
  end if;

  if v_fallos <> '' then
    raise exception 'Las finanzas no son seguras:%', v_fallos;
  end if;

  raise notice 'OK: invoices solo lectura para ADMIN, once funciones SECURITY DEFINER con search_path fijo y no ejecutables por PUBLIC, gastos soft delete, OVERDUE calculado en lectura, CHECK de longitud presentes.';
end $$;