# CommunityHub — Análisis Arquitectónico (Fase 0)

> Documento previo a la implementación. Ningún código se escribe hasta aprobar este análisis.
> Estado: **PENDIENTE DE REVISIÓN**

---

## 0. Entorno de desarrollo detectado

Verificado en la máquina actual antes de diseñar nada:

| Recurso | Estado | Implicación |
|---|---|---|
| Node.js | v24.12.0 | OK. Backend Express + tooling moderno. |
| npm | 11.11.1 | OK. npm workspaces viable. |
| Git | 2.52.0 | OK. |
| Docker / docker compose | **NO INSTALADO** | Ya no es bloqueante: la BD es Supabase (gestionada). Ver D-01. |
| PostgreSQL (psql) | **NO INSTALADO** | irrelevant: se usa el Postgres de Supabase. |
| WSL | disponible (`wsl.exe`) | Reservado por si más adelante se quiere Docker local. |
| VS Code | instalado | OK. |
| **Presupuesto** | **$0 obrigatório** | Ningún servicio de pago en todo el proyecto. |

**Consecuencia:** la base de datos es **Supabase (plan Free)** y todas las APIs externas son de nivel gratuito verificado. El proyecto se ejecuta sin Docker y sin coste. Detalle y límites reales en la sección 8 y en D-01/D-03/D-04.

---

## 1. Arquitectura general

Monorepo con 4 paquetes Node + 1 servidor MCP. Cada paquete compila por separado; el contrato entre frontend y backend es la API REST documentada en OpenAPI.

```
┌──────────────────────────────────────────────────────────────┐
│                        CLIENTE                               │
│  React 18 + TS + Vite                                        │
│  features/ · react-router · axios · RHF · recharts · zod    │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS / JSON / JWT (Bearer)
                            ▼
┌──────────────────────────────────────────────────────────────┐
│                     BACKEND (Express)                        │
│                                                              │
│  routes → middleware(auth, rbac, rate-limit, validate)      │
│        → controllers → services → repositories → Prisma      │
│                                                              │
│  ┌────────────┐  ┌──────────┐  ┌──────────────┐            │
│  │   AI Hub   │  │  Agents  │  │ External API │            │
│  │ (assistant)│  │ (orques.)│  │  adapters    │            │
│  └─────┬──────┘  └────┬─────┘  └──────────────┘            │
│        │              │                                       │
│        └──── tool bus ─┘ (toolsKG, permisos, audit)          │
└────────────┬──────────────────────────────┬──────────────────┘
│ Prisma (TLS)                 │ MCP (stdio/SSE)
              ▼                              ▼
   ┌──────────────────────────┐      ┌──────────────┐
   │  SUPABASE (plan Free)    │      │  MCP Server  │
   │  ├ Postgres  500 MB      │      └──────────────┘
   │  ├ Auth (GoTrue)         │                │
   │  ├ Storage  1 GB         │◄───────┬───────┘
   │  └ Pausa auto: 7 días    │  contexto de actor
   └──────────────────────────┘
              ▲
              │
   ┌─────────┴──────────┐
   │  APIs externas $0  │
   │  Open-Meteo · OSM  │
   │  Gemini · Groq     │
   └────────────────────┘
```

Principios que gobiernan el diseño:

1. **Aislamiento por comunidad (`communityId`) como eje de seguridad.** Toda tabla de negocio lleva `community_id`. Ninguna query sin scope explícito.
2. **Backend como único gatekeeper.** Frontend solo refleja permisos para UX; nunca autoriza.
3. **La IA nunca habla con la base de datos.** Habla con herramientas tipadas (`MCP tools`) que internamente usan los mismos `services` que la API REST. Así el aislamiento se implementa una sola vez.
4. **Acciones sensibles = propuesta + confirmación humana.** La IA propone drafts; los endpoints de confirmación requieren un actor humano autenticado.

---

## 2. Estructura del monorepo

npm workspaces (sin herramientas adicionales de build orchestration; menos complejidad, suficiente para 4 paquetes).

```
communityHub/
├── package.json                 # workspaces + scripts raíz (orquestación)
├── tsconfig.base.json
├── .env.example                  # solo placeholders, ningún secreto real
├── .gitignore
├── supabase/
│   ├── config.toml
│   └── migrations/              # SQL de RLS y políticas (ver D-06)
├── docs/
│   ├── SETUP-SUPABASE.md        # paso a paso de conexión, project ref, SSL, pooler
│
├── backend/                     # API REST + hub de IA
│   ├── prisma/
│   │   ├── schema.prisma
│   │   └── migrations/
│   ├── src/
│   │   ├── app.ts               # composición: middlewares + routers
│   │   ├── server.ts            # bootstrap
│   │   ├── config/              # env (zod-validado), logger, db, redis?
│   │   ├── middleware/          # auth, rbac, scope, validate, errors, rateLimit, audit
│   │   ├── routes/
│   │   ├── controllers/         # HTTP: parse + delegar. Sin lógica de negocio
│   │   ├── services/            # lógica de negocio + autorización fina
│   │   ├── repositories/        # acceso a datos (Prisma). Único lugar con queries
│   │   ├── validators/          # zod schemas por endpoint
│   │   ├── modules/             # ai/ · external/ · jobs/
│   │   ├── utils/
│   │   ├── openapi/             # Generación de especificación
│   │   └── __tests__/
│   └── tsconfig.json
│
├── frontend/                    # SPA React
│   ├── src/
│   │   ├── app/                 # router, providers, layout raíz
│   │   ├── features/            # auth, incidents, reservations, votes, finance…
│   │   │   └── <feature>/{components,pages,hooks,services,schemas,types}
│   │   ├── components/          # UI compartida (Button, Modal, Table, EmptyState)
│   │   ├── layouts/
│   │   ├── services/            # cliente axios + instancia por dominio
│   │   ├── context/             # AuthContext, CommunityContext
│   │   ├── hooks/
│   │   ├── types/
│   │   └── utils/
│   └── tsconfig.json
│
├── mcp-server/                  # servidor MCP
│   ├── src/
│   │   ├── server.ts
│   │   ├── tools/               # una función por tool, schema zod
│   │   ├── context.ts           # resuelve actor + comunidad desde el transporte
│   │   └── registry.ts
│   └── tsconfig.json
│
├── skills/                      # Skills (markdown, portables entre agentes)
│   ├── community-management/    # SKILL.md
│   ├── incident-management/
│   ├── reservations/
│   ├── finance/
│   ├── authentication/
│   ├── database/
│   ├── security/
│   ├── testing/
│   └── documentation/
│
├── agents/                      # definición declarativa de cada agente
│   ├── community.agent.md
│   ├── maintenance.agent.md
│   ├── finance.agent.md
│   ├── documentation.agent.md
│   ├── testing.agent.md
│   └── security.agent.md
│
├── specs/                       # SDD: una spec por módulo, versionada
│   └── 01-authentication.md …
│
├── docs/
│   ├── README.md  ARCHITECTURE.md  SECURITY.md
│   ├── CONTRIBUTING.md  API.md  AI-DEVELOPMENT.md
│   ├── adr/                     # Architecture Decision Records
│   └── diagrams/
└── .github/workflows/           # CI: lint, typecheck, test, build, migrate-check
```

