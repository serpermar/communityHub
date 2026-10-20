# Spec 15 — Frontend (SPA React)

> **Estado: IMPLEMENTED — implementada (2026-10-16).** Bloque 15, el
> primero y único de frontend. Decisiones `FE-1`…`FE-19` cerradas: ver §2 y §12
> (`FE-16`…`FE-19` son la revisión posterior de mejoras de UX, tema, rendimiento
> y cuenta).
> Este documento define **la SPA**
> que consume el backend ya terminado (bloques `01`–`14`) y, con él, **la
> plantilla de arquitectura de features** que el enunciado pide (§3 del PROMPT).
> **Fase:** 15 (frontend). Precedida de `01-authentication` … `14-notifications`
> (backend completo). Sucedida por el servidor MCP y los agentes de desarrollo
> (fuera de alcance aquí).
> **Backend que consume:** la API REST de `/api/v1` documentada en
> [`docs/API.md`](../docs/API.md). **No se toca el backend salvo lo mínimo**:
> `CORS_ORIGINS` ya apunta a `http://localhost:5173` (Vite) por defecto y en
> producción la SPA se sirve en el mismo origen (o tras un proxy) para que la
> cookie de refresh `sameSite=strict` viaje.
> **Backend nuevo:** `frontend/` (paquete nuevo; no existe todavía).
> **Fuera de alcance:** el servidor MCP, los agentes de desarrollo, el envío real
> de notificaciones (email/push/websocket) y el renderizado en servidor (SSR). Ver
> §16.
>
> La decisión de fondo es **FE-1: el backend es el único gatekeeper** y el
> frontend **solo refleja permisos para UX**; y **FE-2: disponibilidad primero**,
> es decir, la SPA no se acopla a ningún proveedor externo ni a la IA — cada
> feature degrada a un estado vacío/`null` cuando el backend dice que no hay dato
> (p. ej. meteorología o `finance: null` para un rol sin permiso).

---

## 1. Objetivo

Que un vecino pueda **usar CommunityHub desde el navegador**: entrar, elegir su
comunidad y, en pantallas por feature, ver y operar las incidencias, las reservas
de zonas comunes, los avisos, los documentos, las finanzas, las votaciones, la
asistencia de IA, el dashboard y la campana de notificaciones — **sin que el
frontend implemente autorización propia**: cada botón que se oculta o se
deshabilita es cosmético, y quien decide de verdad es el backend.

