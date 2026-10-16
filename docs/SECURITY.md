# Seguridad · CommunityHub

Qué protege este proyecto, cómo, y qué riesgos quedan abiertos y aceptados.

---

## 1. El modelo de amenaza, en una frase

Una petición manipulada llega al backend con el token de otra persona, o sin
token, e intenta leer o escribir datos de una comunidad que no es la suya.

Todo lo de aquí existe para que eso falle, y para que falle **en la base de
datos**, no solo en el código de aplicación.

---

## 2. Las dos capas

| Capa | Qué garantiza | Dónde | Qué pasa si falla |
|---|---|---|---|
| Aplicación | Reglas de negocio: roles, horarios, capacidad, transiciones de estado | `services/` | Un vecino ve o hace algo que no debería, pero solo dentro de su comunidad |
| RLS | Aislamiento entre comunidades, ante cualquier consulta | Postgres, 24 tablas | Un bug de una sola línea devuelve datos de otra comunidad |

RLS no puede validar que una reserva cae dentro del horario ni que la prioridad
de una incidencia es coherente. Eso es de la capa de aplicación. Lo que RLS sí
garantiza es lo importante aquí: que una consulta **sin filtro** no devuelve
datos de otra comunidad.

La diferencia entre las dos capas es la que importa: una fuga causada por un bug
de programación, o una lista incompleta.

---

## 3. RLS en la base de datos

Cada tabla tiene `enable row level security` **y** `force row level security`.
Los dos, y no uno:

| | Qué hace |
|---|---|
| `enable` | las políticas se aplican a los roles sin privilegios |
| `force` | se aplican **también al dueño de la tabla** |

Sin `force`, una función o un rol que sea dueño de la tabla se saltaría todas
las políticas. Con los dos, 24 de 24 tablas quedan cerradas incluso para el
propietario.

### El rol de la aplicación

| Rol | `BYPASSRLS` | Quién lo usa |
|---|---|---|
| `app_runtime` | no | Prisma Client, en cada petición |
| `postgres` | sí | `db pull`, seed, fixtures de los tests, `db:apply` |

Conectar la aplicación con `postgres` no da ningún error: funciona, responde, y
cada vecino ve las Communities de los demás. Por eso `src/config/env.ts`
**comprueba el rol al arrancar y se niega a continuar** si `DATABASE_URL` no es
`app_runtime`, y si el puerto no es 5432.

El puerto importa por lo mismo: el *Transaction pooler* (6543) devuelve la
conexión al pool entre transacciones, así que el `SET LOCAL` del contexto de RLS
se pierde antes de que la política lo evalúe.

### El contexto por petición

Dentro de cada transacción, `withContext()` fija lo que las políticas leen:

```ts
await prisma.$transaction(async (tx) => {
  await tx.$executeRaw`select set_config('app.current_user_id', ${userId}, true)`
  await tx.$executeRaw`select set_config('app.current_community_id', ${communityId}, true)`
  return tx.incident.findMany()
})
```

El `true` final es lo que lo convierte en `SET LOCAL`: la variable existe **solo**
durante esa transacción. Si al volver al pool la conexión conservara el valor,
la fuga de un vecino a otro sería un fallo de aislamiento difícil de detectar.

Sin contexto, las consultas de datos de comunidad devuelven **0 filas**, no un
error. Es deliberado: un endpoint al que se le olvide el contexto devuelve una
lista vacía en vez de una lista que no le pertenece.

### El punto ciego del login

Las políticas comparan siempre contra `app_current_user_id()`. En el login y en
el refresh todavía no se sabe quién es el usuario, así que devuelve 0 filas y no
hay forma de saber ni si el email existe.

De ahí las tres funciones `SECURITY DEFINER` de `02b_auth.sql`:

| Función | Para qué |
|---|---|
| `app_auth_find_user_by_email` | login y registro, sin contexto |
| `app_auth_find_session_by_hash` | refresh, sin contexto |
| `app_auth_revoke_family` | detección de reutilización |

Su seguridad depende de dos detalles, y `04_verify.sql` los comprueba:

- `set search_path = public, pg_temp`. Sin esto, cualquiera que pueda crear un
  objeto en el schema de búsqueda puede sustituir la función y ejecutar su
  código con estos privilegios.
- `revoke execute ... from public`, y `grant` **solo** a `app_runtime`. Con el
  `grant` abierto, cualquiera podría leer el hash de contraseña de cualquier
  vecino.

### Escribir exige poder leer lo que escribes

Este no estaba en la spec y costó un bug real. La escritura de Prisma comprueba
las políticas de `SELECT` sobre la fila afectada, no solo la de `INSERT`. Al
registrarse con `app.current_user_id` a `NULL`, `users_select_self` no coincide
con la fila recién creada y la operación falla con:

```
new row violates row-level security policy for table "users"
```

con `users_insert_public` siendo `with check (true)`. El INSERT era legal y aun
así se rechazaba.

La corrección no es un rodeo: al terminar de registrarse, uno **es** el usuario
nuevo, y poder leer su propia fila es justo lo que `users_select_self` existe
para permitir. El contexto del registro es su propio UUID.

Vale la pena dejarlo escrito porque el síntoma (`42501` en un `INSERT` con
`with check (true)`) no lleva a ninguna parte por intuition. Cuando aparezca
otra vez, el contexto es lo primero que hay que mirar.

---

## 4. Autenticación

| Decisión | Por qué |
|---|---|
| argon2id para contraseñas | bcrypt se ataca con GPU; SHA-256 no sirve para contraseñas |
| Access token JWT, 15 min | Ventana de robo corta |
| Refresh **opaco** de 64 bytes aleatorios, 30 días | Un JWT de refresh no se puede revocar: es válido hasta que expira |
| Solo el **hash SHA-256** del refresh en la BD | Si alguien lee la tabla `sessions`, no puede suplantar una sesión |
| Rotación con detección de reutilización | Un refresh ya usado vuelve a aparecer → está robado → se revoca la familia entera |
| Access token solo en memoria del cliente | `localStorage` es legible por cualquier XSS |
| Refresh en cookie `httpOnly` `secure` `sameSite=strict` | `localStorage` lo roba un XSS; `strict` da protección CSRF sin token |

`env.ts` se niega a arrancar en producción con `SameSite` distinto de `strict`.

La rotación con detección de reutilización tiene una consecuencia que conviene
tener presente, porque no es evidente: **reusar un refresh token ya usado tira
también el token nuevo**. Si alguien reutiliza el viejo, toda la familia cae, y
quien lo robó se queda sin sesión y sin poder reutilizar la suya. Es lo correcto.