---

## 3. Modelo entidad-relación inicial

```
                    ┌──────────────┐
                    │    users     │
                    │──────────────│
                    │ id  PK       │
                    │ email  UQ    │
                    │ passwordHash │
                    │ fullName     │
                    │ globalRole   │──┐  NEIGHBOR|ADMIN_SA (staff del SaaS)
                    │ status       │  │
                    └──────┬───────┘  │
                           │          │
        ┌──────────────────┴──────────┴───────────────┐
        │              community_members              │  UQ(community_id,user_id)
        │─────────────────────────────────────────────│
        │ id PK | community_id FK | user_id FK        │
        │ role  → NEIGHBOR|PRESIDENT|ADMIN|PROVIDER  │
        │ status→ ACTIVE|SUSPENDED                   │
        │ unitNumber (portal/localización)            │
        │ permissions extra (JSONB, p.ej. bloques)    │
        └──────────────────┬──────────────────────────┘
                           │
   ┌───────────┬───────────┼─────────────┬──────────────┬──────────────┐
   │           │           │             │              │              │
┌──▼───────┐ ┌─▼─────────┐ ┌▼──────────┐ ┌▼───────────┐ ┌▼───────────┐
│communities│ │ incidents │ │comm_areas │ │announcements│ │ documents  │
│───────────│ │───────────│ │───────────│ │────────────│ │────────────│
│id PK      │ │id PK      │ │id PK      │ │id PK       │ │id PK       │
│name,slug  │ │community  │ │community  │ │community   │ │community   │
│address    │ │title,desc │ │name,type  │ │title,body  │ │title       │
│city,country│ │category  │ │capacity   │ │type        │ │category    │
│lat,lng    │ │priority  │ │openTime   │ │priority    │ │storage_path │
│timezone   │ │status    │ │closeTime  │ │isPinned    │ │visibility  │
│weatherCfg │ │createdBy │ │slotMinutes│ │publishAt   │ │minRole     │
└───────────┘ │assignedTo│ │maxPerDay  │ └────────────┘ └────────────┘
              │ │reporter │ │isActive   │
              │ │assets[] │ └───────────┘
              │ └─────────┘
   ┌──────────▼───────────────┐        ┌──────────────────────┐
   │   incident_comments     │        │      reservations    │
   │─────────────────────────│        │──────────────────────│
   │ id, incident_id, author │        │ id, community_id     │
   │ body, createdAt         │        │ common_area_id FK    │
   └─────────────────────────┘        │ user_id FK           │
                                      │ startsAt, endsAt     │
┌────────────────────┐               │ status → PENDING|     │
│       expenses     │               │  CONFIRMED|CANCELLED │
│────────────────────│               └──────────────────────┘
│ id, community_id   │        ┌──────────────────────┐
│ concept, category  │        │       invoices       │
│ amount, date       │        │──────────────────────│
│ provider, expense_ │        │ id, community_id     │
│ category, createdBy│        │ number, amount, dueAt│
│ document_id?       │        │ paidAt, status       │
└─────────┬──────────┘        │ isGenerated          │
          │                   └──────────────────────┘
          └───────── 1:N ─────┘

┌───────────────────────────────────────┐
│               votes                   │
│───────────────────────────────────────│
│ id, community_id, title, question     │
│ startsAt, endsAt, allowAbstention     │
│ type → SINGLE|MULTIPLE|QUORUM         │
│ quorumPercent, resultVisibility       │
│ createdBy, status → DRAFT|OPEN|CLOSED │
└───────────────────┬───────────────────┘
         ┌──────────┴──────────┐
┌────────▼─────────┐  ┌────────▼────────────┐
│  vote_options    │  │  vote_responses     │
│──────────────────│  │─────────────────────│
│ id, vote_id      │  │ id, vote_id         │
│ label, position  │  │ user_id FK          │
└──────────────────┘  │ option_id FK        │
                      │ weight              │
                      │ createdAt           │
                      │ UQ(vote_id,user_id, │
                      │    option_id)       │
                      └─────────────────────┘

┌───────────────────────────────────────┐
│          notifications                │
│───────────────────────────────────────│
│ id, user_id, community_id?, type      │
│ title, body, payload JSONB            │
│ readAt, createdAt                     │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│        refresh_tokens (o sessions)    │
│───────────────────────────────────────│
│ id, user_id, tokenHash, expiresAt,    │
│ revokedAt, userAgent, ip, replacedBy  │
└───────────────────────────────────────┘

┌───────────────────────────────────────┐
│        audit_logs (append-only)       │
│───────────────────────────────────────│
│ id, actorId, actorRole, community_id? │
│ action, entity, entityId, metadata    │
│ ip, userAgent, createdAt              │
└───────────────────────────────────────┘
```

Notas de modelado relevantes:

- **Aislamiento:** `community_id` con índice en todas las tablas hijas. Índice compuesto `(community_id, status)` en las de consulta frecuente.
- **Un voto por usuario:** `vote_responses` con `UNIQUE(vote_id, user_id)` y *upsert* transaccional. Así el "cambiar de voto" es un `DELETE+INSERT` dentro de la misma transacción, y no depende de la semántica de `option_id`.
- **Reservas duplicadas:** índice único parcial sobre `common_areas_id + starts_at WHERE status IN ('PENDING','CONFIRMED')` no es suficiente (solapes parciales), por lo que se añade una **tabla `area_slots`** discretizada por `slot_minutes`: reserva = varias filas de slot. Conflicto = violación de índice único, atómica y sin condición de carrera. Es la solución robusta frente al clásico "check-then-insert".
- **Documentos:** el binario vive en **Supabase Storage** (bucket privado, 1 GB gratis), nunca en la BD. `documents.storage_path` guarda la clave y `documents` + `document_acl` guardan metadatos y permisos. La descarga pasa por el backend, que valida permisos y genera una signed URL de corta duración.
- **Presupuesto:** decimal en euros con `Decimal(12,2)` de Prisma, nunca `float`.

