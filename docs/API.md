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

## Errores

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Cuerpo mal formado, `:communityId` que no es UUID |
| 401 | `UNAUTHORIZED` | Falta la cabecera, o la sesión ya no vale |
| 401 | `TOKEN_REVOKED` | La sesión se revocó |
| 401 | `TOKEN_EXPIRED` | El access token caducó |
| 401 | `INVALID_CREDENTIALS` | Login con email o contraseña incorrectos |
| 403 | `FORBIDDEN` | Autenticado pero sin permiso |
| 404 | `NOT_FOUND` | El endpoint no existe, o el recurso sí pero está dado de baja |
| 409 | `CONFLICT` | El slug ya existe, el email en el registro, una transición de estado que no existe, un nombre de zona repetido, o un hueco de reserva ya ocupado |
| 429 | `RATE_LIMITED` | Rate limit. `Retry-After` en la cabecera |
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