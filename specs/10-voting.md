# Spec 10 — Votaciones

> **Estado: IMPLEMENTED.** Las decisiones V-1 a V-14 de §2 y las seis decisiones
> de §12 (D-1 a D-6) están cerradas y en pie. Este spec usa la nomenclatura
> **V-1 a V-14** para esta etapa.
> **Fase:** 10 (votaciones comunitarias: crear, participar, cerrar y consultar
> resultados). Precedida de `01-authentication` … `09-finance`.
> **Base de datos:** `supabase/sql/01_schema.sql` (las tablas `votes` §4.14,
> `vote_options` §4.15 y `vote_responses` §4.16 ya existen, con sus tres enums),
> `02_rls.sql` (§5.14-§5.16, y los GRANT de `app_runtime`) y `02k_voting.sql`
> (archivo nuevo, en este bloque).
> **Backend:** `backend/src/voting/`.
>
> Este spec define las **votaciones de la comunidad**: la pregunta ("¿Instalar
> cámaras en el parking?", prompt §7.7), sus opciones (Sí / No / Abstención), un
> voto por vecino, el ciclo de vida borrador→abierta→cerrada, el quórum
> opcional y los resultados. Su decisión de fondo es la contraria a la del
> bloque 09: aquí la visibilidad es **de todos los vecinos** y lo que se protege
> no es el acceso, sino el **secreto del voto** (V-2).

---

## 1. Objetivo

Que el PRESIDENT o un ADMIN **cree una votación** (título, pregunta, descripción,
fecha de inicio, fecha de fin, opciones y ajustes), la **publique** cuando esté
lista, que cada miembro de la comunidad **vote una sola vez** (y pueda cambiar de
voto mientras esté abierta), que se pueda **cerrar** antes de tiempo, y que al
final todos vean unos **resultados** (recuento por opción, participación y, si la
votación es de tipo `QUORUM`, si se ha alcanzado el quórum) — sin que **nadie**,
ni la administración, pueda ver cómo votó un vecino concreto.

Tres piezas, todas en una fase:

1. **Votaciones** (`votes` + `vote_options`): el borrador editable, la
   publicación, el cierre y las opciones (incluida la de abstención, que genera
   el sistema).
2. **El voto** (`vote_responses`): un voto por usuario, garantizado por
   `vote_responses_unique_vote_uidx`, que "cambiar de voto" convierte en un
   *upsert* y no en un borrado.
3. **Resultados**: los agregados (`/results`) y su exportación a CSV
   (`/results/export`), ambos con la misma regla de visibilidad y sin exponer
   jamás una fila individual.

Fuera de alcance: **voto ponderado** (la columna `weight` se queda en 1 y no se
expone como ajuste); **voto múltiple** (`type` `MULTIPLE` no existe en el enum:
véase V-8); **voto delegado o por poder**; **papeleta firmada o verificable**
(si el vecino pudiera demostrar su voto, dejaría de ser secreto); **crear
notificaciones** `VOTE_OPEN`/`VOTE_CLOSED` al publicar/cerrar (aunque el enum
las tenga, el bloque de notificaciones no está construido); **herramientas
IA/MCP** (`get_votes`, `get_vote_results`); el **dashboard visual** (fase 11); y
cualquier **UI**.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **V-1** | **Ven las votaciones y pueden votar todos los miembros activos salvo `PROVIDER`**; las **gestionan** (crear, editar, publicar, cerrar) solo `PRESIDENT` y `ADMIN` | Que solo la gestión vea las votaciones; que `PROVIDER` vote | El prompt da a NEIGHBOR "Participar en votaciones" y a PRESIDENT/ADMIN "Gestionar votaciones"; la matriz de `ARCHITECTURE.md` §5 da "Votar: NEIGHBOR ✅ PRESIDENT ✅ ADMIN ✅ PROVIDER —". Un `PROVIDER` es un profesional externo cuyas capacidades son "sus trabajos asignados" (prompt §roles): no participa en el gobierno de la comunidad, así que tampoco lo ve. Gestionar sin votar no tiene sentido: quien gestiona (PRESIDENT/ADMIN) está en la lista de "Votar ✅" |
| **V-2** | **Papeleta secreta: ningún voto individual se expone por la API, ni a `ADMIN` ni a `PRESIDENT`.** Solo recuentos agregados, y solo a través de `app_vote_results()` (`SECURITY DEFINER`) | Que la administración lea los votos individuales "para el recuento" | Es la decisión central del bloque. El comentario de `02_rls.sql:730` ya diseñó que "la lectura [para recuento] pasa por una función SECURITY DEFINER y no por la política general", pero dejó la rama `or app_is_admin_of(...)` en la política SELECT de `vote_responses`, que permite enumerar votos a quienes tengan el rol. Este bloque **elimina esa rama**: la política pasa a "solo el propio voto" y el recuento lo hace una función que solo devuelve sumas. Sin esto, "secreto de voto" es una promesa de la interfaz, no del backend (y el enunciado exige que la autorización se valide SIEMPRE en backend) |
| **V-3** | **Toda escritura pasa por funciones `SECURITY DEFINER`**; se revoca `insert, update, delete` sobre `votes`/`vote_options` y `insert, update` sobre `vote_responses` a `app_runtime`, y se eliminan las políticas de escritura | Dejar las políticas `votes_write_leadership`, `options_write_leadership` y las dos de `vote_responses` y escribir con Prisma | Mismo argumento que FN-2 (spec 09), DN-2 (08), AN-2 (07) y CA-6 (05): las políticas no pueden (a) garantizar "un solo voto, y solo en la ventana abierta" con la semántica de fecha de `starts_at`/`ends_at`, (b) re-sincronizar la opción de abstención, ni (c) resolver el `DELETE+INSERT`/upsert de manera atómica. Las funciones sí |
| **V-4** | La lista y el detalle son **una sola función**: `app_list_votes()` | `app_get_vote()` separada | Es la misma relación que FN-3 y AN-3: un único predicado de visibilidad escrito una vez. El detalle por id es la misma función con `p_vote` puesto; dos lectores serían dos copias del predicado que pueden divergir |
| **V-5** | El **listado** da **403** a quien no puede ver votaciones (no-miembro o `PROVIDER`); el **detalle por id** da **404** para una votación no visible (borrador no publicado por quien no gestiona, otra comunidad, borrada, o `PROVIDER`/no-miembro) | 403 en el detalle | Listar dice "hay votaciones aquí", por eso un no-miembro (o un `PROVIDER`) recibe 403 (C-8, como avisos y documentos). El detalle por id **no** confirma existencia (C-8): un NEIGHBOR que pida el detalle de un **borrador** recibe 404, el mismo que "no existe"; no se puede distinguir "existe pero es un borrador" de "no existe" |
| **V-6** | Ciclo de vida: `DRAFT → OPEN` con **publish**; `OPEN → CLOSED` con **close**; y una `OPEN` con `now() >= ends_at` se **lee** como `CLOSED` (`app_vote_effective_status()`), sin escribir nada | Un job que pase `OPEN` a `CLOSED` al vencer | No hay jobs en el proyecto (D-4 de la spec 08; FN-5 de la 09). La columna guarda el estado real; la lectura deriva el vencimiento. `DRAFT` nunca vence: solo cambia por `publish`. Cerrar a mano una `OPEN` antes de su `ends_at` es un cierre anticipado válido |
| **V-7** | `PATCH /votes/:id` es **parcial y solo sobre un `DRAFT`**; un voto publicado o cerrado es **inmutable** | Un `PUT` de reemplazo; permitir editar la pregunta después de publicar | `ARCHITECTURE.md` §6 dice `PATCH`, no `PUT`. Editar una votación ya publicada cambiaría la pregunta bajo los pies de quien ya votó; se rechaza con 409 `VOTE_NOT_DRAFT`. Los campos editables son título, pregunta, descripción, tipo, fechas, abstención, quórum, visibilidad y **las opciones** (reemplazo completo de la lista) |
| **V-8** | `type` admite **`SINGLE`** (gana la opción más votada) y **`QUORUM`** (exige quórum); `MULTIPLE` **no existe** | Implementar `MULTIPLE` porque lo dibuja el diagrama de `ARCHITECTURE.md` §11 | El enum real de `01_schema.sql:111` es `vote_type as enum ('SINGLE', 'QUORUM')`. El diagrama de datos menciona `SINGLE|MULTIPLE|QUORUM` y el índice `vote_responses_unique_vote_uidx (vote_id, user_id)` impone **un voto por usuario**: el voto múltiple sería incompatible con el esquema. Se documenta la divergencia diagrama↔enum y se implementa lo que el esquema permite |
| **V-9** | `quorum_percent` es **obligatorio si y solo si** `type = 'QUORUM'` (1-100) y **null** si `SINGLE`; `quorumMet = participationPercent >= quorum_percent`. Elegibles = **miembros activos no `PROVIDER`** | Exigir quórum siempre; contar a los `PROVIDER` como elegibles | El `CHECK votes_quorum_valid` permite `null` o `1..100`, y una votación `SINGLE` sin exigencia de participación no necesita el número. Contar como elegible a quien no puede votar (el `PROVIDER`) haría imposible alcanzar el 100 % |
| **V-10** | La **abstención** es una opción del sistema: con `allow_abstention = true` la función **añade** `{ label: 'Abstención', position: n+1, is_abstention: true }`; el cliente solo envía las opciones **reales** (mínimo 2) | Que el cliente mande la abstención como una opción más | El prompt §7.7 la pinta como una tercera opción fija. Generarla evita que dos clientes la etiqueten distinto ("Abstencion", "Me abstengo") y que el recuento dependa de un texto. La abstención se cuenta **aparte** (no es un voto a favor ni en contra) y se puede excluir de los porcentajes si el cliente quiere |
| **V-11** | **Un voto por usuario con *upsert***: `POST /votes/:id/responses` hace `insert … on conflict (vote_id, user_id) do update set option_id = excluded.option_id` | Un `DELETE+INSERT` explícito; o permitir varios votos | El índice `vote_responses_unique_vote_uidx (vote_id, user_id)` ya impone la unicidad (comentario de `01_schema.sql:583`). El `ON CONFLICT` sobre esa clave no depende de la semántica de `option_id` (a diferencia de un upsert sobre `(vote_id, user_id, option_id)`, que sí lo haría) y el comentario de `02_rls.sql:774` describe exactamente este upsert. "Cambiar de voto" es la misma fila actualizada, no un borrado |
| **V-12** | **Visibilidad de resultados:** `ADMIN` y `PRESIDENT` los ven **siempre**; un miembro normal los ve según `result_visibility` — `LIVE` mientras la votación sea visible, `AFTER_CLOSE` solo **tras** el cierre, `ADMIN_ONLY` **nunca** | `ADMIN_ONLY` = solo `ADMIN` (sin `PRESIDENT`); resultados ocultos también a la gestión antes del cierre | La matriz de `ARCHITECTURE.md` §5 da `PRESIDENT ✅` y `ADMIN ✅` en "Ver resultados (antes de cierre)"; gestionar una votación sin poder ver su progreso sería incoherente. Se lee `ADMIN_ONLY` como "solo la gestión", no "solo el rol ADMIN". Alternativa descartada y confirmada por el usuario el 2026-10-13 |
| **V-13** | El export es **CSV de solo el recuento** (`text/csv`, tres columnas `opción,votos,porcentaje`), con la **misma visibilidad** que `/results` y **sin filas individuales** | Un CSV con una fila por voto (vecino, opción, fecha) | Un CSV por voto rompe la papeleta secreta (V-2) al primer `descargar`. La exportación es del **resultado**, no del escrutinio. Rompe el sobre `{ data }` (como la descarga de documentos, bloque 08); se documenta en `API.md` |
| **V-14** | **No hay `DELETE /votes/:id`**: la API no borra votaciones. La columna `deleted_at` existe y **todas las lecturas la respetan**, pero ninguna ruta la escribe | Añadir un `DELETE` porque `votes` tiene `deleted_at` | `ARCHITECTURE.md` §6 lista exactamente nueve rutas de votación y ninguna es `DELETE` (como pasó con `invoices` en FN-8). Un borrador indeseado se "abandona" (se queda en `DRAFT`, invisible para la comunidad); si de verdad hay que quitarlo, se decide en su spec. El `deleted_at` queda preparado para un borrado por SQL |

---

## 3. Estado real del modelo de datos

Verificado contra `01_schema.sql`, `02_rls.sql` y `prisma/schema.prisma` hoy.

### 3.1 `votes`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `community_id` | `uuid not null → communities(id)` | `on delete cascade`. Eje del aislamiento |
| `title` | `text not null` | **Sin `CHECK` de longitud.** Este bloque lo añade (§4a) |
| `question` | `text not null` | **Sin `CHECK` de longitud.** Este bloque lo añade (§4a) |
| `description` | `text` | Nullable. Sin `CHECK` de longitud (§4a) |
| `type` | `vote_type not null default 'SINGLE'` | `SINGLE, QUORUM` (no hay `MULTIPLE`, V-8) |
| `status` | `vote_status not null default 'DRAFT'` | `DRAFT, OPEN, CLOSED`. `CLOSED` puede derivarse por fecha sin persistirse (V-6) |
| `starts_at` | `timestamptz not null` | Inicio de la ventana de voto |
| `ends_at` | `timestamptz not null` | `check (votes_dates_valid: ends_at > starts_at)` |
| `allow_abstention` | `boolean not null default true` | V-10: genera la opción de abstención |
| `quorum_percent` | `integer` | `check (votes_quorum_valid: null or 1..100)`. Obligatorio si `type = 'QUORUM'` (V-9) |
| `result_visibility` | `vote_result_visibility not null default 'AFTER_CLOSE'` | `AFTER_CLOSE, LIVE, ADMIN_ONLY` (V-12) |
| `created_by` | `uuid → users(id)` | `on delete set null`. Sale de la sesión, nunca del cuerpo |
| `closed_at` | `timestamptz` | Lo escribe `app_close_vote()` |
| `deleted_at` | `timestamptz` | V-14: ninguna ruta lo escribe; todas las lecturas lo respetan |
| `created_at`, `updated_at` | `timestamptz not null default now()` | Trigger establecido en `04_verify.sql` §6 |

Índices existentes: `votes_community_status_idx` (`(community_id, status, ends_at)` con `where deleted_at is null`).

### 3.2 `vote_options`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `vote_id` | `uuid not null → votes(id)` | `on delete cascade` |
| `label` | `text not null` | **Sin `CHECK` de longitud.** Este bloque lo añade (§4a) |
| `position` | `integer not null` | `@@unique(vote_id, position)` (`vote_options_vote_position_uidx`) |
| `is_abstention` | `boolean not null default false` | V-10: una sola opción con `true` por votación (la genera el sistema) |
| `created_at`, `updated_at` | `timestamptz not null default now()` | |

Índices: `vote_options_vote_position_uidx (vote_id, position)` y
`vote_options_vote_label_uidx (vote_id, lower(label))` — este último es la
garantía de "no hay dos opciones iguales" (V-10, duplicados → 400).

### 3.3 `vote_responses`

| Columna | Tipo real | Notas |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `vote_id` | `uuid not null → votes(id)` | `on delete cascade` |
| `option_id` | `uuid not null → vote_options(id)` | `on delete cascade`. **No** se comprueba en la FK que la opción sea de la misma votación: lo hace la función (§4b) |
| `user_id` | `uuid not null → users(id)` | `on delete cascade`. Sale de la sesión |
| `weight` | `integer not null default 1` | `check (vote_responses_weight_valid: weight > 0)`. Fuera de alcance como ajuste: siempre 1 |
| `created_at`, `updated_at` | `timestamptz not null default now()` | `updated_at` se actualiza en el *upsert* (V-11) |

Índices: `vote_responses_unique_vote_uidx (vote_id, user_id)` — el "un voto por
usuario" —, `vote_responses_option_idx (option_id)` y `vote_responses_user_idx (user_id)`.

### 3.4 Nada se crea en el esquema

`02k_voting.sql` no crea tablas ni columnas: solo funciones, permisos, el
reemplazo de las políticas de lectura (V-2) y de escritura (V-3) y los `CHECK`
de longitud de §4a. Las tablas, los enums, los índices y las FKs ya vienen
completos de `01_schema.sql`.

---

## 4. El problema del arranque

### a) `title`, `question`, `description` y `label` no tienen longitud

Igual que en `02i_documents.sql` §4a y `02j_finance.sql` §4a: el `not null` no
impide el `''`. Se añaden los `CHECK` con `not valid` (aplican a filas nuevas sin
fallar sobre las del seed ni las demos; validar es un paso posterior):

```sql
alter table votes
  add constraint votes_title_length
  check (char_length(title) between 1 and 120) not valid;

alter table votes
  add constraint votes_question_length
  check (char_length(question) between 1 and 200) not valid;

alter table votes
  add constraint votes_description_length
  check (character_length(description) between 1 and 1000) not valid;

alter table vote_options
  add constraint vote_options_label_length
  check (char_length(label) between 1 and 120) not valid;
```

`title` de 120 (una cabecera), `question` de 200 (la pregunta —el ejemplo del
prompt cabe de sobra—), `description` de 1000 y `label` de 120 (una opción no
necesita más). Los rangos los repite el zod de forma independiente.

Hay además **dos invariantes de dominio** que el esquema no impone y que las
funciones sí: `quorum_percent` no nulo exige `type = 'QUORUM'` (y al revés,
V-9), y `is_abstention = true` exige un único registro por votación. Se
comprueban en `app_set_vote_options()` / `app_create_vote()` / `app_update_vote()`
y no como `CHECK` porque un `CHECK` no puede mirar el `type` de otra fila ni
contar hermanas sin una subconsulta (que Postgres no admite en un `CHECK`).

### b) La FK `option_id` no comprueba que la opción sea de la votación

`vote_responses.option_id → vote_options(id)` garantiza que la opción existe,
pero **no** que pertenezca a la misma `vote_id` que la respuesta. Un cliente
podría colar la opción de la votación B en un voto de la votación A. Es un
cruce entre votaciones de la misma comunidad (nunca entre comunidades: la
autorización de `app_cast_vote()` deriva la comunidad de `p_vote`), pero rompe
el recuento. Lo comprueba `app_cast_vote()` con `vote_option_invalid` (§5.9,
§7.5 → 400 `VOTE_OPTION_INVALID`).

### c) `votes_select_member` deja ver los borradores a cualquier miembro

La política de lectura de `02_rls.sql:675` es `for select using
(app_is_member_of(community_id))`: **cualquier** miembro activo —incluido un
`PROVIDER`— leería las filas de una votación **`DRAFT`**, con su título y su
pregunta, antes de que la comunidad la conozca. La política de opciones
(`options_select_visible_vote`) sí excluye los borradores, pero la tabla padre
no. Este bloque **sustituye** `votes_select_member` por una lectura consciente
del estado: fuera de `DRAFT` para todos, `DRAFT` solo para PRESIDENT/ADMIN, y
excluyendo a `PROVIDER` (V-1). Es el hueco de "over-exposure" del bloque, como
`invoices_select_scoped` lo fue en el 09 (FN-13).

### d) No hay estado "vencida" para una votación abierta

El enum tiene `DRAFT/OPEN/CLOSED`, pero nada (ningún job) pasa a `CLOSED` una
votación abierta cuyo `ends_at` ya ha llegado. Decisión V-6: se deriva en lectura
con `app_vote_effective_status()` (una función `stable` compartida por el listado
y los resultados, para que no divergan), igual que `OVERDUE` en finanzas (FN-5).
La columna sigue guardando `OPEN`; el cierre real (`close`) escribe `CLOSED` con
`closed_at`.

### e) El `weight` de `vote_responses` y el voto ponderado

La columna `weight` (con `CHECK weight > 0`) sugiere voto ponderado (una
participación que vale más que otra). El bloque 10 **no lo usa**: se inserta
siempre `weight = 1` (el `default`), no se acepta del cuerpo y el recuento
cuenta filas, no suma de pesos. Queda documentado para el futuro; el recuento de
`app_vote_results()` cuenta `count(*)`, no `sum(weight)`, para que activar el
peso más adelante sea una decisión explícita y no un cambio de comportamiento
silencioso.

---

## 5. Funciones

Las once de `02k_voting.sql`, todas `SECURITY DEFINER` con
`search_path = public, pg_temp`, no ejecutables por `PUBLIC`, con `execute` solo
para `app_runtime`. Todas devuelven errores con **sentinel + `errcode`** (§7.5).

### 5.1 `app_vote_community(p_vote uuid) returns uuid`

La pieza de visibilidad del bloque: devuelve el `community_id` de la votación
solo si existe, **no está borrada**, el actor es un **miembro activo que no sea
`PROVIDER`** (V-1) y, si la votación es un **borrador**, el actor es
**PRESIDENT/ADMIN** (V-5, §4c). `NULL` en cualquier otro caso.

Es la misma pieza que `app_announcement_community` (spec 07) y
`app_expense_community` (spec 09): quien la llama dentro de SQL son los
mutadores, con `NULL` → `vote_not_found` → 404; y el middleware `requireVote()`
la usa para resolver la comunidad de las rutas por id. El `app_is_member_of` (y
no un role-check de gestión) mantiene C-8: un no-miembro no puede ni confirmar
que la votación existe. Que un NEIGHBOR vea una votación abierta no le da
permiso para editarla: eso lo decide cada operación con `app_is_leadership_of()`.

```sql
create or replace function app_vote_community(p_vote uuid) returns uuid
language sql stable security definer set search_path = public, pg_temp
as $$
  select v.community_id
    from votes v
   where v.id = p_vote
     and v.deleted_at is null
     and app_is_member_of(v.community_id)
     and app_role_in(v.community_id) in ('NEIGHBOR', 'PRESIDENT', 'ADMIN')
     and (v.status <> 'DRAFT'
          or app_role_in(v.community_id) in ('ADMIN', 'PRESIDENT'))
$$;
```

### 5.2 `app_is_leadership_of(p_community_id uuid) returns boolean`

La guarda de "crear/editar/publicar/cerrar" (V-1). `true` si el actor es miembro
activo con rol `PRESIDENT` o `ADMIN` en esa comunidad. No existe hoy un helper
equivalente (hay `app_is_admin_of` y `app_role_in` por separado); se añade aquí
porque lo usan cinco funciones y escribirlo cinco veces invita a que una se
olvide de la membresía.

```sql
create or replace function app_is_leadership_of(p_community_id uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select app_is_member_of(p_community_id)
     and app_role_in(p_community_id) in ('ADMIN', 'PRESIDENT')
$$;
```

### 5.3 `app_vote_effective_status(p_status vote_status, p_ends_at timestamptz) returns vote_status`

La derivación de V-6, una sola vez: `stable` (usa `now()`), compartida por
`app_list_votes()` y `app_vote_results()`. `DRAFT` y `CLOSED` se quedan como
están; una `OPEN` con `now() >= ends_at` se lee `CLOSED`.

```sql
create or replace function app_vote_effective_status(
  p_status vote_status,
  p_ends_at timestamptz
) returns vote_status
language sql stable security definer set search_path = public, pg_temp
as $$
  select case
    when p_status = 'OPEN' and now() >= p_ends_at then 'CLOSED'::vote_status
    else p_status
  end
$$;
```

### 5.4 `app_set_vote_options(p_vote uuid, p_options jsonb) returns void`

La única pieza que escribe `vote_options` (V-10, D-3), compartida por
`app_create_vote()` y `app_update_vote()`. Recibe la lista de **opciones reales**
(un array JSON de cadenas) o `null`:

- Si `p_options` **no es null**: exige ≥ 2 opciones, ninguna vacía tras `btrim`,
  ninguna repetida (`lower(btrim())`) y ninguna igual a `'Abstención'` cuando la
  votación permite abstención; **borra** las opciones de la votación y las
  **reinserta** con `position` 1..n y `is_abstention = false`.
- A continuación **sincroniza la abstención** con el `allow_abstention` actual de
  la fila: si es `true` y no hay opción de abstención, la inserta al final; si es
  `false`, borra la que hubiera.
- Comprueba al final que quedan ≥ 2 opciones reales.

Con `p_options = null` la llamada solo re-sincroniza la abstención (lo que hace
el `PATCH` que solo cambia `allowAbstention`).

```sql
create or replace function app_set_vote_options(p_vote uuid, p_options jsonb)
returns void
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
declare
  v_allow boolean;
  v_count integer;
begin
  select allow_abstention into v_allow from votes where id = p_vote;

  if p_options is not null then
    v_count := jsonb_array_length(p_options);

    if v_count < 2 then
      raise exception 'vote_options_invalid: se necesitan al menos dos opciones'
        using errcode = '22023';
    end if;

    if exists (
      select 1 from jsonb_array_elements_text(p_options) as e(valor)
       where btrim(e.valor) = ''
    ) then
      raise exception 'vote_options_invalid: las opciones no pueden estar vacías'
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
      raise exception 'vote_option_duplicate: ''Abstención'' la genera el sistema'
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
end
$$;
```

Nota: el `delete` + `insert` solo se ejecuta con `p_options` no nulo y solo sobre
un `DRAFT` (lo garantiza el mutador que llama, §5.6/§5.7). Un `DRAFT` no tiene
respuestas, así que el `on delete cascade` de `vote_responses.option_id` no
destruye ningún voto: reemplazar opciones en un borrador es seguro.

### 5.5 `app_list_votes(...) returns table(...)`

**La única lectura de votaciones** (V-4): listado de la comunidad con filtro por
estado efectivo y paginación, y detalle por id. Guardas:

1. `app_current_user_id()` presente; si no, `42501`.
2. Si `p_vote is null` (listado): no-miembro **o** `PROVIDER` → `forbidden_role`
   (403). V-5: listar confirma que hay votaciones.
3. Predicado de filas: `deleted_at is null`; id/comunidad/estado efectivo; y
   `app_vote_community(v.id) is not null` — el único predicado de visibilidad
   (borrador no publicado, `PROVIDER`, otra comunidad y borrada se caen aquí).
4. Orden `v.starts_at desc, v.id` y paginación idéntica al resto de bloques.

Añade `created_by` + `created_by_name` (left join a `users`, la misma excepción
acotada de los bloques 03-09), `options` (jsonb agregado por posición),
`my_option_id` (la opción que **este** actor eligió, o null) y el `status`/`effective_status`
de V-6. El detalle por id no lleva `p_community_id`: el filtro es la pertenencia
de la fila, y quien no puede verla recibe cero filas → 404 (V-5).

```sql
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
language plpgsql stable security definer set search_path = public, pg_temp
as $$
begin
  if app_current_user_id() is null then
    raise exception 'sin contexto de usuario' using errcode = '42501';
  end if;

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
end
$$;
```

### 5.6 `app_create_vote(...) returns uuid`

La crea **siempre en `DRAFT`** (publicar es un paso explícito, V-6). `created_by`
sale de la sesión (nunca del cuerpo). Guardas en orden:

1. `app_current_user_id()` presente; si no, `42501`.
2. `app_is_leadership_of(p_community_id)`; si no, `forbidden_role`
   (`42501` → 403). El backend ya pone `requireCommunityRole('PRESIDENT','ADMIN')`;
   esta es la red.
3. `p_title` y `p_question` presentes tras `btrim` → `22023` `vote_content_required`.
4. `p_starts_at < p_ends_at` → `vote_dates_invalid` (`22023`) — red para el
   `CHECK votes_dates_valid`.
5. `type = 'QUORUM'` exige `quorum_percent` 1-100 → `vote_quorum_invalid`
   (`22023`); `type = 'SINGLE'` fuerza `quorum_percent = null` (V-9).
6. Inserta la votación y delega las opciones en `app_set_vote_options(v_id, p_options)`
   (§5.4), que valida el mínimo, los duplicados y añade la abstención (V-10).

```sql
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
language plpgsql volatile security definer set search_path = public, pg_temp
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
    raise exception 'forbidden_role: solo la presidencia o un administrador gestiona votaciones'
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
end
$$;
```

### 5.7 `app_update_vote(p_vote uuid, p_patch jsonb) returns setof votes`

El `PATCH` parcial (V-7), **solo sobre un `DRAFT`**. Recibe un objeto JSON con
**solo las claves presentes** en el cuerpo (D-3): el servicio no manda las
ausentes, así que la función distingue "no lo has enviado" (se queda como está)
de "lo has mandado" (se escribe). Guardas en orden:

1. `app_vote_community(p_vote)`; `NULL` → `vote_not_found` (`P0002` → 404). Un
   borrador es visible aquí solo para la gestión, así que un NEIGHBOR ya recibe 404.
2. `app_is_leadership_of(v_community)`; si no, `vote_requires_leadership`
   (`42501` → 403).
3. Estado almacenado **`DRAFT`**; si no, `vote_not_draft` (`U0001` → 409): un
   voto publicado o cerrado es inmutable (V-7).
4. Se aplican las claves presentes. `title`/`question` presentes no pueden quedar
   vacíos (`vote_content_required`). Las fechas resultantes exigen
   `ends_at > starts_at` (`vote_dates_invalid`). Si el `type` resultante es
   `QUORUM`, el `quorum_percent` resultante debe ser 1-100 (`vote_quorum_invalid`);
   si es `SINGLE`, se fuerza `null`.
5. Si viene `options`, se delega en `app_set_vote_options(p_vote, p_options)`.
   En cualquier caso se llama con `null` para re-sincronizar la abstención con el
   `allow_abstention` resultante.
6. Devuelve la fila (`setof votes`), como `app_update_expense` / `app_update_announcement`.

```sql
create or replace function app_update_vote(p_vote uuid, p_patch jsonb)
returns setof votes
language plpgsql volatile security definer set search_path = public, pg_temp
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

  if p_patch ? 'type'             then v_type   := (p_patch ->> 'type')::vote_type; end if;
  if p_patch ? 'startsAt'         then v_starts := (p_patch ->> 'startsAt')::timestamptz; end if;
  if p_patch ? 'endsAt'           then v_ends   := (p_patch ->> 'endsAt')::timestamptz; end if;
  if p_patch ? 'allowAbstention'  then v_allow  := (p_patch ->> 'allowAbstention')::boolean; end if;
  if p_patch ? 'quorumPercent'    then v_quorum := nullif(p_patch ->> 'quorumPercent', '')::integer; end if;

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
end
$$;
```

Nota: `p_patch -> 'options'` es `NULL` (SQL) tanto si la clave no está **como si
su valor es `null` JSON**. En `PATCH` nunca se manda `options: null`, así que el
único caso que llega es "viene un array" (reemplazo) o "no viene" (solo
sincronizar la abstención). El zod lo garantiza (§7.3).

### 5.8 `app_publish_vote(p_vote uuid) returns setof votes`

`DRAFT → OPEN` (V-6). Guardas:

1. `app_vote_community(p_vote)`; `NULL` → `vote_not_found` (`P0002`).
2. no gestión → `vote_requires_leadership` (`42501`).
3. Estado actual: si **no** es `DRAFT`, `vote_not_draft` (`U0001` → 409). No se
   puede "republicar" una abierta ni revivir una cerrada.
4. `update … set status = 'OPEN', updated_at = now() where id and status =
   'DRAFT'`; si `not found` (carrera con otro publish/close), `vote_not_draft`.
5. Devuelve la fila.

```sql
create or replace function app_publish_vote(p_vote uuid) returns setof votes
language plpgsql volatile security definer set search_path = public, pg_temp
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
end
$$;
```

### 5.9 `app_close_vote(p_vote uuid) returns setof votes`

`OPEN → CLOSED` (V-6), con cierre anticipado permitido. Guardas:

1. `app_vote_community(p_vote)`; `NULL` → `vote_not_found` (`P0002`).
2. no gestión → `vote_requires_leadership` (`42501`).
3. Estado actual: `CLOSED` → `vote_already_closed` (`U0001` → 409); `DRAFT` →
   `vote_not_open` (`U0001` → 409). Una `OPEN` ya vencida por `ends_at`
   (su estado **almacenado** sigue `OPEN`) **sí** se puede cerrar.
4. `update … set status = 'CLOSED', closed_at = now(), updated_at = now() where
   id and status = 'OPEN'`; si `not found` (carrera), `vote_already_closed`.
5. Devuelve la fila.

```sql
create or replace function app_close_vote(p_vote uuid) returns setof votes
language plpgsql volatile security definer set search_path = public, pg_temp
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
end
$$;
```

### 5.10 `app_cast_vote(p_vote uuid, p_option_id uuid) returns table(...)`

El voto, con *upsert* (V-11). Guardas en orden:

1. `app_vote_community(p_vote)`; `NULL` → `vote_not_found` (`P0002`). Esto ya
   excluye a `PROVIDER`, a no-miembros y a un `DRAFT` para quien no gestiona.
2. Estado **efectivo** `CLOSED` (por `close` o por `ends_at`) → `vote_closed`
   (`U0001` → 409). Antes de `starts_at` o con estado no `OPEN` →
   `vote_not_open` (`U0001` → 409). La ventana `[starts_at, ends_at]` es la que
   ya describía `responses_insert_own_open_vote`; aquí se reescribe con la fecha
   como parte de la condición, no como `CHECK`.
3. `p_option_id` debe ser una opción **de esta votación** (§4b); si no,
   `vote_option_invalid` (`22023` → 400 `VOTE_OPTION_INVALID`).
4. `insert … on conflict (vote_id, user_id) do update set option_id =
   excluded.option_id, updated_at = now()`. Devuelve la fila resultante.

El `user_id` sale de `app_current_user_id()` (nunca del cuerpo). `weight` queda
en su `default` 1 (§4e).

```sql
create or replace function app_cast_vote(p_vote uuid, p_option_id uuid)
returns table (
  vote_id    uuid,
  option_id  uuid,
  weight     integer,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql volatile security definer set search_path = public, pg_temp
as $$
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
end
$$;
```

### 5.11 `app_vote_results(p_vote uuid) returns table(...)`

Los **resultados agregados** (V-2, V-12). Nunca devuelve una fila de
`vote_responses`: solo sumas. Guardas:

1. `app_current_user_id()` presente; si no, `42501`.
2. `app_vote_community(p_vote)`; `NULL` → `vote_not_found` (`P0002`).
3. Si el estado almacenado es `DRAFT` → `vote_not_published` (`U0001` → 409):
   los resultados de un borrador no existen (solo la gestión llegaría aquí).
4. Visibilidad (V-12): `ADMIN`/`PRESIDENT` siempre; en otro caso, `LIVE` siempre,
   `AFTER_CLOSE` solo si el estado efectivo es `CLOSED`, y `ADMIN_ONLY` nunca. Si
   no pasa → `vote_results_forbidden` (`42501` → 403).

Devuelve **una fila** (D-2) con:

| Columna | Contenido |
|---|---|
| `id`, `status`, `effective_status`, `ends_at` | identidad y estado |
| `allow_abstention` | si la votación admitía abstención |
| `eligible_count` | miembros activos no `PROVIDER` de la comunidad (V-9) |
| `turnout` | número de respuestas (un voto por usuario) |
| `participation_percent` | `turnout / eligible_count * 100`, `numeric(5,2)` |
| `quorum_required` | `type = 'QUORUM'` |
| `quorum_percent` | el exigido, o null |
| `quorum_met` | `true`/`false` si `quorum_required`, `null` si no |
| `abstention_count` | votos sobre la(s) opción(es) de abstención |
| `options` | `jsonb`: `[{ id, label, position, isAbstention, votes, percent }]` por posición |

```sql
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
language plpgsql stable security definer set search_path = public, pg_temp
as $$
declare
  v_community uuid;
  v_role      text;
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
    (select coalesce(sum(cnt), 0) from counts where is_abstention),
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
end
$$;
```

Nota: los porcentajes por opción son sobre el **total de respuestas**
(`turnout`); la abstención aparece como una opción más de la lista, pero se
reporta además aparte (`abstention_count`), para que el cliente pueda mostrar
"Sí 66,7 % · No 33,3 % (1 abstención)" sin re-derivar nada.

---

## 6. Políticas RLS

`02_rls.sql` deja tres políticas de voto en `votes`, dos en `vote_options` y tres
en `vote_responses`. `02k_voting.sql` hace:

- **`votes_select_member`** (SELECT, cualquier miembro): **se sustituye** por una
  lectura consciente del estado (§4c): fuera de `DRAFT` para todos, `DRAFT` solo
  para PRESIDENT/ADMIN, y `PROVIDER` fuera. Cierra el hueco de over-exposure.
- **`votes_write_leadership`** (ALL): **se elimina** (V-3).
- **`options_select_visible_vote`** (SELECT): **se sustituye** para añadir el
  mismo veto a `PROVIDER` (hoy deja ver las opciones de una votación no-borrador a
  cualquier miembro, `PROVIDER` incluido).
- **`options_write_leadership`** (ALL): **se elimina** (V-3).
- **`responses_select_own_or_admin`** (SELECT): **se sustituye** por una política
  de **solo el propio voto** (`user_id = app_current_user_id()`), sin la rama
  ADMIN (V-2). El recuento agregado va por `app_vote_results()`.
- **`responses_insert_own_open_vote`** y **`responses_update_own_open_vote`**
  (INSERT/UPDATE): **se eliminan** (V-3). La ventana y la unicidad las hace
  `app_cast_vote()`.
- **Revokes**: `revoke insert, update, delete on votes, vote_options from
  app_runtime;` y `revoke insert, update on vote_responses from app_runtime;`
  (el `select` se queda). Como en AN-2/FN-2, quitar las líneas de `02_rls.sql` no
  deshace un `GRANT` ya aplicado: hay que revocarlo explícitamente.
- **Grants de `execute`** para `app_runtime` (y `revoke` de `PUBLIC`) sobre las
  once funciones, incluidas las `stable` `app_vote_community`,
  `app_is_leadership_of`, `app_vote_effective_status` y `app_vote_results`
  (D-5: un atacante no las ejecuta sin sesión —la guarda de
  `app_current_user_id()` está dentro—, pero el `revoke from public` es
  deny-by-default y barato).

El `revoke` de `vote_responses` es la pieza imprescindible: sin él, un INSERT
directo por Prisma esquivaría la ventana temporal y el upsert.

---

## 7. Contrato HTTP

### 7.1 Las rutas — exactamente las nueve de `ARCHITECTURE.md` §6

```
GET    /api/v1/communities/:communityId/votes            ?status&page&limit
POST   /api/v1/communities/:communityId/votes
GET    /api/v1/votes/:id
PATCH  /api/v1/votes/:id
POST   /api/v1/votes/:id/publish
POST   /api/v1/votes/:id/close
POST   /api/v1/votes/:id/responses                        (upsert voto único)
GET    /api/v1/votes/:id/results
GET    /api/v1/votes/:id/results/export                   (text/csv)
```

Dos routers como los bloques 05-09: `createVotesRouter()` montado en
`/api/v1/communities` con las dos rutas de comunidad (listar/crear) y
`createVoteRouter()` montado en `/api/v1` con las siete rutas por id. No hay
`DELETE /votes/:id` (V-14).

### 7.2 Guardas

| Ruta | Guard |
|---|---|
| `GET /communities/:id/votes` | `requireAuth` + `requireCommunity()`; la función aplica el 403 de `PROVIDER`/no-miembro |
| `POST /communities/:id/votes` | `requireAuth` + `requireCommunity()` + `requireCommunityRole('PRESIDENT','ADMIN')`; la función re-comprueba |
| `GET /votes/:id` | `requireAuth` + `requireVote()` (id UUID, si no 400). Sin guard de rol: la función hace el 404 (borrador no visible, otra comunidad, borrado, `PROVIDER`) |
| `PATCH /votes/:id` | `requireAuth` + `requireVote()`: la función decide 404 / 403 / 409 (`VOTE_NOT_DRAFT`) |
| `POST /votes/:id/publish` | `requireAuth` + `requireVote()`: idem (`VOTE_NOT_DRAFT`) |
| `POST /votes/:id/close` | `requireAuth` + `requireVote()`: idem (`VOTE_NOT_OPEN`, `VOTE_ALREADY_CLOSED`) |
| `POST /votes/:id/responses` | `requireAuth` + `requireVote()`: idem (`VOTE_NOT_OPEN`, `VOTE_CLOSED`, `VOTE_OPTION_INVALID`) |
| `GET /votes/:id/results` | `requireAuth` + `requireVote()`: idem (`VOTE_NOT_PUBLISHED`, 403 si la visibilidad no lo permite) |
| `GET /votes/:id/results/export` | idem, y responde `text/csv` |

`requireVote()` es la pieza nueva del módulo (`voting/middleware.ts`), gemela de
`requireAnnouncement()`: resuelve la comunidad con `app_vote_community()`, deja
el rol en `req.community` y da **404** si la función devuelve `NULL` (no existe,
borrador no visible, borrado, o `PROVIDER`). No lleva `requireCommunityRole`: el
rol no se decide en la ruta sino en cada función, dentro de la transacción.

Por qué los no-`PRESIDENT`/`ADMIN` no se detienen fuera: el mismo error EN la
función garantiza que RLS y funciones cuenten la misma historia. El guard de ruta
es UX; la red es la función (mismo argumento que DN-2 y FN-2).

### 7.3 Cuerpos y validación

Todos los cuerpos son JSON (≤ 1 MB, el límite de `app.ts`). Validación con zod
en el borde, `.strict()` en todos los esquemas, mensajes en castellano. El 22P02
de un enum o de un `timestamptz` inválido se adelanta con `z.enum` y con un
esquema de instante ISO.

`POST /communities/:id/votes`:

| Campo | Obligatorio | Reglas |
|---|---|---|
| `title` | sí | 1-120 |
| `question` | sí | 1-200 |
| `description` | no | ≤ 1000; `''`/`null` → `null` |
| `type` | no | enum `vote_type` (`SINGLE`/`QUORUM`), default `SINGLE` |
| `startsAt` | sí | instante ISO 8601 con zona |
| `endsAt` | sí | instante ISO 8601; `superRefine` que `endsAt > startsAt` |
| `allowAbstention` | no | booleano, default `true` |
| `quorumPercent` | según `type` | entero 1-100; **obligatorio si `type='QUORUM'`**, **prohibido si `SINGLE`** (superRefine) |
| `resultVisibility` | no | enum, default `AFTER_CLOSE` |
| `options` | sí | array de 2-20 cadenas, cada una 1-120 (las **reales**; la abstención la añade el backend, V-10) |

`PATCH /votes/:id` — parcial, solo `DRAFT`, al menos un campo
(`.refine(Object.keys(v).length > 0)`). `title`, `question`, `type`, `startsAt`,
`endsAt`, `allowAbstention`, `resultVisibility` y `options` son opcionales con las
mismas reglas; `description` usa el patrón `textoEditable` (sin `.transform()`):
ausente = no tocar, `''`/`null` = vaciar. El `superRefine` de fechas/quórum solo
se ejecuta si el PATCH toca el campo correspondiente (un PATCH que no cambia
fechas no puede dejar el par inconsistente, porque no lo toca).

**Ningún campo opcional del PATCH lleva `.transform()`** (ni `quorumPercent`
lleva el `.nullish().transform(v => v ?? null)` que sí tiene el del `POST`). En
zod 4 un `.transform()` se ejecuta y hace **aparecer en la salida** un campo que
no venía en el cuerpo; el servicio, que construye el `p_patch` con las claves
presentes, acabaría mandando `description: null` o `quorumPercent: null` en un
PATCH que no los tocaba y **vaciaría** el campo. Es exactamente el fallo de datos
que documenta `communities/validators.ts:62` (`textoEditable`); aquí vale para
todos los opcionales.

`POST /votes/:id/responses`: cuerpo `{ optionId: <uuid> }`, `.strict()`. Enviar
`userId`, `weight` o cualquier otro campo es un 400.

`GET /communities/:id/votes`: `?status=` (enum `vote_status`, filtra por el
**estado efectivo** §5.5/§5.3 — de modo que `?status=CLOSED` incluye las
vencidas—), `?page=` `?limit=` (1-100); `.strict()` (`?q=` desconocido es 400).

`publish`, `close` y `results` no llevan cuerpo ni query. `results/export` no
lleva cuerpo; puede llevar `?format=` en el futuro (fuera de alcance).

### 7.4 Respuestas

| Caso | HTTP | `code` | Cuerpo |
|---|---|---|---|
| Listar | 200 | — | `{ data: [...], meta: { page, limit, total, totalPages } }` |
| Crear | 201 | — | `{ data: votación }` + `Location: /api/v1/votes/{id}` |
| Detalle | 200 | — | `{ data: votación }` (con `options` y `myOptionId`) |
| Editar | 200 | — | `{ data: votación }` |
| Publicar | 200 | — | `{ data: votación }` con `status: 'OPEN'` |
| Cerrar | 200 | — | `{ data: votación }` con `status: 'CLOSED'` y `closedAt` |
| Votar | 200 | — | `{ data: { voteId, optionId, weight, createdAt, updatedAt } }` |
| Resultados | 200 | — | `{ data: { status, effectiveStatus, allowAbstention, eligibleCount, turnout, participationPercent, quorumRequired, quorumPercent, quorumMet, abstentionCount, options: [{ id, label, position, isAbstention, votes, percent }] } }` |
| Export | 200 | — | `text/csv` (no JSON): `opción,votos,porcentaje` |
| No miembro / `PROVIDER` (listar/results prohibido) | 403 | `FORBIDDEN` | — |
| No gestión (editar/publicar/cerrar) | 403 | `FORBIDDEN` | — |
| Votación inexistente / borrada / otra comunidad / borrador no visible | 404 | `NOT_FOUND` | — |
| `PATCH`/`publish` de una votación no borrador | 409 | `VOTE_NOT_DRAFT` | — |
| `close` de una ya cerrada | 409 | `VOTE_ALREADY_CLOSED` | — |
| `close` de un borrador | 409 | `VOTE_NOT_OPEN` | — |
| Votar fuera de la ventana (no abierta) | 409 | `VOTE_NOT_OPEN` | — |
| Votar tras el cierre | 409 | `VOTE_CLOSED` | — |
| Resultados de un borrador | 409 | `VOTE_NOT_PUBLISHED` | — |
| `optionId` de otra votación | 400 | `VOTE_OPTION_INVALID` | — |
| Opciones repetidas o < 2 | 400 | `VOTE_OPTION_DUPLICATE` (duplicado) / `VALIDATION_ERROR` (resto) | — |
| Cuerpo/query inválido | 400 | `VALIDATION_ERROR` | `details` campo a campo |

La votación serializada lleva `type`, `status`, `effectiveStatus`, `startsAt`,
`endsAt`, `allowAbstention`, `quorumPercent`, `resultVisibility`, `options`
(`[{ id, label, position, isAbstention }]`), `myOptionId`, `createdBy`,
`createdByName`, `closedAt`, `createdAt`, `updatedAt`. La exportación rompe el
sobre `{ data }` a propósito (como la descarga de documentos): es un CSV, no JSON.

### 7.5 Traducción de errores

| sentinel | errcode | HTTP | message |
|---|---|---|---|
| `forbidden_role` | 42501 | 403 | Tu rol en esta comunidad no permite esta acción. |
| `vote_requires_leadership` | 42501 | 403 | Solo la presidencia o un administrador puede gestionar votaciones. |
| `vote_results_forbidden` | 42501 | 403 | Los resultados de esta votación todavía no son visibles. |
| `vote_not_found` | P0002 | 404 | Esa votación no existe o no es visible. |
| `vote_content_required` | 22023 | 400 | El título y la pregunta son obligatorios. |
| `vote_dates_invalid` | 22023 | 400 | La fecha de cierre debe ser posterior a la de inicio. |
| `vote_quorum_invalid` | 22023 | 400 | El quórum debe estar entre 1 y 100. |
| `vote_options_invalid` | 22023 | 400 | La votación necesita al menos dos opciones. |
| `vote_option_duplicate` | 22023 | 400 | Hay opciones repetidas. |
| `vote_option_invalid` | 22023 | 400 | Esa opción no pertenece a esta votación. |
| `vote_not_draft` | U0001 | 409 | Solo se puede editar o publicar un borrador. |
| `vote_not_open` | U0001 | 409 | La votación no está abierta. |
| `vote_closed` | U0001 | 409 | La votación ya está cerrada. |
| `vote_already_closed` | U0001 | 409 | La votación ya está cerrada. |
| `vote_not_published` | U0001 | 409 | La votación todavía no se ha publicado. |
| `sin contexto de usuario` | 42501 | 401 | — |

Con el par sentinel + errcode (R-12): un `title` del cliente que contenga la
cadena `vote_not_found` no puede fabricar un 404. `vote_option_invalid` viaja con
su propio código de contrato `VOTE_OPTION_INVALID`, como `EXPENSE_INVOICE_MISMATCH`
lo hizo en finanzas. Los `U0001` comparten SQLSTATE (clase "conflicto del bloque
de votaciones") y se distinguen por el sentinel; ninguno usa el `CONFLICT`
genérico.

---

## 8. Estructura de archivos

```
backend/src/voting/
  routes.ts          # createVotesRouter() (2 rutas de comunidad) +
                     #   createVoteRouter() (7 rutas por id)
  controller.ts      # HTTP -> servicio (forma del cuerpo y de la query)
  middleware.ts      # requireVote(): app_vote_community -> req.community
  service.ts         # orquesta: repo -> envelope; construye el jsonb del PATCH
  repository.ts      # $queryRaw -> app_*("")
  validators.ts      # schemas zod (alta/PATCH/responses/listado/uuid)
  errors.ts          # tabla de traduccion (sentinel + errcode, U0001)
  __tests__/         # unitarios: validators, errors
```

Montajes en `app.ts`:

```ts
app.use('/api/v1/communities', createVotesRouter())
app.use('/api/v1', createVoteRouter())
```

`service.ts` construye el `p_patch` de `PATCH /votes/:id` como un objeto con
**solo las claves presentes** (D-3): `title`/`question`/`type`/`startsAt`/`endsAt`/
`allowAbstention`/`resultVisibility` se incluyen si `!== undefined`;
`description` se incluye si `!== undefined`, con `input.description ?? null` (para
que `''` y `null` lleguen como `null` y el `nullif` de la función lo confirme);
`quorumPercent` se incluye si `!== undefined`; `options` se incluye si
`!== undefined`. Luego se pasa como `Prisma.Json`/`::jsonb`.

El seed pasa de **10 a 11 secciones** (D-4): se añade **"11/11 Votaciones"** al
final (después de Documentos) y se renumeran los rótulos `N/10` a `N/11`. El
`wipe()` ya borra `voteResponses`, `voteOptions` y `votes` (líneas 127-129); solo
hay que **crear** los datos. Como el seed corre con el rol postgres (bypass de
RLS), inserta votaciones, opciones y respuestas directamente con Prisma.

Datos de demo en la comunidad A (miembros: ana ADMIN, luis PRESIDENT, marta
NEIGHBOR, manolo PROVIDER; elegibles = 3):

- **`voteParkingA`** — "¿Instalar cámaras en el parking?" · `OPEN` · `SINGLE` ·
  `allow_abstention = true` · `result_visibility = LIVE` · inicio en el pasado,
  fin en el futuro · opciones `Sí`, `No` (+ `Abstención` auto) · respuestas
  `ana → Sí`, `luis → Sí`, `marta → No` → turnout 3/3, "Sí 2 (66,67 %)", "No 1".
- **`votePiscinaA`** — "¿Abrir la piscina en junio?" · `DRAFT` · `QUORUM` ·
  `quorum_percent = 60` · `result_visibility = AFTER_CLOSE` · opciones `Sí`,
  `No` · sin respuestas. Es el caso "borrador invisible para el vecino" (404).
- **`voteRuidoA`** — "¿Permitir obras los sábados?" · `CLOSED` (con `closed_at`
  en el pasado y `ends_at` pasado) · `SINGLE` · `result_visibility =
  AFTER_CLOSE` · opciones `Sí`, `No` · respuestas `ana → No`, `marta → Sí`.

---

## 9. Variables de entorno

**Ninguna nueva.** El bloque no usa Storage ni APIs externas. `env.ts` queda
intacto. (El CSV se genera en memoria en el controller; no toca bucket.)

---

## 10. Criterios de aceptación

### Visibilidad y permisos (V-1, V-5)

- Un `NEIGHBOR` de A ve las votaciones no-borrador de A y vota en las abiertas.
- Un `PRESIDENT` y un `ADMIN` de A crean, editan, publican y cierran; además
  votan.
- Un `PROVIDER` de A: listar votaciones da **403**; detalle, voto y resultados
  dan **404**.
- Un no-miembro: listar da 403; detalle da 404.
- Un `NEIGHBOR` pidiendo el detalle de un **borrador** (`votePiscinaA`) recibe
  **404**, igual que si no existiera (C-8); un `PRESIDENT` lo ve.
- Un `ADMIN` de A pidiendo el detalle de una votación de B recibe **404**.

### Ciclo de vida (V-6, V-7)

- Crear deja `status: 'DRAFT'`; `POST publish` lo pasa a `OPEN`; un segundo
  `publish` → **409 `VOTE_NOT_DRAFT`**.
- `POST close` de una `OPEN` → `CLOSED` con `closedAt`; segundo `close` → **409
  `VOTE_ALREADY_CLOSED`**; `close` de un `DRAFT` → **409 `VOTE_NOT_OPEN`**.
- Una votación `OPEN` cuyo `endsAt` ya pasó se lista con
  `effectiveStatus: 'CLOSED'` **sin** haber tocado la fila, y `?status=CLOSED` la
  incluye.
- `PATCH` de una votación `OPEN`/`CLOSED` → **409 `VOTE_NOT_DRAFT`**; `PATCH` de
  un `DRAFT` edita solo lo enviado (probar título, fechas y `options`).
- `PATCH {}` → **400** (al menos un campo).

### El voto (V-10, V-11)

- Votar en `voteParkingA` con la opción `Sí` devuelve 200; repetir con `No`
  **actualiza** la misma respuesta (no aparece un segundo voto: `turnout` sigue
  igual) y `myOptionId` pasa a ser la de `No`.
- Votar con un `optionId` que no es de esa votación → **400
  `VOTE_OPTION_INVALID`**.
- Votar en un `DRAFT` (como PRESIDENT) → **409 `VOTE_NOT_OPEN`**; votar en una
  `OPEN` ya vencida → **409 `VOTE_CLOSED`**.
- Crear con una sola opción, con opciones repetidas o con una opción
  `'Abstención'` (con `allowAbstention = true`) → **400**.
- Con `allowAbstention = true`, las opciones de la votación incluyen
  `{ label: 'Abstención', isAbstention: true }` al final; con `false`, no.
- Cambiar `allowAbstention` de `true` a `false` en un `DRAFT` retira la opción de
  abstención; de `false` a `true` la añade.

### Resultados (V-2, V-12) y export (V-13)

- `GET /results` de `voteParkingA` (LIVE) como NEIGHBOR: 200 con `turnout: 3`,
  `eligibleCount: 3`, `participationPercent: 100.00`, `quorumRequired: false`,
  `quorumMet: null`, `abstentionCount: 0` y `options` con `Sí: 2 (66.67)`,
  `No: 1 (33.33)`, `Abstención: 0`.
- La respuesta **no** contiene ningún identificador de votante ni listado de
  `vote_responses` (papeleta secreta, V-2): una búsqueda de un `userId` en el
  JSON no encuentra nada.
- Un `NEIGHBOR` pidiendo resultados de una votación `AFTER_CLOSE` **abierta** →
  **403**; tras el cierre → 200. De una `ADMIN_ONLY`, siempre **403**; la
  administración, 200.
- `GET /results` de `votePiscinaA` (DRAFT) → **409 `VOTE_NOT_PUBLISHED`**.
- `GET /results/export` devuelve `Content-Type: text/csv` con cabecera
  `opción,votos,porcentaje` y una fila por opción; sin filas individuales.
- Una votación `QUORUM` con participación por debajo de `quorumPercent` da
  `quorumMet: false`; por encima, `true`.

### Contrato

- Toda respuesta JSON es el sobre `{ data }` / `{ error: { code, message,
  details? } }`; el export es la excepción documentada (`text/csv`).
- `POST` devuelve 201 con `Location: /api/v1/votes/{id}`.
- Paginación con `meta.total` real (incluidas páginas más allá del final), igual
  que en los bloques 04-09.
- En `NODE_ENV=test`, `db:verify` falla si: falta cualquiera de las once
  funciones; alguna no es `SECURITY DEFINER`; `app_runtime` conserva
  `insert, update, delete` sobre `votes`/`vote_options` o `insert, update` sobre
  `vote_responses`; las políticas `votes_write_leadership`,
  `options_write_leadership`, `responses_insert_own_open_vote` o
  `responses_update_own_open_vote` siguen existiendo; `votes_select_member`
  (sin consciencia de `DRAFT`) o `responses_select_own_or_admin` (con su rama
  ADMIN) no han sido sustituidas; o faltan los `CHECK` de longitud de §4a.

---

## 11. Riesgos

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| La rama ADMIN de `responses_select_own_or_admin` deja enumerar votos antes del despliegue | Media | V-2: este bloque la elimina y `04_verify` exige su ausencia; los tests comprueban que ningún endpoint devuelve `vote_responses` individuales |
| `votes_select_member` deja ver los borradores antes del despliegue | Media | §4c: se sustituye por la política consciente del estado y `04_verify` la exige |
| Reemplazar `options` en un `DRAFT` con respuestas por error borra votos | Baja | El `PATCH` solo actúa sobre `DRAFT` (V-7) y un `DRAFT` no puede tener respuestas; el `on delete cascade` no destruye nada. Test: editar opciones de un `OPEN` da 409 |
| El `upsert` del voto depende de que `option_id` no esté en la clave única | Baja | La clave única es `(vote_id, user_id)` (esquema); el `ON CONFLICT` se ancla ahí, no en `option_id` (V-11) |
| `quorum_percent` no nulo con `type='SINGLE'` por escritura directa | Baja | La función fuerza `null` en `SINGLE`; `04_verify` puede comprobar el comportamiento con un test |
| Fechas en texto con zona ambigua (`startsAt`) | Media | El zod exige ISO 8601 con zona; la comparación `endsAt > startsAt` se hace con instantes reales, no por texto |
| El export CSV cuela una fila individual | Baja | V-13: el CSV sale solo de `app_vote_results()`, que nunca expone respuestas; test de contrato sobre las columnas |
| Un `weight` distinto de 1 por SQL altera el recuento | Muy baja | §4e: `app_vote_results()` cuenta filas, no `sum(weight)`; quedaría sin efecto |

---

## 12. Decisiones del desarrollador

### D-1: dos routers, el patrón de los bloques 05-09

`createVotesRouter()` para las dos rutas con `:communityId` en la URL
(`requireCommunity` / `requireCommunityRole('PRESIDENT','ADMIN')`) y
`createVoteRouter()` para las siete por id (sin comunidad en la URL; deciden las
funciones). Montados en dos `app.use`. Las rutas se escriben **completas** dentro
del router, como hace `members/routes.ts`.

### D-2: los resultados son una fila, no un set

`app_vote_results()` es `returns table(…)` **de una fila**, no `setof`. El
backend mapea esa fila a un único objeto y el 404 no aplica: el `coalesce` de los
agregados garantiza la fila (como `app_finance_summary`, D-2 de la spec 09).

### D-3: el PATCH es un objeto JSON con solo las claves presentes

`app_update_vote(p_vote, p_patch jsonb)` con `p_patch ? 'clave'` para distinguir
"no enviado" de "enviado". Es la única forma de hacer un PATCH parcial dentro de
una función `SECURITY DEFINER` (el `updateMany` parcial de Prisma no está
disponible cuando se revocan los permisos de escritura). El servicio construye el
objeto con solo las claves definidas, y `options` viaja solo cuando se quiere
reemplazar. `app_set_vote_options()` (D-3b) se extrae para no duplicar la
validación de opciones entre alta y PATCH.

### D-4: el seed pasa de 10 a 11 secciones, con votaciones al final

Añadir "11/11 Votaciones" después de Documentos y renumerar los rótulos `N/10` a
`N/11`. Como el seed corre con el rol postgres, `vote_responses` se inserta
directamente; no hace falta pasar por `app_cast_vote()`. Los tres casos de demo
(abierta con votos, borrador de quórum, cerrada) cubren las tres ramas de
visibilidad y el recuento.

### D-5: las funciones `stable` también se revocan de PUBLIC

Las funciones `sql stable` del bloque (`app_vote_community`,
`app_is_leadership_of`, `app_vote_effective_status`) podrían ejecutarse sin
sesión si quedara `PUBLIC` con `execute`. La guarda de `app_current_user_id()`
está dentro de las que leen, pero el `revoke from public` + `grant` solo a
`app_runtime` es la pieza deny-by-default que todos los bloques aplican.

### D-6: la papeleta secreta se gana quitando la rama ADMIN de la política

El comentario original de `02_rls.sql` quería que el recuento pasara por una
función `SECURITY DEFINER`, pero mantenía `or app_is_admin_of(...)` en la
política SELECT de `vote_responses`. Se **elimina** esa rama: la política pasa a
"solo el propio voto" y el recuento lo hace `app_vote_results()`. Es la
alternativa descartada de V-2 y el punto que más conviene confirmar con el
usuario antes de implementar (una lectura "para auditar" quedaría fuera de la
API, solo por SQL directo con el rol de setup).

---

## 13. Fuera de alcance

- **Voto ponderado** (`weight`): §4e; el recuento cuenta filas.
- **Voto múltiple** (`type = 'MULTIPLE'`): no existe en el enum (V-8).
- **Voto delegado / por poder**: no hay modelo de delegaciones.
- **Papeleta verificable**: incompatible con el secreto de voto (V-2).
- **`DELETE /votes/:id`**: no está en `ARCHITECTURE.md` §6 (V-14).
- **Notificaciones `VOTE_OPEN` / `VOTE_CLOSED`** al publicar/cerrar: el bloque de
  notificaciones no está construido (aunque el enum las tenga).
- **Herramientas IA/MCP de votaciones** (`get_votes`, `get_vote_results` de
  `ARCHITECTURE.md` §12): son de las fases 12/14; este bloque crea las funciones
  de lectura que reutilizarán.
- **Dashboard visual** (Recharts, "próximas votaciones"): fase 11.
- **Edición de una votación publicada**, **reapertura**, **cambio de opciones
  tras el voto**: por diseño (V-7).
- **UI** en general.
