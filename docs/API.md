# API · CommunityHub

Contrato HTTP del backend. Base: `/api/v1`. Formato: JSON.

Los envoltorios son **únicos** y no tienen excepción:

```jsonc
// exito
{ "data": { }, "meta": { } }        // `meta` solo en listados paginados

// error
{ "error": { "code": "CONFLICT", "message": "Ya existe…", "details": [ ] } }
```

- Los **mensajes** van en castellano: los lee quien los ve, y el enunciado del
  proyecto está en castellano.
- Los **identificadores** (`code`, campos, valores de enum) van en inglés:
  los escribe el cliente, y las convenciones de un programa no se traducen.
- Nunca `data: null` en un error, ni un error dentro de un `200`. Un `200` con
  `{ error }` obliga a comprobar el cuerpo en todas partes, que es como se
  cuelan errores que nadie muestra.

`details` solo aparece cuando hay algo útil que decir campo a campo (errores de
validación). Los errores de autorización no lo llevan nunca: un 403 no dice qué
faltó.

## Autenticación

Salvo el registro y el login, todo necesita cabecera `Authorization`:

```
Authorization: Bearer <accessToken>
```

El access token es un JWT de 15 minutos. El refresh va en cookie `httpOnly`
`secure` `sameSite=strict` y **no** se devuelve en el cuerpo.

Que el rol global se lea de la base de datos y no del token es deliberado: el
token dura 15 minutos, así que leer el rol de ahí permitiría revocar un permiso
y seguir usándolo durante la ventana del token.

---

## Comunidades

Las cuatro rutas viven bajo `/api/v1/communities`.

### Modelo

```jsonc
{
  "id": "uuid",
  "name": "Barrio Alto",
  "slug": "barrio-alto",          // inmutable tras el alta
  "description": "text o null",
  "addressLine1": "Calle Mayor 1", // obligatorio
  "city": "Valencia",             // obligatorio
  "province": "Valencia",         // null
  "postalCode": "46001",          // null
  "country": "ES",                // 2 letras
  "latitude": 39.474,             // null = "sin localizar todavía"
  "longitude": -0.379,            // null = "sin localizar todavía"
  "timezone": "Europe/Madrid",
  "registrationNumber": "null",
  "isActive": true,
  "createdAt": "2026-10-04T12:00:00.000Z",
  "updatedAt": "2026-10-04T12:00:00.000Z",
  "memberRole": "ADMIN"           // el rol del llamante en ESTA comunidad
}
```

`latitude` y `longitude` son **anulables, y van juntas**: `null` significa que
aún no se ha localizado la comunidad, no `0,0`. Rellenarlas con `0,0` sería
peor, porque `0,0` está en el Atlántico y daría mapa y meteorología equivocados
sin que nadie se entere. Si se manda una, se mandan las dos. Rango: latitud
`[-90, 90]`, longitud `[-180, 180]`.

`memberRole` es el rol **en esa comunidad**, no el global. La misma persona puede
salir `ADMIN` aquí y `NEIGHBOR` en otra, y su permiso cambia con la comunidad del
`communityId`.

### Roles

| Rol | Puede |
|---|---|
| `NEIGHBOR` | Ver la comunidad, crear incidencias y reservas |
| `PRESIDENT` | Gestión de comunidad. **No** ve los gastos |
| `ADMIN` | Gestión completa, incluido el `PATCH` de configuración |
| `PROVIDER` | Solo los trabajos que tiene asignados |
| `ADMIN_SA` | **Staff de plataforma.** Solo crear comunidades |

`ADMIN` y `ADMIN_SA` son cosas distintas y no se confunden: `ADMIN` es un rol
*dentro* de una comunidad, `ADMIN_SA` es de la plataforma entera.

Y una asimetría que conviene tener presente al integrar: **`ADMIN_SA` crea
comunidades pero no las lee.** Un `ADMIN_SA` que no es miembro recibe `403` al
pedir la comunidad de otro. Entrar por la puerta de al lado a mirar el contenido
de una comunidad sería un cambio de modelo, y se decide en su propia spec.

### `GET /api/v1/communities`

Comunidades de las que el llamante es miembro, con su rol en cada una.

No es un catálogo: no hay descubrimiento. Se entra con invitación o con el alta
del administrador, no recorriendo una lista. Las dadas de baja y las borradas
(`deleted_at`) no aparecen.

```
200 → { "data": [ { …comunidad, "memberRole": "ADMIN" } ] }
401 → sin sesión
```

### `POST /api/v1/communities`

Crea una comunidad y **deja al llamante como su primer `ADMIN`**, en la misma
transacción. No hay un segundo paso de "asignar administrador".

Reservado a `ADMIN_SA`. Un `NEIGHBOR` recibe `403`, y un `ADMIN` de otra
comunidad también: el permiso es de plataforma, no de comunidad.

```jsonc
// mínimo
{ "name": "Barrio Alto", "slug": "barrio-alto",
  "addressLine1": "Calle Mayor 1", "city": "Valencia" }
```

```
201 → { "data": { …comunidad, "memberRole": "ADMIN" } }
      Location: /api/v1/communities/{id}
400 → cuerpo inválido, con el campo concreto en `details`
401 → sin sesión
403 → el rol global no es ADMIN_SA
409 → el slug ya existe
```

El `slug` va en minúsculas y solo admite `[a-z0-9]` y guiones simples, sin
guiones al principio ni al final. Se rechazan los slugs con mayúsculas o espacios
en lugar de normalizarlos: "arreglarlos" necesita una regla para decidir cuál era
el correcto, y esa regla no existe.

### `GET /api/v1/communities/:communityId`

```
200 → { "data": { …comunidad } }
400 → el `:communityId` no es un UUID
401 → sin sesión
403 → no es miembro
404 → existe la membresía pero la comunidad está dada de baja
```

Un `:communityId` **mal formado es `400`, no `403`**. Un 403 significa "no tienes
permiso"; un id que no es un UUID no es una petición sin permiso, es una
petición mal formada. Confundirlo obligaría a depurar credenciales cuando el
problema es un enlace roto.

Y al revés: un id **bien formado pero ajeno**, y un id que **no existe**, dan
ambos `403`. Un `404` en el caso "no existe" confirmaría que ese id está libre,
que es información sobre los ids de los demás.

### `PATCH /api/v1/communities/:communityId`

Actualización parcial. Solo se escribe lo que viene en el cuerpo: un campo
ausente no se toca.

Requiere rol `ADMIN` en esa comunidad. `PRESIDENT` y `NEIGHBOR` reciben `403`.

```jsonc
{ "name": "Barrio Alto", "description": "", "isActive": false }
```

```
200 → { "data": { …comunidad } }
400 → cuerpo vacío, slug, clave desconocida o coordenadas descuadradas
401 → sin sesión
403 → no es ADMIN de esa comunidad
404 → no existe
```

Reglas que no son evidentes:

- **`slug` no se puede cambiar.** Se rechaza con `400` y un mensaje que lo diga,
  no como "clave desconocida". Admitirlo rompería los enlaces ya compartidos
  sin avisar, que es justo lo que un identificador visible tiene que evitar.
- **Cadena vacía es `null`.** `{"description": ""}` guarda `null`, no `""`, para
  que el frontend no tenga que tratar el caso aparte.
- **`isActive: false` es la baja.** No hay `DELETE`: `communities` no tiene
  política de `DELETE` a propósito, así que un borrado físico es imposible desde
  el rol de la aplicación. La baja lógica deja de aparecer en el listado pero la
  comunidad sigue siendo consultable por id.
- **`updated_at`** lo pone el servidor. Aceptarlo del cliente sería aceptar una
  fecha inventada en un campo que sirve para ordenar.

### No hay `DELETE /communities/:id`

Deliberado. La baja es `PATCH { "isActive": false }`. Añadir el borrado físico
sería el primero del proyecto y exigiría una política `DELETE` que hoy no existe
a propósito.

---

## Incidencias

Ocho rutas en **dos** routers, porque no comparten prefijo: dos llevan la comunidad
en la URL y las otras seis llevan la incidencia. Que las de incidencia no lleven
`communityId` es intencionado: la incidencia ya tiene comunidad, y pedir las dos
cosas es pedir lo mismo dos veces.

La comunidad sale de la propia incidencia, y por eso un `ADMIN_SA` o cualquier
usuario de otra comunidad recibe **`404`** en estas seis rutas, no `403`: un `403`
confirmaría que ese id existe.

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "referenceCode": "INC-2026-000001",
  "title": "Fuga de agua en el pasillo del 3º",
  "description": "Empieza el martes...",
  "category": "PLUMBING",      // ELEVATOR | ELECTRICITY | PLUMBING
                               // CLEANING | SECURITY | HEATING | OTHER
  "priority": "HIGH",          // LOW | MEDIUM | HIGH | CRITICAL
  "status": "IN_PROGRESS",     // OPEN | IN_PROGRESS | RESOLVED | CANCELLED
  "location": "Pasillo 3º",    // null si no se dijo
  "reporterId": "uuid",
  "reporterName": "Marta Ruiz",
  "assignedToId": "uuid",      // null si no hay proveedor asignado
  "assignedToName": "Manolo",
  "needsReview": false,
  "createdVia": "MANUAL",
  "resolvedAt": null,          // fecha al entrar en RESOLVED, null al salir
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

`referenceCode` es `INC-<año>-<6 dígitos>`, único, y es lo que la gente dice en voz
alta. **No es una ruta**: las URLs van por `id`.

`email` **no** sale. Para un listado de incidencias no hace falta, y
`GET /members` ya es la excepción acotada que expone correos.

Un comentario es `{ id, incidentId, authorId, authorName, body, createdAt }`, y no
tiene ni `PUT` ni `DELETE`: no se editan ni se borran desde la API.

### Qué ve cada rol

Lo decide la base de datos, fila a fila, no el backend. La misma ruta devuelve
cosas distintas según quién la llame.

| | Lista | Abre | Comenta | Asignado |
|---|---|---|---|---|
| `ADMIN` | todas | todas | sí | sí |
| `PRESIDENT` | todas | todas | sí | no |
| `NEIGHBOR` | **las suyas** | las suyas | las suyas | no |
| `PROVIDER` | **las asignadas** | las asignadas | las asignadas | sí |

### `GET /api/v1/communities/:communityId/incidents`

Lo visible, en orden `created_at desc`. Filtros opcionales, combinables:
`status`, `priority`, `category` y `q` (fragmento de título, con acentos y sin
distinguir mayúsculas).

```
200 → { "data": [ …incidencias ],
        "meta": { "page": 1, "limit": 20, "total": 42, "totalPages": 3 } }
```

`total` es el total **sin paginar**, que es lo que hace útil la paginación. Una
página más allá del final devuelve `data: []` pero conserva el `total` real, para
que el cliente no dibuje "página 5 de 0".

`page` empieza en 1. `limit` va de 1 a 100, y `limit=1000` es un `400` que nombra
el campo, no un `200` con 100 filas: un `4xx` que explica el problema es mejor que
un recorte silencioso.

### `POST /api/v1/communities/:communityId/incidents`

Alta por cualquier miembro activo salvo `PROVIDER`: informar de un problema es cosa
de quien vive en la comunidad, y el proveedor reporta por el trabajo que le asigna
el `ADMIN`.