Y otra, que salió de los tests: el access token de la sesión anterior queda
invalido en el acto de refrescar. Un cliente que guarde el token viejo en vez de
sustituirlo por el nuevo recibirá 401 aunque el servidor esté perfectamente bien.

### Enumeración de emails

Un login con email inexistente y otro con contraseña incorrecta devuelven el
mismo `401 INVALID_CREDENTIALS` y tardan lo mismo: el login con email
inexistente igualmente calcula un hash argon2 de señuelo. Sin eso, el tiempo de
respuesta enumera las cuentas del barrio, que es información que el proyecto
trata de no filtrar.

### El frontend (bloque 15): tokens en memoria y contenido como texto

La SPA (React 18 + Vite, en `frontend/`; [`specs/15-frontend.md`](../specs/15-frontend.md))
**no autoriza nada**: el backend sigue siendo el único gatekeeper (FE-1). Lo que
la UI oculta o deshabilita por rol es cosmético, y toda mutación viaja al API y
acepta su `403`, `404` o `409`.

Dos reglas que no se negocian en el cliente:

- **El access token vive solo en memoria** (`AuthContext`) y **nunca se persiste**
  —ni `localStorage` ni `sessionStorage`—. El **refresh token** sigue en la cookie
  `httpOnly`/`secure`/`sameSite=strict` que fija el backend y que el JavaScript
  del cliente no puede leer.
- **El contenido del usuario** (avisos, comentarios, nombres) se renderiza **como
  texto**: se prohíbe `dangerouslySetInnerHTML` (FE-14; §8 de la spec). El
  frontend **no maneja credenciales** de Storage ni de proveedores externos
  (FE-2, FE-13).

---

## 5. Permisos revoked a `anon` y `authenticated`

`02_rls.sql` revoca los permisos que Supabase concede por defecto a `anon` y
`authenticated`. Los dos recuentos tienen que dar **0**, y `04_verify.sql` lo
falla si no.

No es teórico: con los permisos por defecto, la `anon` key —que es pública por
diseño— puede leer tablas directamente desde el navegador, saltándose el
backend entero.

### Funciones `SECURITY DEFINER`: el otro punto de entrada

Conceder `execute` sobre una función `SECURITY DEFINER` a un rol equivocado es
equivalente a conceder el permiso que la función ejerce, porque la función se
ejecuta **saltándose RLS**. Por eso las que hay tienen los permisos
restringidos a mano:

| Función | Puede ejecutarla | Qué hace |
|---|---|---|
| `app_create_community(...)` | `app_runtime` | Crea una comunidad y a su primer `ADMIN` |
| `app_is_global_admin()` | `app_runtime` | Responde si el usuario del contexto es `ADMIN_SA` |
| `app_can_see_incident(uuid)` | `app_runtime` | Visibilidad de una incidencia |
| `app_incident_community(uuid)` | `app_runtime` | Comunidad de una incidencia visible |
| `app_list_incidents(...)` | `app_runtime` | Listado ya filtrado por rol |
| `app_get_incident(uuid)` | `app_runtime` | Una incidencia, ya filtrada |
| `app_list_incident_comments(uuid)` | `app_runtime` | Comentarios de una visible |
| `app_create_incident(...)` | `app_runtime` | Alta. El reporter lo pone el servidor |
| `app_update_incident_content(...)` | `app_runtime` | Edición del contenido |
| `app_set_incident_priority(uuid, ...)` | `app_runtime` | Prioridad. Solo `ADMIN` |
| `app_assign_incident(uuid, ...)` | `app_runtime` | Asignación. Solo `ADMIN` |
| `app_transition_incident(uuid, ...)` | `app_runtime` | Cambio de estado |
| `app_soft_delete_incident(uuid)` | `app_runtime` | Borrado lógico. Solo `ADMIN` |
| `app_common_area_community(uuid)` | `app_runtime` | Comunidad de una zona visible |
| `app_list_common_areas(uuid)` | `app_runtime` | Listado de zonas de una comunidad |
| `app_get_common_area(uuid)` | `app_runtime` | Una zona, para el `PUT` y los tests |
| `app_get_area_availability(uuid, date)` | `app_runtime` | Rejilla de un día, con `FREE`/`OCCUPIED` |
| `app_create_common_area(...)` | `app_runtime` | Alta. Solo `ADMIN` |
| `app_update_common_area(...)` | `app_runtime` | `PUT` completo. Solo `ADMIN` |
| `app_can_see_reservation(uuid)` | `app_runtime` | Visibilidad de una reserva |
| `app_reservation_community(uuid)` | `app_runtime` | Comunidad de una reserva visible |
| `app_create_reservation(...)` | `app_runtime` | Alta. Rol, rejilla, horario, límite y slots |
| `app_confirm_reservation(uuid)` | `app_runtime` | Confirmación. Solo `ADMIN` |
| `app_cancel_reservation(uuid)` | `app_runtime` | Cancelación. Dueño o `ADMIN`; borra slots |
| `app_list_community_reservations(...)` | `app_runtime` | Listado por comunidad, `notes` redactado |
| `app_list_user_reservations(...)` | `app_runtime` | Agenda propia, todas las comunidades |
| `app_get_reservation(uuid)` | `app_runtime` | Detalle, `notes` redactado |
| `app_announcement_community(uuid)` | `app_runtime` | Comunidad de un aviso |
| `app_list_announcements(...)` | `app_runtime` | Tablón filtrado por rol, ventana y paginación |
| `app_create_announcement(...)` | `app_runtime` | Alta. `PRESIDENT` y `ADMIN`; el autor es la sesión |
| `app_update_announcement(...)` | `app_runtime` | `PUT` completo. `PRESIDENT` y `ADMIN` |
| `app_delete_announcement(uuid)` | `app_runtime` | Borrado lógico. Solo `ADMIN` |

Las trece de incidencias llevan `revoke ... from public` y
`set search_path = public, pg_temp`: las once de `02e_incidents.sql`,
`app_create_community` en `02c_communities.sql` y `app_is_global_admin` en
`02_rls.sql`. Las catorce de `02f_common_areas.sql` y `02g_reservations.sql`, y
las cinco de `02h_announcements.sql`, repiten la misma receta, y **cada fichero
trae su propia autocomprobación**: un `DO` que falla en `db:verify` si una
función pierde el `SECURITY DEFINER`, el `search_path`, la revocación de
`PUBLIC`, o si `common_areas`/`reservations`/`area_slots`/`announcements`
recupera una política o un permiso de escritura. Aplicar el fichero «sin
errores» no demuestra nada; lo que demuestra es que ese bloque revienta al
instalarse mal. `04_verify.sql` lo repite en las secciones 13, 14 y 15, y
comprueba los permisos con `has_function_privilege`, que es la pregunta
correcta: pregunta al catálogo, no deduce del texto del `GRANT`.

