# Spec 16 — MCP, Skills y Agents

> **Estado: DONE — implementada y verificada (2026-10-19).** Bloque 16. Cubre la
> fase 14 del roadmap (`ARCHITECTURE.md` §16): **adaptador MCP + skills + agentes**.
> Es el último gran bloque del enunciado (`COMMUNITYHUB — PROMPT.md` §12, §13,
> §14). Se apoya en el bus de herramientas ya construido en `backend/src/ai/tools`
> (spec 11) sin duplicarlo.
> **Fase:** 14. Precedida de `01-authentication` … `15-frontend`. Sucedida por la
> fase 15 (agentes de desarrollo en profundidad, futura spec 17).
> **Backend que consume:** el `ToolRegistry` de `backend/src/ai/tools` y los
> `services` de dominio; **no se reimplementan tools** (fuente única de verdad).
> **Backend nuevo:** `backend/src/mcp/` (adaptador MCP), `backend/src/agents/`
> (registro + loader de skills), `skills/` (markdown), `agents/*.agent.md`
> (los 6 ficheros, rellenos).
>
> La decisión de fondo es **M-1: el bus de herramientas sigue siendo la única
> fuente de verdad** y el servidor MCP es **un adaptador delgado** sobre él; y
> **M-6: el MCP no ejecuta acciones**: expone solo *lectura no sensible*; toda
> escritura pasa por la API REST con un actor humano (human-in-the-loop,
> PROMPT §25).
>
> **Nota de implementación (desvío respecto a la spec aprobada).** En la REVIEW se
> escribió que las tools `sensitive` se expondrían por MCP anotadas
> (`[requires confirmation]`) y que `prepare_incident_draft` viajaría como
> *propuesta*. Al implementar se tomó la opción **más estricta**: `sensitive` es la
> frontera de **exposición** del MCP y las tools sensibles (`get_expenses`,
> `get_invoices`, `get_finance_summary`, `prepare_incident_draft`) **no se
> registran** en el servidor MCP —ni aparecen en `tools/list` ni se pueden
> invocar—. El MCP queda como canal de **solo lectura no sensible**, lo que encaja
> con la política de mínimo privilegio del proyecto. Los documentos afectados
> (M-4, M-6, §4.1, §8, §9) se actualizaron a esta semántica.

> **Estado histórico: APPROVED — aprobada por el desarrollador (2026-10-16).**
> **M-1** confirmada (adaptador dentro de `backend/`), se **incluye** la ejecución
> de agentes de runtime (`POST /ai/agents/:name/run`), y `get_weather` es la
> **única** tool nueva de MCP.

---

## 1. Objetivo

Que los agentes (y cualquier cliente MCP, p. ej. Claude Desktop) puedan
**consultar CommunityHub a través de herramientas controladas** — con validación
zod, autorización por rol, *scope* de comunidad forzado y auditoría — sin abrir
una segunda vía de acceso a los datos y sin permitir que el modelo modifique nada
por sí solo.

