# Desarrollo asistido por IA · CommunityHub

Cómo están construidos los **agentes** y las **skills** de este proyecto, qué
pueden hacer a través del **servidor MCP**, y cómo se aplica el flujo **SDD**
(*Spec-Driven Development*) con el que se ha desarrollado.

> Este documento describe lo que existe en el repositorio. Todo lo que se afirma
> aquí tiene su fichero y su test; si algo se rompe, falla una comprobación.

---

## 1. La idea, en una frase

La IA **no habla con la base de datos**. Habla con un **bus de herramientas**
tipadas (el mismo que usa el asistente de la aplicación), y el servidor MCP es un
**adaptador delgado** sobre ese bus. Una sola fuente de verdad, un solo sitio donde
vive el aislamiento por comunidad (RLS) y el control por rol.

```
        ┌───────────────┐     ┌──────────────────┐
        │  Asistente IA │     │ Cliente MCP      │
        │  (chat de la  │     │ (Claude Desktop, │
        │   aplicación) │     │  etc.)           │
        └──────┬────────┘     └────────┬─────────┘
               │                       │
               │   ALL_TOOLS (bus)     │  mcpToolsFor(role)
               └───────────┬───────────┘
                           ▼
                  backend/src/ai/tools
                           │
                           ▼
                  services de dominio
                           │
                           ▼
                  Postgres (RLS, por comunidad)
```

Reglas que no se negocian:

- **El `communityId` nunca es argumento de una tool.** Sale del token de sesión del
  actor, no del modelo (AI-10). Un cliente no puede pedir datos de otra comunidad
  aunque los nombre.
- **El MCP no escribe.** Expone solo *lectura no sensible*. Crear, editar o borrar
  pasa siempre por la API REST con un actor humano (*human-in-the-loop*, PROMPT §25).
- **Toda tool call se audita.** Cada ejecución deja una fila en `audit_logs` con el
  agente, la tool, el actor y la duración.

---

## 2. Skills (`skills/`)

Una **skill** es documentación operacional que el agente carga como contexto. No es
código, pero **se versiona y se revisa con el mismo rigor**, porque gobierna el
comportamiento del sistema (`ARCHITECTURE.md` §11).

Formato: `skills/<slug>/SKILL.md`, con front-matter (`name`, `description`) y
secciones de objetivo, contexto, reglas, herramientas permitidas, restricciones,
ejemplos y criterios de éxito.

Las nueve skills:

| Skill | De qué sabe |
|---|---|
| `community-management` | Datos, miembros, avisos, documentos y votaciones de una comunidad |
| `incident-management` | Ciclo de vida de una incidencia (+ `playbooks/` y `examples.md`) |
| `reservations` | Zonas comunes, disponibilidad y reservas |
| `finance` | Gastos, facturas, cuotas y saldo (solo ADMIN) |
| `authentication` | Sesiones, tokens, rotación y roles |
| `database` | Esquema, RLS, funciones `SECURITY DEFINER` |
| `security` | Modelo de amenaza, autorización en dos capas |
| `testing` | Sembrar con privilegio, afirmar con restricción |
| `documentation` | Mantener docs y specs alineados con el código |

La skill de incidencias incluye además `playbooks/triage.md`,
`playbooks/escalado.md`, `playbooks/cierre.md` y `examples.md`.

**Loader:** `backend/src/agents/skills.ts`. Expone `SKILLS` (los slugs),
`loadSkill(slug)` (lanza `SKILL_NOT_FOUND` si no existe), `loadAllSkills()` y
`skillFilesOnDisk(slug)`. Un test (`agents/__tests__/skills.unit.test.ts`) comprueba
que cada `SKILL.md` existe, no está vacío, y que la skill de incidencias trae sus
playbooks.

---

## 3. Agentes (`agents/*.agent.md` + registro)

Un **agente** es un actor con nombre: un conjunto de **skills** (conocimiento), un
conjunto de **tools** (acciones) y un ámbito. Hay dos clases:

| Clase | Qué es | Ejecutable |
|---|---|---|
| `runtime` | Actúa sobre una comunidad | `POST /api/v1/ai/agents/:name/run` |
| `development` | Ayuda a quien desarrolla el proyecto | `npm run agent -- <name> "…"` (CLI, solo lectura) |

Los seis agentes:

| Agente | Clase | Skills | Tools |
|---|---|---|---|
| `community` | runtime | community-management, incident-management, reservations, finance | todas las de su rol |
| `maintenance` | runtime | incident-management | `get_incidents`, `get_open_incidents`, `get_incident`, `get_common_areas`, `get_weather` |
| `finance` | runtime | finance | `get_expenses`, `get_invoices`, `get_finance_summary` |
| `documentation` | development | documentation | — |
| `testing` | development | testing | — |
| `security` | development | security | — |