El objetivo de arquitectura es que `frontend/` demuestre la organización por
**features** (una carpeta por dominio, con sus `api`, `hooks`, `components`,
`pages`, `schemas` y `types`) sobre una base compartida pequeña (`components/`,
`layouts/`, `services/`, `context/`, `hooks/`, `types/`, `utils/`, `routes/`).

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| **FE-1** | **El backend es el único gatekeeper** (ARCHITECTURE §1.2). El frontend **oculta o deshabilita** acciones por rol, pero **nunca** decide si una operación es válida: toda mutación va al API y acepta su `403`/`409`/`400` | Bloquear en el cliente y no llegar al backend | El enunciado §9 lo dice literal: "nunca confiar únicamente en ocultar botones en React". Una regla duplicada en el cliente es una segunda copia que se desincroniza |
| **FE-2** | **La SPA no se acopla a proveedores externos ni a la IA**: meteorología, mapa, geocodificado y asistente llegan por la API; si el backend devuelve `null` o un error de proveedor, la feature muestra un estado degradado, no un error de pantalla | Llamar a Open-Meteo/Photon desde el navegador | Las claves no pueden llegar al cliente y el backend ya es un proxy con caché (ARCHITECTURE §8). El frontend solo pinta el DTO |
| **FE-2bis** | **Token de acceso en memoria** (`AuthContext`), **refresh token en cookie `httpOnly`** que gestiona el backend; el cliente **nunca** lee ni escribe el refresh | `localStorage` para el access token | `docs/SECURITY.md` y ARCHITECTURE §7: el access token en memoria no es alcanzable por XSS; el refresh vive en cookie inaccesible a JS |
| **FE-3** | **Un único cliente axios** con dos interceptores: uno adjunta `Authorization: Bearer`, y otro, ante un `401`, hace **un** `POST /api/v1/auth/refresh` y reintenta **una** vez; si el refresh falla, cierra sesión | Lógica de refresco repartida por feature | Un solo sitio donde vive la sesión evita N copias del mismo bug. Con peticiones concurrentes, el interceptor **encola** las que llegan mientras el refresh está en curso (una sola llamada de refresh) |
| **FE-4** | **Mismo origen**: en desarrollo, la SPA usa el **proxy de Vite** (`/api` → `http://localhost:3000`); en producción se sirve desde el mismo origen que la API (o tras un proxy que preserve la ruta `/api`) | CORS «de verdad» con la cookie cross-site | La cookie de refresh es `sameSite=strict` y `path=/api/v1/auth` (ARCHITECTURE §7, env `REFRESH_COOKIE_*`). Con el proxy, la cookie es *same-site* también en dev |
| **FE-5** | Enrutado con **React Router** (data router) + `<ProtectedRoute>` y `<RoleGate>`. La raíz `/` redirige según sesión y comunidad activa | Guardas por pantalla duplicadas | Un route tree con guards declarativos es una sola fuente de verdad del acceso visual |
| **FE-6** | **Estado de servidor con hooks propios** (`useAsync`/`useResource` + invalidación manual tras mutación), **sin** una librería de caché de servidor (TanStack Query no está en el stack del enunciado). **Context** solo para `Auth` y `Community` activa | Meter TanStack Query | El enunciado fija el stack (§3); añadir una dependencia grande para 14 features es scope creep. Los hooks propios bastan y no ocultan nada |
| **FE-7** | Formularios con **React Hook Form + `zodResolver`**. Los esquemas **se copian** del backend a `features/*/schemas` (no se importa el paquete del backend), con los **mismos mensajes en español** | Compartir los `zod` del backend por un paquete común | El enunciado pide el frontend como paquete aparte; un `.ts` compartido crearía acoplamiento de build entre dos apps. La spec del backend es la fuente; el frontend la refleja |
| **FE-8** | Estilos con **Tailwind CSS**. Componentes de UI propios y accesibles (`Button`, `Input`, `Select`, `Modal`, `Table`, `EmptyState`, `Toast`, `Spinner`) en `components/ui` | Una librería de componentes | El enunciado pide Tailwind; una librería extra es otra dependencia y otra API que aprender |
| **FE-9** | **Recharts** solo en el **dashboard** (series de incidencias, reservas y gastos). El resto de pantallas no trae librería de gráficos | Gráficos ad hoc | El enunciado pide Recharts para estadísticas; usarlo solo donde hay series evita peso en el resto |
| **FE-10** | **UI en español**, sin framework de i18n. Los textos son literales | `react-i18next` | El producto es monolingüe; un framework de i18n ahora es complejidad sin uso |
| **FE-11** | El **envelope de error** del backend (`{ "error": { "code", "message", "details" } }`) se traduce a un tipo `ApiError` en el interceptor. Las pantallas muestran `message` y, si `code === 'VALIDATION_ERROR'`, mapean `details` a los campos del formulario | Parsear el error en cada `catch` | Un único mapeo por código evita que cada pantalla reinvente el formato |
| **FE-12** | La **campana de notificaciones** sondea `unread-count` cada 60 s y **revalida al recuperar el foco** (`visibilitychange`), además de en cada mutación relevante | WebSocket/SSE | `14-notifications.md` §16 deja el tiempo real fuera de alcance; un sondeo con revalidación por foco es suficiente y no abre un canal persistente |
| **FE-13** | La **subida de documentos** va por `multipart/form-data` **a la API** (el backend valida y firma la *signed URL*); el cliente **nunca** habla con Storage | Subir directo al bucket | El backend es el gatekeeper de ACL y de tipo/tamaño (spec 08). El cliente no debe tener credenciales de Storage |
| **FE-14** | **Testing**: Vitest + React Testing Library + **MSW** para componentes e integración; **Playwright** para E2E con los 8 casos del enunciado (§18). Los componentes se prueban **con el backend mockeado**, nunca contra Supabase | E2E para todo | ARCHITECTURE §14: los tests de componente/integración con MSW son rápidos y deterministas; el E2E se reserva para los flujos de extremo a extremo |
| **FE-15** | **Administración de plataforma** para `ADMIN_SA`: una pantalla mínima que **crea comunidades** (`POST /communities`) y muestra el resultado. No hay listado global ni edición de ajenas: el `ADMIN_SA` crea pero **no lee** lo que no pertenece (C-12) | Un CRUD global de comunidades | El backend no expone «listar todas» ni administrar ajenas; la pantalla refleja lo único que el backend permite |
| **FE-16** | **Tema claro/oscuro con `class` de Tailwind** (`darkMode: 'class'`): la preferencia vive en `localStorage` (`communityhub.theme`), y si no hay, se toma `prefers-color-scheme`. La clase `dark` se pone en `<html>` | Solo tema claro, o dos hojas CSS | Tailwind ya está en el stack (FE-8); la variante `dark:` no añade dependencias y evita duplicar estilos. El «hueco» de §15 queda cerrado |
| **FE-17** | **Code-splitting por ruta** con `React.lazy` + `Suspense` y `manualChunks` en Vite (`vendor-react`, `vendor-charts`, `vendor-forms`). El `RouteFallback` cubre la carga | Un único bundle | Recharts pesa y solo lo usa el dashboard (FE-9); partirlo evita que la primera pintura cargue gráficos que quizá nadie abra |
| **FE-18** | **Estados de carga y error de primera clase**: `Skeleton`/`SkeletonList` en las listas, `ErrorBoundary` envolviendo el router, y `Modal` con *focus trap*, foco inicial y retorno, `aria-labelledby` y bloqueo de scroll. El shell tiene *skip link* a `#main` | Estados de carga mínimos y sin barreras | Son los tres puntos donde una SPA se rompe en silencio (pantalla blanca, spinner infinito, modal que no se cierra con Escape). Ninguno depende del backend |
| **FE-19** | **Cuenta propia**: `PATCH /auth/me` (editar `fullName`/`phone`) y `POST /auth/change-password` (exige la actual y **revoca las demás sesiones**). Cierra el hueco de §4.14 | Dejar la edición de perfil fuera de alcance | El backend ya expone ambos endpoints (spec 01 §5.5); la SPA los consume como cualquier otra feature, sin inventar contrato |