```
201 → { "data": …incidencia }
      Location: /api/v1/incidents/{id}
400 → cuerpo inválido, con el campo concreto en `details`
403 → el rol no puede abrir incidencias
```

El reporter **no** se manda: lo pone el servidor, y mandarlo es un `400` en vez de
un `201` que lo ignoraría en silencio. Lo mismo con `status` o `needsReview`.

`needsReview` no se manda y no se decide en el cliente: es `true` si la prioridad es
`CRITICAL` **y** quien la abre es un `NEIGHBOR`. Lo decide la misma transacción que
la inserta.

### `GET /api/v1/incidents/:id`

```
200 → { "data": …incidencia }
404 → no existe, está borrada, o no es visible para ti
```

### `PUT /api/v1/incidents/:id`

Reemplazo **completo** del contenido: `title`, `description` y `category` son
obligatorios. Es un `PUT`, no un `PATCH`, y no hay `PATCH` de contenido.

Opcionales y con permisos distintos:

- `location`: `null` **o** `""` la borran.
- `priority`: solo `ADMIN`.
- `assignedToId`: solo `ADMIN`, y `null` desasigna.

```
200 → { "data": …incidencia }
403 → tu rol no permite cambiar la prioridad o la asignación
404 → no existe o no es visible
```

Enviar solo el contenido no toca ni el estado, ni la prioridad, ni el `assignedToId`.
Y un `NEIGHBOR` que manda `priority` recibe `403`, no un `200` que lo ignoró.

### `PATCH /api/v1/incidents/:id/status`

```
200 → { "data": …incidencia }
403 → tu rol no puede cambiar el estado, o esta arista es solo del ADMIN
409 → la transición no existe desde el estado actual
```

El grafo:

| De | A | Quién |
|---|---|---|
| `OPEN` | `IN_PROGRESS` | `ADMIN`, o el `PROVIDER` **asignado** |
| `IN_PROGRESS` | `RESOLVED` | `ADMIN`, o el `PROVIDER` **asignado** |
| `RESOLVED` | `OPEN` | solo `ADMIN` |
| cualquiera de los tres | `CANCELLED` | solo `ADMIN` |
| `CANCELLED` | — | estado final |

`403` y `409` significan cosas distintas y el cliente las tiene que tratar distinto:
un `409` ofrece elegir otro estado destino, y un `403` no tiene nada que ofrecer.

Dos `PATCH` simultáneos desde el mismo estado **no** se pierden: uno entra y el
otro recibe `409`. Nunca los dos `200`.

`PRESIDENT` no aparece en el grafo, en ninguna fila.

### `DELETE /api/v1/incidents/:id`

```
204 → sin cuerpo
403 → solo `ADMIN`
404 → no existe, o ya estaba borrada
```

Borrado lógico, y **para todos los roles desaparece**: ni el reporter ni el
proveedor asignado la vuelven a ver. Un `DELETE` repetido es `404`, no un `204`
idempotente.

### Comentarios

```
GET  /api/v1/incidents/:id/comments    200 → { "data": [ …comentarios ] }
POST /api/v1/incidents/:id/comments    201 → { "data": …comentario }
                                        400 → cuerpo inválido
                                        404 → no existe o no es visible
```

El listado va en `created_at asc` y no se pagina. El autor es el llamante y no se
manda.

---

## Zonas comunes

Cuatro rutas en **dos** routers: dos llevan la comunidad en la URL y las otras dos
la zona. Como en incidencias, la comunidad de una zona sale de la propia fila, y
por eso un usuario de otra comunidad (o un `ADMIN_SA` que no es miembro) recibe
**`404`** en `PUT /common-areas/:id` y en la disponibilidad, no `403`.

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "name": "Piscina comunitaria",
  "type": "SWIMMING_POOL",       // PADEL_COURT | COMMUNITY_ROOM | GYM
                                 // TERRACE | PLAYGROUND | GARAGE | OTHER
  "description": "text o null",
  "capacity": 20,                // null = sin límite
  "slotMinutes": 60,             // 30 | 60 | 90 | 120
  "openTime": "08:00",           // hora de pared de la comunidad
  "closeTime": "22:00",
  "maxDailyReservations": 10,    // null = sin límite diario
  "requiresApproval": false,
  "isActive": true,              // false = dada de baja
  "createdBy": "uuid o null",
  "createdAt": "2026-10-06T10:00:00.000Z",
  "updatedAt": "2026-10-06T10:00:00.000Z"
}
```

### `GET /api/v1/communities/:communityId/common-areas`

Todas las zonas de la comunidad, `is_active` incluido, en orden alfabético. Cualquier
miembro activo lee el listado, sin distinguir rol: el `ADMIN` necesita ver las dadas
de baja para reactivarlas, y al vecino no le hace daño saber que la sala cerró.

```
200 → { "data": [ …zonas ] }
403 → no es miembro de la comunidad
```

### `POST /api/v1/communities/:communityId/common-areas`

Solo `ADMIN`. `PRESIDENT`, `NEIGHBOR` y `PROVIDER` reciben `403`, tanto en la ruta
como dentro de la transacción: la comprobación está en las dos capas a propósito.

```jsonc
{ "name": "Sala de actos", "type": "COMMUNITY_ROOM", "requiresApproval": true }
```

```
201 → { "data": { …zona } }      // sin Location: no hay GET /common-areas/:id
400 → cuerpo inválido (el nombre corto, una rejilla fuera de {30,60,90,120}…)
403 → el rol no puede gestionar zonas
409 → el nombre ya existe en ESTA comunidad
```

Los campos ausentes usan el default de la columna: `type: OTHER`, `slotMinutes: 60`,
`08:00`–`22:00`, `isActive: true` y `null` en lo anulable. `communityId`, `id`,
`createdBy` y `updatedAt` no se aceptan en el cuerpo: los pone el servidor, y
mandarlos es un `400` por `.strict()`.

### `PUT /api/v1/common-areas/:id`

Reemplazo **completo** de la configuración: los diez campos son obligatorios
(`description`, `capacity` y `maxDailyReservations` admiten `null`, que significa
"sin límite"). Solo `ADMIN`, y el `403` lo decide la función con la fila delante.

```
200 → { "data": { …zona } }
400 → falta un campo o la forma no cuadra
403 → tu rol no puede gestionar zonas
404 → la zona no existe o no es visible
409 → el nombre choca con el de otra zona
```

`slotMinutes` **no reescribe `area_slots`**: los slots son filas históricas de
"quién tenía la zona a las 10:00", y recalcularlos con otra rejilla destruiría la
ocupación pasada. Cambiar la rejilla solo afecta a reservas nuevas.

### `GET /api/v1/common-areas/:id/availability?date=YYYY-MM-DD`

La rejilla de un día, calculada en la **timezone de la comunidad**: `openTime` y
`closeTime` son hora de pared, y a las 10:00 de Valencia la piscina está abierta
aunque en UTC sean las 08:00.

```jsonc
{ "data": { "date": "2026-10-10", "slotMinutes": 60,
            "openTime": "08:00", "closeTime": "22:00",
            "slots": [ { "startsAt": "…Z", "endsAt": "…Z", "status": "FREE" } ] } }
```

- `status` es `FREE` u `OCCUPIED`, y sale de `area_slots` sin mirar `reservations`:
  la existencia del slot **es** la ocupación, y solo las reservas confirmadas
  escriben slots. El cliente no necesita saber de quién es el hueco.
- La fecha es obligatoria y estricta (`YYYY-MM-DD`, día real): `400` si falta o si
  la cadena no es una fecha de calendario.
- La zona **dada de baja devuelve su rejilla** (`200`): la disponibilidad es
  informativa; quién prohíbe reservar sobre ella es el alta de reservas.

---

## Reservas

Seis rutas en **dos** routers: la de comunidad cuelga de
`/api/v1/communities` y las otras cinco de `/api/v1`. Como en incidencias y zonas,
la comunidad sale de la propia fila, y un usuario de otra comunidad recibe **`404`**
en las cuatro rutas que llevan `:id` de zona o de reserva.

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "communityName": "Barrio Alto",
  "commonAreaId": "uuid",
  "commonAreaName": "Piscina comunitaria",
  "userId": "uuid",
  "userName": "Marta Ruiz",
  "startsAt": "2026-10-13T10:00:00.000Z",
  "endsAt": "2026-10-13T11:00:00.000Z",
  "status": "CONFIRMED",          // PENDING | CONFIRMED | CANCELLED
  "attendees": 3,                 // null = no se dijo
  "notes": "Traigo la pata de mesa",  // null: sin notas, o redactadas
  "cancelledAt": null,
  "createdAt": "…",
  "updatedAt": "…"
}
```

`notes` puede ser `null` por dos motivos distintos y la API **no los distingue**:
porque no se dijo nada, o porque no es tuya. Distinguirlos solo beneficiaría a un
atacante que quisiera saber si hay texto oculto.

### `POST /api/v1/common-areas/:id/reservations`

Alta por `NEIGHBOR`, `PRESIDENT` y `ADMIN`. **`PROVIDER` no reserva**: trabaja en la
comunidad, no la usa. El rol se comprueba en el guard de la ruta y se repite dentro
de la transacción.

```jsonc
{ "startsAt": "2026-10-13T10:00:00.000Z",
  "endsAt": "2026-10-13T11:00:00.000Z",
  "attendees": 3, "notes": "texto" }   // attendees y notes opcionales
```

```
201 → { "data": { …reserva } }
      Location: /api/v1/reservations/{id}
400 → forma o reglas de negocio (ver abajo)
403 → el rol no puede reservar (guard de la ruta)
404 → la zona no existe, no es visible, o tu membresía no está activa
409 → ese hueco ya está ocupado
```

`status` no se manda: nace de `requiresApproval` de la zona (`true` → `PENDING`,
`false` → `CONFIRMED`). Aceptarlo del cliente sería saltarse la aprobación por un
JSON. Tampoco `userId` ni `communityId`.

Los cuatro `400` de negocio, y qué los provoca:

| Mensaje | Causa |
|---|---|
| La reserva no puede empezar en el pasado | `startsAt` < ahora |
| Las horas deben encajar en la rejilla | hora local que no es múltiplo de `slotMinutes` |
| La reserva cae fuera del horario | local antes de `openTime` o después de `closeTime`, o cruza medianoche local |
| La asistencia supera la capacidad | `attendees` > `capacity` de la zona |
| Se ha alcanzado el límite diario | ya hay `maxDailyReservations` reservas **CONFIRMED** ese día local |
| Esa zona común está dada de baja | `isActive: false` |

El límite diario cuenta solo `CONFIRMED`: una `PENDING` no ocupa el calendario, y
hacer que la cola de aprobación consumiera plaza significaría que una cola pudiera
bloquear un día entero.

**El solape no se comprueba, se demuestra.** No hay un "está libre" antes del
insert: dos peticiones simultáneas al mismo hueco pasarían cualquier comprobación
hecha en TypeScript. La única autoridad es el índice único
`(common_area_id, starts_at)`; una gana y la otra recibe `409`. A la pregunta
"¿puedo reservar a las 10:00?", la respuesta fiable es intentarlo.

### `GET /api/v1/communities/:communityId/reservations`

Cualquier miembro activo lee **todas** las reservas de su comunidad (también
`PROVIDER`), con `notes` redactado por fila: lo decide la base de datos, no el
backend.

