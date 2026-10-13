# Spec 09 — Finanzas

> **Estado: IMPLEMENTED.** Las decisiones FN-1 a FN-14 de §2 y las seis
> decisiones de §12 (D-1 a D-6) están cerradas y en pie. Este spec usa la
> nomenclatura **FN-1 a FN-14** para esta etapa.
> **Fase:** 9 (finanzas: gastos, facturas, resumen económico). Precedida de
> `01-authentication`, `02-communities`, `03-members`, `04-incidents`,
> `05-common-areas`, `06-reservations`, `07-announcements` y `08-documents`.
> **Base de datos:** `supabase/sql/01_schema.sql` (las tablas `expenses` §4.12
> e `invoices` §4.13 ya existen, con su enum), `02_rls.sql` (`expenses_admin_only`
> §5.12 e `invoices_select_scoped`/`invoices_write_admin` §5.13) y
> `02j_finance.sql` (archivo nuevo, en este bloque).
> **Backend:** `backend/src/finance/`.
>
> Este spec define las **finanzas de la comunidad**: gastos, facturas y el
> resumen económico (el "dashboard económico" del prompt §7.6). Es el bloque de
> los datos más sensibles del producto —el seed los llama "lo que ADMIN ve y
> PRESIDENT no"— y por eso la visibilidad es la decisión FN-1: **todo finanzas
> es 100 % solo ADMIN**.

---

## 1. Objetivo

Que una comunidad registre sus **gastos** (concepto, categoría, importe, fecha,
proveedor, comunidad y una factura vinculada — prompt §7.6) y sus **facturas**,
y que el ADMIN tenga un **resumen económico** (totales por categoría, pendientes
de pago y vencidas) sin sacar las finanzas del perímetro de la administración.

Tres piezas, todas en una sola fase:

1. **Gastos** (`expenses`): el registro del gasto, con su edición (`PUT`, la
   primera edición de negocio de un bloque que no sea el `PATCH` de
   comunidades), su borrado lógico y sus filtros (`?from&to&category`,
   `ARCHITECTURE.md` §6).
2. **Facturas** (`invoices`): el pasivo —la factura que la comunidad debe
   pagar—, con su listado por estado y la acción `pay` que la pasa a `PAID`.
   No hay edición ni borrado: la arquitectura no las lista.
3. **Resumen** (`finance/summary`): los agregados del dashboard económico.

La asimetría es la inversa de los avisos y hereda la de los documentos, al
extremo: aquí **nadie lee salvo ADMIN**. Un `PRESIDENT` no recibe ni un
"resumen" —la matriz de `ARCHITECTURE.md` §5 le daba `✅ (resumen)`— porque la
implementación real (RLS, seed, `API.md`) dice que no ve nada, y FN-1 la
ratifica. El 04_verify ya lo comprueba: *0 filas para cualquier no-ADMIN*.