---

## 4. Lista de módulos

| Módulo | Responsabilidad |
|---|---|
| `auth` | registro, login, refresh con rotación, logout, verificación |
| `users` | perfil, cambio de contraseña, preferencias |
| `communities` | CRUD, configuración, métricas |
| `members` | invitaciones, roles, suspensión, unidades |
| `incidents` | CRUD, estados, prioridades, comentarios, adjuntos, asignación a proveedor |
| `common-areas` | zonas comunes, horarios, slots |
| `reservations` | reserva, cancelación, disponibilidad, solapes |
| `announcements` | avisos, publicación, fijación |
| `documents` | subida, descarga, ACL, categorías |
| `finance` | gastos, facturas, presupuestos, resumen económico |
| `voting` | votaciones, opciones, voto único, resultados, quórum |
| `notifications` | generación de eventos, lectura, no leídas |
| `dashboard` | agregados para la home (KPIs + series para Recharts) |
| `integrations` | weather, maps, calendar (adapters con cache) |
| `ai-assistant` | chat contextual, tool calling, historial, citas |
| `ai-classifier` | propuesta de categoría/prioridad/título para incidencias |
| `agents` | definición y ejecución de agentes especializados |
| `audit` | registro de acciones sensibles |
| `common` | errores, logger, validadores, helpers |

Cada módulo es una carpeta vertical dentro de `routes/controllers/services/repositories`, siguiendo el flujo `Route → Controller → Service → Repository → DB`.

---

## 5. Roles y permisos

Dos niveles: **rol global** (staff del SaaS) y **rol dentro de la comunidad** (`community_members.role`). La autorización efectiva se calcula como `rol_global` + `rol_comunidad` + overrides.

| Capacidad | NEIGHBOR | PRESIDENT | ADMIN | PROVIDER |
|---|---|---|---|---|
| Ver datos públicos de su comunidad | ✅ | ✅ | ✅ | ✅ |
| Crear incidencia | ✅ | ✅ | ✅ | — |
| Ver incidencias propias | ✅ | ✅ | ✅ | ✅ (asignadas) |
| Ver todas las incidencias | — | ✅ | ✅ | — |
| Comentar | ✅ | ✅ | ✅ | ✅ (asignadas) |
| Cambiar estado de incidencia | — | — | ✅ | ✅ (transiciones permitidas) |
| Eliminar incidencia | — | — | ✅ (soft delete) | — |
| Reservar zona común | ✅ | ✅ | ✅ | — |
| Gestionar zonas comunes | — | — | ✅ | — |
| Ver avisos | ✅ | ✅ | ✅ | ✅ |
| Crear/pinear avisos | — | ✅ | ✅ | — |
| Ver documentos | según ACL | según ACL | ✅ (todos) | — |
| Gestionar documentos | — | — | ✅ | — |
| Ver gastos/facturas | — | ✅ (resumen) | ✅ (detalle) | — |
| Gestionar gastos/facturas | — | — | ✅ | — |
| Crear/cerrar votaciones | — | ✅ | ✅ | — |
| Votar | ✅ | ✅ | ✅ | — |
| Ver resultados (antes de cierre) | según `resultVisibility` | ✅ | ✅ | — |
| Gestionar miembros y roles | — | — | ✅ | — |
| Invocar IA y herramientas MCP | ✅ | ✅ | ✅ | ✅ (scope limitado) |

Implementación:

- **Middleware `requireRole(...roles)`** para el coarse check sobre el `community_members.role` de la comunidad extraída del recurso.
- **`authorize(resource, action)`** en la capa de servicio para el fine-grained check (p. ej. "un neighbor solo ve incidencias cuyo `reporter_id` es él").
- **Policy object por entidad** (`incident.policy.ts`) para que las reglas estén en un sitio declarativo, testeable y revisable — no dispersas en condicionales.
- **Matriz de referencia:** tabla anterior exportada a `docs/permissions.md` desde el propio código, para que no se desincronice.

---

## 6. Endpoints REST iniciales

Prefijo `/api/v1`. Autenticación: `Authorization: Bearer <accessToken>`.

```
# ── AUTH ─────────────────────────────────────────────
POST   /api/v1/auth/register
POST   /api/v1/auth/login
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
GET    /api/v1/auth/me

# ── USERS / COMMUNITIES / MEMBERS ────────────────────
GET    /api/v1/users/me
PATCH  /api/v1/users/me
POST   /api/v1/users/me/password
GET    /api/v1/communities
POST   /api/v1/communities                     (global ADMIN)
GET    /api/v1/communities/:communityId
PATCH  /api/v1/communities/:communityId
GET    /api/v1/communities/:communityId/members
POST   /api/v1/communities/:communityId/members
PATCH  /api/v1/communities/:communityId/members/:memberId
DELETE /api/v1/communities/:communityId/members/:memberId

# ── INCIDENTS ────────────────────────────────────────
GET    /api/v1/communities/:communityId/incidents        ?status&priority&category&q&page
POST   /api/v1/communities/:communityId/incidents
GET    /api/v1/incidents/:id
PUT    /api/v1/incidents/:id
PATCH  /api/v1/incidents/:id/status
DELETE /api/v1/incidents/:id                           (soft delete)
GET    /api/v1/incidents/:id/comments
POST   /api/v1/incidents/:id/comments

# ── COMMON AREAS / RESERVATIONS ──────────────────────
GET    /api/v1/communities/:communityId/common-areas
POST   /api/v1/communities/:communityId/common-areas
PUT    /api/v1/common-areas/:id
GET    /api/v1/common-areas/:id/availability?date
POST   /api/v1/common-areas/:id/reservations
GET    /api/v1/communities/:communityId/reservations
GET    /api/v1/reservations/me
PATCH  /api/v1/reservations/:id/cancel

# ── ANNOUNCEMENTS ─────────────────────────────────────
GET    /api/v1/communities/:communityId/announcements
POST   /api/v1/communities/:communityId/announcements
PUT    /api/v1/announcements/:id
DELETE /api/v1/announcements/:id

# ── DOCUMENTS ─────────────────────────────────────────
GET    /api/v1/communities/:communityId/documents
POST   /api/v1/communities/:communityId/documents      (multipart)
GET    /api/v1/documents/:id
GET    /api/v1/documents/:id/download
DELETE /api/v1/documents/:id

# ── FINANCE ───────────────────────────────────────────
GET    /api/v1/communities/:communityId/expenses       ?from&to&category
POST   /api/v1/communities/:communityId/expenses
GET    /api/v1/expenses/:id
PUT    /api/v1/expenses/:id
DELETE /api/v1/expenses/:id
GET    /api/v1/communities/:communityId/invoices
POST   /api/v1/communities/:communityId/invoices
POST   /api/v1/communities/:communityId/invoices/:id/pay
GET    /api/v1/communities/:communityId/finance/summary

# ── VOTING ────────────────────────────────────────────
GET    /api/v1/communities/:communityId/votes
POST   /api/v1/communities/:communityId/votes
GET    /api/v1/votes/:id
PATCH  /api/v1/votes/:id
POST   /api/v1/votes/:id/publish
POST   /api/v1/votes/:id/close
POST   /api/v1/votes/:id/responses                (upsert voto único)
GET    /api/v1/votes/:id/results
GET    /api/v1/votes/:id/results/export

# ── DASHBOARD / NOTIFICATIONS / INTEGRATIONS ─────────
GET    /api/v1/communities/:communityId/dashboard
GET    /api/v1/notifications
GET    /api/v1/notifications/unread-count
PATCH  /api/v1/notifications/:id/read
POST   /api/v1/notifications/read-all
GET    /api/v1/communities/:communityId/weather
GET    /api/v1/communities/:communityId/map

# ── AI ────────────────────────────────────────────────
POST   /api/v1/ai/chat                              (SSE stream)
GET    /api/v1/ai/chat/sessions
GET    /api/v1/ai/chat/sessions/:id/messages
DELETE /api/v1/ai/chat/sessions/:id
POST   /api/v1/ai/incidents/classify               → devuelve PROPUESTA, no crea
POST   /api/v1/ai/incidents/drafts
POST   /api/v1/ai/incidents/drafts/:id/confirm      (actor humano)
GET    /api/v1/ai/tools                             (qué tools existen)
POST   /api/v1/ai/tools/:toolName/preview          (dry-run de una tool)

# ── META ──────────────────────────────────────────────
GET    /api/v1/health
GET    /api/v1/docs                                 (Swagger UI)
GET    /api/v1/openapi.json
```