---

## 3. Estado real del backend que consume

El backend está **completo** (bloques `01`–`14`, `db:verify` en verde). El
frontend consume la API documentada en [`docs/API.md`](../docs/API.md); aquí solo
lo que condiciona decisiones del cliente:

- **Auth propia** (no GoTrue). `POST /auth/register`, `POST /auth/login`,
  `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/me`, `PATCH /auth/me`,
  `POST /auth/change-password`, `GET /auth/sessions`, `DELETE /auth/sessions/:id`.
- **Login/refresh devuelven el access token en el cuerpo** (`{ data: {
  accessToken, expiresIn, user } }`) y el **refresh token solo en cookie**
  `httpOnly`. El cliente debe mandar `withCredentials: true`.
- **Envelope**: éxito `{ "data": …, "meta"?: … }`; error `{ "error": { "code",
  "message", "details"? } }` (ver `docs/API.md` → Errores).
- **Roles de miembro**: `ADMIN`, `PRESIDENT`, `NEIGHBOR`, `PROVIDER`. Rol global
  de plataforma: `NEIGHBOR`, `ADMIN_SA`. La autorización fina vive en el backend.
- **Aislamiento por comunidad**: casi todo endpoint cuelga de
  `/communities/:communityId/…` y exige pertenencia; las rutas de recurso
  (`/incidents/:id`, `/votes/:id`…) resuelven el scope por el propio recurso.
- **`notifications`** es personal y **global** (sin `communityId` en la ruta).
- **`GET /auth/me`** devuelve `PublicUser` = `{ id, email, fullName, phone,
  avatarUrl, globalRole, emailVerifiedAt, createdAt }`.

---

## 4. Alcance funcional

Cada feature consume endpoints ya existentes. La columna «endpoints» remite a
`docs/API.md`.

### 4.1 Autenticación (`features/auth`)