Fuera de alcance: presupuestos/facturas **de cuotas por vecino** (la tabla no
guarda `user_id` destinatario; véase FN-13); **facturar contra documentos**
(`invoices.is_generated` queda como bandera de infraestructura, no se genera
nada); **pagos reales o ficheros adjuntos**; el **dashboard visual** (fase 10,
Recharts); **votos ni presupuestos comunitarios**; cualquier **UI**.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **FN-1** | **Todo finanzas —gastos, facturas y resumen— es solo de `ADMIN`** | Que `PRESIDENT` vea un resumen agregado, como apuntaba la matriz de `ARCHITECTURE.md` §5 | La fila "Ver gastos/facturas: ✅ (resumen)" de la matriz **no corresponde a lo implementado**: `02_rls.sql`§5.12 es `expenses_admin_only`, el seed los llama "el dato más sensible… que ADMIN ve y PRESIDENT no", `API.md` dice literalmente que `PRESIDENT` no ve los gastos y `04_verify` lo comprueba con 0 filas. El comentario de `02_rls.sql:637` ("el PRESIDENT recibe un resumen agregado por otra vía") quedó como intención no desarrollada. La decisión del usuario es cerrar con lo **ya implementado**: finanzas dentro del perímetro de la administración. El resumen también es ADMIN-only, así que no hay "otra vía" que cablear |
| **FN-2** | **Toda escritura pasa por funciones `SECURITY DEFINER`**; se elimina `invoices_write_admin` y se revoca `insert, update, delete` sobre `invoices` a `app_runtime` | Dejar la política y escribir con Prisma | Mismo argumento que DN-2 (spec 08), AN-2 (spec 07) y CA-6 (spec 05): las políticas de escritura no pueden (a) validar que la factura vinculada sea de la misma comunidad, (b) traducir el `23505` de `invoices_community_number_uidx` a un 409 con sentinel, ni (c) comprobar el rol ADMIN. `expenses` ya no tiene permisos de escritura (`grant select` §grant de `02_rls.sql`) — aquí solo falta **revocar** a `invoices` |
| **FN-3** | La lista y el detalle son **una sola función por entidad**: `app_list_expenses()` y `app_list_invoices()` | `app_get_*()` separadas | Es la misma relación que DN-6 y AN-3: un único predicado de visibilidad (FN-1) escrito una vez; el detalle por id es la misma función con `p_*` set. Dos lectores serían dos copias del predicado que divergen |
| **FN-4** | El **listado** de gastos/facturas/resumen da **403** a cualquier no-ADMIN; el **detalle por id** (gasto) da **404** | 403 en el detalle | Listar dice "hay datos aquí", por eso un no-miembro recibe 403 (C-8, como en avisos y documentos) y un miembro no-ADMIN también 403 (FN-1). El detalle por id **no** confirma existencia (C-8): un `PRESIDENT` que pida el detalle de un gasto existente recibe 404, el mismo que "no existe". No se puede distinguir "existe pero es de ADMIN" de "no existe" |
| **FN-5** | **`OVERDUE` se calcula en lectura** (`app_invoice_effective_status()`: `PENDING` con `due_date < hoy` → `OVERDUE`); **nunca se escribe** en la columna | Un job que pase `PENDING` a `OVERDUE` | No hay jobs en el proyecto (D-4 de la spec 08). La columna guarda `PENDING`/`PAID`/`CANCELLED`; la lectura la deriva. `CANCELLED` no tiene ruta en `ARCHITECTURE.md` §6 —solo se alcanza por SQL directo— y no hace falta una ruta de cancelación para este bloque |
| **FN-6** | `POST /invoices/:id/pay` **idempotente con 409**: pagar una `PAID` da `invoice_already_paid`, pagar una `CANCELLED` da `invoice_cancelled` | Que pagar dos veces sea un 200 | Un doble `POST pay` casi seguro es un error del cliente o una reconexión; devolver 200 "ya pagada" ocultaría que el flujo se pisó. El 409 con su sentinel lo dice explícito. Pagar una `PENDING` vencida (que se lee `OVERDUE`) es un pago normal: `paid_at = now()`, `status = 'PAID'` |
| **FN-7** | `PUT /expenses/:id` es **reemplazo completo** de los campos mutables | `PATCH` parcial; o `PUT` sin poder limpiar los nullables | `ARCHITECTURE.md` §6 dice `PUT`, no `PATCH`. Semántica idéntica a `app_update_announcement` (bloque 07): el cliente envía los campos obligatorios (concept, amount, expenseDate) y `supplier`/`notes`/`invoiceId` **null limpian el valor** (`nullif`). No hay "yellow-flag" de qué cambió: el PUT es una foto del estado nuevo |
| **FN-8** | El borrado de gastos es **soft delete** (`deleted_at = now()`), solo `ADMIN` | Borrado físico | Mismo criterio que DN-11, AN-5 y el bloque 04: el histórico de una tesorería no se pierde. Y es el único `DELETE`: **las facturas no tienen borrado** —`ARCHITECTURE.md` §6 no lista `DELETE /invoices/:id` (ni `PUT`)—, como DN-9 hizo que los documentos no tuvieran `PUT`. Una factura equivocada queda; si hiciera falta a la vista, heterogénea, se decidirá en su spec |
| **FN-9** | Los importes viajan como **`numeric(12,2)`** y se validan en zod (**positivos**, máx. 9 999 999 999,99); las sumas del resumen se castean a `numeric(12,2)` | `float`/`double` | `01_schema.sql` lo comenta: en batalla abierta los floats redondean mal (0.1+0.2). El zod adelanta `amount > 0` y el límite de precisión; el `CHECK expenses_amount_positive` es la red. El backend convierte el `numeric` (string en `$queryRaw`) a número en la capa de mapeo |
| **FN-10** | `expenses.invoice_id` (la "factura" del prompt §7.6) debe pertenecer **a la misma comunidad** en el alta y en el `PUT`; si no, 400 `expense_invoice_mismatch` | Permitir vincular facturas de otra comunidad | El gasto y la factura son de la comunidad del `community_id`; un cruce entre comunidades rompería el aislamiento. La FK existe (`expenses_invoice_id_fkey`, `on delete set null`) pero no puede verificar la comunidad de la fila referenciada —eso lo hace la función |
| **FN-11** | Se añaden `CHECK` de longitud (**`not valid`**, patrón de `02i_documents.sql` §4a) a `concept`, `notes` y `supplier` de `expenses`, y a `number`, `concept` y `supplier` de `invoices` | Dejar el `not null` desnudo | El `not null` impide vacío implícito pero no el `''` ni el texto infinito. Los rangos los repite el zod del backend. `not valid` aplica a filas nuevas sin fallar sobre las existentes |
| **FN-12** | La **única** `unique` real del bloque, `invoices_community_number_uidx`, se traduce a `invoice_number_taken` con SQLSTATE **`U0001`** → 409; los 409 de negocio (`invoice_already_paid`, `invoice_cancelled`) usan también `U0001` como clase de conflicto | `23505` crudo o errcodes distintos por caso | El 23505 de un número repetido **no puede** viajar como `23505`: Prisma (P2010) lo reescribe a «Unique constraint failed:…» y se come el sentinel (D-5 de la spec 08). `U0001` repite para los tres 409 como "clase de conflicto del bloque", y la traducción de `errors.ts` exige **el par** sentinel+errcode (R-12), así que un texto de un campo del cliente no fabrica un 409 |
| **FN-13** | Las **facturas de cuotas por vecino** quedan **fuera de alcance**; la lectura de `invoices` se restringe a `ADMIN` (sustituye `invoices_select_scoped`) | Mantener la rama de miembros de la política | `invoices_select_scoped` deja leer **todas** las facturas a cualquier miembro activo, pero el comentario de `02_rls.sql:648` dice "sus propias facturas" — y la tabla **no tiene `user_id`**, así que "propias" es inexpresable. Hoy un vecino vería las facturas de toda la comunidad: un hueco de over-exposure que este bloque cierra (la política pasa a ADMIN-only, FN-1). Las cuotas por vecino exigirían añadir `user_id` al esquema, y eso es otro modelo |
| **FN-14** | El resumen devuelve **agregados + los 5 gastos más recientes** en un único objeto; el `?status=OVERDUE` del listado de facturas filtra por el **estado efectivo** | Resumen solo con escalares; filtrar por la columna | Es ADMIN-only (FN-1), así que incluir los recientes no filtra nada y le da al dashboard contenido real. Y como `OVERDUE` no se persiste (FN-5), el filtro del listado tiene que comparar con `app_invoice_effective_status()` o un filtro `?status=OVERDUE` jamás devolvería nada |

---

## 3. Estado real del modelo de datos

Verificado contra `01_schema.sql`, `02_rls.sql` y `prisma/schema.prisma` hoy.

### 3.1 `expenses`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade`. Eje del aislamiento |
| `concept` | `text not null` | **Sin `CHECK` de longitud.** Este bloque lo añade (§4a) |
| `category` | `expense_category not null default 'OTHER'` | `MAINTENANCE, CLEANING, SECURITY, UTILITIES, ADMIN, INSURANCE, OTHER` |
| `amount` | `numeric(12,2) not null` | `check (amount > 0)` ya existe |
| `expense_date` | `date not null` | La fecha del gasto, no la de alta |
| `supplier` | `text` | Nullable. **Sin `CHECK` de longitud.** Este bloque lo añade (§4a) |
| `invoice_id` | `uuid → invoices(id)` | `on delete set null`. FN-10: debe ser de la misma comunidad |
| `notes` | `text` | Nullable. **Sin `CHECK` de longitud.** Este bloque lo añade (§4a) |
| `created_by` | `uuid → users(id)` | `on delete set null` |
| `deleted_at` | `timestamptz` | FN-8: soft delete. Ninguna función borra la fila |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger establecido en `04_verify.sql` §6 |