| | Ve las reservas | Ve `notes` |
|---|---|---|
| `ADMIN` | todas | todas |
| `PRESIDENT` | todas | todas |
| `NEIGHBOR` | todas | solo las suyas |
| `PROVIDER` | todas | ninguna |

Filtros opcionales, combinables: `commonAreaId` (UUID), `date` (día **local** de la
comunidad), `status`, `page`, `limit`. Sin `status` salen `PENDING` y `CONFIRMED`;
las canceladas solo si se piden con `?status=CANCELLED`, porque la agenda por
defecto es lo que va a pasar.

```
200 → { "data": [ …reservas ], "meta": { …paginación } }
400 → filtro con forma inválida
403 → no es miembro
```

### `GET /api/v1/reservations/:id`

```
200 → { "data": { …reserva } }
400 → el `:id` no es un UUID
404 → no existe, o no es visible para ti
```

Un vecino que abre la reserva de otro recibe el detalle **con `notes: null`**: la
visibilidad de la fila es de comunidad entera, la redacción es una capa aparte.

### `POST /api/v1/reservations/:id/confirm`

Solo `ADMIN` (`R-3`). El rol lo decide la función dentro de la transacción; la ruta
no filtra por rol, para que haya un único dueño de la regla.

```
200 → { "data": { …reserva, "status": "CONFIRMED" } }
403 → no eres ADMIN de esa comunidad
404 → no existe o no es visible
409 → la reserva no está PENDING, o su hueco lo acaba de tomar otra
```

El orden importa: **primero los slots, después el status**. Si el hueco se ocupó
mientras la reserva esperaba aprobación, el `409` sale y la reserva **sigue
`PENDING`** — ni confirmada a medias ni auto-cancelada: quien decide si
rechazarla o reprogramarla es el `ADMIN` que la estaba confirmando. Por eso dos
`PENDING` pueden compartir hueco (ninguna escribe slots) y la segunda en ser
confirmada recibe `409`.

### `PATCH /api/v1/reservations/:id/cancel`

Dueño o `ADMIN`. Un `PRESIDENT`, aunque sea de la comunidad, recibe `403`.

```
200 → { "data": { …reserva, "status": "CANCELLED", "cancelledAt": "…" } }
400 → el cuerpo no está vacío ({"status": …} es 400, no un 200 que lo ignora)
403 → no eres el dueño ni un ADMIN
409 → ya estaba cancelada
```

El cuerpo debe ser `{}` o ausente: cancelar es cancelar, no hay nada que cambiar.

Cancelar **borra sus slots**: los slots son el calendario, y sin ese borrado la
zona quedaría bloqueada para siempre por una reserva que la aplicación dice
cancelada. Los tres cambios (status, `cancelledAt`, slots) son atómicos.

### `GET /api/v1/reservations/me`

La agenda propia **en todas las comunidades**, sin `:communityId` a propósito: el
alcance lo pone la función con el usuario de la sesión, y `notes` sale siempre sin
redactar porque todas las filas son del llamante.

Filtros: `status`, `page`, `limit`. No hay `commonAreaId` ni `date`: sin comunidad
en la ruta no tendrían ancla. Preguntar por las reservas de otro no da `403`, da
lista propia: decir "existe y no es tuya" también es filtrar.

```
200 → { "data": [ …reservas con communityName ], "meta": { … } }
401 → sin sesión
400 → filtro desconocido o con forma inválida
```

---

## Avisos

Cuatro rutas en **dos** routers: las dos de comunidad cuelgan de
`/api/v1/communities` y las otras dos de `/api/v1`. Como en incidencias, zonas y
reservas, la comunidad de `PUT` y `DELETE` sale de la propia fila, así que un
usuario de otra comunidad recibe **`404`** en ellas, no `403`: un `403`
confirmaría que ese id existe.

Tampoco hay `GET /announcements/:id`, igual que no lo hay en zonas comunes: el
listado **es** la lectura. Un aviso se localiza en su tablón.

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "title": "Corte de agua el jueves",     // 3–120
  "body": "El jueves de 9:00 a 14:00…",   // 1–5000
  "type": "MAINTENANCE",                  // GENERAL | URGENT | MAINTENANCE | MEETING
  "priority": "HIGH",                     // LOW | MEDIUM | HIGH
  "isPinned": true,
  "publishAt": "2026-10-06T09:00:00.000Z",
  "expiresAt": "2026-10-10T00:00:00.000Z", // null = no caduca
  "authorId": "uuid",                     // null si el autor se dio de baja
  "authorName": "Ana Ruiz Delgado",       // null si el autor se dio de baja
  "createdAt": "2026-10-05T10:00:00.000Z",
  "updatedAt": "2026-10-05T10:00:00.000Z"
}
```

`authorName` sale de `users.full_name`, y solo puede leerse desde una función:
el módulo no tiene ningún `SELECT` directo contra la tabla.

### Qué ve cada rol

La ventana (programado y caducado) se aplica en el listado **por rol**, no con
un parámetro:

| | Publicado y vivo | Programado | Caducado | Borrado |
|---|---|---|---|---|
| `NEIGHBOR` | ✅ | ❌ | ❌ | ❌ |
| `PROVIDER` | ✅ | ❌ | ❌ | ❌ |
| `PRESIDENT` | ✅ | ✅ | ✅ | ❌ |
| `ADMIN` | ✅ | ✅ | ✅ | ❌ |

Quien gestiona ve los programados para poder corregirlos antes de que salgan, y
los caducados para poder borrarlos o reabrirlos: con la ventana aplicada a
todos, un aviso caducado sería inalcanzable. **Nadie ve nunca uno borrado**,
gestión incluida.

### `GET /api/v1/communities/:communityId/announcements`

Cualquier miembro activo lee el tablón de su comunidad, con el orden fijado:
`isPinned` primero y `publishAt` descendente dentro de cada grupo.

| Filtro | Forma | Efecto |
|---|---|---|
| `type` | enum de tipos | solo ese tipo |
| `q` | hasta 100 caracteres | `ilike` sobre `title` y `body` |
| `page` | entero ≥ 1 (por defecto 1) | desplazamiento |
| `limit` | 1–100 (por defecto 20) | tamaño de página |

Parámetro desconocido (`?pinned=true`), `type` fuera de enum, `page=0`,
`limit=101` o `q` vacío son `400`: los filtros son estos y ninguno más.

```
200 → { "data": [ …avisos ], "meta": { page, limit, total, totalPages } }
400 → filtro con forma inválida
403 → no es miembro (o la membresía no está activa)
```

`total` cuenta los avisos del listado completo, no los de la página; una página
más allá del final devuelve `data: []` con el `total` real.

### `POST /api/v1/communities/:communityId/announcements`

Alta por `PRESIDENT` y `ADMIN` (AN-1), con el rol comprobado en el guard de la
ruta **y** repetido dentro de la función. `NEIGHBOR` y `PROVIDER` reciben `403`.

```jsonc
{ "title": "Junta de escala el martes",
  "body": "…",
  "type": "MEETING",          // opcional, por defecto GENERAL
  "priority": "HIGH",         // opcional, por defecto MEDIUM
  "isPinned": false,          // opcional
  "publishAt": "…",           // opcional, por defecto ahora
  "expiresAt": "…" }          // opcional, por defecto null (no caduca)
```

```
201 → { "data": { …aviso } }        // sin Location: no hay GET /announcements/:id
400 → forma inválida o expiresAt ≤ publishAt
403 → el rol no puede redactar avisos
```

Los defaults los pone la columna dentro de la función, no el backend: «no lo
mandaste» y «lo mandaste igual que el default» acaban en el mismo sitio, y solo
hay un sitio donde están escritos.

`authorId` y `communityId` **no se aceptan**: el autor lo pone la sesión
(`AN-9`) y la comunidad la decide la URL. Mandarlos es `400` por `.strict()`.

### `PUT /api/v1/announcements/:id`

Reemplazo completo, sin `PATCH`: los **ocho campos** son obligatorios, y
`expiresAt` admite `null` explícito («ya no caduca»), que es la única forma de
deshacer una caducidad.

El rol no está en el guard: lo decide la función con la fila delante, con lo que
un `NEIGHBOR` o un `PROVIDER` reciben `403` aunque la ruta no filtre por rol.

```
200 → { "data": { …aviso } }
400 → falta un campo, clave desconocida en el cuerpo, o expiresAt ≤ publishAt
403 → tu rol no puede editar avisos
404 → no existe, está borrado, o no es de tu comunidad
```

La edición **no cambia la autoria**: `authorId` y `authorName` siguen siendo los
de la publicación original, aunque edite otro `PRESIDENT`. Un `id`,
`authorId`, `communityId`, `createdAt` o `updatedAt` en el cuerpo es `400`.

### `DELETE /api/v1/announcements/:id`

Solo `ADMIN` (AN-5): el `PRESIDENT` redacta, fija y caduca, pero no archiva. El
único que lo dice es la función con la fila delante, porque la ruta no lleva
guard de rol.

Es **borrado lógico** (`deleted_at`): la fila sigue existiendo y desaparece del
listado para todos los roles.

```
200 → { "data": { "id": "…", "deleted": true } }
403 → "Solo un administrador puede borrar avisos."
404 → no existe, ya estaba borrado, o no es de tu comunidad
```

El segundo `DELETE` es `404`, no un `200` idempotente: la spec lo fija
expresamente, y lo mismo le pasa al `PUT` de un aviso ya borrado.

Este módulo **no tiene `409` ni `422`**: no hay índice único que pisar ni
estados que transitar (AN-11), y `422` no existe en el proyecto.

---

## Documentos

Cinco rutas en **dos routers**, como avisos: las dos de comunidad cuelgan de
`/api/v1/communities` y las otras tres de `/api/v1`. Quien ve qué lo decide
siempre `app_list_documents()` con la fila delante (DN-6), así que un
documento invisible para el actor es **`404`**, no `403` (C-8: un `403`
confirmaría que ese id existe).

Es el primer bloque que toca Storage: el binario **nunca** va en la base, solo
`storage_path`, la clave dentro del bucket privado `community-documents`
prefijada por `<communityId>/`. Esa ruta no sale nunca en una respuesta —ni en
el detalle ni en el listado—, así que un cliente no puede montarse una URL por
su cuenta. Quien descarga recibe una **signed URL** firmada por el backend.

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "title": "Actas de la junta de marzo",     // 1–120, con los espacios recortados
  "description": "…",                        // hasta 1000, o null
  "category": "MINUTES",                     // MINUTES | STATUTES | INVOICE | BUDGET | MAINTENANCE | OTHER
  "mimeType": "application/pdf",             // lista cerrada de 03_storage.sql
  "sizeBytes": 48312,                        // 1 … 10 MB, calculado del binario
  "checksum": "9f2b…",                      // SHA-256 hex del contenido (DN-12)
  "minRole": "NEIGHBOR",                     // NEIGHBOR | PRESIDENT | ADMIN | PROVIDER
  "isPublic": false,
  "uploadedBy": "uuid",                     // la sesión, nunca el cuerpo (DN-8)
  "uploadedByName": "Luis Mendoza Prat",     // null si el autor se dio de baja
  "createdAt": "2026-10-06T09:00:00.000Z",
  "updatedAt": "2026-10-06T09:00:00.000Z"
}
```