- **Login** (`POST /auth/login`), **registro** (`POST /auth/register`),
  **logout** (`POST /auth/logout`, con confirmación).
- Tras login/refresh, cargar `GET /auth/me` y poblar `AuthContext`.
- Al montar la app, intentar `POST /auth/refresh` (silencioso) para recuperar la
  sesión desde la cookie; si falla, estado «anónimo».
- Pantallas: `/login`, `/register`.
- Gestión de sesiones en `/settings/sessions`: `GET /auth/sessions`,
  `DELETE /auth/sessions/:id`.

### 4.2 Shell y navegación (`layouts`, `app/routes`)

- **AppLayout** autenticado: cabecera con selector de comunidad, **campana**
  (con *badge*), menú de usuario (perfil, sesiones, salir).
- **Sidebar** por feature, con entradas visibles según rol (FE-1, §7).
- **AuthLayout** para `/login` y `/register`.
- Estados de carga (`Skeleton`), vacío (`EmptyState`) y error (`ErrorState`) en la
  base de cada pantalla de lista. Un `ErrorBoundary` envuelve el router para que un
  fallo de render no deje la pantalla en blanco (FE-18).
- **Atajo de accesibilidad**: *skip link* a `#main` como primer elemento del shell;
  el `Modal` atrapa el foco y se cierra con Escape (FE-18).

### 4.3 Comunidades y selección (`features/communities`)

- `GET /communities` (a las que pertenece) → poblar el selector y
  `CommunityContext`.
- `GET /communities/:communityId`, `PATCH /communities/:communityId`
  (configuración, solo `ADMIN`), `POST /communities` (`ADMIN_SA`).
- Al entrar en `/c/:communityId/...`, resolver la membresía del usuario **desde
  el backend**; si no es miembro, la API responde `403`/`404` y la UI lo muestra.

### 4.4 Incidencias (`features/incidents`)

- Listado con filtros (`GET /communities/:id/incidents?status=&priority=&category=&q=&page=&limit=`),
  detalle (`GET /incidents/:id`), alta (`POST …/incidents`), edición
  (`PUT /incidents/:id`), cambio de estado (`PATCH /incidents/:id/status`),
  borrado (`DELETE /incidents/:id`) y comentarios.
- La UI de estados respeta el **grafo** (OPEN→IN_PROGRESS→RESOLVED, CANCELLED
  final, reapertura solo `ADMIN`) ofreciendo solo transiciones válidas — pero el
  `409`/`403` del backend es la verdad.
- Asignación a un `PROVIDER` (selector) según lo que permita el backend.

### 4.5 Zonas comunes y reservas (`features/common-areas`, `features/reservations`)

- Zonas: listado, alta y edición (`…/common-areas`), disponibilidad
  (`GET /common-areas/:id/availability?date=`).
- Reservas: alta (`POST /common-areas/:id/reservations`), listado de comunidad,
  «mis reservas» (`GET /reservations/me`), cancelar (`PATCH /reservations/:id/cancel`),
  confirmar (`POST /reservations/:id/confirm`, **solo `ADMIN`**, R-3/D-2).
- La rejilla de slots viene de `availability`; la UI **no** calcula huecos por su
  cuenta (evita el bug de solape, spec 06).

### 4.6 Avisos (`features/announcements`)

- Listado, detalle, alta/edición/borrado según rol; fijado (`isPinned`),
  programación (`publishAt`) y caducidad (`expiresAt`).
- Contenido de usuario **renderizado como texto** (nunca
  `dangerouslySetInnerHTML`; ver §8).

### 4.7 Documentos (`features/documents`)

- Listado por rol, subida (`multipart/form-data` → `POST …/documents`), descarga
  (sigue la *signed URL* que devuelve `GET /documents/:id/download`, con sus
  `404`/`403` en dos pasos), borrado (soft delete).

### 4.8 Finanzas (`features/finance`)

- **Solo `ADMIN`** (el backend responde `403` a los demás y el dashboard da
  `finance: null`). Gastos, facturas, pago (`POST …/invoices/:id/pay`) y resumen
  (`GET …/finance/summary`).
- La UI **oculta** el módulo a quien no es `ADMIN`, pero se apoya en el `403`.

### 4.9 Votaciones (`features/voting`)