Índices existentes: `expenses_community_date_idx` (`(community_id, expense_date desc)` con `where deleted_at is null`) y `expenses_community_category_idx` (`(community_id, category)`). El listado de este bloque se ordena por `expense_date desc, id`, que **ya está indexado**.

### 3.2 `invoices`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade` |
| `number` | `text not null` | **`invoices_community_number_uidx`** (única por comunidad). Sin `CHECK` de longitud (FN-11) |
| `concept` | `text` | Nullable |
| `amount` | `numeric(12,2) not null` | `check (amount > 0)` |
| `issue_date` | `date not null` | |
| `due_date` | `date not null` | `check (invoices_dates_valid: due_date >= issue_date)` |
| `paid_at` | `timestamptz` | Lo escribe `app_pay_invoice()` |
| `status` | `invoice_status not null default 'PENDING'` | `PENDING, PAID, OVERDUE, CANCELLED`. `OVERDUE` nunca se persiste (FN-5) |
| `supplier` | `text` | Nullable |
| `is_generated` | `boolean not null default false` | Bandera de infraestructura. No se escribe `true` en este bloque |
| `created_by` | `uuid → users(id)` | `on delete set null` |
| `deleted_at` | `timestamptz` | Nullable; ninguna ruta lo escribe (FN-8) |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Índices: `invoices_community_number_uidx`, `invoices_community_status_idx`
(`(community_id, status, due_date)`) e `invoices_community_due_idx`
(`(community_id, due_date)` con `where status = 'PENDING' and deleted_at is null`).

### 3.3 Nada se crea en el esquema

`02j_finance.sql` no crea tablas ni columnas: solo funciones, permisos, las
políticas de escritura que se eliminan de `invoices`, el reemplazo de la de
lectura y los `CHECK` de longitud de §4a. Las tablas, enums, índices y la FK
`expenses.invoice_id → invoices.id` ya vienen completos de `01_schema.sql`.

---

## 4. El problema del arranque

### a) `concept`, `notes`, `supplier` y `number` no tienen longitud

Igual que en `02i_documents.sql` §4a (bloques 04, 07 y 08): el `not null` no
impide el `''`. Se añaden los `CHECK` con `not valid`:

```sql
alter table expenses
  add constraint expenses_concept_length
  check (char_length(concept) between 1 and 120) not valid;

alter table expenses
  add constraint expenses_notes_length
  check (character_length(notes) between 1 and 1000) not valid;

alter table expenses
  add constraint expenses_supplier_length
  check (character_length(supplier) between 1 and 200) not valid;

alter table invoices
  add constraint invoices_number_length
  check (char_length(number) between 1 and 50) not valid;

alter table invoices
  add constraint invoices_concept_length
  check (character_length(concept) between 1 and 120) not valid;

alter table invoices
  add constraint invoices_supplier_length
  check (character_length(supplier) between 1 and 200) not valid;
```

`not valid` aplica a filas nuevas sin romper las del seed ni las demos; validar
es un paso posterior. `concept` de 120 (un gasto cabe), `notes` de 1000, y
`number` de 50 para un número de factura tipo `INV-2026-0001` con margen. Los
rangos los repite el zod de forma independiente.

### b) `invoices_select_scoped` deja ver todas las facturas a cualquier miembro

La política de `02_rls.sql:649` permite el `SELECT` si el actor es ADMIN **o** es
un miembro activo:

```sql
app_is_member_of(community_id)
and exists (select 1 from community_members m
            where m.community_id = invoices.community_id
              and m.user_id = app_current_user_id()
              and m.status = 'ACTIVE')
```

El comentario dice "Cada vecino puede ver **sus propias** facturas de cuotas",
pero la tabla `invoices` **no tiene columna de destinatario**: "propias" es
inexpresable y la rama anterior concede a **cualquier** vecino activo el `SELECT`
de **todas** las facturas de la comunidad. Es un hueco de over-exposure que este
bloque cierra (FN-13): se sustituye por una sola política `invoices_admin_only`
(FN-1). El `expenses_admin_only` de §5.12 ya es ADMIN-only y se queda tal cual.
Después `app_runtime` pierde `insert, update, delete` sobre `invoices` (FN-2):
el `grant insert, update, delete on … invoices` de `02_rls.sql:972` hay que
revocarlo explícitamente, porque quitarlo de la lista no deshace un `GRANT` ya
aplicado (mismo argumento que AN-2).

### c) No hay `OVERDUE` real: no hay jobs

El `invoice_status` enum incluye `OVERDUE`, pero en el proyecto no hay operación
periódica que lo asigne. La decisión FN-5: se calcula en lectura con
`app_invoice_effective_status()` (una función `stable` compartida por el listado
y el resumen, para que no divergan). La columna sigue guardando `PENDING`/`PAID`
y, si alguien escribe `CANCELLED` por SQL, se respeta.

### d) `numeric` y el mapeo del backend

Prisma trae `numeric(12,2)` como **string** en `$queryRaw` (igual que las fechas
`date`). La capa de mapeo (`repository.ts`) convierte `amount`/totales a `number`
con `Number(row.amount)` y las fechas las serializa el propio mapeador. La firma
de las funciones SQL tipa los importes como `numeric(12,2)` para que las sumas
del resumen no devuelvan un `float` de precisión arbitraria.

---

## 5. Funciones

Las nueve de `02j_finance.sql`, todas `SECURITY DEFINER` con
`search_path = public, pg_temp`, no ejecutables por `PUBLIC`, con `execute` solo
para `app_runtime`. Todas devuelven errores con **sentinel + `errcode`** (§7.5).

### 5.1 `app_expense_community(p_expense uuid) returns uuid`

Devuelve el `community_id` solo si el gasto **existe, no está borrado y el actor
es miembro activo** de su comunidad; `NULL` si no. Mismo contrato que
`app_document_community` (spec 08): quien la llama dentro de SQL son
`app_update_expense()` y `app_delete_expense()` — con `NULL` → `expense_not_found`
→ 404. El `app_is_member_of` (y no `app_is_admin_of`) mantiene C-8: un no-miembro
no puede ni confirmar que el gasto existe. La comprobación de ADMIN va después,
en cada operación.

```sql
create or replace function app_expense_community(p_expense uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select e.community_id
    from expenses e
   where e.id = p_expense
     and e.deleted_at is null
     and app_is_member_of(e.community_id)
$$;
```