El detalle que hace que esto no sea una escalada de privilegios trivial está en
que **`app_is_global_admin()` no acepta ningún usuario como parámetro**
(C-3 de la spec 02). Una función `SECURITY DEFINER` que reciba un `userId` libre
es escalada con una llamada: quien pueda ejecutarla pregunta por cualquier
usuario. El predicado va fijado a `app_current_user_id()`, que sale del contexto
de la sesión y no de la petición.

### Por qué las escrituras de incidencias son funciones y no `UPDATE`

`app_runtime` **no** tiene `INSERT` ni `UPDATE` sobre `incidents`, y `incidents`
**no** tiene política de `INSERT` ni de `UPDATE`. No es una medida de rendimiento:
es que la política de `UPDATE` que había antes solo comprobaba que el llamante
fuera miembro y un reporter, y se saltaba todo el dominio de golpe. Con
`INSERT`/`UPDATE` concedidos, cualquiera que llegara hasta la tabla podría poner
`status = 'RESOLVED'` sin pasar por el grafo.

Como no hay escritura directa, todas las reglas viven dentro de la función, que
es el **único sitio donde el motor las ve**. El backend no las duplica: si lo
hiciera habría dos reglas que se pueden desincronizar, y la que se desincronice
sería la de TypeScript, que nadie audita.

La excepción única es `incident_comments`, que sí va por el cliente de Prisma: solo
`INSERT`, con la política puesta por el backend. Es deliberado y está anotado en el
sitio: un comentario no tiene estado, ni prioridad, ni transiciones, así que no hay
regla de dominio que justifique una capa `SECURITY DEFINER`. Lo que sí importa —que
la incidencia sea visible— lo pone `comments_insert_author` de `02_rls.sql`, no el
código.

Y como `app_runtime` es un rol de **base de datos** y no de HTTP, "no hay endpoint"
no es una defensa: `02_rls.sql` traía un `grant update` y una política
`comments_update_author` que ningún endpoint usaba, pero que allowían reescribir un
comentario entero desde el rol de la aplicación. I-7 dice que los comentarios no se
editan, así que `02e_incidents.sql` revoca el `UPDATE` **y** suelta la política.
Quitar solo la política dejaría el permiso concedido y sin regla: denegado por
casualidad, y no por diseño.

### Visibilidad de una incidencia: 404 en vez de 403

El predicado es el mismo en las lecturas y en las escrituras, y es lo que impide
que un vecino exista para su vecino:

- `ADMIN` y `PRESIDENT` ven todas las de su comunidad.
- `NEIGHBOR` ve las suyas.
- `PROVIDER` ve las que tiene **asignadas**.

Lo que **no** existe y no se ve es un `404`, nunca un `403`, y por dos motivos: un
`403` confirmaría que el id existe, y un `410` confirmaría que estuvo. El borrado
lógico es invisible a propósito, así que después de borrar la incidencia tampoco
la ve quien lareportedo.

Y hay una consecuencia menos obvia: **un miembro suspendido también pierde el
acceso**, porque el predicado incluye `app_is_member_of()`, y eso mira el estado
de la membresía. El token sigue siendo válido quince minutos; lo que se corta es
el rol.

### Por qué el rol se comprueba en dos capas

El backend comprueba el rol en el middleware **y** las funciones de SQL lo
comprueban otra vez dentro de la transacción, contra la fila.

La razón es que el middleware no es el único camino: PostgREST llega a las mismas
funciones sin pasar por Express. Una comprobación que solo vive en el backend
protege el backend y nada más. La de SQL protege el dato.

En el `PUT` hay además una comprobación de rol en el servicio, antes de escribir,
que **no** es la que protege: es la primera capa, y está para que el mensaje sea
el bueno y para no escribir el contenido de una incidencia antes de fallar por la
prioridad. Si se borrara, el endpoint seguiría siendo seguro.

### Un error de negocio no se confunde con un permiso

`app_transition_incident()` tiene **cuatro** guardas y el orden importa: contexto,
visibilidad, actor, arista-de-solo-`ADMIN`, grafo.

La cuarta existe por un error que se cometió al escribirla: al principio el
requisito de `ADMIN` para reabrir y cancelar estaba **dentro** de la arista del
grafo (`… and v_is_admin`). Con eso, un `PROVIDER` asignado que intentaba reabrir
caía en `incident_invalid_transition` y recibía un `409` — "ese cambio no se puede"
— cuando lo que faltaba era un **permiso**. El `409` invites a elegir otro estado
destino, y no hay ninguno que sirva.

Separándolo, el `PROVIDER` recibe `403` y el `NEIGHBOR` un `409` de verdad por una
transición que no existe. La guarda mira también el origen, no solo el destino,
para no convertir el `OPEN → OPEN` de un `PROVIDER` (que es un `409` por ser una
transición al estado actual) en un `403`.

### Traducir errores sin regalar un `409`

Los errores de negocio se levantan con un **sentinel** al principio del mensaje y
un `errcode` de PostgreSQL. La traducción a HTTP exige **las dos cosas**, y no
solo el sentinel.

Un sentinel es texto que viaja dentro del mensaje de Postgres, que es justo donde
acabaría cualquier valor que venga del cliente. Si la traducción mirase solo el
texto, un título que se llamase `incident_invalid_transition` podría convertirse
en un `409`.

`incident_invalid_transition` usa `22023` y **no** `23514`, aunque los dos sean un
`CHECK` reventado, para que un título demasiado corto y una transición imposible
se distinguan aunque el texto se pierda. Y un `23514` **sin** sentinel conocido es
un `400`: es un formulario mal rellenado.

Un `42501` desconocido cae en `403` y no en `500`, por el mismo motivo que en el
bloque 03: si una política se cierra de más, el síntoma tiene que ser un `403` y no
un error interno que nadie sabe mirar.

### El solape de reservas: dejar que el índice decida

`area_slots_no_overlap_uidx` es `unique (common_area_id, starts_at)` **sin
condición**, y esa ausencia de `where` es la defensa, no un detalle de estilo.
Con un índice parcial, dos reservas que solapen a medias (10:00–11:00 y
10:30–11:30) podrían convivir, y el «imposible por construcción» dejaría de
serlo.

Y no hay, deliberadamente, un `select … where overlaps` antes del `insert`:
entre ese select y ese insert caben dos peticiones concurrentes en la piscina, y
la segunda entraría creyendo que el hueco está libre. Un `check-then-insert` en
TypeScript tendría la misma ventana, y más ancha todavía, porque pasa por red.
La única autoridad es el índice: las dos escriben, una gana y la otra recibe
`409`. Es el patrón de «a la pregunta *¿está libre?*, la respuesta fiable es
intentarlo».