**Dos piezas, una verdad:**

- El **registro** (`backend/src/agents/registry.ts`) es la fuente de verdad del
  comportamiento: `AGENTS`, `findAgent`, `runtimeAgents`, `developmentAgents`,
  `requireRuntimeAgent`, `requireDevelopmentAgent`.
- El **fichero** `agents/<name>.agent.md` es el «alma» legible del agente y se
  inyecta en el *system prompt* al ejecutarlo (`readAgentFile`).

Un **test de sincronía** (`agents/__tests__/registry.unit.test.ts`) falla si hay un
fichero huérfano, si un agente declarado no tiene su `.agent.md`, o si referencia una
skill que no existe. El registro y el markdown no se pueden desincronizar en
silencio.

### Ejecución de un agente de runtime

`runAgent` (`backend/src/agents/runtime.ts`):

1. Resuelve el rol del actor en la comunidad (`roleInCommunity`).
2. Comprueba que el rol puede ejecutar ese agente.
3. Construye el *system prompt*: base + identidad (`.agent.md`) + skills.
4. Acota las tools: `toolsForAgent` = tools permitidas por el agente ∧ por el rol.
5. Ejecuta el bucle de `runAssistant` **reutilizado** (no hay una segunda máquina de
   *tool calling*).
6. Audita `agent.run` con el nombre del agente.

No abre sesión de chat: un `run` es una consulta puntual que no se guarda en el
historial del usuario.

### Ejecución de un agente de desarrollo

Los tres agentes de desarrollo (spec 17) se ejecutan **por CLI**, no por HTTP:
no son actores de comunidad y no tienen datos que aislar. El comando es:

```bash
cd backend
npm run agent -- testing "qué endpoints no tienen test de integración"
npm run agent -- security "revisa la validación del endpoint de incidencias"
npm run agent -- documentation "comprueba specs vs código"
```

- **Solo lectura.** El agente recibe un catálogo de tres herramientas sobre el
  repositorio —`list_files`, `read_file`, `search_repo`— **confinado a la raíz**:
  una ruta con `..` o absoluta es un error, no una lectura. No hay escritura, ni
  comandos, ni base de datos.
- **Propone, no aplica.** La salida es una **propuesta** por `stdout` (o
  `--out <fichero>`), que una persona revisa y aplica. Esto es el
  *human-in-the-loop*: ningún agente de desarrollo escribe en el repo.
- **Sin proveedor LLM no falla.** `npm run agent -- <name> "…"` imprime el
  *prompt* compuesto (identidad + skills + catálogo de tools) para pegarlo en el
  chat de siempre (PROMPT §16). Con `--prompt` se fuerza ese modo.
- El runner **no reutiliza `runAssistant`**: aquel consume cuota y audita por
  usuario/comunidad, y un agente de desarrollo no tiene ninguna de las dos. Vive
  en `backend/src/agents/dev/` (`tools.ts`, `runner.ts`, `cli.ts`).

---

## 4. Servidor MCP (`backend/src/mcp`)

El MCP (Model Context Protocol) permite que clientes externos —Claude Desktop, etc.—
usen las herramientas del proyecto. Hay **dos transportes**:

- **HTTP** (`StreamableHTTPServerTransport`) en `POST /api/v1/mcp`, en modo
  *stateless* (un servidor por petición). El actor viaja en el token de sesión MCP.
- **stdio** (`backend/src/mcp/stdio.ts`), para clientes locales, lanzado con
  `npm run mcp:stdio` y el token en la variable de entorno `MCP_SESSION_TOKEN`.

### El token de sesión MCP

El access token de la API **no** sirve para el MCP: no lleva comunidad. El MCP exige
un token propio:

1. El usuario pide `POST /api/v1/mcp/sessions` con su Bearer y un `communityId`.
2. El backend comprueba la pertenencia y emite un JWT HS256 con `audience:'mcp'` y
   payload `{ sub, cid, role, ver }`.
3. Ese token (cabecera `Authorization` en HTTP, `MCP_SESSION_TOKEN` en stdio) es el
   que usa el cliente MCP.

Como el rol se vuelve a resolver contra la base **en cada petición**, el token es
revocable sin lista de revocación: quitar a alguien de la comunidad corta su acceso
al instante.

### El catálogo: solo lectura, no sensible

`mcpToolsFor(role)` (`backend/src/mcp/tools.ts`) es:

```ts
publicTools(ALL_TOOLS).filter((tool) => tool.roles.includes(role))
```

`publicTools` quita las tools con `sensitive: true`. En este proyecto son las
financieras y `prepare_incident_draft`. La consecuencia de diseño —más estricta que
la anotación `[requires confirmation]`— es que **el MCP no expone ninguna tool que
toque dinero o que prepare una escritura**: es un canal de lectura del estado de la
comunidad y nada más.