`storagePath` no existe en la respuesta. Tampoco `deletedAt`: el borrado no
devuelve la fila.

### Qué ve cada rol

Tres puertas y solo tres, en el orden del predicado:

1. **`ADMIN`** ve y descarga todo.
2. **ACL explícita** con `can_view` en la fila: vale para cualquier rol activo,
   **incluido `PROVIDER`**. Es la única puerta de `PROVIDER`.
3. **Visibilidad por rol**: miembro activo, **no `PROVIDER`**, y `isPublic` o
   umbral alcanzado. El orden real del enum es
   `NEIGHBOR < PRESIDENT < ADMIN < PROVIDER`; el `<> 'PROVIDER'` explícito es lo
   que impide que el orden por sí solo incluya al proveedor en cualquier umbral.

| | `minRole NEIGHBOR` | `minRole PRESIDENT` | `minRole ADMIN` | Con ACL `can_view` |
|---|---|---|---|---|
| `NEIGHBOR` | ✅ | ❌ | ❌ | ✅ |
| `PRESIDENT` | ✅ | ✅ | ❌ | ✅ |
| `ADMIN` | ✅ | ✅ | ✅ | ✅ |
| `PROVIDER` | ❌ | ❌ | ❌ | ✅ |

`isPublic: true` hace lo mismo que el umbral para los tres roles que no son
`PROVIDER` (la fórmula es `isPublic OR rol >= minRole`): un documento público
con `minRole: ADMIN` lo ven `NEIGHBOR` y `PRESIDENT` igualmente. **`PROVIDER`
no lo ve por publicado que esté**: para eso hace falta la ACL.

Y un borrado es borrado para todo el mundo, gestión incluida (DN-11).

### `GET /api/v1/communities/:communityId/documents`

Miembros activos de esa comunidad, con el orden fijado: `createdAt`
descendente (DN-7, lo último arriba).

| Filtro | Forma | Efecto |
|---|---|---|
| `category` | enum de categorías | solo esa categoría |
| `q` | hasta 100 caracteres | `ilike` sobre `title` y `description` |
| `page` | entero ≥ 1 (por defecto 1) | desplazamiento |
| `limit` | 1–100 (por defecto 20) | tamaño de página |

Parámetro desconocido (`?pinned=true`), `category` fuera de enum, `page=0`,
`limit=101` o `q` vacío son `400`: los filtros son estos y ninguno más.

```
200 → { "data": [ …documentos ], "meta": { page, limit, total, totalPages } }
400 → filtro con forma inválida
403 → no es miembro (o la membresía no está activa)
```

`total` cuenta el listado completo, no la página: una página más allá del
final devuelve `data: []` con el `total` real.

### `POST /api/v1/communities/:communityId/documents`

Alta en **`multipart/form-data`** y solo de `ADMIN` (DN-1): el guard de la ruta
corre antes de leer el archivo, y la función repite el rol dentro de la
transacción. `NEIGHBOR`, `PRESIDENT` y `PROVIDER` reciben `403`.

| Campo de formulario | Forma | Efecto |
|---|---|---|
| `file` | obligatorio | el binario; otro nombre de campo es `400` |
| `title` | obligatorio, 1–120 | el título |
| `description` | opcional, hasta 1000 | la descripción |
| `category` | enum, opcional | por defecto `OTHER` |
| `minRole` | `NEIGHBOR`/`PRESIDENT`/`ADMIN`/`PROVIDER`, opcional | por defecto `NEIGHBOR` |
| `isPublic` | `"true"` o `"false"`, opcional | por defecto `false` |
| `acl` | JSON `[{ userId, canView?, canDownload? }]`, opcional | la ACL, escrita en la misma transacción |

`PROVIDER` como umbral se acepta, pero no lo alcanza nadie por rol (la
comparación excluye a `PROVIDER` y ningún otro rol llega tan alto): solo lo
abren `ADMIN`, un `isPublic: true` o la ACL. En la práctica, umbral
`PROVIDER` deja el documento reservado a esos tres.

El archivo: hasta **10 MB** y con uno de los mimes de `03_storage.sql`
(`application/pdf`, `image/jpeg`, `image/png`, `image/webp`,
`application/msword`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`application/vnd.ms-excel`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`text/plain`, `text/csv`). Fuera de ahí, o pesando 10 MB y un byte más, es
`400` **antes** de tocar Storage: el orden del alta es validar, subir,
insertar (con compensación si el insert falla).

```
201 → { "data": { …documento } }   // cabecera Location: /api/v1/documents/{id}
400 → forma inválida, sin archivo, mime fuera de lista o archivo >10 MB
403 → tu rol no puede subir documentos
409 → la ruta ya está ocupada en el bucket — inalcanzable por la API,
      que genera la ruta con uuid v4; existe para que una colisión no sea 500
```

`uploadedBy` no se acepta en el cuerpo (`.strict()`): lo pone la sesión (DN-8).
Tampoco `storagePath`, `checksum` ni `sizeBytes`: el checksum y el tamaño salen
del binario (DN-12), no de lo que diga el cliente. La respuesta es una
**relectura** de la fila (DN-3), con los recortes y los defaults ya aplicados.

### `GET /api/v1/documents/:id`

El mismo predicado que el listado, con `id` y sin comunidad en la URL.

```
200 → { "data": { …documento } }
404 → no existe, está borrado, es de otra comunidad o este rol no lo ve
```

Los cuatro casos son el mismo `404`.

### `GET /api/v1/documents/:id/download`

La descarga son **dos consultas con dos significados distintos** (§5.5):

```
200 → { "data": { "url": "…", "expiresIn": 300 } }
404 → el primer paso no da la ruta: no existe, o este rol no lo ve
403 → el segundo paso no da la ruta: lo ve, pero no puede descargarlo
```

El `404` sale de la comprobación de visibilidad, así que no confirma la
existencia. El `403` llega después de superarla: una ACL con
`canDownload: false` **veta la descarga por rol**, aunque el documento sea
visible por `minRole` o por ser público.

`expiresIn` es `DOCUMENTS_SIGNED_URL_EXPIRES_IN` (60–3600, por defecto 300
segundos). La URL la firma el backend con la clave del servicio, que no sale
nunca en la respuesta.

### `DELETE /api/v1/documents/:id`

Solo `ADMIN`, y lo decide la función con la fila delante: la ruta no lleva
guard de rol. El `PRESIDENT` recibe `403` con mensaje propio y el objeto del
bucket no se toca.

Es **borrado lógico** (`deleted_at`) y el objeto del bucket se elimina
después, cuando el soft delete ya está commiteado (DN-11): si esa eliminación
falla, el `200` ya se ha ganado y queda un residuo logueado.

```
200 → { "data": { "id": "…", "deleted": true } }
403 → "Solo un administrador puede borrar documentos."
404 → no existe, ya estaba borrado, o no es de tu comunidad
```

El segundo `DELETE` es `404`, no un `200` idempotente, igual que en avisos.

---

## Finanzas

Nueve rutas en **dos routers**: seis de comunidad cuelgan de
`/api/v1/communities` y tres de gasto por id de `/api/v1`. Es el **único bloque
que es solo de `ADMIN`, listar incluido** (FN-1): la tesorería y el listado
confirman datos, así que un `NEIGHBOR`, `PRESIDENT` o `PROVIDER` recibe `403` en
las rutas de comunidad. En las de gasto por id resuelve la función con la fila
delante, así que un no-`ADMIN` recibe **`404`**, no `403` (C-8: un `403`
confirmaría que ese id existe).

Las **facturas no tienen ruta por id**: no hay `GET`, `PUT` ni `DELETE` de
factura (FN-8/FN-13). Las tres rutas de factura cuelgan de la comunidad. El alta
de gasto sí responde `Location` (porque existe `GET /api/v1/expenses/:id`); el de
factura **no la lleva**, a propósito. Las facturas **no se editan ni se borran**
por API: solo se crean y se pagan.

### Modelo de gasto

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "concept": "Reparación de la bomba",       // 1–120, con los espacios recortados
  "category": "MAINTENANCE",                 // MAINTENANCE | CLEANING | SECURITY | UTILITIES | ADMIN | INSURANCE | OTHER
  "amount": 1250.5,                          // número, no cadena; > 0 y ≤ 9 999 999 999,99
  "expenseDate": "2026-01-15",               // YYYY-MM-DD
  "supplier": "Bombeiros Zaragoza SL",       // hasta 200, o null
  "notes": "Cambio de la válvula.",          // hasta 1000, o null
  "invoiceId": "uuid",                       // factura de la MISMA comunidad, o null
  "invoiceNumber": "INV-2026-001",           // el número de esa factura, o null
  "createdBy": "uuid",                       // la sesión, nunca el cuerpo
  "createdByName": "Ana Belmonte",           // null si el autor se dio de baja
  "createdAt": "2026-10-08T09:00:00.000Z",
  "updatedAt": "2026-10-08T09:00:00.000Z"
}
```

`amount` sale como **número** (`1250.5`) y nunca como el string `"1250.50"` del
`numeric`: es parte del contrato (FN-9).

### Modelo de factura

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "number": "INV-2026-001",                  // 1–50, único por comunidad, con los espacios recortados
  "concept": "Seguro de la comunidad",       // hasta 120, o null
  "amount": 890.25,                          // número, no cadena
  "issueDate": "2026-01-10",                 // YYYY-MM-DD
  "dueDate": "2026-02-10",                   // YYYY-MM-DD, nunca anterior a issueDate
  "paidAt": "2026-02-01T09:00:00.000Z",      // instante, o null
  "status": "PENDING",                       // PENDING | PAID | CANCELLED (guardado)
  "effectiveStatus": "PAID",                 // PENDING | PAID | OVERDUE | CANCELLED (derivado, FN-5)
  "supplier": "Mapfre",                      // hasta 200, o null
  "isGenerated": false,                      // reservado; siempre false por API
  "createdBy": "uuid",
  "createdByName": "Ana Belmonte",
  "createdAt": "2026-10-08T09:00:00.000Z",
  "updatedAt": "2026-10-08T09:00:00.000Z"
}
```

`status` es lo que hay en la tabla y `effectiveStatus` lo que el cliente debe
pintar. **`OVERDUE` no se guarda nunca** (no hay jobs en el proyecto): se calcula
al leer como "`PENDING` con `dueDate` pasada". Una factura vencida tiene
`status: "PENDING"` y `effectiveStatus: "OVERDUE"`; al pagarla pasa a `PAID`.

### `GET /api/v1/communities/:communityId/expenses`

Solo `ADMIN`. Orden por `expenseDate` descendente.

| Filtro | Forma | Efecto |
|---|---|---|
| `category` | enum de categorías | solo esa categoría |
| `from` | `YYYY-MM-DD` | desde esa fecha, inclusive |
| `to` | `YYYY-MM-DD` | hasta esa fecha, inclusive |
| `page` | entero ≥ 1 (por defecto 1) | desplazamiento |
| `limit` | 1–100 (por defecto 20) | tamaño de página |

Parámetro desconocido (`?q=`), `category` fuera de enum, `page=0`, `limit=101` o
`from` posterior a `to` son `400`.