El mismo criterio gobierna la confirmación, con el orden **primero slots,
después status**: si el hueco se ocupó mientras la reserva esperaba aprobación,
el `409` revienta y la reserva **sigue `PENDING`** — ni confirmada a medias ni
auto-cancelada. Confirmar a medias dejaría el sistema mintiendo, y
auto-cancelarla decidiría por el `ADMIN` algo que solo él puede decidir.

### Cancelar no es `UPDATE status`

`app_runtime` no tiene `INSERT`, `UPDATE` ni `DELETE` sobre `reservations` ni
`area_slots`, y `02g_reservations.sql` revoca los que `02_rls.sql` había
concedido. Cancelar son **tres cambios atómicos** —`status`, `cancelled_at` y el
borrado de los slots— dentro de `app_cancel_reservation()`, y esa función es la
única que puede ejecutar el borrado porque es la dueña de los datos.

Sin el tercer paso, la piscina quedaría bloqueada para siempre por una reserva
que la aplicación dice cancelada: el índice no distingue «reserva real» de
«reserva muerta», así que nadie podría reservar ese hueco nunca más. Es el fallo
silencioso más caro del bloque, y por eso no hay forma de llegar a un `UPDATE` de
status por la API: ni endpoint, ni permiso, ni política.

### Las notas de una reserva se redactan en SQL

RLS decide **fila a fila** y no sabe escribir en una columna: devuelve filas
enteras o no devuelve nada. Por eso la redacción de `notes` vive en un `CASE`
dentro de las tres funciones de lectura (`app_list_community_reservations`,
`app_get_reservation`, y la propia de `app_list_user_reservations`, donde no hace
falta porque todas las filas son del llamante): el dueño, un `ADMIN` y un
`PRESIDENT` ven el texto; el resto recibe `null`.

Y `null` significa a la vez «no dije nada» y «no es tuya», a propósito:
distinguir los dos casos solo beneficiaría a un atacante que quisiera saber si
hay texto oculto. Un listado que dijera `notes_ocultas` le confirmaría a un
vecino que la reserva de al lado tiene notas.

### 404 también en zonas y reservas

Las rutas `PUT /common-areas/:id`, la disponibilidad y las cuatro de reserva con
`:id` no llevan comunidad en la URL: la resuelve el guard contra la fila. Un id
inexistente, el de otra comunidad, el de una comunidad a la que ya no perteneces
o el de una zona de una comunidad donde estás **suspendido** son el mismo `404`,
y por el mismo motivo que en incidencias (C-8): un `403` confirmaría que ese id
existe — y en el caso de la suspensión, que antes sí lo veías. La suspensión
corta la visibilidad, no solo el permiso, porque `app_is_member_of()` exige
membresía `ACTIVE`.

### El único bloque que toca Storage (documentos)

El binario no vive en la base: solo `storage_path`, y esa clave **no sale nunca
en una respuesta** —ni el detalle ni el listado la devuelven, y `db:verify`
falla si `app_list_documents()` vuelve a mencionar `storage_path`. El bucket
`community-documents` es privado (`public = false`), con `file_size_limit` de
10 MB y `allowed_mime_types` cerrados en `03_storage.sql`; quien descarga
recibe una **signed URL** de `DOCUMENTS_SIGNED_URL_EXPIRES_IN` segundos, y la
clave de servicio que la firma no sale de la respuesta jamás.

Hay dos drivers (`STORAGE_DRIVER`): `supabase`, con la clave de servicio —el
arranque exige que `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` no estén
vacías ni en `PENDING`, para fallar antes que la primera petición— y
`local`, carpeta en disco. Fuera de test el default es `supabase`;
**dentro de `NODE_ENV=test` el driver es siempre `local`, pase lo que pase en
`.env`** (`env.ts`): la suite nunca sube fixtures al bucket real, no deja
basura en el proyecto y no depende de red para estar en verde.

Las reglas que viven aquí:

- **Subir y borrar es solo `ADMIN`** (DN-1), dos veces: el guard de la ruta
  antes de leer el archivo, y la función dentro de la transacción. Y
  `app_runtime` no tiene `INSERT`, `UPDATE` ni `DELETE` sobre `documents` ni
  `document_acl`: la única escritura posible pasa por una de las cinco
  funciones.
- **El orden del alta es validar → subir → insertar**, con compensación: si el
  `INSERT` falla, el objeto recién subido se borra (best-effort, con log). Una
  fila sin objeto sería un documento que se ve y no se puede bajar.
- **El borrado va al revés**: soft delete primero (el dato), objeto después y
  solo cuando el commit ya ocurrió; si la eliminación falla, queda un residuo
  logueado y el `200` no se deshace.
- **La descarga en dos pasos** (§5.5 de la spec): primera consulta nula es
  `404` —no distingue «no existe» de «no lo ves», porque un `403` confirmaría
  la existencia—, segunda consulta nula es `403`. Una ACL con
  `can_download: false` veta la descarga por rol, aunque el documento sea
  visible por `minRole` o por ser público.
- **`PROVIDER` no ve nada por rol** (DN-5): `<> 'PROVIDER'` está escrito en las
  dos funciones de lectura y `db:verify` lo comprueba con
  `pg_get_functiondef`. Con el orden real del enum
  (`NEIGHBOR < PRESIDENT < ADMIN < PROVIDER`), un simple
  `role >= min_role` incluiría al proveedor hasta en `min_role = ADMIN`.

Y una peculiaridad del único `409` del bloque: la colisión en
`documents_storage_path_uidx` se captura y se relanza con el sentinel
`document_path_taken`, pero con **SQLSTATE `U0001`** y no con `23505`. Prisma
traduce cualquier `23505` que reciba a «Unique constraint failed: …» y se come
el mensaje, de modo que el sentinel jamás llegaría al traductor: la pareja
(sentinel, errcode) se perdería justo en el único caso que la necesita. Un
`23505` que sí llegue no se convierte en `409` nunca (sección «Traducir
errores sin regalar un `409`»): o es una colisión —imposible con uuid v4— o es
un bug del esquema, y disfrazar uno de lo otro lo escondería.

### El único bloque que es solo de ADMIN (finanzas)