Convenciones transversales: paginación cursor o `page`+`limit`, envelope `{ data, meta }`, errores `{ error: { code, message, details? } }`, códigos HTTP correctos, `Idempotency-Key` opcional en escrituras sensibles.

---

## 7. Estrategia de autenticación

- **Access token JWT**: 15 min, payload mínimo (`sub`, `role`, `ver` de sesión). En `Authorization: Bearer`.
- **Refresh token**: opaco (no JWT), 30 días, **rotación con detección de reutilización**: cada refresh emite un token nuevo e invalida el anterior; si llega un refresh token ya revocado, se revoca la toda la familia de sesiones (robo de token).
- **Almacenamiento**: refresh en cookie `httpOnly` + `secure` + `sameSite=strict` (evita XSS y CSRF). Access token solo en memoria del cliente (no `localStorage`). Con `sameSite=strict`, la protección CSRF es inherente; se añade token CSRF si en el futuro se usan cookies cross-site.
- **Hash de contraseñas**: `argon2id` (preferido sobre bcrypt por resistencia a GPU).
- **RBAC** en cada endpoint (ver sección 5).
- **Scope de comunidad obligatorio** en `req.communityContext`, resuelto por un middleware `resolveCommunity` que:
  1. extrae `communityId` de la ruta o del recurso,
  2. verifica que el usuario es miembro activo,
  3. adjunta `role`, `permissions` y `communityId` al request.
- **Rate limiting** por `userId` + `ip` (límite la API de login y los endpoints de IA).
- **Sesiones**: tabla `refresh_tokens` con `revokedAt`, `userAgent`, `ip`; permite "ver y revocar sesiones".

### Auth propia vs Supabase Auth (decisión D-11)

Supabase incluye GoTrue, un sistema de auth completo y gratuito. La tentación es usarlo. Recomiendo **implementar el auth propio** y usar Supabase **solo como Postgres y Storage**. Motivos:

| | Auth propia | Supabase Auth |
|---|---|---|
| Coste | $0 | $0 |
| argon2id, rotación de refresh, detección de reutilización | Control total | Opaco |
| RLS de Supabase | Requiere el `role` de Supabase en el JWT | Nativa |
| Lo que demuestra el portfolio | Seguridad diseñada por ti | Un wrapper de una librería |
| Esfuerzo | ~2-3 días | ~medio día |

El enunciado pide explícitamente JWT, RBAC y refresh token como funcionalidad a desarrollar. Usar GoTrue convertiría la Fase 2 en un ejercicio de integración. **Auth propia**, y si más adelante quieres ahorrar tiempo, la interfaz `AuthProvider` deja el cambio a una línea.

---

## 8. Estrategia de integración con APIs externas

Reglas:

1. **Coste $0 absoluto.** Ningún proveedor de pago, en ningún entorno.
2. **El frontend nunca habla con el proveedor externo.** El backend es un proxy con caché, validación y normalización, para que las claves no lleguen al cliente y el rate limit se gestione en un sitio.
3. **Cache obligatoria** en toda integración gratuita, porque sus límites son por día y por IP.

```
React → GET /communities/:id/weather → WeatherAdapter → Open-Meteo
                                              │
                                              ├─ cache (TTL 15 min)
                                              ├─ normaliza a WeatherDTO
                                              └─ degradación a null si falla
```

### APIs de datos Cockcroft (verificadas)

| Servicio | Uso | Coste | Límite real | Mitigación |
|---|---|---|---|---|
| **Open-Meteo** | Meteorología por lat/lng | $0 | 600/min · 5 000/h · 10 000/día · 300 000/mes. Solo uso no comercial. Atribución CC BY 4.0 obligatoria | Cache 15 min por comunidad. El weather se pide una vez al cargar el dashboard, no en bucle. Atribución visible en la UI |
| **Photon (komoot.io)** | Geocoding y reverse geocoding | $0 | Sin cifra publicada; "uso razonable", throttling sin aviso | Cache largo (datos estáticos). `User-Agent` identificable, como pide su política |
| **OSRM demo** | Rutas / distancia | $0 | Servidor de demostración, sin garantía | Solo si aporta al caso de uso; cache 24 h |
| **OSM tiles + Leaflet** | Renderizado del mapa | $0 | Política de uso del tile server | Attribution de OpenStreetMap obligatoria |
| **Supabase** | Postgres + Storage + Auth | $0 | 500 MB BD · 1 GB storage · 5 GB egress · 2 proyectos · pausa a los 7 días sin actividad | Sección siguiente |