### 5.2 `app_list_expenses(...) returns table(...)`

**La única lectura de gastos** (FN-3): listado de la comunidad con filtros y
paginación, detalle por id, y `total` real vía `count(*) over ()`. Guardas:

1. `app_current_user_id()` presente; si no, `42501`.
2. Si `p_expense is null` (listado): no-miembro → `forbidden_role` (403);
   miembro no-ADMIN → `forbidden_role` (403). FN-4: listar confirma que hay
   datos.
3. Predicado de filas: `deleted_at is null`; id/community/categoría/rango
   `[from, to]`; y `app_is_admin_of(d.community_id)` — FN-1.
4. Orden `d.expense_date desc, d.id` (el índice `expenses_community_date_idx`
   ya lo cubre) y paginación idéntica al resto de bloques.

Añade `created_by` + `created_by_name` (left join a `users`, la misma excepción
acotada de los bloques 03–08) e `invoice_id` + `invoice_number` (left join a
`invoices`). El detalle por id no lleva `p_community_id`; el filtro es la
pertenencia de la fila, y un no-ADMIN recibe cero filas → 404 (FN-4).

```sql
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
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

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
    left join invoices i on i.id = d.invoice_id
    left join users u on u.id = d.created_by       -- on delete set null
   where d.deleted_at is null
     and (p_expense is null or d.id = p_expense)
     and (p_community_id is null or d.community_id = p_community_id)
     and (p_category is null or d.category = p_category)
     and (p_from is null or d.expense_date >= p_from)
     and (p_to is null or d.expense_date <= p_to)
     and app_is_admin_of(d.community_id)           -- FN-1
   order by d.expense_date desc, d.id
   limit least(greatest(coalesce(p_limit, 20), 1), 100)
   offset greatest(coalesce(p_offset, 0), 0);
end
$$;
```

### 5.3 `app_create_expense(...) returns uuid`

`ADMIN` único (FN-1), `created_by` sale de la sesión (nunca del cuerpo). Guardas
en orden:

1. `app_current_user_id()` presente; si no, `42501`.
2. `app_is_admin_of(p_community_id)`; si no, `forbidden_role` (`42501` → 403).
   El backend ya pone `requireCommunityRole('ADMIN')`; esta es la red.
3. `p_concept` presente — guarda interna (el zod exige 1–120), `22023`.
4. `p_amount` presente y `> 0` — red para el `CHECK expenses_amount_positive`,
   `expense_amount_invalid` (`22023`).
5. `p_invoice_id` si viene: debe existir, no estar borrada y ser de la misma
   comunidad — si no, `expense_invoice_mismatch` (`22023` → 400). FN-10.

Inserta con `btrim` en textos, `coalesce(p_category, 'OTHER')`, `nullif` para
`supplier`/`notes` vacíos. Devuelve el `uuid` de la fila.

```sql
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
language plpgsql volatile security definer set search_path = public, pg_temp
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
end
$$;
```

### 5.4 `app_update_expense(p_expense uuid, ...) returns setof expenses`

FN-7: reemplazo completo. Guardas en orden —documenta la guarda: un gasto
invisible para el actor no es "suyo de editar"—

1. `app_expense_community(p_expense)`; `NULL` → `expense_not_found` (`P0002`
   → 404). El gasto existe pero el actor no es miembro: ni confirmar.
2. `app_is_admin_of(v_community)`; si no, `expense_requires_admin` (`42501`
   → 403), con el mismo argumento de `document_requires_admin`: ni `PRESIDENT`
   ni `NEIGHBOR` tocan la tesorería.
3. `p_concept` presente → `expense_content_required` (`22023`). `p_amount` `> 0`
   → `expense_amount_invalid` (`22023`).
4. Mismo chequeo de `p_invoice_id` (FN-10): `expense_invoice_mismatch`.
5. `update … where id = p_expense and deleted_at is null`; si `not found`,
   `expense_not_found` (`P0002`): otra transacción la borró en medio.
6. Devuelve la fila (`setof expenses`), como `app_update_announcement`.

```sql
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
language plpgsql volatile security definer set search_path = public, pg_temp
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
    raise exception 'expense_not_found: no existe o no es visible' using errcode = 'P0002';
  end if;

  return query select e.* from expenses e where e.id = p_expense;
end
$$;
```

### 5.5 `app_delete_expense(p_expense uuid) returns void`

FN-8: soft delete, `ADMIN` único. Guardas idénticas a `app_delete_document`:

1. `app_expense_community`; `NULL` → `expense_not_found` (`P0002`).
2. no ADMIN → `expense_requires_admin` (`42501`).
3. `update … set deleted_at = now() where id and deleted_at is null`; si `not
   found` (borrado dos veces en carrera), `P0002`.

```sql
create or replace function app_delete_expense(p_expense uuid) returns void
language plpgsql volatile security definer set search_path = public, pg_temp
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
end
$$;
```

### 5.6 `app_invoice_effective_status(p_status invoice_status, p_due_date date) returns invoice_status`

La derivación `OVERDUE` de FN-5, una sola vez: `stable` (no `immutable`: usa
`current_date`), compartida por el listado y el resumen.

```sql
create or replace function app_invoice_effective_status(
  p_status   invoice_status,
  p_due_date date
) returns invoice_status
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when p_status = 'PENDING' and p_due_date < current_date then 'OVERDUE'::invoice_status
    else p_status
  end
$$;
```

### 5.7 `app_list_invoices(...) returns table(...)`

La única lectura de facturas (FN-3), con el mismo esqueleto que §5.2. Guardas:
usuario presente; si es listado, miembro y ADMIN (403 por FN-1). Predicado:
`deleted_at is null`, filtros de id/comunidad/estado, y `app_is_admin_of`. El
filtro `p_status` compara con el **estado efectivo** (FN-14): así
`?status=OVERDUE` devuelve las vencidas sin que exista la fila `OVERDUE`.
Orden: `issue_date desc, id`. Expone `status` (el guardado) y `effective_status`
(el derivado), para que el cliente no tenga que rehacer la cuenta.

```sql
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
language plpgsql stable security definer set search_path = public, pg_temp
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
end
$$;
```

### 5.8 `app_create_invoice(...) returns uuid`

`ADMIN` único. Guardas:

1. usuario presente → `42501`.
2. ADMIN → `forbidden_role` (`42501`).
3. `p_number` presente → `invoice_content_required` (`22023`).
4. `p_amount` `> 0` → `invoice_amount_invalid` (`22023`).
5. `p_due_date >= p_issue_date` → `invoice_dates_invalid` (`22023`) — red para
   el `CHECK invoices_dates_valid`.
6. Inserta; captura el `23505` de `invoices_community_number_uidx` y lo
   re-lanza con sentinel `invoice_number_taken` y SQLSTATE `U0001` (FN-12).

`is_generated` nace `false` siempre (fuera de alcance generar facturas),
`status` nace `PENDING`, `created_by` de la sesión.

```sql
create or replace function app_create_invoice(
  p_community_id uuid,
  p_number       text,
  p_concept      text,
  p_amount       numeric,
  p_issue_date   date,
  p_due_date     date,
  p_supplier     text
) returns uuid
language plpgsql volatile security definer set search_path = public, pg_temp
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
end
$$;
```

### 5.9 `app_pay_invoice(p_invoice uuid) returns setof invoices`

La única mutación de estado de factura (FN-6). Guardas:

1. `app_invoice_community(p_invoice)`; `NULL` → `invoice_not_found` (`P0002`).
2. no ADMIN → `invoice_requires_admin` (`42501`).
3. Estado actual: `PAID` → `invoice_already_paid` (`U0001` → 409); `CANCELLED`
   → `invoice_cancelled` (`U0001` → 409). Un `OVERDUE` leído no es un estado
   guardado: pagar `PENDING` vencida es un pago normal.
4. `update … set paid_at = now(), status = 'PAID', updated_at = now() where id
   and deleted_at is null`; si `not found` (borrado en carrera), `P0002`.
5. Devuelve la fila actualizada.

```sql
create or replace function app_pay_invoice(p_invoice uuid) returns setof invoices
language plpgsql volatile security definer set search_path = public, pg_temp
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

  select status into v_status from invoices where id = p_invoice;

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
end
$$;
```

Nota: `app_invoice_community` (el hermano de §5.1) vive en el mismo script y se
escribe antes que `app_pay_invoice`, con el mismo contrato: existe, no borrada,
actor miembro.

### 5.10 `app_finance_summary(p_community_id uuid) returns table(...)`

El **resumen económico** (prompt §7.6, "crear dashboard económico"; la parte de
servidor, porque el UI es la fase 10). `ADMIN` único: guardas de usuario,
membresía (403) y ADMIN (403), como el listado de gastos. Devuelve **una única
fila** con los agregados de toda la historia no borrada:

| Columna | Contenido |
|---|---|
| `expense_total` | `sum(amount)` de gastos no borrados |
| `expense_count` | `count(*)` |
| `expense_by_category` | `jsonb`: `[{ category, total, count }]` ordenado por total desc |
| `expense_recent` | `jsonb`: los **5 gastos más recientes** (`[{ id, concept, category, amount, expenseDate, supplier }]`) |
| `invoice_total` | `sum(amount)` de facturas no borradas |
| `invoice_count` | `count(*)` |
| `invoice_open_amount` | `sum` donde `status = 'PENDING'` (pendiente + vencida, FN-5) |
| `invoice_paid_amount` | `sum` donde `status = 'PAID'` |
| `invoice_pending_count` | número de `PENDING` con `due_date >= hoy` |
| `invoice_overdue_count` | número de `PENDING` con `due_date < hoy` |

```sql
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
language plpgsql stable security definer set search_path = public, pg_temp
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
end
$$;
```

---

## 6. Políticas RLS

`02_rls.sql` deja en `expenses` una política y en `invoices` dos. `02j_finance.sql`
hace:

- **`expenses_admin_only`** (ALL, ADMIN): **se queda tal cual** como guarda
  gruesa. `app_runtime` ya solo tiene `select` sobre `expenses` (§grant).
- **`invoices_select_scoped`** (SELECT, ADMIN o cualquier miembro): **se
  elimina** y se sustituye por **`invoices_admin_only`** (SELECT, solo ADMIN),
  cerrando el hueco FN-13.
- **`invoices_write_admin`** (ALL): **se elimina** (FN-2).
- **Revokes sobre `invoices`**: `revoke insert, update, delete on invoices from
  app_runtime;` y la misma simetría que `02i_documents.sql` sobre `anon,
  authenticated`.
- Grants de `execute` para `app_runtime` (y `revoke` de `PUBLIC`) sobre las
  nueve funciones, incluyendo `app_invoice_effective_status` (las de `sql`
  `stable` no se ejecutan por PUBLIC: un atacante podría usarlas a coste del
  RLS si no tuviera la guarda de sesión, y la simetría `revoke from public` es
  barata y cubre roles futuros).

El `revoke` de `invoices` es la pieza imprescindible, no decorativa: quitar las
líneas de `02_rls.sql` no deshace un `GRANT` ya aplicado (mismo argumento que
AN-2 en la spec 07 y DN-2 en la 08).

---

## 7. Contrato HTTP

### 7.1 Las rutas — exactamente las nueve de `ARCHITECTURE.md` §6

```
GET    /api/v1/communities/:communityId/expenses          ?from&to&category
POST   /api/v1/communities/:communityId/expenses
GET    /api/v1/expenses/:id
PUT    /api/v1/expenses/:id
DELETE /api/v1/expenses/:id
GET    /api/v1/communities/:communityId/invoices
POST   /api/v1/communities/:communityId/invoices
POST   /api/v1/communities/:communityId/invoices/:invoiceId/pay
GET    /api/v1/communities/:communityId/finance/summary
```

Dos routers como los bloques 05–08: `createFinanceRouter()` montado en
`/api/v1/communities` con las seis rutas de comunidad (gastos listar/crear,
facturas listar/crear/pagar, resumen) y `createExpenseRouter()` montado en
`/api/v1` con las tres rutas de gasto por id. **Asimetría deliberada:**
`ARCHITECTURE.md` §6 da a las facturas rutas por `:id` **solo bajo**
`communities/:communityId` (listar, crear, pagar), y **no** hay `GET
/invoices/:id` (FN-13), ni `PUT` ni `DELETE` de facturas (FN-8). El `PUT` de
gastos es la primera edición que un bloque centrado trae desde el bloque 02.

### 7.2 Guardas