Finanzas es el primer bloque cuyo **listado también es de `ADMIN`** (FN-1). En
los anteriores, listar era de cualquier miembro; aquí la tesorería y el listado
confirman datos, así que un `NEIGHBOR`, `PRESIDENT` o `PROVIDER` recibe `403` en
las seis rutas de comunidad. En las tres rutas de gasto por `:id` —que no llevan
comunidad en la URL— la visibilidad la resuelve la función con la fila delante,
de modo que un no-`ADMIN` recibe **`404`** (C-8: un `403` confirmaría que ese id
existe), igual que un gasto de otra comunidad, uno borrado o uno inexistente.

El bloque cierra un hueco que venía del esquema: `invoices` tenía
`invoices_select_scoped` (SELECT para cualquier miembro activo) y
`invoices_write_admin` (ALL para `ADMIN`). Se sustituyen por
**`invoices_admin_only`** (SELECT, solo `ADMIN`) y se revoca
`insert, update, delete` sobre `invoices` a `app_runtime` (y a `anon`/
`authenticated`): la única puerta de escritura es
`app_create_invoice()` / `app_pay_invoice()`. `db:verify` comprueba con
`pg_get_functiondef` que la política sigue siendo la de `ADMIN` y que
`app_runtime` no conserva la escritura.

Y el patrón de siempre: las once funciones de `02j_finance.sql` son `SECURITY
DEFINER` con `search_path = public, pg_temp` fijo, ejecutables por `app_runtime`
y **no** por `PUBLIC`; todos los revokes escriben el sentinel y el `errcode`, y
la traducción exige **la pareja** de las dos cosas, porque un concepto o un
proveedor del cliente viaja dentro del mensaje de un error de Postgres.

Los tres conflictos del bloque (`invoice_number_taken`, `invoice_already_paid`,
`invoice_cancelled`) comparten el SQLSTATE `U0001`, exactamente por el motivo de
documentos: Prisma se come el mensaje de cualquier `23505` (el número de factura
lleva un índice único por comunidad). Con `U0001` el sentinel viaja entero, y
cada uno lleva su **código de contrato propio** (`INVOICE_NUMBER_TAKEN`,
`INVOICE_ALREADY_PAID`, `INVOICE_CANCELLED`) en vez del genérico `CONFLICT`. Un
`U0001` desnudo (sin sentinel) no se convierte en `409`: es un bug del esquema, y
se deja pasar como `500`.

El gasto es **soft delete** (`deleted_at`), como avisos y documentos: la fila
sigue viva y las funciones la excluyen. El vínculo gasto ↔ factura solo se
acepta si la factura es **de la misma comunidad** (FN-10); si no, es un `400` con
el código propio `EXPENSE_INVOICE_MISMATCH`, no un `VALIDATION_ERROR`: el cuerpo
era válido y lo que falla es la relación.

### La papeleta secreta (votaciones)

Votaciones es el bloque del **voto secreto** (V-2): no hay ninguna lectura de
`vote_responses` que enumere votantes, y **ni `ADMIN` ni `PRESIDENT`** pueden
saber quién votó qué. El único recuento es `app_vote_results()`, que devuelve
sumas agregadas y una fila (`coalesce`/subselects); las respuestas individuales
solo existen dentro de las funciones `SECURITY DEFINER`. Por eso `app_runtime`
no tiene `INSERT`, `UPDATE` ni `DELETE` sobre `votes`, `vote_options` ni
`vote_responses`: la única puerta de escritura son `app_create_vote()`,
`app_update_vote()`, `app_publish_vote()`, `app_close_vote()` y `app_cast_vote()`.

El bloque cierra dos huecos que venían del esquema:

- **`votes_select_member`** (SELECT para cualquier miembro) se sustituye por
  **`votes_select_visible`**: fuera de `DRAFT` para `NEIGHBOR`/`PRESIDENT`/`ADMIN`,
  un `DRAFT` solo para `PRESIDENT`/`ADMIN`, y **`PROVIDER` fuera siempre**
  (V-1/V-5). Un borrador es invisible para el vecino (`404`, igual que si no
  existiera). El veto al proveedor se repite en `options_select_visible_vote`,
  que antes se lo dejaba ver.
- **`responses_select_own_or_admin`** (que daba a `ADMIN` la rama de leer las
  respuestas de otros) se sustituye por **`responses_select_own`**: cada uno ve
  solo la suya, y la administración **no** tiene una rama extra. Es el corazón de
  V-2: la rama de `ADMIN` era exactamente el agujero que convertía la papeleta en
  pública.

Las cuatro políticas de escritura (`votes_write_leadership`,
`options_write_leadership`, `responses_insert_own_open_vote`,
`responses_update_own_open_vote`) se eliminan; `db:verify` falla si cualquiera
reaparece, si `app_runtime` conserva la escritura, o si las políticas sustituidas
no son las nuevas.

Los cinco conflictos del bloque (`vote_not_draft`, `vote_not_open`,
`vote_closed`, `vote_already_closed`, `vote_not_published`) comparten el SQLSTATE
`U0001` por el mismo motivo que documentos y finanzas, y cada uno con su **código
de contrato propio** (`VOTE_NOT_DRAFT`, `VOTE_NOT_OPEN`, `VOTE_CLOSED`,
`VOTE_ALREADY_CLOSED`, `VOTE_NOT_PUBLISHED`). Un `U0001` sin sentinel no se
convierte en `409`: es un bug del esquema y se deja pasar como `500`. El voto va
por **UPSERT** sobre `vote_responses_unique_vote_uidx (vote_id, user_id)`: un
voto por usuario, y cambiar de voto actualiza la misma fila en vez de crear una
segunda. La opción de abstención la genera el sistema (V-10), de modo que el
recuento no depende de un texto que el cliente pueda escribir de mil formas.

---

## 6. Secretos

