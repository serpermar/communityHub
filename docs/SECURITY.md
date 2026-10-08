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
| `npm run test:integration` | Los 45 endpoints contra Postgres real (auth 7, comunidades 4, miembros 7, incidencias 8, zonas comunes 4, reservas 6, avisos 4, documentos 5): aislamiento entre comunidades, rotación, reutilización, envelope, rate limit, las ocho rutas de incidencias con sus seis roles, de reservas el solape concurrente, la redacción de `notes` y la confirmación con hueco robado, de avisos la ventana por rol, el `authorId` inalterable y el soft delete, y de documentos la visibilidad por rol y por ACL (el borde de `PROVIDER`), la descarga `404`/`403` en dos pasos, el alta con su objeto real en el bucket, el soft delete con el objeto eliminado, y el `409` de ruta ocupada |
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