| Ruta | Guard |
|---|---|
| `GET /communities/:id/expenses` | `requireAuth` + `requireCommunity()` + `requireCommunityRole('ADMIN')`; la función re-comprueba (FN-1) |
| `POST /communities/:id/expenses` | idem |
| `GET /expenses/:id` | `requireAuth` + id con forma de UUID (si no, 400). Sin `requireCommunity()`: es `app_list_expenses()` con `p_expense` — cero filas → 404 (no existe, otra comunidad, borrado o no eres ADMIN; los cuatro, el mismo 404 de C-8) |
| `PUT /expenses/:id` | `requireAuth` + id UUID, sin guard de rol en la ruta: la función decide el 404 (`expense_not_found`) y el 403 (`expense_requires_admin`) |
| `DELETE /expenses/:id` | idem |
| `GET /communities/:id/invoices` | `requireAuth` + `requireCommunity()` + `requireCommunityRole('ADMIN')` |
| `POST /communities/:id/invoices` | idem |
| `POST /communities/:id/invoices/:invoiceId/pay` | idem (la ruta lleva `communityId` en la URL, así que existe `requireCommunity`) |
| `GET /communities/:id/finance/summary` | idem |

Por qué los no-ADMIN no se detienen fuera: el mismo error EN la función
garantiza que el RLS y las funciones cuenten la misma historia. El guard de ruta
es UX (evita llegar a PostgreSQL cuando ya se sabe) y la red es el `ADMIN` de la
función (DN-2), no al revés.

### 7.3 Cuerpos y validación

Todos los cuerpos son JSON (≤ 1 MB, el límite de `app.ts`). Validación con zod
en el borde, `.strict()` en todos los esquemas. El 22P02 de un enum inválido se
adelanta con `z.enum` (mismo motivo que en avisos/reservas).

`POST`/`PUT` gastos (alta y actualización comparten la forma FN-7; en el `PUT`
`supplier`/`notes`/`invoiceId` aceptan `null` para limpiar):

| Campo | Obligatorio | Reglas |
|---|---|---|
| `concept` | sí | 1–120 caracteres |
| `category` | no | enum `expense_category`, default `OTHER` |
| `amount` | sí | número `> 0`, ≤ 9 999 999 999,99 |
| `expenseDate` | sí | `YYYY-MM-DD` |
| `supplier` | no | ≤ 200; `''`/`null` → `null` |
| `invoiceId` | no | UUID; debe ser de la misma comunidad (FN-10) |
| `notes` | no | ≤ 1000; `''`/`null` → `null` |

`POST` factura:

| Campo | Obligatorio | Reglas |
|---|---|---|
| `number` | sí | 1–50 caracteres; único por comunidad (FN-12) |
| `concept` | no | ≤ 120 |
| `amount` | sí | número `> 0`, ≤ 9 999 999 999,99 |
| `issueDate` | sí | `YYYY-MM-DD` |
| `dueDate` | sí | `YYYY-MM-DD`; `superRefine` que `dueDate >= issueDate` |
| `supplier` | no | ≤ 200; `''`/`null` → `null` |

Querys:

- `GET /communities/:id/expenses`: `?from=` `?to=` (fechas `YYYY-MM-DD`, con
  `superRefine` `from <= to`), `?category=` (enum), `?page=` `?limit=`; `.strict()`
  (un `?q=` desconocido es un 400 que lo dice).
- `GET /communities/:id/invoices`: `?status=` (enum `invoice_status`, incluido
  `OVERDUE`, que filtra por el estado efectivo FN-14), `?page=` `?limit=`;
  `.strict()`.
- `finance/summary`: sin query.

`pay` no lleva cuerpo.

### 7.4 Respuestas

| Caso | HTTP | `code` | Cuerpo |
|---|---|---|---|
| Listar gastos | 200 | — | `{ data: [...], meta: { page, limit, total, totalPages } }` |
| Crear gasto | 201 | — | `{ data: gasto }` + `Location: /api/v1/expenses/{id}` |
| Detalle gasto | 200 | — | `{ data: gasto }` |
| Actualizar gasto | 200 | — | `{ data: gasto }` |
| Borrar gasto | 200 | — | `{ data: { id, deleted: true } }` |
| Listar facturas | 200 | — | `{ data: [...], meta }` (cada factura con `status` y `effectiveStatus`) |
| Crear factura | 201 | — | `{ data: factura }`. **Sin `Location`**: no existe `GET /invoices/:id` (FN-13), y un `Location` a una ruta inexistente es mentir |
| Pagar factura | 200 | — | `{ data: factura }` con `status: 'PAID'` y `paidAt` |
| Resumen | 200 | — | `{ data: { expenseTotal, expenseCount, expenseByCategory, expenseRecent, invoiceTotal, invoiceCount, invoiceOpenAmount, invoicePaidAmount, invoicePendingCount, invoiceOverdueCount } }` |
| No miembro (listar/crear/pagar/resumen) | 403 | `FORBIDDEN` | — |
| Miembro no-ADMIN (listar/crear/pagar/resumen) | 403 | `FORBIDDEN` | FN-1 |
| Miembro no-ADMIN (detalle gasto) | 404 | `NOT_FOUND` | FN-4: igual que no existe |
| Gasto/factura inexistente o borrado | 404 | `NOT_FOUND` | — |
| `PUT`/`DELETE` de un gasto de otra comunidad | 404 | `NOT_FOUND` | C-8 |
| `POST pay` de factura ya pagada | 409 | `INVOICE_ALREADY_PAID` | — |
| `POST pay` de factura cancelada | 409 | `INVOICE_CANCELLED` | — |
| Número de factura repetido en la comunidad | 409 | `INVOICE_NUMBER_TAKEN` | — |
| Cuerpo/query inválido | 400 | `VALIDATION_ERROR` | `details` campo a campo |
| `invoiceId` de otra comunidad | 400 | `EXPENSE_INVOICE_MISMATCH` | — |

El gasto/factura de las respuestas lleva el serializado camelCase del repo
(`expenseDate`, `createdAt`, …), incluyendo `invoiceNumber` en el gasto y
`effectiveStatus` en la factura. `amount` se serializa como número, no como
string (FN-9).

### 7.5 Traducción de errores