- Listado, detalle, crear/editar borrador, publicar (`POST /votes/:id/publish`),
  cerrar (`POST /votes/:id/close`), votar (`POST /votes/:id/responses`) y
  resultados (`GET /votes/:id/results`, export `GET /votes/:id/results/export`).
- El `PROVIDER` no lista ni ve detalle (`403`/`404`); la UI lo refleja.

### 4.10 Asistencia de IA (`features/ai`)

- Chat (`POST /ai/chat`, **SSE**), sesiones (`GET /ai/chat/sessions`, mensajes,
  borrado), clasificar incidencia (`POST /ai/incidents/classify` → propuesta),
  borradores (`POST /ai/incidents/drafts`, confirmar con actor humano),
  catálogo y *preview* de *tools*.
- El SSE se consume con `fetch` + `ReadableStream` (no con axios) y se pinta por
  trozos; los borradores **nunca** crean la incidencia sin confirmación del
  usuario (ARCHITECTURE §1.4). Modo sin IA (backend sin proveedor): la pantalla
  avisa y el resto de la app sigue funcionando.

### 4.11 Dashboard (`features/dashboard`)

- `GET /communities/:id/dashboard?from=&to=` → KPIs + listas cortas + series.
- Gráficos **Recharts** con `incidents.byStatus`, `incidents.byCategory`,
  `reservations.byMonth`, `finance.expensesByMonth` (§5.2 de la spec 13).
- `finance` se pinta **solo si no es `null`** (rol `ADMIN`).

### 4.12 Notificaciones (`features/notifications`)

- **Campana** en la cabecera con `GET /notifications/unread-count` (badge).
- Panel/lista: `GET /notifications?unread=&page=&limit=`, marcar una
  (`PATCH /notifications/:id/read`, idempotente), marcar todas
  (`POST /notifications/read-all`).
- Sondeo + revalidación por foco (FE-12). La lista es personal y global.

### 4.13 Miembros (`features/members`)

- Listado de miembros, invitaciones (`POST …/invitations`, listar, revocar),
  cambio de rol/estado (`PATCH …/members/:memberId`), canje de invitación
  (`POST /invitations/redeem`). Solo `ADMIN` invita y cambia roles (el backend lo
  impone); la UI lo refleja.

### 4.14 Cuenta y sesiones (`features/account`)

- **Ver y editar** el perfil propio: `GET /auth/me` y `PATCH /auth/me`
  (`fullName`, `phone`; vaciar `phone` lo borra). Formulario RHF + zod con toast de
  confirmación (FE-19).
- **Cambiar contraseña**: `POST /auth/change-password` (`currentPassword`,
  `newPassword` ≥ 12). El error `CURRENT_PASSWORD_INVALID` se mapea al campo
  *contraseña actual*, no a un mensaje genérico. Al éxito, se avisa de que las
  demás sesiones se han revocado.
- Gestión de sesiones: `GET /auth/sessions`, `DELETE /auth/sessions/:id`, y
  logout. La tabla de sesiones se refresca tras un cambio de contraseña.
- `AccountPage` usa dos formularios (`<form>` independientes) y una lista de
  descripción (`<dl>`) semántica para los datos de solo lectura.

### 4.15 Administración de plataforma (`features/platform-admin`)

- Visible **solo** para `globalRole === 'ADMIN_SA'` (FE-15). Pantalla
  `/admin/communities/new`: formulario de alta de comunidad
  (`POST /communities`, spec 02) y confirmación con el `communityId` creado.
- No hay listado global de comunidades: el backend no lo expone (C-12). Si el
  `ADMIN_SA` no pertenece a ninguna comunidad, `GET /communities` vuelve vacío y el
  selector de comunidad muestra un estado vacío con enlace a «crear comunidad».

---

## 5. Modelo de datos y tipos (contrato con el frontend)

Los DTOs son los de `docs/API.md`; en el cliente se declaran **una vez** en
`types/` (globales) o `features/*/types` (de dominio). Los tipos núcleo:

```ts
// types/api.ts — el envelope de todo el backend
type ApiSuccess<T> = { data: T; meta?: Record<string, unknown> }
type ApiErrorBody = { error: { code: string; message: string; details?: unknown } }

// features/auth/types.ts
type PublicUser = {
  id: string; email: string; fullName: string; phone: string | null;
  avatarUrl: string | null; globalRole: 'NEIGHBOR' | 'ADMIN_SA';
  emailVerifiedAt: string | null; createdAt: string
}

// types/roles.ts
type MemberRole = 'ADMIN' | 'PRESIDENT' | 'NEIGHBOR' | 'PROVIDER'

// features/communities/types.ts
type Community = { id: string; name: string; city: string | null; /* … */ }
type Membership = { communityId: string; role: MemberRole; status: MemberStatus }
```

El **envelope y los errores** se tipan genéricamente; cada feature declara el DTO
de su recurso. Las fechas viajan como ISO 8601 en UTC con `Z` y se formatean en el
cliente (nunca se envían formateadas).

---

## 6. API client y sesión

- `services/http.ts`: **una** instancia `axios.create({ baseURL: '/api/v1',
  withCredentials: true })`.
  - **Request**: adjunta `Authorization: Bearer <access>` si hay token en
    `AuthContext`.
  - **Response**: si `error.response.status === 401` y la ruta no es
    `/auth/refresh` ni `/auth/login`, llama a `POST /auth/refresh` **una vez**
    (encolando las concurrentes), actualiza el token y reintenta. Si el refresh
    falla, limpia la sesión y redirige a `/login`.
  - Normaliza el error a `ApiError { status, code, message, details }` (FE-11).
- `services/<feature>.ts` por dominio, con funciones tipadas que devuelven `data`
  (y `meta` cuando aplica). Las **mutaciones** devuelven el recurso y disparan la
  invalidación del hook de lista correspondiente.

---

## 7. Permisos (solo UX; el backend manda)

Matriz **orientativa** de visibilidad de navegación/acciones. Es un espejo de la
autorización real del backend; cuando difiera, **gana el backend** (FE-1).

| Feature | ADMIN | PRESIDENT | NEIGHBOR | PROVIDER | ADMIN_SA |
|---|---|---|---|---|---|
| Incidencias | ver/crear/gestionar | ver/crear | ver/crear (las suyas según rol) | ver asignadas | — |
| Zonas / Reservas | gestión total | ver/reservar | ver/reservar | — | — |
| Avisos | gestionar | gestionar | leer | leer | — |
| Documentos | gestionar | ver (según ACL) | ver (según ACL) | borde (ACL) | — |
| Finanzas | **sí** | **no** | **no** | **no** | — |
| Votaciones | gestionar/votar | crear/votar | votar | **no** | — |
| Dashboard | sí (+ `finance`) | sí | sí | sí | — |
| IA | sí | sí | sí | según *tool* | — |
| Miembros/invitaciones | gestionar | ver | ver (¿propio?) | — | — |
| Notificaciones | personales | personales | personales | personales | — |
| Comunidades | gestión (la suya) | — | — | — | **crear** |
| Administración de plataforma | — | — | — | — | **crear comunidades** |

Las celdas «—» y «no» son **ocultar en UI**, no autorización. Las reglas exactas
están en las specs `02`–`14` y en `docs/SECURITY.md`.

---

## 8. Errores

| Situación | `code` | Tratamiento en la UI |
|---|---|---|
| Formulario inválido | `VALIDATION_ERROR` | Pintar `details` en los campos (RHF `setError`); toast genérico |
| Credenciales | `INVALID_CREDENTIALS` | Mensaje en el formulario de login |
| Contraseña actual incorrecta | `CURRENT_PASSWORD_INVALID` | Mensaje inline en el campo *contraseña actual* |
| Sesión caducada / revocada | `TOKEN_EXPIRED`, `TOKEN_REVOKED` | Refresco transparente; si falla, `/login` |
| Sin permiso (`403`) | `FORBIDDEN`, etc. | Ocultar la acción + mensaje «no tienes permiso» |
| No encontrado (`404`) | `NOT_FOUND` | `EmptyState`/página 404 de la SPA |
| Conflicto de estado (`409`) | `CONFLICT`, `*_INVALID_TRANSITION`, … | Mensaje con la acción alternativa (la UI ofrece el estado válido) |
| Validación de negocio (`400`) | `EXPENSE_INVOICE_MISMATCH`, `VOTE_*`, … | Mensaje inline junto al campo implicado |
| Límite (`429`) | `RATE_LIMITED` | Aviso «demasiados intentos, espera» |
| `5xx` | — | `ErrorState` con reintento |