Objetivo de arquitectura: demostrar el patrón `Agent → Skill → MCP Tool → Service
→ DB` (PROMPT §13) reutilizando el mismo `ToolRegistry` que ya usa el asistente de
la aplicación, y dejar **skills y agentes declarados en markdown, sincronizados con
el código por un test**.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Motivo |
|---|---|---|---|
| **M-1** | El **adaptador MCP vive dentro del paquete `backend/`** (`backend/src/mcp/`) y reutiliza `ALL_TOOLS` de `backend/src/ai/tools/index.ts`. No hay paquete `mcp-server/` separado | Paquete `mcp-server/` propio que importe el backend | No existe raíz de workspaces (`package.json` raíz ausente) y el bus de tools vive en el backend. Un paquete aparte obligaría a publicar/duplicar los tools o a un import entre paquetes que hoy no está montado. Una sola lógica de negocio (`ARCHITECTURE.md` §12) |
| **M-2** | Transportes: **Streamable HTTP** montado en `/api/v1/mcp` (SSE como capa del SDK) **y stdio** (`npm run mcp:stdio`). SDK oficial **`@modelcontextprotocol/sdk`** (dependencia nueva, justificada) | Implementar el protocolo MCP a mano | El protocolo evoluciona; el SDK oficial es la referencia y evita drift |
| **M-3** | El contexto del actor viaja en un **token de sesión MCP con scope**: `POST /api/v1/mcp/sessions` (Bearer JWT + `communityId`) emite un JWT HS256 con `aud:'mcp'` y payload `{ sub, cid, role, ver, exp }`. En **stdio** se pasa por env `MCP_SESSION_TOKEN`; en **HTTP**, como `Authorization: Bearer` del endpoint MCP. Sin token válido no hay *tool call* | Reutilizar el access token normal | El access token no lleva comunidad (`{sub, role, ver}`); el scope de comunidad es obligatorio en los tools (AI-10). El token MCP es de vida corta y revocable vía la misma tabla `sessions` |
| **M-4** | A `ToolDefinition` se le añade **`sensitive: boolean`** (por defecto `false`). Es la frontera de **exposición** del MCP: una tool `sensitive` **no** se registra en el servidor MCP (ni aparece en `tools/list` ni se puede invocar). Además el MCP filtra por rol (del token) | Dejar la sensibilidad implícita en el rol, o exponer las sensibles anotadas | `ARCHITECTURE.md` §12 la pide como campo explícito. La implementación la usa como **gate de exposición**, más simple de auditar que una anotación que el cliente puede ignorar (ver nota de implementación) |
| **M-5** | **`communityId` nunca es argumento de tool**: se deriva del token de sesión MCP | Aceptar `communityId` del LLM | AI-10 / `ARCHITECTURE.md` §12.3: el scope lo fija el backend, no el modelo |
| **M-6** | **El MCP no ejecuta escrituras y no expone tools sensibles.** Solo registra tools de lectura no sensibles (`publicTools`), filtradas por el rol del token. Crear/editar/borrar va por REST con actor humano | Exponer `prepare_incident_draft` (propuesta) o `set_incident_status` por MCP | Human-in-the-loop (PROMPT §25, `ARCHITECTURE.md` §10). `prepare_incident_draft` quedó `sensitive`; `set_incident_status` **no existe** en el registro actual; no se inventa |
| **M-7** | Tools nuevas: **solo `get_weather`** (envuelve el servicio de integraciones existente, con degradación). `search_community_docs` queda **fuera de alcance** | Añadir `search_community_docs` | Requiere embeddings/búsqueda (infra inexistente). `get_weather` sí tiene servicio detrás (spec 12) |
| **M-8** | **Auditoría unificada**: se factoriza un servicio `audit()` (a partir de `ai/repository.insertAudit`) y **cada tool call MCP** escribe en `audit_logs` (`agent_name:'mcp'`, `action:'mcp.tool_call'`, metadata con tool, args redactados, duración y transporte) | Registrar solo en el asistente | `ARCHITECTURE.md` §12.4 y §10 (trazabilidad). Hoy no hay capa de auditoría compartida |
| **M-9** | **Skills** en `skills/<slug>/SKILL.md` (markdown estructurado). Un **loader** en `backend/src/agents/skills.ts` las parsea; un **test** verifica que toda skill referenciada por un agente existe y tiene las secciones obligatorias | Skills solo como documentación sin validación | `ARCHITECTURE.md` §11: las skills gobiernan comportamiento y "se revisan con el mismo rigor que el código" |
| **M-10** | **`AgentRegistry`** en `backend/src/agents/registry.ts`: `agent → { rol, skills, tools permitidas, límites, humanApproval }`, **sincronizado con `agents/*.agent.md`** por test. Los 6 agentes del PROMPT §12 se declaran; los 3 de runtime (community, maintenance, finance) son **ejecutables** vía `POST /api/v1/ai/agents/:name/run` (reusa el bucle del asistente con tools/skills filtradas). Los 3 de desarrollo (documentation, testing, security) quedan **solo declarados y en modo lectura** | Inventar un runtime de agentes nuevo | Reutiliza `ai/assistant.ts`; evita una segunda máquina de *tool calling* |
| **M-11** | Se **conecta el `createAiRateLimiter()`** (hoy definido y sin usar) a las rutas MCP y de agentes; se mantiene el presupuesto diario por usuario del asistente | Dejar el limiter sin usar | `http/ratelimit.ts` ya lo define; el MCP es una entrada externa y debe limitarse |
| **M-12** | Config nueva por env: `MCP_ENABLED`, `MCP_SESSION_TTL_SECONDS`, `MCP_HTTP_PATH`. Se **corrige el drift** de `.env.example` (documentar `AI_ENABLED`, `LLM_*`, `AI_DAILY_*`, `AI_MAX_TOOL_ITERATIONS`, `AI_REQUEST_TIMEOUT_MS`, `AI_CONFIDENCE_THRESHOLD`, `AI_CACHE_TTL_HOURS`; retirar el inexistente `GROQ_MODEL`) | Inventar más variables | Mantener config y código alineados |