### Auditoría

Cada `tools/call` ejecuta la tool dentro de `withContext` (el mismo contexto RLS que
la API) y, en la misma transacción, escribe en `audit_logs`
(`agent_name:'mcp'`, `action:'mcp.tool_call'`). El servicio compartido es
`insertAudit` (`backend/src/audit/repository.ts`), que antes vivía dentro de
`ai/repository.ts` y ahora lo usan tanto el asistente como el MCP y los agentes.

### Probar el MCP

```bash
cd backend

# 1) Consigue un token (sustituye <access> y <communityId>)
curl -X POST http://localhost:3000/api/v1/mcp/sessions \
  -H "Authorization: Bearer <access>" \
  -H "Content-Type: application/json" \
  -d '{"communityId":"<communityId>"}'

# 2) Lista las tools
curl -X POST http://localhost:3000/api/v1/mcp \
  -H "Authorization: Bearer <tokenMCP>" \
  -H "Accept: application/json, text/event-stream" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

O por stdio:

```bash
MCP_SESSION_TOKEN=<tokenMCP> npm run mcp:stdio
```

---

## 5. El flujo SDD

El proyecto se desarrolla por bloques con un flujo explícito
(`ARCHITECTURE.md` §13). Cada bloque tiene su **spec** en `specs/`:

```
IDEA → SPEC → REVIEW → PLAN → IMPLEMENTATION → TEST → SECURITY REVIEW → DOCS → MERGE
        DRAFT  REVIEW   APPROVED   IMPLEMENTING        DONE
```

- **SPEC**: se escribe qué se va a hacer, con decisiones numeradas y alternativas
  descartadas. No se implementa nada hasta que la spec está **APPROVED**.
- **IMPLEMENTATION**: se implementa lo aprobado; los desvíos se anotan en la propia
  spec (como la nota de sensibilidad de la spec 16).
- **TEST**: cada criterio de aceptación tiene un test que falla si se rompe. Sembrar
  con privilegio (`admin`), afirmar con restricción (rol `app_runtime`).
- **SECURITY REVIEW**: qué superficie nueva hay y por qué es aceptable.
- **DOCS**: este documento, `docs/API.md`, `docs/SECURITY.md` y `ARCHITECTURE.md` se
  actualizan al cerrar el bloque.

El estado de cada spec vive en su cabecera. El roadmap por fases está en
`ARCHITECTURE.md` §16.

---

## 6. Reglas para un agente que trabaje en este repo

Si eres un agente (humano o IA) haciendo cambios aquí:

1. **No inventes tools ni escrituras por MCP.** Si una capacidad no existe en
   `ALL_TOOLS`, no se añade al MCP.
2. **El aislamiento no se prueba con un mock.** Los tests de integración corren
   contra Postgres real porque la mitad de lo que comprueban es que RLS filtra de
   verdad.
3. **Sembrar con privilegio, afirmar con restricción.** Los fixtures se crean con
   `MIGRATION_DATABASE_URL` (postgres); las aserciones van por la API con el rol de
   aplicación.
4. **Nada de red en los tests.** El proveedor LLM se sustituye por `FakeLLMClient`;
   los proveedores externos (Open-Meteo, Photon) tienen su caché y su degradación.
5. **Nada de secretos en el repositorio.** Las claves viven en `backend/.env`
   (fuera de Git); las plantillas solo llevan la estructura.
6. **Los agentes de desarrollo no escriben en el repo.** Ni solos ni
   acompañados: su catálogo es de solo lectura y su salida es una propuesta;
   el cambio lo aplica una persona.

---

## 7. Dónde mirar

| Quieres… | Mira |
|---|---|
| El catálogo de tools | `backend/src/ai/tools/index.ts` (`ALL_TOOLS`) |
| El registro de agentes | `backend/src/agents/registry.ts` |
| El loader de skills | `backend/src/agents/skills.ts` |
| La ejecución de un agente de runtime | `backend/src/agents/runtime.ts` |
| La ejecución de un agente de desarrollo | `backend/src/agents/dev/` |
| Las dev tools (solo lectura) | `backend/src/agents/dev/tools.ts` |
| El servidor MCP | `backend/src/mcp/server.ts` |
| El token MCP | `backend/src/mcp/session.ts` |
| La auditoría compartida | `backend/src/audit/repository.ts` |
| Las specs | `specs/` |
| El roadmap | `ARCHITECTURE.md` §16 |

## 8. Configuración y uso en frontend

### 8.1 Variables de entorno

El asistente se configura desde `backend/.env`. Las claves **nunca** van en el frontend.

```env
# Proveedor de IA
GROQ_API_KEY="gsk_..."      # Principal (recomendado)
GEMINI_API_KEY="AIza..."    # Respaldo opcional
AI_ENABLED="true"