**XSS**: el contenido de usuario (avisos, comentarios, nombres) se pinta como
texto. Se prohíbe `dangerouslySetInnerHTML`; si en el futuro se renderiza markdown,
se sanea (ARCHITECTURE §15).

---

## 8-bis. Validaciones y casos límite

- Los esquemas `zod` del cliente reflejan los mínimos/máximos del backend
  (título ≥ 5, descripción ≥ 10, `unread` solo `"true"`/`"false"`, `page` ≥ 1,
  `limit` 1..100…). El backend vuelve a validar.
- Fechas de reserva: la UI solo ofrece **slots** de `availability` (evita el
  solape y el fallo de rejilla); nunca deja escribir una hora libre.
- Votación: la UI no permite abstenerse «a mano» si el backend lo rechaza; usa el
  mecanismo del backend.
- Token expirado a mitad de una acción: el interceptor reintenta el refresh y
  repite la petición sin perder el formulario.
- Multi-comunidad: cambiar de comunidad recarga los datos de la sección y respeta
  el `communityId` de la URL; nunca reutiliza estado de otra comunidad.
- IA sin proveedor: la feature avisa y no rompe; el resto de la app funciona.

---

## 9. Configuración (env)

- `VITE_API_BASE_URL` (por defecto `/api/v1`, vacío en prod con mismo origen).
- `vite.config.ts` con **proxy de desarrollo** `/api` →
  `http://localhost:3000` (FE-4); `changeOrigin: true` y `cookieDomainRewrite`
  para que la cookie de refresh funcione en dev.
- Sin claves: el frontend **no** maneja ninguna credencial de terceros ni de
  Storage.

---

## 10. Estructura del frontend

```
frontend/
├── index.html
├── package.json
├── vite.config.ts                 # proxy /api, alias @
├── tailwind.config.ts  postcss.config.js
├── tsconfig.json
├── src/
│   ├── main.tsx
│   ├── app/                       # router, providers, App
│   ├── routes/                    # route tree + ProtectedRoute/RoleGate
│   ├── layouts/                   # AppLayout, AuthLayout
│   ├── components/                # ui/ (Button, Input, Modal, Table…)
│   ├── components/ErrorBoundary.tsx  # límite de render (FE-18)
│   ├── services/                  # http.ts + api por dominio
│   ├── context/                   # AuthContext, CommunityContext
│   ├── hooks/                     # useAsync, useDebouncedValue, useMediaQuery…
│   ├── types/                     # api.ts, roles.ts
│   ├── utils/                     # fechas, moneda, cn()
│   └── features/
│       ├── auth/{api,hooks,components,pages,schemas,types}
│       ├── communities/  members/
│       ├── incidents/  common-areas/  reservations/
│       ├── announcements/  documents/  finance/
│       ├── voting/  ai/  dashboard/  notifications/  account/
│       └── ...
└── tests/  (e2e/ con Playwright)
```

---

## 11. Tests

- **Componente**: `*.test.tsx` con RTL sobre `components/ui` y componentes de
  feature (render, interacción, accesibilidad básica). La revisión FE-16…FE-19
  añadió `components/ui/Display.test.tsx` (Modal + `SkeletonList`) y
  `features/account/pages/AccountPage.test.tsx` (perfil, contraseña, errores).
- **Integración de feature**: con **MSW** simulando `/api/v1`; verifica estados
  carga/vacío/error y el camino feliz de cada formulario. La suite cubre también
  utilidades puras (`features/notifications/links.test.ts` para el enrutado de
  notificaciones, `hooks/useDebouncedValue.test.ts`).
- **E2E (Playwright)** — los 8 flujos del enunciado §18: **login**, **crear
  incidencia**, **consultar incidencia**, **crear reserva**, **cancelar reserva**,
  **crear votación**, **votar**, **consultar resultados**. Contra el backend real
  en modo test y datos sembrados.