---

## 3. Contexto: qué ya existe (y qué falta)

Estado real del backend (verificado), que esta spec **reutiliza** o **completa**:

**Existe y se reutiliza**
- `backend/src/ai/tools/registry.ts`: `defineTool`, `ToolContext { userId, communityId, role, client }`, `runTool(ALL_TOOLS, name, args, ctx)` con validación zod + rol + `requiresCommunity` (devuelve `AI_TOOL_FORBIDDEN`/`AI_TOOL_UNKNOWN`/`400`).
- `backend/src/ai/tools/index.ts`: catálogo `ALL_TOOLS` con **17 tools** (community, incidents, areas, announcements, documents, finance, voting).
- `backend/src/ai/llm/*`: `LLMClient`, `getLLMClient()` con modo sin key (devuelve `null`), `FakeLLMClient` para tests.
- `backend/src/auth/tokens.ts`: `signAccessToken`/`verifyAccessToken` (HS256, `JWT_SECRET`); tabla `sessions` revocable.
- `backend/src/ai/repository.ts:insertAudit(...)`: `insert into audit_logs …`.
- `GET /api/v1/ai/tools` y `POST /api/v1/ai/tools/:toolName/preview` (catálogo y ejecución de un tool), en `ai/routes.ts` y `app.ts:217`.
- Rate limiter `createAiRateLimiter()` en `http/ratelimit.ts` (**definido, hoy sin conectar**).

**Falta y esta spec crea/rellena**
- `sensitive` **no existe** en `ToolDefinition`.
- **No hay** `AgentRegistry`, ni loader de skills, ni runtime de agentes.
- `agents/*.agent.md` existen **vacíos** (6 ficheros, 0 bytes); `AGENTS.md` y `docs/AI-DEVELOPMENT.md` también vacíos.
- **No existe** `skills/` ni `mcp-server/`.
- **No hay** transporte MCP ni SDK MCP instalado.
- **No hay** servicio de auditoría compartido (cada módulo hace su `insert`).

---

## 4. Alcance funcional

### 4.1 Adaptador MCP (`backend/src/mcp`)

- `server.ts`: construye un `McpServer` del SDK y registra como *tools* del MCP
  las `ALL_TOOLS` visibles para el rol del token, traduciendo `ToolDefinition` →
  `{ name, description, inputSchema }` (el JSON Schema ya está en `parameters`) y
  ejecutando vía `runTool`. Respuesta = `ToolResult.result` (+ `citations`).
- **HTTP**: `StreamableHTTPServerTransport` montado en `MCP_HTTP_PATH`
  (`/api/v1/mcp`), autenticado por el token de sesión MCP (M-3). `GET` para el
  stream SSE y `POST` para los mensajes del protocolo.
- **stdio**: `backend/src/mcp/stdio.ts` arranca un `StdioServerTransport` leyendo
  `MCP_SESSION_TOKEN`; si no hay token válido, aborta con error claro.
- `tools/list` devuelve exactamente las tools cuyo `roles` incluye el rol del
  token; `tools/call` ejecuta vía `runTool` (zod + scope + auditoría).

**Sensibilidad**: una tool con `sensitive: true` **no se registra** en el servidor
MCP: queda fuera de `tools/list` y `tools/call` la rechaza (`isError`). Es la
**frontera de exposición** del MCP (M-4, M-6): el canal externo es de solo lectura
no sensible. En la API de la aplicación esas mismas tools siguen existiendo, con su
rol y su scope de siempre. El catálogo MCP es, literalmente, `publicTools(ALL_TOOLS)`
filtrado por el rol del token.

---

## 4-bis. Alcance funcional de skills y agentes

### 4.16 Skills (`skills/`)

Nueve skills en `skills/<slug>/SKILL.md`, una por entrada del mapa de
`ARCHITECTURE.md` §11 y del PROMPT §14:

`community-management`, `incident-management`, `reservations`, `finance`,
`authentication`, `database`, `security`, `testing`, `documentation`.