# Modelos por defecto
LLM_PRIMARY_MODEL="openai/gpt-oss-120b"
LLM_FAST_MODEL="openai/gpt-oss-20b"
```

- **Orden de resolución:** Groq (primario) > Gemini (respaldo) > `null` (modo degradado).
- **Modo degradado:** Con `AI_ENABLED="false"` o sin claves, el chat devuelve `503 AI_NOT_CONFIGURED` y la clasificación de incidencias usa heurística (AI-3).
- **Sin SDKs:** Los clientes usan `fetch` nativo para mantener las dependencias al mínimo (D-02).

### 8.2 Puntos de integración

| Lugar | Archivo | Descripción |
|---|---|---|
| **Página dedicada** | `frontend/src/features/assistant/pages/AssistantPage.tsx` | Chat completo con sesiones, streaming SSE, `tool_calls`, `citations` y borrado de conversaciones. Ruta `/c/:communityId/assistant`. |
| **Borrador de incidencia** | `frontend/src/features/incidents/pages/IncidentCreatePage.tsx` | Usa `createIncidentDraft()` / `confirmIncidentDraft()`. Propone categoría/prioridad/título, requiere confirmación humana y crea con `createdVia: 'AI_SUGGESTION'`. |
| **Botón flotante** | `frontend/src/components/ai/AiFloatingButton.tsx` | Visible en cualquier vista con comunidad activa. Abre el drawer del asistente. |
| **Drawer del asistente** | `frontend/src/components/ai/AiAssistantDrawer.tsx` | Chat reutilizable con historial de sesiones, streaming, herramientas ejecutadas y citas a entidades. Escucha el evento `open-ai-assistant`. |
| **Resumir avisos** | `frontend/src/features/announcements/pages/AnnouncementsPage.tsx` | Botón "Resumir con IA" que envía los avisos visibles al asistente para generar un resumen claro en español. |

### 8.3 Integración en frontend

| Lugar | Archivo | Descripción |
|---|---|---|
| **Página dedicada** | `frontend/src/features/assistant/pages/AssistantPage.tsx` | Chat completo con sesiones, streaming SSE, `tool_calls`, `citations` y borrado de conversaciones. Ruta `/c/:communityId/assistant`. |
| **Borrador de incidencia** | `frontend/src/features/incidents/pages/IncidentCreatePage.tsx` | Usa `createIncidentDraft()` / `confirmIncidentDraft()`. Propone categoría/prioridad/título, requiere confirmación humana y crea con `createdVia: 'AI_SUGGESTION'`. |
| **Botón flotante** | `frontend/src/components/ai/AiFloatingButton.tsx` | Visible en cualquier vista con comunidad activa. Abre el drawer del asistente. Montado en `AppLayout.tsx`. |
| **Drawer del asistente** | `frontend/src/components/ai/AiAssistantDrawer.tsx` | Chat reutilizable con historial de sesiones, streaming, herramientas ejecutadas y citas a entidades. Escucha el evento `open-ai-assistant`. |
| **Resumir avisos** | `frontend/src/features/announcements/pages/AnnouncementsPage.tsx` | Botón "Resumir con IA" que envía los avisos visibles al asistente para generar un resumen claro en español. |
| **Cmd+K ampliado** | `frontend/src/components/ui/CommandPalette.tsx` | Búsqueda global de incidencias, documentos, avisos y miembros con debounce 300ms. |
| **Vistas incidencias** | `frontend/src/features/incidents/pages/IncidentListPage.tsx`, `frontend/src/features/incidents/components/IncidentKanban.tsx`, `frontend/src/features/incidents/components/IncidentCalendar.tsx` | Toggle Lista/Tablero/Calendario con persistencia en URL. |
| **Previsualización documentos** | `frontend/src/features/documents/components/DocumentPreviewModal.tsx`, `frontend/src/features/documents/pages/DocumentsPage.tsx` | Vista previa de imágenes/PDF con URLs firmadas. |
| **Dashboard** | `frontend/src/features/dashboard/pages/DashboardPage.tsx` | Accesos rápidos a avisos, votaciones y reservas. |
| **DataTable unificado** | `frontend/src/components/ui/DataTableView.tsx` | Componente unificado para listas con tabla/tarjetas, paginación, estados vacíos/error/skeleton. |

### 8.4 Reglas de seguridad

- **Sin claves expuestas:** Toda la lógica de proveedores vive en `backend/src/ai/llm/`.
- **Scope forzado:** El `communityId` se deriva del contexto autenticado (AI-10).
- **Auditoría:** Las ejecuciones de tools se registran en `audit_logs` (AI-13).
- **Presupuesto:** Se aplica `AI_DAILY_*` por usuario vía `ai_usage` (AI-5).