Descartados por exigir pago: Google Maps, Mapbox, HERE, TomTom, WeatherAPI.org, Meteostat de pago.

**Nominatim público queda descartado** aunque sea gratis: su política prohíbe explícitamente el uso desde plataformas de vibe-coding/low-code y exige máximo 1 req/s. Photon cubre el mismo caso de uso sin esa trampa.

### Proveedor LLM (verificado)

Anthropic, OpenAI, DeepSeek y Mistral **no tienen tier gratuito sin tarjeta**. Los que sí, a fecha de hoy:

| Proveedor | Modelos free | Límite verificado | Uso en CommunityHub |
|---|---|---|---|
| **Groq** | `openai/gpt-oss-120b`, `gpt-oss-20b`, `qwen3.8-27b` | 30 req/min · 1 000 req/día · 8 000 tok/min · 200 000 tok/día, sin tarjeta | **Principal.** Latencia muy baja, ideal para tool calling interactivo |
| **Google Gemini** | Gemini 3.x Flash, 2.5 Flash | Tokens gratis sin billing; los límites exactos solo se ven dentro de AI Studio | **Secundario / fallback.** Contexto largo |
| **OpenRouter** | ~19 modelos `:free` | 20 req/min · **50 req/día** sin créditos comprados | Solo para evals, no tráfico de app |

Diseño: **interfaz `LLMProvider` con router propio**. Groq como primario, Gemini como respaldo, y caché semántica de respuestas para consultas repetidas. 200 000 tokens/día dan para varios cientos de mensajes de comunidad al día, muy por encima de lo que necesita un portfolio.

Guardas obligatorias por los límites gratuitos:

- **Presupuesto diario por usuario** en `ai_usage` (tokens y peticiones), con respuesta clara al superar el límite.
- **Caché** de `classify_incident` por hash de la descripción: la clasificación es determinista y repetirla es tirar tokens.
- **Fallback sin red**: tests con `LLMProvider` fake. La suite completa debe pasar sin ninguna API key. Un test que falla porque se agotó un tier gratuito es un test roto.
- **Modelo elige por tarea**: extracción/clasificación con `gpt-oss-20b` (rápido y barato), razonamiento con `gpt-oss-120b`.

### Supabase Free: qué cambia de verdad

| Límite | Valor free | Impacto en el diseño |
|---|---|---|
| Tamaño BD | 500 MB | Sobrado para un portfolio. Obliga a no adjuntar binarios en BD |
| Storage | 1 GB | **Los documentos van a Supabase Storage, no a la BD.** La ruta se guarda en `documents.storage_path` |
| Egress | 5 GB/mes | Vigilar: no servir el SPA desde Supabase |
| Proyectos | 2 activos | 1 para dev, 1 opcional para demo |
| **Pausa por inactividad** | **7 días** | **Riesgo real:** el proyecto se apaga solo. Ver mitigación abajo |
| Backups automáticos | **No incluidos** | Sin plan de recuperación. Los datos demo son recreables con `npm run seed` |
| Row Level Security | Disponible | **Activar siempre** (D-06). Es la mejor relación esfuerzo/seguridad aquí |

Mitigaciones de la pausa:

- Script `GET /api/v1/health` que hace un `SELECT 1` y documentar en el README que hay que "despertar" el proyecto desde el panel de Supabase.
- Un pequeño script `npm run supabase:ping` para activar el proyecto antes de una demo.
- **Los tests de integración no deben apuntar a Supabase por defecto**, o la CI se rompe cada semana. Se ejecutan contra la instancia de test creada por el propio runner (Neon/Postgres efímero gratuito) o se saltan de forma explícita con una razón.

**PostgreSQL real, no emulación.** Supabase es Postgres auténtico, así que Prisma, migraciones, `Decimal`, índices parciales, `jsonb` y RLS funcionan sin compromiso. La decisión no degrada el diseño.

---

## 9. Arquitectura de IA

Dos funciones distintas, deliberadamente separadas:

### 9.1 AI Community Assistant (chat)
Pipeline:

```
Mensaje del usuario
  ↓
AuthContextMiddleware      → userId + memberships + comunidad activa
  ↓
AssistantService           → decide si necesita herramientas
  ↓
Tool loop (max N iteraciones, con presupuesto de tokens)
  ├── get_open_incidents()
  │     └── ToolRegistry → requireRole + requireCommunityMember
  │            └── Service → Repository (scoped) → DB
  ↓
Sintesis de la respuesta en lenguaje natural
  ↓
Citas: cada afirmación lleva el id/recurso del que salió
```

- **Tool calling** nativo del proveedor LLM (el modelo pide una tool, el backend la ejecuta con validación zod + autorización, y devuelve el resultado).
- **Límites duros**: máximo de iteraciones, timeout total, y whitelist de tools por rol (un `PROVIDER` solo ve tools de incidencias asignadas).
- **Aislamiento**: el contexto que se le da al modelo ya viene filtrado por el backend. El prompt nunca recibe un `community_id` del cliente sin validar.
- **Sin acceso directo a SQL.** Prohibido explícitamente.
- **Respuestas fundamentadas**: el modelo debe citar los recursos usados; si no tiene datos, lo dice. Se registra en `ai_chat_messages` para trazabilidad y evaluación.
- **Privacidad**: los prompts con datos personales se minimiseizan; las conversaciones se guardan en BD con retención limitada y opción de borrado por el usuario.

### 9.2 AI Incident Assistant (clasificación)

```
Descripción libre del vecino
  ↓
Schema estricto de salida { category, priority, title, description, confidence, needsHumanReview }
  ↓
Validación zod: category ∈ enum, priority ∈ enum
  ↓
Normalización heurística (p.ej. palabras clave → HEATING/HIGH) como fallback si el modelo no responde
  ↓
UI: "He preparado esta incidencia. Revísala y confirma."
  ↓
Usuario confirma (o edita) → se crea la incidencia en su nombre, auditada
```

Nunca se crea nada automáticamente. Reglas: si `priority = CRITICAL` o `confidence < umbral`, se fuerza `needsHumanReview`; si el texto menciona agua/gas/ascensor sin más, se sugiere prioridad mínima y se pide confirmación explícita. **El actor que crea es siempre un humano autenticado** (`createdBy` = usuario real, `createdVia = 'ai_suggestion'` para trazabilidad).

### Proveedor LLM

Abstracción `LLMClient` (Groq como primario, Gemini como fallback, ambos en tier gratuito; ver sección 8) y **modo sin key obligatorio**: si no hay `GROQ_API_KEY`, el asistente responde "IA no configurada" y el clasificador cae a heurísticas. La aplicación y la suite de tests deben ser plenamente funcionales sin ninguna API key ni conexión a internet.