Cada `SKILL.md` con front-matter (`name`, `description`) y secciones: objetivo,
contexto, reglas, herramientas permitidas, restricciones, ejemplos, criterios de
éxito. `incident-management` incluye `playbooks/` (triage, escalado, cierre) y
`examples.md` (casos buenos/malos), como en `ARCHITECTURE.md` §11.

Loader `backend/src/agents/skills.ts`: expone `SKILLS` (los nueve slugs),
`loadSkill(slug)` (lanza `SKILL_NOT_FOUND`), `loadAllSkills()` (carga todas y
verifica que existen) y `skillFilesOnDisk(slug)` (usado por los tests).

### 4.17 Agentes (`agents/*.agent.md` + `AgentRegistry`)

Se rellenan los 6 ficheros `agents/*.agent.md` con la identidad del agente
(front-matter `name`, `title`, `description`, `kind`, `roles`, `skills`, `tools`).
El registro en código es la **fuente de verdad** del comportamiento; el fichero es
su «alma» legible, que además se inyecta en el *system prompt* en tiempo de
ejecución.

| Agente | `kind` | Roles que lo ejecutan | Skills | Tools |
|---|---|---|---|---|
| `community` | runtime | NEIGHBOR, PROVIDER, ADMIN, PRESIDENT | community-management, incident-management, reservations, finance | `'all'` (todas las de su rol) |
| `maintenance` | runtime | ADMIN, PRESIDENT | incident-management | get_incidents, get_open_incidents, get_incident, get_common_areas, get_weather |
| `finance` | runtime | ADMIN | finance | get_expenses, get_invoices, get_finance_summary |
| `documentation` | development | — (solo declarado) | documentation | — |
| `testing` | development | — (solo declarado) | testing | — |
| `security` | development | — (solo declarado) | security | — |

`AgentRegistry` (`backend/src/agents/registry.ts`) refleja esa tabla en código; un
**test de sincronía** compara el registro con el markdown (nombres, skills, tools).

### 4.18 Ejecución de agentes de runtime

`POST /api/v1/ai/agents/:name/run` (requireAuth; `communityId` + `role` resueltos
como en el asistente): carga la skill del agente como *system prompt*, ejecuta el
bucle de `ai/assistant.ts` con **solo** las tools del agente, respeta el
presupuesto diario y audita cada tool call con `agent_name = <agente>`.

---

## 5. Modelo de datos y tipos

- **Sin tablas nuevas.** Se reutiliza `audit_logs` (append-only) y `sessions`.
- Nuevos tipos en código:
  - `ToolDefinition.sensitive: boolean` (añadido).
  - `McpSessionPayload = { sub, cid, role, ver, aud:'mcp', exp }`.
  - `McpSessionToken` (JWT firmado con `signAccessToken`-like, audiencia `mcp`).
  - `AgentDefinition = { name, description, skills: string[], tools: string[], humanApproval: boolean, readOnly: boolean }`.
  - `SkillMeta = { name, description, tools: string[], sections: Record<string,string> }`.

---

## 6. API

Nuevo router `backend/src/mcp/routes.ts`, montado por `app.ts`.

| Método y ruta | Auth | Descripción |
|---|---|---|
| `POST /api/v1/mcp/sessions` | Bearer JWT + `communityId` (body) | Verifica membresía (`app_role_in`) y emite el token de sesión MCP (TTL `MCP_SESSION_TTL_SECONDS`) |
| `POST /api/v1/mcp` | Bearer **token MCP** | Transporte Streamable HTTP del SDK (JSON-RPC: `initialize`, `tools/list`, `tools/call`) |
| `GET /api/v1/mcp` | Bearer **token MCP** | Canal SSE del transporte (si el SDK lo usa) |
| `POST /api/v1/ai/agents/:name/run` | Bearer JWT | Ejecuta un agente de runtime (4.18); SSE con los mismos eventos que el chat |

`GET /api/v1/ai/tools` y `.../preview` **no cambian** (siguen siendo el catálogo
de la aplicación).

---

## 7. Permisos

El MCP **no** implementa autorización propia: reutiliza `runTool` (rol + scope) y
`app_role_in`. Matriz efectiva:

- El rol del token limita el catálogo (`tools/list`) y la ejecución (`tools/call`).
- `PROVIDER` solo ve tools de incidencias asignadas; `NEIGHBOR`/`PRESIDENT` las de
  miembro; `finance` solo `ADMIN` (los `finance` tools ya son `['ADMIN']`).