```
200 → { "data": [ …gastos ], "meta": { page, limit, total, totalPages } }
400 → filtro con forma inválida
403 → no eres ADMIN (o no eres miembro activo)
```

### `POST /api/v1/communities/:communityId/expenses`

Alta de `ADMIN`. El guard de la ruta corre antes de tocar la base y la función
repite el rol dentro de la transacción.

| Campo | Forma | Efecto |
|---|---|---|
| `concept` | obligatorio, 1–120 | el concepto |
| `category` | enum, opcional | por defecto `OTHER` |
| `amount` | número > 0, ≤ 9 999 999 999,99 | el importe |
| `expenseDate` | `YYYY-MM-DD` | la fecha |
| `supplier` | hasta 200, opcional | `null`/vacío se guarda como `null` |
| `notes` | hasta 1000, opcional | `null`/vacío se guarda como `null` |
| `invoiceId` | UUID de una factura **de la misma comunidad**, opcional | el vínculo (FN-10) |

```
201 → { "data": { …gasto } }   // cabecera Location: /api/v1/expenses/{id}
400 → forma inválida, o la factura es de otra comunidad (EXPENSE_INVOICE_MISMATCH)
403 → tu rol no permite gestionar gastos
```

`createdBy` no se acepta en el cuerpo (`.strict()`): lo pone la sesión. La
respuesta es una **relectura** de la fila, con los recortes y los defaults ya
aplicados.

### `GET /api/v1/expenses/:id`

El mismo predicado que el listado, con `id` y sin comunidad en la URL.

```
200 → { "data": { …gasto } }
404 → no existe, está borrado, es de otra comunidad o este rol no es ADMIN
```

Los cuatro casos son el mismo `404`.

### `PUT /api/v1/expenses/:id`

**Reemplazo completo** (FN-7): mismos campos que el `POST` y todos obligatorios
salvo los anulables, que aceptan `null` explícito para **limpiar** el valor.

```
200 → { "data": { …gasto } }
400 → forma inválida, o la factura es de otra comunidad
403 → "Solo un administrador puede gestionar gastos."
404 → no existe, está borrado o es de otra comunidad
```

### `DELETE /api/v1/expenses/:id`

Solo `ADMIN`, y lo decide la función con la fila delante. Es **borrado lógico**
(`deleted_at`).

```
200 → { "data": { "id": "…", "deleted": true } }
403 → "Solo un administrador puede gestionar gastos."
404 → no existe, ya estaba borrado, o no es de tu comunidad
```

El segundo `DELETE` es `404`, no un `200` idempotente.

### `GET /api/v1/communities/:communityId/invoices`

Solo `ADMIN`. Orden por `issueDate`.

| Filtro | Forma | Efecto |
|---|---|---|
| `status` | `PENDING`/`PAID`/`OVERDUE`/`CANCELLED` | filtra por el **estado efectivo** (FN-14) |
| `page` | entero ≥ 1 (por defecto 1) | desplazamiento |
| `limit` | 1–100 (por defecto 20) | tamaño de página |

`?status=OVERDUE` devuelve las vencidas sin que exista la fila `OVERDUE`:
compara con el estado derivado.

```
200 → { "data": [ …facturas ], "meta": { page, limit, total, totalPages } }
400 → filtro con forma inválida
403 → no eres ADMIN (o no eres miembro activo)
```

### `POST /api/v1/communities/:communityId/invoices`

Alta de `ADMIN`. `number` es único **por comunidad**: repetirlo es `409`.

| Campo | Forma | Efecto |
|---|---|---|
| `number` | obligatorio, 1–50 | el número, único en la comunidad |
| `concept` | hasta 120, opcional | la descripción |
| `amount` | número > 0 | el importe |
| `issueDate` | `YYYY-MM-DD` | la emisión |
| `dueDate` | `YYYY-MM-DD`, ≥ `issueDate` | el vencimiento |
| `supplier` | hasta 200, opcional | el proveedor |

```
201 → { "data": { …factura } }   // SIN cabecera Location (FN-13)
400 → forma inválida, o dueDate anterior a issueDate
403 → tu rol no permite gestionar facturas
409 → INVOICE_NUMBER_TAKEN: ya existe una factura con ese número en la comunidad
```

### `POST /api/v1/communities/:communityId/invoices/:invoiceId/pay`

Solo `ADMIN`, **sin cuerpo**. El primer pago pasa la factura a `PAID` con
`paidAt`; el segundo es un `409`, no un `200` idempotente (FN-6).

```
200 → { "data": { …factura } }   // status "PAID", effectiveStatus "PAID", paidAt con instante
400 → :invoiceId no es UUID, o se manda algo en el cuerpo
403 → tu rol no permite gestionar facturas
404 → la factura no existe o no es de tu comunidad
409 → INVOICE_ALREADY_PAID: esa factura ya está pagada
```

Pagar una factura `PENDING` **vencida** (que se lee como `OVERDUE`) es un pago
normal: la columna guardaba `PENDING` y pasa a `PAID`.

### `GET /api/v1/communities/:communityId/finance/summary`

Solo `ADMIN`, sin query. Devuelve **una fila** siempre, incluso con la comunidad
vacía (todo a `0` o `[]`).

```jsonc
{
  "data": {
    "expenseTotal": 350.0,                 // suma de todos los gastos
    "expenseCount": 3,
    "expenseByCategory": [                 // por categoría, de mayor a menor
      { "category": "CLEANING", "total": 150.0, "count": 2 }
    ],
    "expenseRecent": [                     // los 5 últimos por fecha
      { "id": "uuid", "concept": "C", "category": "CLEANING", "amount": 200.0, "expenseDate": "2026-01-12", "supplier": null }
    ],
    "invoiceTotal": 400.0,                 // suma de todas las facturas
    "invoiceCount": 3,
    "invoiceOpenAmount": 100.0,            // PENDING (pendiente + vencida)
    "invoicePaidAmount": 300.0,            // PAID
    "invoicePendingCount": 1,              // PENDING con dueDate aún no pasada
    "invoiceOverdueCount": 1               // PENDING con dueDate pasada
  }
}
```

```
200 → { "data": { …resumen } }
403 → no eres ADMIN (o no eres miembro activo)
```

### El vínculo gasto ↔ factura

Un gasto puede apuntar a una factura (`invoiceId`) **de su misma comunidad**.
Apuntar a una de otra comunidad es un `400` con el código propio
`EXPENSE_INVOICE_MISMATCH`, no un `VALIDATION_ERROR`: el cuerpo era válido, lo
que falla es la relación. La vista del gasto trae `invoiceNumber` para no
obligar a una segunda petición.

---

## Votaciones

Nueve rutas en **dos routers**: dos de comunidad cuelgan de
`/api/v1/communities` y siete por id de `/api/v1`. Es el bloque de la **papeleta
secreta** (V-2): **no existe** ninguna lectura de votos individuales, ni para
`ADMIN` ni para `PRESIDENT`; el único recuento es el agregado de
`GET /api/v1/votes/:id/results`, que suma y nunca enumera votantes. Tampoco hay
`DELETE /votes/:id` (V-14).

Un `PROVIDER` **no ve ni vota** votaciones (V-1): listar le da `403` y el detalle
`404`. La autorización va en dos capas: el guard de la ruta
(`requireCommunity` / `requireVote`) da el `403`/`404` grueso y cada función lo
repite dentro de la transacción.

### Qué ve cada rol

| Rol | Listar | Detalle | Crear/editar/publicar/cerrar | Votar | Resultados |
|---|---|---|---|---|---|
| `NEIGHBOR` | `200` (sin borradores) | `200`; `404` si es `DRAFT` | `403` | `200` (si `OPEN`) | según `resultVisibility` |
| `PRESIDENT` | `200` | `200` | `200` | `200` | siempre |
| `ADMIN` | `200` | `200` | `200` | `200` | siempre |
| `PROVIDER` | `403` | `404` | `404` | `404` | `404` |
| No-miembro | `403` | `404` | `404` | `404` | `404` |

Un `DRAFT` solo lo ven `PRESIDENT` y `ADMIN`; para los demás es **invisible**
(`404`, igual que si no existiera).

### Modelo

```jsonc
{
  "id": "uuid",
  "communityId": "uuid",
  "title": "¿Instalar cámaras en el parking?",  // 1–120
  "question": "¿Estás de acuerdo...?",          // 1–200
  "description": "Presupuesto estimado...",     // hasta 1000, o null
  "type": "SINGLE",                             // SINGLE | QUORUM
  "status": "OPEN",                             // DRAFT | OPEN | CLOSED (guardado)
  "effectiveStatus": "OPEN",                    // DRAFT | OPEN | CLOSED (derivado, V-6)
  "startsAt": "2026-10-01T08:00:00.000Z",
  "endsAt": "2026-11-01T20:00:00.000Z",         // siempre posterior a startsAt
  "allowAbstention": true,
  "quorumPercent": null,                        // 1–100 solo si type=QUORUM, si no null
  "resultVisibility": "LIVE",                   // AFTER_CLOSE | LIVE | ADMIN_ONLY
  "options": [
    { "id": "uuid", "label": "Sí", "position": 1, "isAbstention": false },
    { "id": "uuid", "label": "No", "position": 2, "isAbstention": false },
    { "id": "uuid", "label": "Abstención", "position": 3, "isAbstention": true }
  ],
  "myOptionId": "uuid",                         // la opción que votó este usuario, o null
  "createdBy": "uuid",                          // la sesión, nunca el cuerpo
  "createdByName": "Luis Mendoza",              // null si el autor se dio de baja
  "closedAt": null,                             // instante, o null
  "createdAt": "2026-10-01T08:00:00.000Z",
  "updatedAt": "2026-10-01T08:00:00.000Z"
}
```

`status` es la columna y `effectiveStatus` lo que el cliente debe pintar: una
votación `OPEN` cuyo `endsAt` ya pasó se **lee** como `CLOSED` sin tocar la fila
(V-6; no hay jobs). El filtro `?status=` compara con el estado **efectivo**.

La **abstención** no la manda el cliente (V-10): con `allowAbstention: true` el
backend añade `{ label: "Abstención", isAbstention: true }` al final de
`options`. Mandarla a mano es `400`.

### `GET /api/v1/communities/:communityId/votes`

Lista las votaciones visibles de la comunidad.

| Filtro | Forma | Efecto |
|---|---|---|
| `status` | `DRAFT`/`OPEN`/`CLOSED` | filtra por el estado **efectivo** |
| `page` | entero ≥ 1 (por defecto 1) | desplazamiento |
| `limit` | 1–100 (por defecto 20) | tamaño de página |

```
200 → { "data": [ …votaciones ], "meta": { page, limit, total, totalPages } }
400 → filtro con forma inválida
403 → eres PROVIDER, o no eres miembro activo
```

### `POST /api/v1/communities/:communityId/votes`

Alta de `PRESIDENT`/`ADMIN`. Nace siempre `DRAFT` (V-6); el `status` no se acepta
en el cuerpo.