| sentinel | errcode | HTTP | message |
|---|---|---|---|
| `forbidden_role` | 42501 | 403 | Tu rol en esta comunidad no permite esta acción. |
| `expense_not_found` | P0002 | 404 | Ese gasto no existe o no es visible. |
| `expense_requires_admin` | 42501 | 403 | Solo un administrador puede gestionar gastos. |
| `expense_content_required` | 22023 | 400 | El concepto es obligatorio. |
| `expense_amount_invalid` | 22023 | 400 | El importe debe ser mayor que 0. |
| `expense_invoice_mismatch` | 22023 | 400 | La factura debe pertenecer a la misma comunidad. |
| `invoice_not_found` | P0002 | 404 | Esa factura no existe o no es visible. |
| `invoice_requires_admin` | 42501 | 403 | Solo un administrador puede gestionar facturas. |
| `invoice_content_required` | 22023 | 400 | El número de factura es obligatorio. |
| `invoice_amount_invalid` | 22023 | 400 | El importe debe ser mayor que 0. |
| `invoice_dates_invalid` | 22023 | 400 | El vencimiento no puede ser anterior a la emisión. |
| `invoice_number_taken` | U0001 | 409 | Ya existe una factura con ese número en esta comunidad. |
| `invoice_already_paid` | U0001 | 409 | Esa factura ya está pagada. |
| `invoice_cancelled` | U0001 | 409 | Una factura cancelada no se puede pagar. |
| `sin contexto de usuario` | 42501 | 401 | — |

Con el par sentinel + errcode (R-12): un `concept` del cliente que contenga la
cadena `invoice_not_found` no puede fabricar un 404. Los tres 409 comparten
errcode `U0001` (FN-12): la clase es "conflicto del bloque de finanzas", y la
traducción exige el sentinel para distinguirlos.

---

## 8. Estructura de archivos

```
backend/src/finance/
  routes.ts          # createFinanceRouter() (6 rutas de comunidad) +
                     #   createExpenseRouter() (3 rutas por id)
  controller.ts      # HTTP -> servicio (forma del cuerpo y de la query)
  service.ts         # orquesta: llamadas al repo, mapeo a envelope
  repository.ts      # $queryRaw -> app_*("")
  validators.ts      # schemas zod (alta/actualización gasto, factura,
                     #   listados, uuid)
  errors.ts          # P_tabla de traducción (sentinel + errcode, U0001)
  __tests__/         # unitarios: validators, errors
```

Montajes en `app.ts`:

```ts
app.use('/api/v1/communities', createFinanceRouter())
app.use('/api/v1', createExpenseRouter())
```

El seed toca dos secciones: **5/10 Facturas** (nueva) y **6/10 Gastos**
(renumerada; hoy es "5/9 Gastos" y el bloque 09 convierte las nueve secciones a
diez). Las facturas se crean **antes** que los gastos, para que el "Seguro de la
comunidad, primera cuota" se cree con `invoice_id` = la factura `INV-2026-001`
ya pagada: la FK de `expenses→invoices` (FN-10) se demuestra con datos. El
resumen final del seed añade el contador de facturas.

Datos de demo en la comunidad A:
- `INV-2026-001` — Seguro de la comunidad, primera cuota · 890,25 · fechada
  2026-01-10, vence 2026-02-10 · `PAID` (pagada 2026-02-01) · Mapfre · **es el
  `invoice_id` del gasto "Seguro"**.
- `INV-2026-002` — Limpieza de febrero · 480,00 · vence 2026-03-05 · `PENDING`
  (fecha pasada → se ofrece en el listado como `OVERDUE`, FN-5).
- `INV-2026-003` — Reparación del ascensor · 2 600,00 · vence 2026-11-15 ·
  `PENDING` (futura → `PENDING` de verdad).

Ningún objeto se sube a ningún bucket: finanzas no toca Storage.

---

## 9. Variables de entorno

**Ninguna nueva.** El bloque no usa Storage ni APIs externas. `env.ts` queda
intacto. (`expenses.invoice_id` se vincula a `invoices`, no a un documento:
"registrar la factura" del prompt §7.6 es vincular el pasivo, no subir un PDF;
el binario de una factura real usaría el bucket de documentos —bloque 08—, que
ya existe.)

---

## 10. Criterios de aceptación

### Permisos (FN-1)

- `ADMIN` lista, detalla, crea, edita y borra gastos; lista, crea y paga
  facturas; y lee el resumen de su comunidad.
- `NEIGHBOR`, `PRESIDENT` y `PROVIDER`: el **listado** de gastos, el de
  facturas, el `POST` de ambos, el `pay` y el `resumen` dan **403**.
- `NEIGHBOR`, `PRESIDENT` y `PROVIDER`: el **detalle** de un gasto da **404**,
  aunque el gasto exista y aunque conozcan el UUID (C-8).
- No miembro: listar/crear/pagar/resumen dan 403; detalle de gasto da 404.
- Un `ADMIN_SA` que no es miembro tampoco ve finanzas (misma asimetría que el
  resto del producto).

### Aislamiento

- Un `ADMIN` de A pidiendo `PUT`/`DELETE`/detalle de un gasto de B recibe 404,
  no 403 (C-8: `app_expense_community` exige membresía).
- `expense_id` de B colado en una creación de A → sea cual sea la factura, solo
  puede pertenecer a A (FN-10).
- `?category=` que no es del enum → 400, no 22P02 crudo.

### Facturas y estados

- `POST /invoices` con el mismo `number` en la misma comunidad → **409
  `INVOICE_NUMBER_TAKEN`**, no 500 (FN-12).
- El mismo `number` en comunidades **distintas** → 201 (la única es por
  comunidad).
- `dueDate < issueDate` → 400 con `details`.
- Una factura `PENDING` con `dueDate` pasada aparece con `effectiveStatus:
  'OVERDUE'` en el listado **y** con `?status=OVERDUE`.
- `POST pay`: primero 200 con `status: 'PAID'` y `paidAt`; segundo `POST` →
  **409 `INVOICE_ALREADY_PAID`**.
- El resumen cuenta como `invoiceOverdueCount` la vencida y como
  `invoicePendingCount` la futura; `invoiceOpenAmount` = vencida + pendiente.

### Gastos y `PUT`

- Crear gasto con `amount: 0` o negativo → 400 con `details`.
- `PUT /expenses/:id` reemplaza: cambiar `concept`/`amount`/`expenseDate` se ve
  al detallar; `invoiceId: null` desvincula la factura; `supplier: ''` lo deja
  en `null`.