- El `communityId` sale del token; un token de la comunidad A **nunca** lee datos
  de la B (mismo test de aislamiento que el resto del proyecto).
- Token MCP sin sesión `ACTIVE` en `sessions` → `401`.

---

## 8. Errores

| Situación | `code` | Tratamiento |
|---|---|---|
| Token MCP ausente/inválido | `UNAUTHORIZED` (401) | Rechaza la conexión (stdio: no arranca) |
| Token válido pero ya sin membresía/rol | `TOKEN_REVOKED` (401) | Se re-resuelve el rol en cada petición |
| `MCP_ENABLED=false` | `MCP_DISABLED` (404) | El endpoint y el stdio quedan cerrados |
| `communityId` del que no es miembro | `FORBIDDEN` (403) | Al pedir el token de sesión |
| Tool sensible o inexistente | `result.isError` | El SDK no la registra; no es un `403` |
| Tool fuera del rol | no aparece en `tools/list` | Nunca se registra para ese rol |
| Argumentos inválidos | `result.isError` (texto) | zod de `runTool` |
| `GET /mcp` | `VALIDATION_ERROR` (405) | No hay stream en modo stateless |
| Límite | `RATE_LIMITED` (429) | `createAiRateLimiter()` + presupuesto diario |

---

## 9. Validaciones y casos límite

- Token MCP caducado a mitad de sesión → reconexión pidiendo uno nuevo (TTL corto).
- Tool con `requiresCommunity` y token sin `cid` → imposible: el emisor exige membresía.
- `prepare_incident_draft` quedó `sensitive`: **no se expone** por MCP, así que el
  canal externo no puede crear ni proponer incidencias.
- Un cliente pide `tools/list` con rol `ADMIN` → ve las de lectura pero **no** las
  sensibles (`get_expenses`, `get_invoices`, `get_finance_summary`); con `NEIGHBOR`
  → además pierde las de `ADMIN`.
- `MCP_ENABLED=false` → el endpoint MCP responde `404 MCP_DISABLED` y stdio no arranca.
- Repositorio de desarrollo: ningún agente de desarrollo escribe en el repo — solo
  produce planes/propuestas (PROMPT §24, §25).
- Sin proveedor LLM: el MCP **arranca y lista** tools (son de lectura y no usan
  LLM); los agentes de runtime fallan con `AI_NOT_CONFIGURED` hasta que haya
  proveedor.

---

## 10. Estructura nueva

```
skills/
├── community-management/SKILL.md
├── incident-management/{SKILL.md, playbooks/{triage,escalado,cierre}.md, examples.md}
├── reservations/SKILL.md
├── finance/SKILL.md
├── authentication/SKILL.md
├── database/SKILL.md
├── security/SKILL.md
├── testing/SKILL.md
└── documentation/SKILL.md

agents/                # 6 ficheros ya existentes, ahora rellenos
community.agent.md  maintenance.agent.md  finance.agent.md
documentation.agent.md  testing.agent.md  security.agent.md

backend/src/
├── mcp/
│   ├── routes.ts        # POST /mcp/sessions, POST / (transporte HTTP), GET -> 405
│   ├── session.ts       # emitir/verificar token MCP (audience 'mcp')
│   ├── tools.ts         # mcpToolsFor(role): publicTools(ALL_TOOLS) ∧ rol
│   ├── server.ts        # McpServer + tools; ejecuta vía runTool y audita
│   └── stdio.ts         # entrypoint stdio (lee MCP_SESSION_TOKEN)
├── agents/
│   ├── registry.ts      # registro: AGENTS, findAgent, runtimeAgents, requireRuntimeAgent
│   ├── skills.ts        # loader de skills/ (SKILLS, loadSkill, loadAllSkills)
│   ├── runtime.ts       # runAgent, buildAgentPrompt, toolsForAgent
│   ├── validators.ts    # zod del body del run
│   ├── controller.ts    # listAgents, runAgentHandler
│   └── routes.ts        # GET /ai/agents, POST /ai/agents/:name/run
└── audit/
    └── repository.ts    # insertAudit compartido (antes vivía en ai/repository.ts)
```

---

## 10-bis. Tests