| Campo | Forma | Efecto |
|---|---|---|
| `title` | obligatorio, 1–120 | el título |
| `question` | obligatorio, 1–200 | la pregunta |
| `description` | hasta 1000, opcional | `null`/vacío se guarda como `null` |
| `type` | `SINGLE`/`QUORUM`, opcional | por defecto `SINGLE` |
| `startsAt` | instante ISO 8601 | el inicio |
| `endsAt` | instante ISO 8601, posterior a `startsAt` | el cierre |
| `allowAbstention` | booleano, opcional | por defecto `true`; genera la abstención |
| `quorumPercent` | 1–100, obligatorio si `type=QUORUM` | el quórum (V-9) |
| `resultVisibility` | `AFTER_CLOSE`/`LIVE`/`ADMIN_ONLY`, opcional | por defecto `AFTER_CLOSE` |
| `options` | 2–20 cadenas de 1–120 (las reales) | las opciones |

```
201 → { "data": { …votación } }   // cabecera Location: /api/v1/votes/{id}
400 → forma inválida, opciones repetidas (VOTE_OPTION_DUPLICATE) o 'Abstención' a mano
403 → tu rol no permite gestionar votaciones
```

### `GET /api/v1/votes/:id`

```
200 → { "data": { …votación } }
400 → :id no es UUID
404 → no existe, está borrada, es de otra comunidad, es un DRAFT que no gestionas, o eres PROVIDER
```

### `PATCH /api/v1/votes/:id`

**Parcial** y **solo sobre un `DRAFT`** (V-7). Acepta los mismos campos que el
`POST` (incluidas `options`, que **reemplazan** la lista entera); las claves
ausentes no se tocan y `description` vacía limpia el valor.

```
200 → { "data": { …votación } }
400 → forma inválida, o el cuerpo va vacío
403 → ves la votación pero no la gestionas
404 → no existe o no es visible (incluido un DRAFT ajeno)
409 → VOTE_NOT_DRAFT: la votación ya no es un borrador
```

### `POST /api/v1/votes/:id/publish`

`DRAFT → OPEN`, sin cuerpo.

```
200 → { "data": { …votación } }   // status "OPEN"
400 → se manda algo en el cuerpo
403 → tu rol no permite gestionar votaciones
404 → no existe o no es visible
409 → VOTE_NOT_DRAFT: la votación no es un borrador
```

### `POST /api/v1/votes/:id/close`

`OPEN → CLOSED`, sin cuerpo; cierre anticipado incluido (pone `closedAt`).

```
200 → { "data": { …votación } }   // status "CLOSED", closedAt con instante
400 → se manda algo en el cuerpo
403 → tu rol no permite gestionar votaciones
404 → no existe o no es visible
409 → VOTE_ALREADY_CLOSED (ya cerrada, incluso por `endsAt`) o VOTE_NOT_OPEN (era DRAFT)
```

### `POST /api/v1/votes/:id/responses`

Emite el voto. **Un voto por usuario**: repetir **cambia** el voto (V-11), no da
`409` ni crea un segundo. El `userId` sale de la sesión, nunca del cuerpo.

| Campo | Forma | Efecto |
|---|---|---|
| `optionId` | UUID de una opción **de esta votación** | la opción elegida |

```
200 → { "data": { "voteId", "optionId", "weight", "createdAt", "updatedAt" } }
400 → forma inválida, o la opción no es de esta votación (VOTE_OPTION_INVALID)
404 → no existe o no es visible (un PROVIDER aquí ve 404)
409 → VOTE_NOT_OPEN (no está abierta / aún no empieza) o VOTE_CLOSED (ya cerró)
```

### `GET /api/v1/votes/:id/results`

El **recuento agregado**; nunca una fila por voto (V-2). Devuelve **una fila**
siempre, incluso sin votos. La visibilidad la decide `resultVisibility` (V-12):
`ADMIN`/`PRESIDENT` siempre; el resto, `LIVE` siempre, `AFTER_CLOSE` solo con el
estado efectivo `CLOSED`, `ADMIN_ONLY` nunca.

```jsonc
{
  "data": {
    "id": "uuid",
    "status": "OPEN",
    "effectiveStatus": "OPEN",
    "endsAt": "2026-11-01T20:00:00.000Z",
    "allowAbstention": true,
    "eligibleCount": 3,              // miembros activos que votan (sin PROVIDER)
    "turnout": 3,                    // votos emitidos
    "participationPercent": 100.0,
    "quorumRequired": false,         // type = QUORUM
    "quorumPercent": null,
    "quorumMet": null,               // true/false si QUORUM, null si no
    "abstentionCount": 0,
    "options": [
      { "id": "uuid", "label": "Sí", "position": 1, "isAbstention": false, "votes": 2, "percent": 66.67 }
    ]
  }
}
```

```
200 → { "data": { …recuento } }
403 → los resultados no son visibles todavía para tu rol
404 → no existe, está borrada, es de otra comunidad o eres PROVIDER
409 → VOTE_NOT_PUBLISHED: la votación es un DRAFT
```

### `GET /api/v1/votes/:id/results/export`

El mismo recuento en **CSV** (V-13), la única respuesta que **no** es el sobre
JSON. Una fila por opción, nunca una por voto.

```
200 → text/csv; charset=utf-8
      Content-Disposition: attachment; filename="votacion-########-resultados.csv"

opción,votos,porcentaje
Sí,2,66.67
No,1,33.33
Abstención,0,0
```

Las condiciones de error son las mismas que las de `GET /votes/:id/results`.

### Ciclo de vida

```
        POST /votes                 POST publish            POST close
DRAFT ───────────────► DRAFT ─────────────────► OPEN ─────────────────► CLOSED
  │                                              │  ends_at vencido (solo leído)
  └── PATCH (solo aquí)                          └── effectiveStatus "CLOSED"
```

`publish` y `close` son **manuales** (no hay jobs): una `OPEN` vencida por
`endsAt` no se cierra sola, se **lee** como `CLOSED`, y `close` sobre ella da
`VOTE_ALREADY_CLOSED`.

---

## IA

Asistente de la comunidad (chat con *tool calling*) y asistente de incidencias.
El prefijo es `/api/v1/ai` y **no** lleva `:communityId` en la URL (D-1): la
comunidad viaja en el cuerpo. El modelo **nunca** toca SQL: solo puede pedir
*herramientas* que el backend valida y autoriza (AI-1), así que la frase
"pregúntale a la IA" no abre un agujero nuevo en RLS.

### `POST /api/v1/ai/chat`

Un turno de conversación. Responde en **SSE**, la única ruta que no usa el sobre
JSON. El texto final se reemite troceado como `token`; si el modelo pide tools,
salen `tool_call` y `citation` antes. La sesión se crea si no se manda
`sessionId`, y el mensaje del usuario y la respuesta se persisten.

| Campo | Forma | Efecto |
|---|---|---|
| `message` | 1..4000 | el mensaje del vecino |
| `sessionId` | UUID (opcional) | continúa una sesión **tuya** |
| `communityId` | UUID (opcional) | contexto de comunidad; `403` si no eres miembro |

```
event: meta      data: { "type":"meta", "sessionId":"uuid", "model":"…" }
event: tool_call data: { "type":"tool_call", "name":"get_incidents", "args":{…} }
event: citation  data: { "type":"citation", "tool":"get_incidents", "ids":["uuid"] }
event: token     data: { "type":"token", "delta":"…" }
event: done      data: { "type":"done", "tokensIn":123, "tokensOut":45 }
event: error     data: { "type":"error", "code":"AI_PROVIDER_ERROR", "message":"…" }
```

Los errores **antes** del primer evento (sin proveedor, sin cuota, comunidad
ajena) salen como JSON normal; una vez abierto el stream solo se puede emitir
`event: error`.

```
200 → text/event-stream
400 → forma inválida
403 → la comunidad del cuerpo no es tuya
429 → AI_QUOTA_EXCEEDED (cuota diaria agotada)
503 → AI_NOT_CONFIGURED (sin proveedor configurado)
```

### `GET /api/v1/ai/chat/sessions`

Tus conversaciones, más recientes primero (AI-7).

```
200 → { "data": [ { "id", "title", "communityId", "model", "createdAt", "updatedAt" } ],
        "meta": { page, limit, total } }
```

### `GET /api/v1/ai/chat/sessions/:id/messages`

Los mensajes de una conversación **tuya**. La de otro da `404`, no `403`: no se
revela que exista.

```
200 → { "data": [ { "id", "role", "content", "toolCalls", "citations",
                    "tokensIn", "tokensOut", "createdAt" } ], "meta": {…} }
404 → CHAT_SESSION_NOT_FOUND
```

### `DELETE /api/v1/ai/chat/sessions/:id`

Borra una conversación tuya (derecho al borrado); los mensajes caen en cascada.

```
204 → sin cuerpo
404 → CHAT_SESSION_NOT_FOUND
```

### `POST /api/v1/ai/incidents/classify`

Clasifica una descripción libre en una propuesta `{ categoría, prioridad, título }`.
**Nunca crea** la incidencia (AI-2). Sin proveedor cae a la heurística local.

| Campo | Forma |
|---|---|
| `communityId` | UUID de una comunidad tuya |
| `description` | 3..2000 |

```
200 → { "data": { "category":"PLUMBING", "priority":"HIGH",
                  "title":"…", "description":"…",
                  "confidence":0.9, "needsHumanReview":false } }
400 → forma inválida
403 → la comunidad no es tuya
```

`needsHumanReview` se fuerza a `true` si la prioridad es `CRITICAL` o la
confianza queda por debajo del umbral, aunque el modelo diga lo contrario (AI-12).

### `POST /api/v1/ai/incidents/drafts`

Guarda la propuesta como **borrador** pendiente (caduca a los 7 días). La
`proposal` es opcional: si viene ya calculada no se reclasifica (D-2).

| Campo | Forma |
|---|---|
| `communityId` | UUID de una comunidad tuya |
| `description` | 3..2000 |
| `proposal` | objeto `{ category, priority, title, description, confidence, needsHumanReview }` (opcional) |

```
201 → Location: /api/v1/ai/incidents/drafts/<id>
      { "data": { "id", "proposal", "status":"PENDING", "confidence",
                  "needsHumanReview", "createdAt", "expiresAt" } }
400 → forma inválida
403 → no eres miembro de esa comunidad
```

### `POST /api/v1/ai/incidents/drafts/:id/confirm`

Confirma el borrador: crea la incidencia **a nombre del actor humano** y marcada
como `AI_SUGGESTION`. El cuerpo es un parche **parcial** sobre la propuesta
guardada; los límites son los de `incidents`, no los del `Proposal`.

| Campo | Forma |
|---|---|
| `title` | 5..200 (opcional) |
| `description` | 10..4000 (opcional) |
| `category` | enum `incident_category` (opcional) |
| `priority` | enum `incident_priority` (opcional) |
| `location` | ≤200 (opcional) |

```
201 → { "data": { …incidencia del bloque 04, "createdVia":"AI_SUGGESTION" } }
400 → forma inválida
404 → INCIDENT_DRAFT_NOT_FOUND (no existe o es de otro)
409 → INCIDENT_DRAFT_ALREADY_CONFIRMED | INCIDENT_DRAFT_NOT_PENDING (caducado/descartado)
```

### `GET /api/v1/ai/tools`

El catálogo de herramientas que **tu rol** puede usar, uniendo tus comunidades.

```
200 → { "data": [ { "name", "description", "roles":[…], "requiresCommunity" } ] }
```

### `POST /api/v1/ai/tools/:toolName/preview`