---

## 10. Arquitectura de Agents

Cada agente = **definición declarativa** (rol, skills que usa, tools permitidas, límites) + **runtime** compartido. La definición en `agents/*.agent.md` y el registro en código deben estar sincronizados (test que lo verifique).

```
AgentRegistry
  ├── community     → tools: communities, members, announcements, documents, weather
  ├── maintenance   → tools: incidents, common_areas, reservations, classify_incident, providers
  ├── finance       → tools: expenses, invoices, finance_summary
  ├── documentation → tools: search_specs, search_code, openapi_schema, write_docs_proposal
  ├── testing       → tools: list_coverage_gaps, suggest_test_cases, run_tests, read_failures
  └── security      → tools: read_repo, grep_patterns, audit_logs, dependency_scan
```

Invariantes comunes a todos los agentes:

- **Tool whitelist estricta** por agente (no "hereda todo").
- **Human-in-the-loop** en acciones sensibles (escrituras, migraciones, cambios de permisos). El agente produce un *plan*; la ejecución pasa por un endpoint que exige un actor humano.
- **Presupuesto**: límite de iteraciones y de llamadas a tools por sesión.
- **Trazabilidad**: toda tool call va a `audit_logs` con agente, tool, params (redactados), resultado y duración.
- **Agents de desarrollo** (testing, security, documentation) operan **solo en modo lectura** sobre el repositorio. Ninguno escribe en el repo automáticamente.

---

## 11. Arquitectura de Skills

Skills en `skills/*/SKILL.md` como markdown estructurado (formato tipo Anthropic Agent Skills): `name`, `description`, secciones de objetivo/contexto/reglas/tools/restricciones/ejemplos/criterios de éxito.

Estructura de cada una:

```
skills/incident-management/
├── SKILL.md          # objetivo, reglas, tools permitidas, restricciones
├── playbooks/        # flujos: triage.md, escalado.md, cierre.md
└── examples.md       # casos buenos/malos
```

Mapa skill → tools:

| Skill | Tools |
|---|---|
| `community-management` | `get_community`, `get_members` |
| `incident-management` | `get_incidents`, `get_open_incidents`, `get_incident`, `create_incident_draft`, `set_incident_status` |
| `reservations` | `get_areas`, `get_availability`, `get_reservations`, `get_user_reservations` |
| `finance` | `get_expenses`, `get_invoices`, `get_finance_summary` |
| `authentication` | *(sin tools; reglas de sesión y autorización)* |
| `database` | *(convenciones de migración y modelado)* |
| `security` | checklist y patrones |
| `testing` | estrategia y plantillas |
| `documentation` | plantilla de spec y de docs |

Una skill es **documentación operacional que el agente carga como contexto**. No es código. Se versionan y se revisan con el mismo rigor que el código, porque gobiernan el comportamiento del sistema.

---

## 12. Arquitectura MCP

Dos piezas: el **bus de herramientas** en el backend (fuente única de verdad) y el **servidor MCP** como adaptador.

```
                 ┌──────────────── ToolRegistry (backend) ────────────────┐
                 │  nombre, schema zod, roles permitidos,               │
                 │  requiere scope de comunidad, es sensible,           │
                 │  fn(args, ctx) → resultado                            │
                 └───────┬──────────────────────────────┬────────────────┘
                         │                              │
              Assistant / Agents                 MCP Server
              (tool calling en el chat)        (Model Context Protocol)
                         │                              │
                         └────── mismos services ────────┘
                                   (una sola lógica de negocio)
```

Herramientas iniciales (las del enunciado, más las necesarias):

```
get_community()            get_members()               get_announcements()
get_announcement(id)       get_incidents()             get_open_incidents()
get_incident(id)           create_incident_draft()     set_incident_status()
get_common_areas()         get_availability()          get_reservations()
get_user_reservations()    get_expenses()              get_invoices()
get_finance_summary()      get_votes()                 get_vote_results()
get_documents()            get_weather()               search_community_docs()
```

Requisitos transversales de cada tool:

1. **Schema zod** validado antes de ejecutar (los parámetros del LLM no son de fiar).
2. **Autorización** contra `req.communityContext`; si la tool no encaja con el rol, devuelve error de permisos (no datos parciales).
3. **Scope** forzado a la comunidad del actor: la tool no acepta `communityId` libre del LLM, lo deriva del contexto.
4. **Auditoría** de llamadas sensibles.
5. **Respuesta mínima necesaria** (el modelo solo recibe los campos que necesita).

Transporte MCP: `stdio` (para clientes locales como Claude Desktop) y `SSE`/`Streamable HTTP` (para integración remota). El contexto del actor llega por el transporte — en stdio, por un token de sesión firmado; en HTTP, por el mismo JWT que la API. Sin sesión no hay tool call.

---

## 13. Estructura SDD

El SDD es el proceso, y `/specs` es su artefacto. Regla operativa: **ninguna funcionalidad entra en implementación sin spec aprobada**.

```
IDEA → SPEC → REVIEW → PLAN → IMPLEMENTATION → TEST → SECURITY REVIEW → DOCS → MERGE
```

- `/specs/NN-slug.md` con la plantilla estándar (objetivo, contexto, actores, requisitos funcionales y no funcionales, modelo de datos, API, permisos, errores, validaciones, casos límite, tests, criterios de aceptación).
- **Spec ↔ código**: cada spec referencia los ficheros que la implementan; cada endpoint apunta a su spec. Un test de contrato verifica que OpenAPI coincide con lo implementado (`/specs` se referencia desde la UI de API).
- **Ciclo de vida de una spec**: `DRAFT → REVIEW → APPROVED → IMPLEMENTING → DONE`, con el cambio de estado en el commit message (`spec(04-incidents): approve`).
- Orden de las specs:

```
01-authentication  02-users         03-communities
04-incidents       05-reservations  06-announcements
07-documents        08-finance       09-voting
10-ai-assistant    11-agents        12-mcp
```

Regla de implementación extraída del SDD: cuando el código y la spec divergen, primero se corrige la spec (y se registra el cambio), luego el código.

---

## 14. Estrategia de testing

Pirámide con pesos explícitos:

| Nivel | Alcance | Herramienta | Objetivo |
|---|---|---|---|
| Unit | policies, servicios, validadores, reglas de slot | Vitest | rápido, sin infra |
| Integration (backend) | rutas → services → **Postgres real** | Vitest + supertest + `prisma dev` (PGlite) | lógica y aislamiento de comunidad |
| Component (frontend) | componentes y hooks | Vitest + Testing Library + MSW | UI y estados |
| E2E | flujos críticos en navegador | Playwright | Login, crear incidencia, reservar, votar, resultados |
| Contract | OpenAPI vs implementado | test automático | detecta drift entre spec y código |
| AI evals | calidad de tools y clasificación | dataset de casos esperados | mide acierto de categoría/prioridad |

**Postgres en local sin Docker:** `npx prisma dev` levanta un Postgres real (PGlite, WASM) en un proceso Node. Es la solución a que Docker no esté instalado: **mismo motor, mismas migraciones, sin contenedores ni orquestación**. Los tests de integración corren contra `prisma dev`, nunca contra Supabase (que se pausa a los 7 días y rompería la CI). `fileParallelism: false` porque la suite comparte una única base de datos.

Los tests que tocan servicios externos usan adapters fake (weather, map) y `LLMProvider` fake. **`npm test` tiene que pasar sin ninguna API key y sin red.**

Casos de prueba que **deben** existir (por riesgo, no por conveniencia):

- Usuario A de comunidad 1 intenta leer incidencia de comunidad 2 → 403/404. **Este es el test de seguridad central del proyecto.**
- Reserva duplicada en el mismo slot → 409 (y dos peticiones concurrentes → una sola gana).
- Reserva fuera de horario / de capacidad / por usuario no autorizado → rechazo.
- Refresh token reutilizado → invalida la familia de sesiones.
- Un neighbor intenta `DELETE /incidents/:id` de otro → 403.
- Voto duplicado → una sola respuesta; cambiar de voto funciona.
- Categoría/prioridad fuera de enum en la validación → 422.
- Idioma: los mensajes de error y la UI de la web en español (el enunciado está en español y el público es communities de vecinos).

Comando raíz esperado: `npm test` (unit+integration), `npm run test:e2e`, `npm run lint`, `npm run typecheck`. En CI, la suite debe ser verde y **sin** `skip` ni `only`.

---

## 15. Estrategia de seguridad

Defensa en profundidad, aplicada desde el primer commit (no como fase final).

**Autenticación y sesión**
- argon2id para contraseñas. Política mínima: 10 caracteres, sin requisitos arbitrarios de símbolos, y comprobación contra listas de contraseñas filtradas cuando sea viable.
- Access JWT 15 min + rotación de refresh con detección de reutilización.
- Cookies `httpOnly`/`secure`/`sameSite=strict`; nada de secretos en `localStorage`.

**Autorización**
- Deny by default: todo endpoint requiere explícitamente rol/scope.
- `community_members` obligatorio para todo acceso a datos de comunidad.
- Policies por entidad, testeadas unitariamente.
- Verificación de propiedad del recurso además de la pertenencia a la comunidad (`owner OR role`).

**Entrada y salida**
- Zod en **todos** los cuerpos, query params y headers relevantes. Unknown keys rechazadas.
- Prisma parametrizado por defecto → SQL injection resuelta en origen; ninguna query cruda salvo necesidad, y siempre con parámetros.
- Helmet con CSP. `react-dom` escapa por defecto; se prohíbe `dangerouslySetInnerHTML` y se sanea todo markdown de contenido de usuario (avisos, comentarios).
- Límite de tamaño de uploads, validación de tipo real de archivo (magic bytes), nombres generados, almacenamiento fuera del webroot.

**Infraestructura**
- Helmet, CORS allowlist explícita, `express-rate-limit` (login e IA con límites más estrictos), `trust proxy` correcto.
- Secrets solo por env; `.env` en `.gitignore`; `.env.example` documentado.
- **Supabase**: conexión TLS obligatoria (`sslmode=require`), y el service_role key solo en el backend. Nunca en el frontend.
- **RLS activado en todas las tablas** (D-06). El backend conecta como rol con bypass para migraciones, pero el día que se añada un cliente Supabase directo (Realtime, dashboards), las políticas siguen protegiendo los datos. Deny por defecto.
- Logs estructurados **con redacción de PII y tokens**; los audit logs son append-only.
- Dependency audit en CI (`npm audit` con umbral).
- Headers de seguridad y `robots.txt`/`noindex` si aplica.

**IA**
- El LLM es entrada no confiable: mismo tratamiento que un request externo (validación estricta, whitelist).
- Cero ejecución de código por salida del modelo; cero SQL generado por el modelo.
- Presupuesto de tokens e iteraciones; rate limiting por usuario.
- Sin fuga de datos de otras comunidades por contexto.

---

## 16. Roadmap por fases

| Fase | Contenido | Puertas de salida |
|---|---|---|
| **0** | Análisis arquitectónico + decisiones | Este documento aprobado |
| **1** | Monorepo, TS, ESLint, Prettier, Git, Prisma + Supabase conectado, `prisma dev`, CI | `npm run dev` levanta todo contra Supabase; CI verde sin coste |
| **2** | Auth completo + RBAC base | spec 01 aprobada; tests de register/login/refresh + test de aislamiento |
| **3** | Communities, Members, Users | spec 02–03; policy de comunidad con tests |
| **4** | Incidents + Comments | spec 04; reglas de transición de estado |
| **5** | Announcements | spec 06 |
| **6** | Common Areas + Reservations (con slots) | spec 05; test de reserva duplicada y concurrencia |
| **7** | Documents + ACL | spec 07; test de descarga no autorizada |
| **8** | Finance (expenses, invoices, summary) | spec 08 |
| **9** | Voting | spec 09; test de voto único y quórum |
| **10** | Dashboard + Recharts | métricas correctas |
| **11** | Integraciones externas (weather, map) | degradación limpia si falla |
| **12** | AI Assistant (tool calling) | spec 10; respuesta con citas |
| **13** | AI Incident Assistant (draft + confirmación) | spec 10; nunca crea sin humano |
| **14** | MCP server + skills + agents | spec 11–12; auditoría de tool calls |
| **15** | Agents de desarrollo (testing, security, documentation) | workflow SDD operativo |
| **16** | Hardening, CI/CD completo, docs, demo | README/ARCHITECTURE/SECURITY/CONTRIBUTING/API/AI-DEVELOPMENT |

Cada fase empieza con spec aprobada y termina con tests, security review y documentación. Ninguna fase avanza saltándose la anterior.

---