- **Unit** (`src/mcp/__tests__/`, `src/agents/__tests__/`): firma/verificación del
  token MCP (incluida audiencia distinta y manipulación); loader de skills
  (existen los 9 `SKILL.md`, los playbooks de incidencias y `SKILL_NOT_FOUND`);
  registro de agentes vs `agents/*.agent.md` (**test de sincronía**: un fichero por
  agente, skills existentes, runtime con rol, dev sin rol); `mcpToolsFor` (excluye
  sensibles y filtra por rol); `sensitive` por defecto `false` y `publicTools`.
- **Integración** (Supabase real, `src/__tests__/`): `POST /mcp/sessions` rechaza a
  no-miembro; `tools/list` sin sensibles; `tools/call` de `get_community` devuelve
  el dato de la comunidad del token y deja fila en `audit_logs`
  (`action='mcp.tool_call'`, `agent_name='mcp'`); tool sensible → `isError`; la
  revocación por pertenencia invalida el token; `GET /mcp` → 405. De agentes:
  `GET /ai/agents` lista solo runtime; `run` con rol permitido audita `agent.run`;
  con rol denegado → 403; agente inexistente o de desarrollo → 404.
- **Sin red**: toda la suite pasa sin proveedor LLM (los agentes usan
  `FakeLLMClient`; el MCP es solo lectura y no usa LLM).
- **Smoke**: stdio arranca con `MCP_SESSION_TOKEN` válido; sin token, falla con
  error claro.

---

## 11. Criterios de aceptación

1. `POST /api/v1/mcp/sessions` emite un token con scope de la comunidad y rol del
   usuario; sin membresía devuelve `403`.
- Un cliente MCP (`initialize` → `tools/list` → `tools/call`) obtiene respuestas
  correctas y **acotadas al rol y a la comunidad del token**.
- Un token de la comunidad A no lee datos de la B (test de aislamiento).
- `npm run mcp:stdio` conecta un cliente local (Claude Desktop) leyendo
  `MCP_SESSION_TOKEN`; sin token, **no arranca**.
- `skills/` (9) y `agents/*.agent.md` (6) existen, están rellenos y **sincronizados
  con el código** (test).
- `POST /api/v1/ai/agents/:name/run` ejecuta un agente de runtime con sus skills y
  su whitelist de tools.
- Toda tool call MCP queda en `audit_logs` (`action = 'mcp.tool_call'`).
- El MCP **no** modifica datos ni expone tools sensibles (solo lectura no sensible).
- `typecheck`, `test:unit`, `test:integration` y `smoke` verdes, sin API keys.

---

## 11-bis. Documentación a actualizar (al implementar)

- **`docs/AI-DEVELOPMENT.md`** (hoy vacío): agentes, skills, MCP tools, y cómo se
  aplica el SDD (PROMPT §21).
- `docs/API.md`: sección MCP (`/mcp/sessions`, transporte, `/ai/agents/:name/run`).
- `ARCHITECTURE.md` §10–12: marcar MCP/skills/agents como implementados; ajustar la
  decisión M-1 (el adaptador vive en `backend/`, no en `mcp-server/`).
- `docs/README.md`: comando `npm run mcp:stdio` y variables MCP.
- `docs/SECURITY.md`: token MCP con scope, human-in-the-loop, auditoría de tools.
- `AGENTS.md` (vacío): índice de agentes y skills.

---

## 11-bis-2. Fuera de alcance

- **Agentes de desarrollo automatizados** (testing/security/documentation escriben
  en el repo): fase 15, spec 17. Aquí solo se **declaran** (modo lectura).
- **`search_community_docs`** / embeddings / RAG documental (sin infra de búsqueda).
- **Escrituras por MCP** (`set_incident_status`, altas, borrados): siempre por REST
  con actor humano.
- **Embeddings y vector store**; **streaming token a token por MCP** más allá de lo
  que dé el SDK.
- **Auth OAuth del MCP remoto**: se usa el token de sesión propio (M-3).

---

## 12. Criterios de aceptación de la REVIEW

- [ ] M-1…M-12 aprobadas (o corregidas).
- [ ] Alcance: ¿se incluye la ejecución de agentes de runtime (`/ai/agents/:name/run`)
      en este bloque o se deja para la spec 17?
- [ ] Set de skills (9) y agentes (6) confirmado.
- [ ] `get_weather` como única tool nueva de MCP, ¿correcto?
- [ ] ¿`mcp-server/` como paquete aparte (ARCHITECTURE) o módulo en `backend/` (M-1)?