Ejecuta una tool directamente, sin LLM, para depurar. Autoriza igual que el chat
(AI-9): la tool existe y tu rol puede usarla, y solo ve los datos de esa
comunidad (AI-10).

| Campo | Forma |
|---|---|
| `communityId` | UUID de una comunidad tuya |
| `args` | objeto con los argumentos de la tool (por defecto `{}`) |

```
200 → { "data": { "tool":"get_community", "result":{…} } }
400 → args inválidos para esa tool
403 → AI_TOOL_FORBIDDEN (la tool existe, tu rol no puede)
404 → AI_TOOL_UNKNOWN (la tool no existe)
```

---

## MCP y agentes

El servidor MCP es un **adaptador de solo lectura** sobre el mismo bus de
herramientas que usa la IA de la aplicación (spec 16). No reimplementa nada y no
escribe: expone, por el protocolo MCP, las tools **no sensibles** que el rol del
token puede usar. Los **agentes** son actores con nombre que reutilizan el bucle del
asistente con un *system prompt* propio (su fichero `.agent.md`) y sus skills.

### `POST /api/v1/mcp/sessions`

Canjea la sesión del usuario por un **token de sesión MCP** (Bearer JWT normal en la
cabecera). El token es un JWT HS256 con `audience:'mcp'`, payload `{ sub, cid, role,
ver }` y vida `MCP_SESSION_TTL_SECONDS` (por defecto 3600). El rol se resuelve
contra la base al emitir **y en cada petición** MCP: sacar a alguien de la comunidad
(o cambiarle el rol) invalida el token al instante.

| Campo | Forma |
|---|---|
| `communityId` | UUID de una comunidad tuya |

```
201 → { "data": { "token":"…", "communityId":"…", "role":"ADMIN", "expiresAt":"…" } }
400 → VALIDATION_ERROR (communityId no es UUID)
403 → no perteneces a esa comunidad
```

### `POST /api/v1/mcp`

El endpoint MCP (JSON-RPC 2.0), autenticado con `Authorization: Bearer <token MCP>`
—no el access token de la API— y `Accept: application/json, text/event-stream`.
Métodos soportados: `tools/list` y `tools/call`. `GET /mcp` responde `405`.

`tools/list` devuelve **solo las tools de lectura no sensibles** del rol del token:
las financieras (`get_expenses`, `get_invoices`, `get_finance_summary`) y
`prepare_incident_draft` quedaron `sensitive` y **no se registran**. `tools/call`
ejecuta vía `runTool` (zod + rol + scope) dentro del contexto RLS del actor y deja
una fila en `audit_logs` (`agent_name:'mcp'`, `action:'mcp.tool_call'`). La
comunidad sale del token, nunca de los argumentos.

```
200 → { "jsonrpc":"2.0", "id":1, "result":{ "tools":[ … ] } }        # tools/list
200 → { "jsonrpc":"2.0", "id":1, "result":{ "content":[ … ] } }      # tools/call OK
200 → { … "result":{ "isError":true, "content":[ … ] } }             # tool ausente o args inválidos
401 → UNAUTHORIZED / TOKEN_REVOKED (falta el token, o ya no eres miembro)
404 → MCP_DISABLED (env MCP_ENABLED=false)
405 → VALIDATION_ERROR (GET; en modo stateless no hay stream)
429 → RATE_LIMITED
```

### `GET /api/v1/ai/agents`

Lista los agentes de **runtime** (Bearer JWT normal). Devuelve `name`, `title`,
`description`, `roles` y `skills`. Los agentes de desarrollo (testing,
documentation, security) no aparecen: no son ejecutables por HTTP.

```
200 → { "data": [ { "name":"community", "title":"…", "roles":["NEIGHBOR","PRESIDENT","ADMIN","PROVIDER"], "skills":[…] }, … ] }
401 → UNAUTHORIZED
```

### `POST /api/v1/ai/agents/:name/run`

Ejecuta un agente de runtime con su identidad (fichero `agents/<name>.agent.md`), sus
skills inyectadas como contexto y sus tools acotadas por tu rol y por la whitelist
del agente. No abre sesión de chat; **sí** deja auditoría `agent.run`.

| Campo | Forma |
|---|---|
| `communityId` | UUID de una comunidad tuya |
| `message` | string con la consulta |

```
200 → { "data": { "agent":"finance", "answer":"…", "citations":[ … ], "toolCalls":[ … ],
                  "tokensIn":n, "tokensOut":n, "model":"…" } }
400 → VALIDATION_ERROR (body inválido)
403 → tu rol no puede ejecutar ese agente (p. ej. NEIGHBOR en finance)
404 → AGENT_NOT_FOUND (no existe, o es un agente de desarrollo)
503 → AI_NOT_CONFIGURED (no hay proveedor LLM)
```

El presupuesto diario de IA y el rate limit se aplican igual que en el chat.

---

## APIs externas

Meteorología (Open-Meteo) y mapa (Photon) para la ficha de una comunidad, más el
geocodificado de su dirección. El **frontend nunca habla con el proveedor**
(EXT-1): el backend es un proxy con caché y normalización, así que no hay ninguna
clave en el cliente (ambos proveedores son anónimos). Las tres rutas cuelgan de
`/api/v1/communities/:communityId`.

**Toda integración degrada sola** (EXT-2): si el proveedor cae, `weather` y `map`
devuelven `200` con datos parciales o nulos y un `meta.reason`, **nunca un `5xx`**.
Solo `geocode`, que es una acción explícita de un `ADMIN`, falla ruidosamente. Los
resultados se cachean en `external_cache` con TTL por tipo, de modo que el widget
no depende de la disponibilidad del proveedor en cada carga.

### `GET /api/v1/communities/:communityId/weather`

El tiempo en la ubicación de la comunidad. Cualquier miembro activo (proveedor
incluido): son datos del barrio, no configuración.

```
200 → { "data": {
          "location": { "city":"Zaragoza", "latitude":41.6488,
                        "longitude":-0.8891, "timezone":"Europe/Madrid" },
          "current": { "temperatureC":21, "apparentTemperatureC":21,
                       "weatherCode":0, "condition":"CLEAR", "isDay":true },
          "today": { "minC":14, "maxC":24, "precipitationProbability":0,
                     "sunrise":"2026-10-14T08:12:00+02:00",
                     "sunset":"2026-10-14T19:04:00+02:00" },
          "updatedAt":"2026-10-14T10:00:00.000Z", "source":"open-meteo" },
        "meta": { "cached":false, "stale":false, "degraded":false } }
401 → UNAUTHORIZED
403 → FORBIDDEN (comunidad ajena o inexistente, C-8)
```

`data` puede ser `null` con un `meta.reason`: `NO_LOCATION` (la comunidad aún no
tiene coordenadas), `PROVIDER_ERROR` (el proveedor cayó y no había caché) o
`DISABLED` (integraciones apagadas). `meta.cached=true` si salió de caché fresca y
`meta.stale=true` si se sirvió una caché caducada porque el proveedor falló
(stale-while-error, EXT-4).

### `GET /api/v1/communities/:communityId/map`

El mapa de la comunidad. `location` sale **siempre** de la base de datos (es dato
propio, no del proveedor); solo los POIs dependen de Photon.

```
200 → { "data": {
          "location": { "addressLine1":"Calle de Prueba 1", "city":"Zaragoza",
                        "province":null, "postalCode":null, "country":"ES",
                        "latitude":41.6488, "longitude":-0.8891,
                        "timezone":"Europe/Madrid" },
          "providers": [ { "name":"Ferretería", "category":"Ferretería",
                           "osmKey":"shop", "osmValue":"hardware",
                           "latitude":41.649, "longitude":-0.889,
                           "distanceM":30, "address":null } ],
          "pois": [ { "name":"Parque", "category":"Parque",
                      "osmKey":"leisure", "osmValue":"park",
                      "latitude":41.6495, "longitude":-0.89,
                      "distanceM":120, "address":null } ],
          "updatedAt":"2026-10-14T10:00:00.000Z", "source":"photon" },
        "meta": { "cached":false, "stale":false, "degraded":false } }
401 → UNAUTHORIZED
403 → FORBIDDEN (comunidad ajena o inexistente, C-8)
```

`providers` son los oficios y tiendas de reparación (ferretería, fontanería,
farmacia, taller…); `pois`, el resto de puntos de interés. Se filtran por
`MAP_SEARCH_RADIUS_M` (haversine) y se ordenan por cercanía, con un tope de
`MAP_MAX_RESULTS` (EXT-11). Si el proveedor cae, `location` sigue presente y las
listas van vacías con `meta.degraded=true` (y `meta.reason`).

### `POST /api/v1/communities/:communityId/geocode`

Rellena `latitude`/`longitude` a partir de la dirección **ya guardada** de la
comunidad. Solo `ADMIN`. No acepta cuerpo ni reescribe la dirección (EXT-10): la
máquina aporta la posición, no corrige a la persona. Es el único endpoint que
escribe, y solo si resuelve; deja auditoría `community.geocode` (EXT-14).

```
200 → { "data": { "latitude":40.4168, "longitude":-3.7038,
                  "formattedAddress":"Calle Mayor 1, 28013 Madrid, España",
                  "source":"photon" } }
401 → UNAUTHORIZED
403 → FORBIDDEN (no eres ADMIN, o la comunidad no es tuya)
422 → GEOCODING_FAILED (la dirección no resuelve, o no hay dirección)
502 → EXTERNAL_PROVIDER_ERROR (el proveedor cae o agota el timeout)
503 → EXTERNAL_NOT_CONFIGURED (integraciones apagadas)
```

> Open-Meteo (CC-BY) y OpenStreetMap/Photon exigen atribución: la pinta el
> frontend, fuera del alcance de la API.

---

## Dashboard

Una sola llamada para pintar la portada: los contadores, las listas cortas y las
series del mes de una comunidad. Es **solo lectura** y **no escribe nada**
(DSH-12): ni `audit_logs` ni `notifications`.

La regla que lo gobierna todo es que **contar no es leer** (DSH-2). Los recuentos
y las series son la **foto agregada de la comunidad entera**, no la vista por rol
de quien pregunta: la autorización vive en `app_community_dashboard()`, que corre
`SECURITY DEFINER` y por eso agrega filas que la RLS por rol nunca le entregaría a
un `NEIGHBOR`. Las **listas cortas**, en cambio, sí respetan lo que puede ver cada
rol, porque nacen de las mismas consultas que el resto del API.

### `GET /api/v1/communities/:communityId/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD`

La portada de la comunidad. Cualquier miembro activo (proveedor incluido). El
bloque `finance` es `null` para todo rol que no sea `ADMIN` (DSH-3): viaja como
`null` y no como ceros, para no delatar ni la existencia de los importes.

`from` y `to` son opcionales (`YYYY-MM-DD` estricto). Por defecto, la ventana son
los **últimos 12 meses**; el rango máximo es de **24 meses** (DSH-5). Afectan a las
series (`incidents.byStatus`, `incidents.byCategory`, `reservations.byMonth`,
`finance.expensesByMonth`), **no** a los contadores ni a las listas, que son del
"ahora".