---

## 12. Decisiones cerradas

Aprobadas por el desarrollador (2026-10-16):

- [x] **FE-1…FE-15** confirmadas sin cambios.
- [x] **Sondeo de notificaciones**: cada **60 s** **y** revalidación al recuperar
      el foco (`visibilitychange`) (FE-12).
- [x] **Administración de plataforma** para `ADMIN_SA`: **sí**, se incluye en este
      bloque (FE-15, §4.15).
- [x] **Vite + React 18** (`react@^18`, `react-dom@^18`). No hace falta React 19.

### Revisión de mejoras (FE-16…FE-19)

Cerrada tras la primera implementación, sobre el feedback de uso:

- [x] **FE-16 — Tema claro/oscuro** con `darkMode: 'class'`, preferencia en
      `localStorage` y respeto de `prefers-color-scheme`. Sustituye al «tema claro
      únicamente» que dejaba §15.
- [x] **FE-17 — Code-splitting** por ruta (`React.lazy` + `Suspense`) y
      `manualChunks` de Vite para React, Recharts y formularios.
- [x] **FE-18 — Carga y error de primera clase**: `Skeleton`/`SkeletonList`,
      `ErrorBoundary` y `Modal` accesible; *skip link* a `#main`.
- [x] **FE-19 — Cuenta**: `PATCH /auth/me` y `POST /auth/change-password`
      (cierra el hueco de §4.14).

---

## 13. Criterios de aceptación

1. `npm run dev` en `frontend/` levanta la SPA y habla con el backend por el proxy
   `/api` (cookie de refresh incluida).
2. Login, registro y logout funcionan; al recargar la página la sesión se recupera
   por `refresh` silencioso; a los 15 min el interceptor renueva sin que el usuario
   note nada.
2. Un usuario sin sesión es redirigido a `/login` desde cualquier ruta protegida.
3. Cada feature de §4 tiene sus pantallas de listado/detalle/alta y sus estados de
   carga, vacío y error.
4. La navegación y las acciones se ocultan/deshabilitan por rol **y** siguen siendo
   seguras: con permisos manipulados en el cliente, el backend responde
   `403`/`404` y la UI lo muestra.
2. El **dashboard** pinta KPIs y las 4 series con Recharts; `finance` solo si no es
   `null`.
3. La **campana** muestra el *badge*, lista, marca una y marca todas.
4. Los **8 flujos E2E** pasan.
4. `typecheck` (tsc), tests de componente e integración (MSW) y E2E, todos verdes.
6. Sin secretos en el cliente; el access token **nunca** se persiste.

---

## 14. Documentación a actualizar (al implementar)

- `docs/README.md`: fila «Frontend» y comando de arranque (`npm run dev` en
  `frontend/`).
- `ARCHITECTURE.md` §2 y §16: marcar la fase de frontend; enlazar esta spec.
- `docs/API.md`: sin cambios por parte del frontend (el contrato lo define el
  backend); si el frontend descubre una divergencia, primero se corrige la spec
  del backend. La revisión FE-19 consume los endpoints `PATCH /auth/me` y
  `POST /auth/change-password` que se documentaron en `docs/API.md` y en
  `specs/01-authentication.md` §5.5.
- `docs/CONTRIBUTING.md`: cómo se prueba el frontend (component/integration/E2E).
- `docs/SECURITY.md`: párrafo del bloque (tokens en memoria + cookie `httpOnly`,
  contenido de usuario como texto, el frontend no autoriza).

---

## 15. Fuera de alcance

- **SSR / Next**: la SPA es cliente puro (Vite).
- **Tiempo real** (websockets/SSE de notificaciones): solo el *stream* SSE del chat
  de IA, que ya expone el backend.
- **Envío de notificaciones** por email/push.
- **Servidor MCP** y **agentes de desarrollo** (specs propias, aún sin escribir).
- **Internacionalización** más allá del castellano. El tema claro/oscuro **ya no**
  está aquí: se implementó en FE-16.
- **PWA / offline**.
- **Recuperación de contraseña olvidada** (ver `specs/01-authentication.md` §12):
  el cambio autenticado sí está (FE-19), la recuperación por correo no.