| Secreto | Dónde | Estado |
|---|---|---|
| Contraseña de `app_runtime` | `.env`, y el rol en Supabase | Rotada, aleatoria, 32 caracteres |
| Contraseña de `postgres` | `.env` | Rotada, aleatoria, 32 caracteres |
| `JWT_SECRET` | `.env` | 64 bytes en base64, generado con `crypto.randomBytes` |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env`, nunca en el cliente | Del dashboard |

`.env` está en `.gitignore` y no se sube nunca. Las plantillas `.env.example`
contienen la estructura y los comentarios, ningún valor.

### Una credencial que sí quedó en el historial

La contraseña de `postgres` de la primera configuración se subió en el commit
`924a3e6`. **Está rotada**: la actual es aleatoria y el valor antiguo ya no
autentica. Rotar es lo que resuelve el problema; el historial del repositorio
sigue conteniéndolo, así que:

- No reutilices esa contraseña en ningún otro sitio.
- Si el repositorio se hace público, purga el historial (`git filter-repo`) o
  empieza de nuevo. El nombre del proyecto y su ref tampoco son secretos, pero
  la contraseña sí lo era.

### Sobre el certificado del pooler

`sslmode=require` no significa lo mismo en libpq que en node-postgres. En libpq
es "cifra, pero no compruebes la cadena". En `pg` se traduce a
`rejectUnauthorized: true`, y la conexión falla con:

```
self-signed certificate in certificate chain
```

porque el pooler de Supabase presenta un certificado firmado por su propia CA,
que no está en ningún almacén de CA público. Verificar contra las CA del
sistema no es un descuido de configuración: es imposible.

Por eso hay dos caminos, y el primero es el bueno:

1. `POSTGRES_CA_CERT_PATH` (o `PGSSLROOTCERT`) apunta al certificado de Supabase.
   Se verifica de verdad. Descárgalo de *Dashboard → Settings → Database →
   SSL Certificates*.
2. Sin certificado, se cifra **sin verificar**, que es lo que ya hace Prisma
   con `sslmode=require` en el cliente del backend. `npm run db:apply` lo dice
   en pantalla cada vez que conecta.

El riesgo residual del camino 2 es real pero acotado: sin verificar la cadena,
una composiciónTLS que llegue al puerto y sepa hablar el protocolo se hace
pasar por la base de datos. Sin la clave de `postgres`, no obtiene nada. En una
red con adversario esto no es suficiente; con la ruta 1, sí.

---

## 7. Riesgos aceptados

### `deepmerge-ts` — Stack exhaustion (transitivo, solo en la CLI)

`npm audit` marca `deepmerge-ts` (dependencia transitiva de `@prisma/config`, que
a su vez viene de Prisma).

| | |
|---|---|
| Afecta a | `prisma` (herramienta de línea de comandos) |
| Aviso | [GHSA-ggr8-5vv4-36mx](https://github.com/advisories/GHSA-ggr8-5vv4-36mx), severidad alta |
| Versión instalada | 7.1.5 (vulnerable, el fix está en 8.x) |
| Presente en producción | No. `@prisma/client` no declara `dependencies`, solo `peerDependencies` |
| Cuándo se ejecuta | `prisma generate`, `prisma db pull`. Nunca al servir peticiones |

**Decisión: aceptado, con verificación.** Comprobado en vez de supuesto: al
arrancar `createApp()` con Prisma conectado, `require.cache` contiene **0**
módulos de `deepmerge-ts`. El vector exige ejecutar la CLI con una entrada
controlada por el atacante, lo que ya exige acceso al repositorio.

`npm audit fix` no lo resuelve sin subir Prisma a 8.x, que hoy es
`8.0.0-rc`. Subir la versión mayor de Prisma para tapar un aviso que no afecta al
runtime es peor que el aviso, así que se espera a Prisma 8 estable.

Volver a mirarlo cuando salga Prisma 8 estable, no antes.

### Demo en la base de datos de desarrollo

`npm run db:seed` deja credenciales conocidas y las imprime por pantalla:

```
ADMIN      ana@comunidad-a.test     · CommunityHub2026
PRESIDENT  luis@comunidad-a.test    · CommunityHub2026
```

Es intencionado, para que cualquiera clone y entre sin pedirle nada a nadie. Pero
son contraseñas públicas: **nunca corras el seed contra un entorno con datos
reales**, y no tomes estas cuentas como referencia de un patrón.

### Sin verificación de email ni recuperación de contraseña

Fuera de alcance (sección 12 de la spec). Sin SMTP no hay correo, y sin correo no
hay "confirma tu cuenta" ni "restablece tu contraseña". Es una decisión
consciente: el enunciado no lo pedía y una implementación a medias —un token de
reset que caduca y nunca se envía— es peor que no tenerla.

### Rate limit en memoria

Vive en el proceso. Con una sola instancia es correcto; con varias, cada una
cuenta por su lado y el límite real es `N × el configurado`. El serverless
empeora esto porque las instancias se reciclan constantemente. Cuando haya más
de una instancia, mover a la tabla de Supabase, que ya está contratada.
Documentado como pregunta abierta 3 en la spec.

---

## 8. Qué se verifica, y cómo

Nada de lo anterior se da por bueno sin una comprobación que falle si se rompe.

| Comprobación | Qué demuestra |
|---|---|
| `npm run check:db` | Rol `app_runtime` sin `BYPASSRLS`, puerto correcto, RLS deniega sin contexto, el contexto se lee en las políticas |
| `npm run test:unit` | Hash y verify de argon2id, JWT (incluido `alg: none`), validación de entradas, traducción de errores de PL/pgSQL. Sin base de datos |
| `npm run test:integration` | Los 80 endpoints contra Postgres real (auth 7, comunidades 4, miembros 7, incidencias 8, zonas comunes 4, reservas 6, avisos 4, documentos 5, finanzas 9, votaciones 9, IA 9, APIs externas 15, dashboard 1, notificaciones 4): aislamiento entre comunidades, rotación, reutilización, envelope, rate limit, las ocho rutas de incidencias con sus seis roles, de reservas el solape concurrente, la redacción de `notes` y la confirmación con hueco robado, de avisos la ventana por rol, el `authorId` inalterable y el soft delete, de documentos la visibilidad por rol y por ACL (el borde de `PROVIDER`), la descarga `404`/`403` en dos pasos, el alta con su objeto real en el bucket, el soft delete con el objeto eliminado, y el `409` de ruta ocupada; de finanzas el `403` de todo rol no-`ADMIN` (listar incluido), el `404` del gasto por id, la derivación de `OVERDUE`, el `409` de doble pago y de número repetido, y el `400` `EXPENSE_INVOICE_MISMATCH` de la factura de otra comunidad; y de votaciones la papeleta secreta (ningún id de votante en el recuento), el `403` de listar y el `404` de detalle del `PROVIDER`, la invisibilidad del borrador, el ciclo `DRAFT→OPEN→CLOSED`, el UPSERT del voto, la visibilidad de resultados por rol y el CSV del recuento (una fila por opción, nunca por voto); y de IA el `503` sin proveedor y el `429` con la cuota agotada **antes** de abrir el stream, el chat por SSE con su bucle de tools, la persistencia de la sesión y sus mensajes, el `404` de la sesión ajena (leer y borrar), la clasificación que **nunca** crea la incidencia, la caída a la heurística sin proveedor, el `201`+`Location` del borrador y el `409` al confirmarlo dos veces, la creación con `createdVia=AI_SUGGESTION` y `reporterId` humano, el parche parcial del humano, y el `403`/`404` del catálogo y del `preview` filtrados por rol; y de APIs externas la degradación que **nunca** es un `5xx` (proveedor caído sin caché y comunidad sin coordenadas), la caché que evita una segunda llamada al proveedor dentro del TTL, el `403` de aislamiento en los tres endpoints, y `geocode` restringido a `ADMIN` con escritura real de coordenadas y su fila de auditoría `community.geocode`; y del dashboard los recuentos de incidencias de toda la comunidad vistos por un `NEIGHBOR` (contar no es leer), el `finance` nulo para todo rol no-`ADMIN` y presente para `ADMIN`, la ventana `from`/`to` de las series, el aislamiento entre comunidades, y el `400` de las fechas mal formadas; y de notificaciones la generación de los 8 eventos por API con su audiencia (dirección, difusión y destinatarios concretos, sin auto-notificación del actor), la paginación y el filtro `unread`, el contador del *badge*, el marcado idempotente, el `404` de la notificación ajena (nunca `403`), el `read-all`, el aislamiento entre usuarios y los `400` de validación |
| `npm run smoke` | El flujo entero por HTTP real, con cabeceras y cookies, contra el servidor levantado |
| `db:verify` | Que el esquema y los permisos están donde deben, sin depender del código |

Los 7 endpoints y los criterios 1 a 19 de la spec tienen su test. La lista está
en `specs/01-authentication.md`, sección 10. Del bloque 04, los criterios de
`specs/04-incidents.md` sección 10 tienen su test, y en la base de datos se
comprueba además lo que no se puede pedir por HTTP: que `incidents` no tiene
política de escritura, que las once funciones siguen siendo `SECURITY DEFINER` con
`search_path` fijo y no ejecutables por `PUBLIC`, que la secuencia del código legible
no es usable desde fuera, y que `app_can_see_incident` y `app_list_incidents` siguen
mencionando las mismas tres condiciones.

De los bloques 05 y 06, los criterios de `specs/05-common-areas.md` y
`specs/06-reservations.md` (sección 10) tienen su test de integración, y en la base
de datos se comprueba además lo que por HTTP no se ve: que `common_areas`,
`reservations` y `area_slots` siguen sin política de escritura y sin permiso de
escritura para nadie que no deba; que las catorce funciones siguen siendo
`SECURITY DEFINER` con `search_path` fijo y sin ejecutar desde `PUBLIC`; que
`area_slots_no_overlap_uidx` sigue siendo **único y sin condición**; que
`reservations.status` tiene default `CONFIRMED` y el enum exactamente tres valores;
y que la política de `SELECT` de `reservations` filtra por comunidad
(`app_is_member_of`) y **no** por `user_id`, que es la regla entera de R-5.

Ese último es el más importante de todos y no falla nunca por casualidad: si
alguien edita el predicado y olvida el listado, el detalle y la lista empiezan a
discrepar **sin que nada falle**, porque las dos consultas funcionan. Es el fallo más
difícil de detectar de todo el bloque, así que se comprueba con `pg_get_functiondef`
en vez de confiar en que alguien se acuerde.

Del bloque 07, los criterios de `specs/07-announcements.md` (sección 10) tienen
su test de integración, y en la base de datos se comprueba lo que por HTTP no se
ve: que `announcements` sigue sin política de `INSERT`, `UPDATE` ni `DELETE` y
sin permiso de escritura para `app_runtime`, que las cinco funciones siguen
siendo `SECURITY DEFINER` con `search_path` fijo, ejecutables por `app_runtime`
y no por `PUBLIC`, y que el índice de orden y el `CHECK` de ventana existen.

Del bloque 08, los criterios de `specs/08-documents.md` (sección 10) tienen su
test de integración, y en la base de datos se comprueba lo que por HTTP no se
ve: que `documents` y `document_acl` siguen sin política de escritura y sin
permiso de escritura para `app_runtime`; que las cinco funciones siguen siendo
`SECURITY DEFINER` con `search_path` fijo, ejecutables por `app_runtime` y no
por `PUBLIC`; que las dos lecturas siguen excluyendo a `PROVIDER` con
`pg_get_functiondef`; que el alta sigue firmando `uploaded_by` con
`app_current_user_id()` (DN-8); que la ACL sigue entrando con `ON CONFLICT`
(DN-9); que el borrado sigue siendo un soft delete (DN-11); y que
`app_list_documents()` no menciona `storage_path`.

Del bloque 09, los criterios de `specs/09-finance.md` (sección 10) tienen su
test de integración, y en la base de datos se comprueba lo que por HTTP no se
ve: que `invoices` ya **no** tiene política de escritura ni permiso de escritura
para `app_runtime` y su política de `SELECT` es la de `ADMIN`
(`invoices_admin_only`); que las once funciones de `02j` siguen siendo
`SECURITY DEFINER` con `search_path` fijo, ejecutables por `app_runtime` y no
por `PUBLIC`; que el listado de facturas sigue derivando `OVERDUE` con
`app_invoice_effective_status()`; y que los seis `CHECK` de longitud del bloque
existen.

Del bloque 10, los criterios de `specs/10-voting.md` (sección 10) tienen su test
de integración, y en la base de datos se comprueba lo que por HTTP no se ve: que
las once funciones de `02k` siguen siendo `SECURITY DEFINER` con `search_path`
fijo, ejecutables por `app_runtime` y no por `PUBLIC`; que `votes`,
`vote_options` y `vote_responses` no tienen ninguna política de escritura ni
permiso de escritura para `app_runtime`; que `votes_select_member` y
`responses_select_own_or_admin` han sido **sustituidas** por `votes_select_visible`
y `responses_select_own`; que `app_cast_vote()` sigue haciendo el UPSERT sobre
`(vote_id, user_id)`; que `app_vote_results()` sigue exigiendo la visibilidad de
`result_visibility` (`vote_results_forbidden`); que `app_list_votes()` sigue
derivando el estado efectivo; y que los cuatro `CHECK` de longitud del bloque
existen. El `INFORME` de `04_verify.sql` incluye, además, el recuento de funciones
de votaciones (debe ser 11) y el de `EXECUTE` a `PUBLIC` sobre ellas (debe ser 0).

Del bloque 11, los criterios de `specs/11-ai.md` (sección 10) tienen su test de
integración, y en la base de datos se comprueba lo que por HTTP no se ve: que
`app_runtime` no tiene `DELETE` sobre `ai_chat_sessions`, ningún privilegio sobre
`ai_cache` ni `SELECT` sobre `incident_drafts` (las tres escrituras pasan por
función `SECURITY DEFINER`); que las cuatro funciones de `02l` siguen siendo
`SECURITY DEFINER` con `search_path` fijo, ejecutables por `app_runtime` y no por
`PUBLIC`; que `app_confirm_incident_draft` sigue marcando `AI_SUGGESTION` (AI-2);
que `app_ai_usage_consume` sigue siendo un UPSERT por `(user_id, usage_date)`
(AI-5); que `app_ai_cache_get` es **`volatile`** (hace `UPDATE` de `hit_count`:
declararla `stable` la rompería con `0A000`); y que las cuatro políticas RLS de la
IA (`ai_sessions_own`, `ai_messages_own`, `drafts_own`, `ai_usage_own`) existen.
El `INFORME` añade las funciones de IA (deben ser 4) y sus `EXECUTE` a `PUBLIC`
(deben ser 0).

Del bloque 12, los criterios de `specs/12-external-apis.md` (sección 14) tienen
su test de integración, y en la base de datos se comprueba lo que por HTTP no se
ve: que `external_cache` tiene RLS habilitada **sin política** y que `app_runtime`
no tiene ningún privilegio de tabla sobre ella (solo `EXECUTE` sobre las
funciones); que las tres funciones de `02m` siguen siendo `SECURITY DEFINER` con
`search_path` fijo, ejecutables por `app_runtime` y no por `PUBLIC`; y —la
comprobación de regresión que en el bloque 11 cazó el bug de `app_ai_cache_get`—
que `app_external_cache_put` y `app_external_cache_purge` son **`volatile`**
(hacen `INSERT`/`UPDATE`/`DELETE`: declararlas `stable` las rompería con `0A000`),
mientras que `app_external_cache_get` es `stable`. El `INFORME` añade las funciones
de APIs externas (deben ser 3) y sus `EXECUTE` a `PUBLIC` (deben ser 0).

Del bloque 13, los criterios de `specs/13-dashboard.md` (sección 14) tienen su
test de integración, y en la base de datos se comprueba lo que por HTTP no se ve:
que `app_community_dashboard` sigue siendo `SECURITY DEFINER` con `search_path`
fijo, `stable` y **no** ejecutable por `PUBLIC`. Es el corazón del bloque: la
función corre como su propietario y por eso agrega la comunidad entera aunque la
RLS por filas esté activa, que es exactamente lo que permite que un `NEIGHBOR`
reciba recuentos de incidencias que no puede leer (contar no es leer, DSH-2). El
`INFORME` añade la función de dashboard (debe ser 1) y sus `EXECUTE` a `PUBLIC`
(debe ser 0).

El dashboard no añade superficie de escritura: es una única lectura y no escribe
ni `audit_logs` ni `notifications` (DSH-12), que se comprueba con un test
dedicado. Los únicos datos que oculta son los de finanzas para todo rol no
`ADMIN`, que viajan como `finance: null` y no como ceros, para no filtrar ni la
existencia de los importes (DSH-3).

Del bloque 14, los criterios de `specs/14-notifications.md` (sección 14) tienen su
test de integración, y en la base de datos se comprueba lo que por HTTP no se ve:
que `app_notify`, `app_notify_leadership` y `app_notify_community`
(`02o_notifications.sql`) siguen siendo `SECURITY DEFINER` con `search_path` fijo,
**`volatile`** (hacen `INSERT`: declararlas `stable` las rompería con `0A000`) y
**no** ejecutables por `PUBLIC`; y una **comprobación de regresión** de que las
nueve emisoras de `02d`/`02e`/`02g`/`02h`/`02k` siguen llamando a `app_notify`
en su cuerpo. Ese es el punto del diseño: la notificación nace **dentro de la
misma transacción** que el hecho que la provoca (una incidencia, una reserva, un
aviso, una votación, un alta), así que no hay una segunda escritura que pueda
quedar a medias ni un `INSERT` de cliente que se pueda falsificar. La generación
corre como el propietario `SECURITY DEFINER` precisamente para poder insertar
filas de **otro** usuario, que es lo que la RLS de `notifications` no dejaría
hacer al usuario de contexto. El `INFORME` añade las tres funciones de
notificaciones (deben ser 3) y sus `EXECUTE` a `PUBLIC` (deben ser 0).

Las notificaciones son **estrictamente personales**: la política
`notifications_own` (`02_rls` §5.17) es `user_id = app_current_user_id()`, así que
el listado —que **no** se filtra por comunidad, NTF-3— sigue viendo solo las filas
del usuario, y marcar una notificación ajena afecta cero filas y responde **404,
nunca `403`** (un `403` confirmaría que ese `id` existe). El actor **nunca** se
auto-notifica (NTF-7), que es lo que evita que publicar un aviso genere un eco para
quien lo publica. El módulo no añade superficie de escritura HTTP: las cuatro rutas
son de lectura y de marcado, no hay un `POST` de creación —crear una notificación
a mano no es una operación del cliente—.

No hay ninguna clave de proveedor que proteger en este bloque: Open-Meteo y Photon
son anónimos, así que la superficie nueva es de salida (una `fetch` con
`User-Agent` identificativo y `AbortSignal.timeout`) y de caché. La caché no es
solo rendimiento: es el control de cuota que evita repetir contra el proveedor
1 000 veces una llamada que cambia cada 15 minutos.

Sobre el test central del proyecto, el que si falla avisa de una fuga:

```
Usuario A de comunidad 1 intenta leer una incidencia de comunidad 2  ->  0 filas
```

No es un 403. Con RLS, la consulta simplemente no ve la fila. Un 403 confirmaría
que la fila existe y que solo le negaron el paso; cero filas no revela ni que
exista.

Y el mismo razonamiento aplicado a `incident_comments`: un vecino que lista los
comentarios de la incidencia de otro recibe `0 filas`, no un `403`. La política
`comments_select_via_incident` de `02_rls.sql` resuelve primero si la incidencia es
visible y solo entonces filtra por autor, así que el comentario hereda el alcance de
su incidencia sin que ninguna ruta tenga que comprobarlo.

---

## 9. Lo que haría en una revisión de seguridad

Si esto se auditara, por orden de relación entre lo que se encuentra y lo que
cuesta:

1. **Purga del historial** de la contraseña de `924a3e6` (§6). Barato y elimina
   el único secreto que sigue en el repositorio.
2. **TLS verificado de verdad**: descargar el certificado de Supabase y poner
   `POSTGRES_CA_CERT_PATH` (§6). Convierte un riesgo aceptado en una garantía.
3. **Rate limit compartido** en cuanto haya más de una instancia (§7).
4. **Verificación de email y recuperación de contraseña**, cuando haya SMTP.
   Sin esto, un vecino que pierde la contraseña lo pierde todo.
5. **Límite global además del límite por IP** en el login. El actual lo detiene
   un atacante desde una IP; no lo detiene uno con un rango entero.