- `PUT`/`DELETE` de un gasto ya borrado → 404 (borrado dos veces).
- Borrar un gasto lo saca del listado, del resumen y de los totales, pero la
  fila conserva su `deleted_at`.

### Contrato

- Toda respuesta es el sobre `{ data }` / `{ error: { code, message, details? } }`.
- `POST` gasto devuelve 201 con `Location: /api/v1/expenses/{id}`; `POST`
  factura 201 sin `Location` (no hay detalle).
- `amount` y los totales del resumen viajan como número, no como `"890.25"`.
- Paginación con `meta.total` real (esp. páginas más allá del final), igual que
  en los bloques 04–08.
- En `NODE_ENV=test`, `db:verify` falla si: falta cualquiera de las nueve
  funciones, alguna no es `SECURITY DEFINER`, `app_runtime` conserva
  `insert, update, delete` sobre `invoices`, la política `invoices_write_admin`
  sigue existiendo, o la política `invoices_select_scoped` (con su rama de
  miembros) no ha sido sustituida por `invoices_admin_only`.

---

## 11. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La rama de miembros de `invoices_select_scoped` deja escapar facturas antes del despliegue | Baja | Este bloque la sustituye en `02j_finance.sql` y `04_verify` exige su ausencia; los tests de integración comprueban que un vecino recibe 403/404 |
| `numeric` como string en `$queryRaw` se filtra al frontend | Media | El mapeo convierte a número (§4d); el test de contrato compare que la `data` es JSON number |
| Pagar dos veces como 200 silencioso (doble click de la UI) | Baja | FN-6: el segundo `POST pay` es un 409 explícito; el frontend lo tratará como estado ya alcanzado |
| `OVERDUE` viva en dos sitios (listado y resumen) y diverjan | Baja | FN-5: un único `app_invoice_effective_status()`; `04_verify` y los tests la ejercitan en ambos |
| Factura vinculada a un gasto y borrada en cascada | Baja | La FK es `on delete set null`: borrar la factura deja el gasto sin `invoice_id`, nunca rompe el gasto |
| Los `CHECK` `not valid` se aplican sin validar y quedan "mentira" | Baja | Mismo criterio que bloques 04/07/08: se documenta y la validación es un paso posterior explícito |
| Un `ADMIN` crea un gasto de 10 000 000 000,00 y rompe el JSON | Muy baja | El zod limita a 9 999 999 999,99 (FN-9); el `numeric(12,2)` aguanta exactamente eso |

---

## 12. Decisiones del desarrollador

### D-1: dos routers, el patrón de los bloques 05–08

`createFinanceRouter()` para las seis rutas con `:communityId` en la URL (pueden
usar `requireCommunity` + `requireCommunityRole('ADMIN')`) y
`createExpenseRouter()` para las tres por id (sin comunidad en la URL, deciden
las funciones). Montados en dos `app.use` distintos. Las rutas se escriben
**completas** dentro del router, como hace `members/routes.ts`.

### D-2: el resumen devuelve una fila, no un set

`app_finance_summary` es `returns table(…)` **de una fila**, no `setof`. El
backend mapea esa fila a un único objeto y `404 no aplica aquí: es un agregado,
no una entidad. Los `count(*)` y `sum` vacíos no pueden devolver cero filas
porque el `coalesce` y los sub-select de §5.10 garantizan la fila.

### D-3: incluido el id del gasto en los `recent`

`expense_recent` lleva el `id`: aunque un dashboard fututo lo pinte, el frontend
podrá navegar al detalle (`GET /expenses/:id`) sin re-listar. Al ser ADMIN-only,
no es una fuga.

### D-4: el seed cambia "9 secciones" a 10, y las facturas van antes que los gastos

Renumerar "5/9 Gastos → 6/10 Gastos" y meter "5/10 Facturas" delante permite que
el gasto del seguro se cree **con** su `invoice_id` (FN-10) en el mismo
`createMany`, en vez de un `update` posterior. Es el único bloque que reordena
secciones; no rompe nada salvo los `console.log` que se tocan.

### D-5: `invoice_effective_status` también se revoca de PUBLIC

Las funciones `sql stable` de este bloque (5.1, 5.2, 5.6, 5.7, 5.10) podrían
ejecutarse sin sesión si quedara `PUBLIC` con `execute`. La guarda de
`app_current_user_id()` está dentro, pero el `revoke from public` (con el
`grant` solo a `app_runtime` después) es la pieza de deny-by-default que todos
los bloques aplican, y añadir el rol a una lista que hay que recordar —en vez de
revocar al grupo— es cómo aparecen los huecos.

### D-6: `pay` idempotente con 409, no con 200

FN-6. Alternativa considerada: un segundo `pay` como `200` (idempotencia de
leer-el-estado). Se descartó porque el 409 es más informativo para el cliente
(no confunde "lo hice" con "ya estaba"), y porque el único coste —reintentos
AI/UX— se mitiga tratando `INVOICE_ALREADY_PAID` como un "ya está" en el
frontend.

---

## 13. Fuera de alcance

- **Facturas de cuotas por vecino** (cuotas, recibos a vecinos): exige añadir
  `user_id` al esquema; FN-13. La política de membresía de `02_rls.sql` queda
  deliberadamente sustituida hasta entonces.
- **Generación de facturas** (`is_generated`) ni **presupuestos**: la tabla
  `invoices` guarda el pasivo, no se auto-genera ni se comparan presupuestos.
- **Ficheros adjuntos a gastos/facturas**: un PDF de factura es un documento
  (bloque 08) con su ACL; vincularlo a `expenses.invoice_id` es un cruce de
  modelo futuro.
- **Pagos reales / integraciones bancarias**.
- **`CANCELLED` por API**: no hay ruta en `ARCHITECTURE.md` §6; solo se alcanza
  por SQL directo (la guarda de `pay` lo respeta).
- **Cancelación/PATCH de facturas** y **edición de facturas** (`PUT
  /invoices/:id`): no existen en la arquitectura.
- **Dashboard visual** (Recharts): fase 10; este bloque entrega solo el
  endpoint del resumen.
- **Herramientas IA/MCP de finanzas** (`get_expenses`, `get_invoices`,
  `get_finance_summary` de `ARCHITECTURE.md`): son de las fases 12/14; este
  bloque crea las funciones de lectura que esas herramientas reutilizarán.
- **UI** en general.