```
200 → { "data": {
          "community": { "id":"…", "name":"…", "city":"…",
                         "neighborCount":12, "memberCount":14 },
          "incidents": { "open":3, "inProgress":1, "pending":2, "critical":1,
                         "byStatus":  [ { "status":"OPEN", "count":3 } ],
                         "byCategory":[ { "category":"PLUMBING", "count":2 } ] },
          "reservations": { "upcomingCount":2,
                            "upcoming":[ { "id":"…", "commonAreaId":"…",
                                           "commonAreaName":"Piscina",
                                           "startsAt":"2026-10-20T10:00:00.000Z",
                                           "endsAt":"2026-10-20T11:00:00.000Z",
                                           "status":"CONFIRMED", "userId":"…",
                                           "userName":"Ana" } ],
                            "byMonth":[ { "month":"2026-10", "count":2 } ] },
          "announcements": { "latest":[ { "id":"…", "title":"…", "type":"INFO",
                                          "priority":"NORMAL", "isPinned":false,
                                          "publishAt":"2026-10-14T09:00:00.000Z" } ] },
          "votes": { "openCount":1,
                     "open":[ { "id":"…", "title":"…",
                                "endsAt":"2026-10-25T00:00:00.000Z" } ] },
          "finance": { "expenseTotal":350.5, "expenseCount":2,
                       "invoiceOpenAmount":800, "invoicePendingCount":1,
                       "invoiceOverdueCount":1,
                       "expensesByMonth":[ { "month":"2026-10", "total":100 } ] },
          "generatedAt":"2026-10-15T13:57:16.303Z",
          "period": { "from":"2025-11-01T00:00:00.000Z", "to":"2026-10-15T00:00:00.000Z" } } }
401 → UNAUTHORIZED
403 → FORBIDDEN (comunidad ajena o inexistente, C-8)
400 → VALIDATION_ERROR (fecha mal formada, `from > to`, o rango de más de 24 meses)
```

Detalles que el frontend da por hechos:

- **Incidencias.** `open` son las `OPEN`; `inProgress`, las `IN_PROGRESS`;
  `pending`, las `OPEN` **sin asignar**; `critical`, las `CRITICAL` que no están ni
  `RESOLVED` ni `CANCELLED`. Todas excluyen las borradas (DSH-7).
- **Reservas.** `upcoming` son las `CONFIRMED` o `PENDING` con `starts_at >= ahora`,
  las 5 más próximas y **sin `notes`** (es información del solicitante, no del
  vecindario). `byMonth` cuenta por mes de calendario (DSH-9).
- **Avisos.** Los 5 vigentes más recientes; los fijados (`isPinned`) primero. Un
  aviso caducado o borrado no aparece (DSH-10).
- **Votaciones.** Las `OPEN` no vencidas (`ends_at >= ahora`), hasta 5, y **sin
  recuento**: el resultado se pide en su propio endpoint (DSH-11).
- **Vecinos.** `neighborCount` cuenta los miembros `ACTIVE` con rol distinto de
  `PROVIDER` (un proveedor no es un vecino); `memberCount`, todos los `ACTIVE`
  (DSH-8).
- **Importes** como número y **fechas** como ISO 8601 en UTC con `Z`.

---

## Notificaciones

La campana del usuario: **estrictamente personales**, y **de solo lectura desde
el API**. El cliente no crea notificaciones; las genera el propio motor, dentro
de las escrituras que ya están autorizadas, con `app_notify()` (`02o_notifications.sql`,
NTF-1). Por eso no hay `POST /notifications`: un endpoint para inventarse avisos
sería un agujero, no una función.

### Modelo

```json
{
  "id": "…",
  "type": "INCIDENT_UPDATED",
  "title": "Tu incidencia cambió de estado",
  "body": "Fuga de agua · EN_PROGRESO",
  "payload": { "incidentId": "…", "status": "IN_PROGRESS" },
  "communityId": "…",
  "readAt": null,
  "createdAt": "2026-10-15T13:57:16.303Z"
}
```

- `type` es una de las 8 clases de `notification_type`. El catálogo de eventos
  (NTF-2): `INCIDENT_CREATED`, `INCIDENT_UPDATED`, `RESERVATION_CREATED`,
  `RESERVATION_CANCELLED`, `ANNOUNCEMENT_NEW`, `VOTE_OPEN`, `VOTE_CLOSED`,
  `MEMBER_JOINED`. Los que necesitarían un *job* o un `INSERT` directo
  (`INVOICE_DUE`, `AI_DRAFT_READY`, `INCIDENT_COMMENT`) quedan fuera.
- `payload` lleva los identificadores para que el frontend haga el enlace sin
  volver a resolver nada; `communityId` viaja en la fila para que una notificación
  global (la lista **no** se filtra por comunidad, NTF-3) sepa de dónde salió.
- `readAt` es `null` mientras no se ha leído, y una **fecha ISO** una vez leída.

### Quién recibe qué

La audiencia la decide el evento, no el rol de quien pregunta (NTF-4):

- **Dirección** (`ADMIN` y `PRESIDENT` `ACTIVE`): `INCIDENT_CREATED`,
  `MEMBER_JOINED`, `RESERVATION_CREATED`, `RESERVATION_CANCELLED`.
- **Difusión** (todos los `ACTIVE` **salvo** `PROVIDER`): `ANNOUNCEMENT_NEW`,
  `VOTE_OPEN`, `VOTE_CLOSED`.
- **Destinatarios concretos**: `INCIDENT_UPDATED` va al reportero y al proveedor
  asignado; `RESERVATION_CANCELLED` va también al reservante.

El **actor nunca se auto-notifica** (NTF-7): quien crea la incidencia, cancela su
reserva o publica el aviso no recibe su propio aviso. Tampoco hay deduplicación:
dos cambios de estado generan dos notificaciones.

### `GET /api/v1/notifications?unread=true&page=&limit=`

La lista del usuario, **global** (de todas sus comunidades), más nuevas primero.
`unread=true` deja solo las no leídas; `page` empieza en 1 y `limit` va de 1 a 100
(por defecto `page=1`, `limit=20`, NTF-5). La paginación viaja en `meta`.

```
200 → { "data": [ { …Notification… } ],
        "meta": { "page":1, "limit":20, "total":25, "totalPages":2 } }
401 → UNAUTHORIZED
400 → VALIDATION_ERROR (`unread` que no es "true"/"false", `page`<1, `limit` fuera de 1..100, o parámetro desconocido)
```

### `GET /api/v1/notifications/unread-count`

El número para el *badge* de la campana, sin traer la lista.

```
200 → { "data": { "count": 3 } }
401 → UNAUTHORIZED
```

### `PATCH /api/v1/notifications/:id/read`

Marca una como leída. Es **idempotente**: si ya estaba leída **conserva su
`readAt` original** (`coalesce(read_at, now())`) en vez de reescribirlo. Una
notificación de otro usuario es invisible por RLS y responde **404, nunca 403**:
un 403 confirmaría que ese `id` existe.

```
200 → { "data": { …Notification…, "readAt":"2026-10-15T14:02:00.000Z" } }
401 → UNAUTHORIZED
400 → VALIDATION_ERROR (`:id` que no es UUID)
404 → NOT_FOUND (no existe o no es tuya)
```

### `POST /api/v1/notifications/read-all`

Marca **todas** las no leídas del usuario y devuelve cuántas cambió (NTF-6).

```
200 → { "data": { "updated": 3 } }
401 → UNAUTHORIZED
```

---

## Errores

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo mal formado, `:communityId` que no es UUID |
| 400 | `EXPENSE_INVOICE_MISMATCH` | La factura vinculada a un gasto no es de su comunidad (código propio, no `VALIDATION_ERROR`) |
| 400 | `VOTE_OPTION_INVALID` | La opción votada no pertenece a esa votación |
| 400 | `VOTE_OPTION_DUPLICATE` | Hay opciones repetidas, o se manda 'Abstención' a mano |
| 401 | `UNAUTHORIZED` | Falta la cabecera, o la sesión ya no vale |
| 401 | `TOKEN_REVOKED` | La sesión se revocó |
| 401 | `TOKEN_EXPIRED` | El access token caducó |
| 401 | `INVALID_CREDENTIALS` | Login con email o contraseña incorrectos |
| 403 | `FORBIDDEN` | Autenticado pero sin permiso |
| 403 | `AI_TOOL_FORBIDDEN` | La tool de IA existe pero tu rol no puede usarla |
| 404 | `NOT_FOUND` | El endpoint no existe, o el recurso sí pero está dado de baja |
| 404 | `AI_TOOL_UNKNOWN` | El nombre de tool del `preview` no existe |
| 404 | `CHAT_SESSION_NOT_FOUND` | La conversación no existe o es de otro |
| 404 | `INCIDENT_DRAFT_NOT_FOUND` | El borrador no existe o es de otro |
| 409 | `CONFLICT` | El slug ya existe, el email en el registro, una transición de estado que no existe, un nombre de zona repetido, un hueco de reserva ya ocupado, o una ruta de documento ya ocupada en el bucket |
| 409 | `INVOICE_NUMBER_TAKEN` | Ya existe una factura con ese número en la comunidad |
| 409 | `INVOICE_ALREADY_PAID` | Se intenta pagar una factura ya pagada |
| 409 | `INVOICE_CANCELLED` | Se intenta pagar una factura cancelada |
| 409 | `VOTE_NOT_DRAFT` | Se edita o publica una votación que no es borrador |
| 409 | `VOTE_NOT_OPEN` | Se vota o cierra una votación que no está abierta |
| 409 | `VOTE_CLOSED` | Se vota una votación cuyo estado efectivo ya es `CLOSED` |
| 409 | `VOTE_ALREADY_CLOSED` | Se cierra una votación que ya está cerrada |
| 409 | `VOTE_NOT_PUBLISHED` | Se piden resultados de un borrador |
| 409 | `INCIDENT_DRAFT_ALREADY_CONFIRMED` | Se confirma un borrador ya confirmado |
| 409 | `INCIDENT_DRAFT_NOT_PENDING` | Se confirma un borrador caducado o descartado |
| 422 | `GEOCODING_FAILED` | La dirección de la comunidad no resuelve a coordenadas |
| 429 | `RATE_LIMITED` | Rate limit. `Retry-After` en la cabecera |
| 429 | `AI_QUOTA_EXCEEDED` | Cuota diaria del asistente agotada |
| 502 | `AI_PROVIDER_ERROR` | El proveedor de IA falló y no hay respaldo |
| 502 | `EXTERNAL_PROVIDER_ERROR` | El proveedor externo (Photon) falló en `geocode` |
| 503 | `AI_NOT_CONFIGURED` | El asistente no tiene proveedor configurado |
| 503 | `EXTERNAL_NOT_CONFIGURED` | `geocode` con las integraciones externas apagadas |
| 500 | `INTERNAL_ERROR` | Error no previsto |

Un mismo `code` puede venir de sitios distintos, y por eso el mensaje importa aunque
el cliente no debería leerlo: un `CONFLICT` puede ser "el slug está pillado" o "de
`OPEN` no se puede pasar a `RESOLVED`". Si el cliente necesita distinguirlos, no
puede con el `code` todavía.

El cliente decide **por el `code`**, nunca por el mensaje: el mensaje es para las
personas y puede cambiar; el código es parte del contrato.

Un `500` nunca lleva detalle del fallo hacia fuera, solo un `reference`
opaco que sí aparece en el log del servidor. Un error no previsto puede llevar en
su mensaje rutas, SQL o valores.