## 17. Riesgos técnicos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| **Aislamiento entre comunidades mal implementado** (bug más grave posible) | Crítico | `community_id` obligatorio, policies centralizadas, tests adversariales por comunidad, índice único de scope |
| Solape de reservas (condición de carrera) | Alto | Tabla `area_slots` + índice único parcial; test de concurrencia |
| AI alucinando datos de negocio | Alto | Solo tools, nunca DB; citas obligatorias; validación de enum; sin tool = "no lo sé" |
| Tool calling con parámetros inventados | Alto | zod en cada tool; error explícito al modelo |
| Prompt injection desde contenido de usuario | Alto | El contenido de usuario es dato, nunca instrucción; el system prompt no concede autoridad al contenido; whitelist de tools |
| Coste/latencia de IA | Medio | Caché de respuestas, límites por usuario, `max_iterations`, modelo adecuado por tarea |
| **Agotamiento de un tier gratuito de LLM** (Groq 1 000 req/día, 200 000 tok/día) | Medio | Presupuesto diario por usuario, caché de clasificaciones, fallback a Gemini, y modo sin IA que nunca rompe la app |
| **Supabase pausa el proyecto a los 7 días sin actividad** | Medio | Script `supabase:ping` + nota en README; los tests nunca dependen de Supabase |
| Supabase Free sin backups automáticos | Medio | Los datos son de demo y se regeneran con `npm run seed`; documentado en `SECURITY.md` como riesgo aceptado |
| Cambios de modelo en un proveedor gratuito | Bajo | Router `LLMProvider`: cambiar de modelo es un cambio de variable de entorno |
| Open-Meteo: uso no comercial y throttling | Bajo | Caché agressiva, atribución visible, alternativa documentada (OpenWeather gratis requiere registro) |
| Acoplamiento frontend a proveedor externo | Medio | Backend proxy + DTOs; cliente sin claves |
| Uploads maliciosos | Medio | Validación de magic bytes, límites, almacenamiento fuera del webroot |
| Complejidad del monorepo tooling | Bajo | npm workspaces; nada de Nx/Turbo hasta que duela |
| Specs que se desincronizan del código | Medio | Referencia cruzada spec↔ficheros; test de contrato OpenAPI |
| Rotación de refresh con falsos positivos en uso legítimo | Bajo | Ventana de gracia de segundos para reintentos |
| Multi-tenant sin RLS a nivel de BD | Medio | Aceptado: el aislamiento es de aplicación y está cubierto por tests; RLS como defensa extra en producción (decisión abierta D-06) |
| Datos financieros con redondeo/float | Medio | `Decimal` en BD y en el dominio; tests de importes |

---

## 18. Decisiones arquitectónicas

Estado: **D-01 a D-04 decididas** (dadas por el desarrollador). D-05 a D-11 pendientes de confirmación.

### Ya decididas

**D-01 — Entorno: Supabase Free, coste $0.** ✅ Decidido.
- Base de datos: **Supabase** (plan Free). Es Postgres real, así que Prisma, migraciones, `Decimal`, índices parciales, `jsonb` y RLS funcionan sin compromiso.
- **Docker ya no es necesario** en esta máquina. El proyecto se ejecuta con `npm run dev` contra Supabase, coste cero. La Fase 1 ya no tiene bloqueantes.
- Los tests de integración usan `npx prisma dev` (Postgres local vía PGlite), para que la CI no dependa de un proyecto que se pausa a los 7 días.
- `docker-compose.yml` se documentará en el README como vía alternativa de despliegue, pero **no es requisito para ejecutar ni para evaluar el proyecto**.

**D-02 — Proveedor LLM: Groq free, con Gemini de fallback.** ✅ Decidido.
- Groq `openai/gpt-oss-120b` / `gpt-oss-20b`: 30 req/min, 1 000 req/día, 200 000 tokens/día, sin tarjeta.
- Gemini (tokens gratis sin billing) como respaldo.
- Modo degradado sin API key obligatorio: la app y los tests funcionan sin IA.
- **Anthropic queda descartado**: no ofrece tier gratuito sin tarjeta.

**D-03 — APIs externas: todas gratuitas.** ✅ Decidido.
- Meteorología: **Open-Meteo** (sin key, 10 000/día).
- Mapa: **Photon** (geocoding) + **OSM tiles con Leaflet**.
- Sin Google Maps ni Mapbox: requieren pago.

**D-04 — Supabase = solo Postgres + Storage + Auth opcional.** ✅ Decidido.
- Se usa como plataforma de datos, **no** como framework de frontend ni como auth. El backend sigue siendo Express con su propia lógica de negocio y autorización.

Cerradas por el desarrollador aceptando las recomendaciones:

**D-05 — Auth propia.** ✅ Cerrada. Argon2id + rotación de refresh + detección de reutilización, implementadas en el backend. GoTrue no se usa. Justificación en la sección 7.

**D-06 — Row Level Security: sí, desde el inicio.** ✅ Cerrada. Implementado en `supabase/sql/02_rls.sql`: 24 tablas con `force row level security` y políticas que leen el contexto de sesión. El backend conecta con el rol `app_runtime` (sin `BYPASSRLS`), no con `postgres`.

**D-07 — `PROVIDER` es un usuario con login.** ✅ Cerrada. Se modela como un `community_members.role = 'PROVIDER'` sobre la tabla `users`, no como una entidad aparte. Así hereda autenticación, sesión y auditoría sin duplicar trabajo, y las políticas de RLS le permiten ver **solo** las incidencias que tiene asignadas.

**D-08 — Orden: `01-authentication` + `03-communities` antes que `04-incidents`.** ✅ Cerrada.

**D-09 — Idioma.** ✅ Cerrada. UI y textos de usuario en español; identificadores y comentarios de código en inglés.

**D-10 — Seed de demo.** ✅ Cerrada. 2 comunidades con usuarios de cada rol, incidencias, zonas comunes, gastos y votaciones. Determinista, para que los tests sean reproducibles.

**D-11 — Nombre.** ✅ Cerrada. `communityHub`.

---

## Siguiente paso

1. Creas el proyecto en Supabase (plan Free) y ejecutas los 4 scripts de `supabase/sql/` en orden. Guía paso a paso: `supabase/sql/README.md`.
2. `04_verify.sql` debe terminar todo en verde. Si algo falla, te dice exactamente qué falta.
3. Activas el rol `app_runtime` con contraseña (esta en ningún archivo del repositorio).
4. Me pasas la **URL de conexión** y la **service role key** → van a `.env`, nunca al repo.
5. Yo escribo `/specs/01-authentication.md` y `/specs/03-communities.md` para tu revisión.
6. Con la spec aprobada: plan → implementación, con tests y security review en cada commit.

Opcional pero recomendado: una API key de Groq (console.groq.com, sin tarjeta). Sin ella la aplicación funciona igual, con el clasificador en modo heurístico.