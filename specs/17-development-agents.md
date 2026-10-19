# Spec 17 — Agentes de desarrollo (testing, security, documentation)

> **Estado: DONE — implementada y verificada (2026-10-19).** Bloque 17. Cubre la
> fase 15 del roadmap (`ARCHITECTURE.md` §16): **agentes de desarrollo**, la parte
> que quedaba de la FASE 7 – AI DEVELOPMENT del enunciado
> (`COMMUNITYHUB — PROMPT.md` §12). La spec 16 los dejó **solo declarados**
> (fichero `.agent.md` + skills + registro) y en modo lectura; aquí se convierten
> en **ejecutables de verdad, pero solo por quien desarrolla y solo para
> proponer**.
> **Fase:** 15. Precedida de `16-mcp-agents`.
> **Backend nuevo:** `backend/src/agents/dev/` (tools de solo lectura, runner y
> CLI) y dos helpers en `backend/src/agents/registry.ts`.
>
> La decisión de fondo es **D-1: los agentes de desarrollo no se exponen por
> HTTP** (no son actores de comunidad) y **D-2: no escriben en el repositorio**;
> producen una **propuesta** por salida estándar que un humano revisa y aplica
> (human-in-the-loop, PROMPT §25; `AI-DEVELOPMENT.md` §6.6).
>
> **Aprobación.** El desarrollador indicó continuar con este bloque el
> 2026-10-19; las decisiones D-1…D-7 y el alcance se fijan aquí y quedan
> sujetos a su revisión al cerrar.

---

## 1. Objetivo

Que los tres agentes de desarrollo de la spec 16 —`testing`, `security` y
`documentation`— dejen de ser decorativos y pasen a ser **usables en el día a
día del proyecto**: un comando local que les da la identidad y las skills del
agente, un catálogo de **herramientas de solo lectura** sobre el repositorio y,
si hay proveedor LLM, una **propuesta** redactada; si no lo hay, el *prompt*
listo para pegar en el chat (PROMPT §16).

Objetivo de arquitectura: cerrar el bucle del PROMPT §17 (WORKFLOW AI-FIRST)
sin abrir una vía de escritura. El agente **propone**; el actor humano
**decide**.

---

## 2. Decisiones

| # | Decisión | Alternativa descartada | Por qué |
|---|---|---|---|
| **D-1** | Los agentes de desarrollo se ejecutan **por CLI** (`npm run agent -- <name> "<instrucción>"`), **no** por HTTP | Montarlos en `/api/v1/ai/agents/:name/run` como los de runtime | No son actores de comunidad: no tienen `communityId`, ni rol, ni datos que aislar. Exponerlos por HTTP sería superficie de ataque nueva sin necesidad. El actor es quien desarrolla, en su máquina |
| **D-2** | **Solo lectura.** El catálogo de dev tools (`list_files`, `read_file`, `search_repo`) no escribe ni ejecuta comandos, y está **confinado a la raíz del repositorio** (una ruta que salga de la raíz es un error). La salida es una propuesta por `stdout` (o `--out <fichero>`) | Tools de escritura (`write_docs_proposal`, aplicar parches) | `AI-DEVELOPMENT.md` §6.6 y PROMPT §24/§25: los agentes de desarrollo no escriben en el repo solos. La escritura la hace un humano |
| **D-3** | El runner **no usa la base de datos**: ni `withContext`, ni `runAssistant` (acoplados a Postgres y a la auditoría por comunidad), ni presupuesto diario. Implementa un bucle de *tool calling* mínimo sobre `LLMClient` y `parseToolArguments` | Reutilizar `runAssistant` | `runAssistant` consume cuota y audita **por usuario/comunidad**; un agente de desarrollo no tiene ninguna de las dos. Forzarlo obligaría a inventar un `userId`/`communityId` falsos |
| **D-4** | **Degradación sin proveedor LLM.** Sin `AI_ENABLED` o sin clave, `getLLMClient()` devuelve `null` y el CLI imprime el *prompt* compuesto (identidad + skills + catálogo de tools + instrucción). No es un error | Fallar con `AI_NOT_CONFIGURED` | PROMPT §16: el chat es la herramienta de desarrollo. El prompt pegado en el chat de siempre es una salida válida; un fallo seco, no |
| **D-5** | El registro gana `developmentAgents()` y `requireDevelopmentAgent(name)`; los tres agentes mantienen `roles: []` y `tools: []` (su catálogo es el de desarrollo, no el de comunidad) | Darles `tools` de comunidad | Un agente de desarrollo no consulta gastos ni incidencias de nadie; lee el **código y las specs** |
| **D-6** | **Sin tablas nuevas.** La ejecución local no deja rastro en `audit_logs` (no hay actor de comunidad). El rastro de una propuesta es el propio chat/consola de quien la pidió | Auditar con un actor ficticio | La auditoría de `audit_logs` es por comunidad; un agente de desarrollo no tiene comunidad. Inventar una fila con datos falsos ensucia el registro |
| **D-7** | Config: **sin variables nuevas**. Se reutiliza `AI_ENABLED`, `LLM_PRIMARY_MODEL` y el tope `AI_MAX_TOOL_ITERATIONS` | Añadir `DEV_AGENT_*` | No hay nada que configurar: el repo, el proveedor y los topes ya existen |

---

## 3. Contexto: qué ya existe (y qué falta)

**Existe y se reutiliza**
- `backend/src/agents/registry.ts`: `AGENTS` (6), `findAgent`, `runtimeAgents`,
  `requireRuntimeAgent`, `readAgentFile`. Los 3 agentes `development` ya están
  declarados con `roles: []`, `tools: []` y su `.agent.md`.
- `backend/src/agents/skills.ts`: `loadSkill` (lanza `SKILL_NOT_FOUND`).
- `backend/src/ai/llm/*`: `LLMClient`, `getLLMClient()` (modo sin key →
  `null`), `parseToolArguments`, `FakeLLMClient`.
- `AppError`/`AGENT_NOT_FOUND` en `http/errors.ts`.

**Falta (lo añade esta spec)**
- Un **catálogo de tools de solo lectura** sobre el repositorio.
- Un **runner** de agente de desarrollo (prompt + bucle) **sin DB**.
- Un **entrypoint CLI** y su script npm.
- `developmentAgents()` / `requireDevelopmentAgent` en el registro.

---

## 4. Alcance funcional

### 4.1 Dev tools (`backend/src/agents/dev/tools.ts`)

Tres tools de **solo lectura**, confinadas a `repoRoot`:

| Tool | Argumentos | Devuelve |
|---|---|---|
| `list_files` | `{ path?, glob?, limit? }` | Rutas **relativas** a la raíz (excluye `node_modules`, `.git`, `dist`, `coverage`, `build`, etc.). Tope por defecto 500 |
| `read_file` | `{ path }` | El contenido del fichero (tope 128 KB). Ruta inexistente o fuera de la raíz → error |
| `search_repo` | `{ pattern, path?, max? }` | Coincidencias `ruta:línea: texto` (regex), con `path` opcional como prefijo. Tope por defecto 200 |

Reglas:
- El **confinamiento de ruta** es sagrado: se resuelve la ruta y se exige que
  quede dentro de `repoRoot` (`resolved === root || resolved.startsWith(root + sep)`).
  Una ruta absoluta o con `..` que escape es un error, no una lectura.
- No hay tools de escritura, borrado, ejecución de comandos ni red.
- Los límites (tamaño, número) evitan volcar el repo entero al contexto.

### 4.2 Runner (`backend/src/agents/dev/runner.ts`)

`runDevAgent(name, instruction, opts?)`:

1. `requireDevelopmentAgent(name)`.
2. Compone el *system prompt*: base de desarrollo + identidad (`readAgentFile`) +
   skills (`loadSkill`) + descripción de las dev tools.
3. Ejecuta un bucle de *tool calling* acotado por `AI_MAX_TOOL_ITERATIONS`,
   ejecutando las tools contra `repoRoot` y devolviendo sus resultados al modelo.
4. Sin cliente LLM: devuelve `mode: 'prompt'` con el prompt compuesto como
   respuesta (D-4).
5. Devuelve `{ agent, answer, toolCalls, tokensIn, tokensOut, model, mode }`.
   **No escribe nada** (ni DB, ni disco salvo el `--out` explícito del CLI).

### 4.3 CLI (`backend/src/agents/dev/cli.ts`)

```
npm run agent -- <testing|security|documentation> "<instrucción>" [--out <fichero>] [--prompt]
```

- `--prompt` fuerza el modo prompt (no llama al modelo).
- `--out <fichero>` escribe la propuesta en un fichero **indicado por el humano**
  (no en una ruta fija del repo). Sin `--out`, la propuesta va a `stdout`.
- Un nombre que no sea de desarrollo (`community`, `maintenance`, `finance` o
  inventado) → error claro; un agente de runtime **no** se puede correr por aquí.

Scripts npm: `agent` (tsx) y `agent:dist` (node sobre `dist/`).

---

## 5. Modelo de datos y tipos

- **Sin tablas nuevas** (D-6).
- Nuevos tipos en código:
  - `DevToolContext = { repoRoot: string }`.
  - `DevTool = { name, description, parameters, schema, run(args, ctx) }`.
  - `DevRunResult = { agent, answer, toolCalls, tokensIn, tokensOut, model, mode }`
    con `mode: 'llm' | 'prompt'`.

---

## 6. CLI y API

- **No hay endpoints nuevos.** El bloque no toca `app.ts` ni la API pública.
- El único contrato nuevo es el comando `npm run agent` y su contrato de salida
  (texto de la propuesta por `stdout`).

---

## 7. Permisos

- No hay RBAC: el CLI corre en la máquina de quien desarrolla, sobre el
  repositorio local. Lo único que se "autoriza" es la **contención de lectura**
  (D-2): el agente no puede leer fuera de la raíz del repo.
- Los agentes de desarrollo **no** pueden ejecutarse por HTTP ni con un token de
  comunidad; `requireDevelopmentAgent` es la única puerta y es local.

---

## 7-bis. Seguridad

- **Superficie nueva:** lectura de ficheros del repositorio por un proceso local.
  No hay entrada de red, ni sesión, ni datos de vecinos.
- **Riesgo**: que el modelo lea algo fuera del repo o se auto-inyecte con
  contenido del propio repo (prompt injection desde un fichero). Mitigaciones:
  confinamiento de ruta (D-2), y la regla ya vigente en los prompts del proyecto
  —el contenido es un **dato**, nunca una instrucción—.
- **Secretos**: el dev tool lee ficheros del repo, pero `.env` está fuera de Git
  y el runner no lee `.env` como tool (no está en el catálogo de rutas
  sugeridas; además el modelo decide qué leer). No hay claves en el bundle.

---

## 7. Errores

| Situación | `code` | Tratamiento |
|---|---|---|
| Agente inexistente o de runtime por CLI | `AGENT_NOT_FOUND` (404) | `requireDevelopmentAgent` |
| Ruta fuera de la raíz del repo | `VALIDATION_ERROR` (400) | `list_files`/`read_file`/`search_repo` |
| Fichero inexistente | `NOT_FOUND` (404) | `read_file` |
| Argumentos inválidos de una dev tool | error contado al modelo | No aborta el bucle (igual que en el chat) |
| Sin proveedor LLM | — (no es error) | `mode: 'prompt'` (D-4) |

---

## 7-bis-2. Validaciones y casos límite

- `read_file` con `../../etc/passwd` o una ruta absoluta → error, nunca lectura.
- `search_repo` sin coincidencias → lista vacía (no error).
- Instrucción vacía → el CLI imprime el uso y sale con código distinto de cero.
- Un modelo que pide tools sin parar → se corta al tope de iteraciones y se
  responde algo honesto (misma garantía que el asistente).

---

## 8. Estructura nueva

```
backend/src/agents/dev/
├── tools.ts     # list_files, read_file, search_repo (solo lectura, confinadas)
├── runner.ts    # runDevAgent: prompt + bucle LLM, sin DB
└── cli.ts       # entrypoint: `npm run agent -- <name> "<instrucción>"`
```

Cambios menores en `backend/src/agents/registry.ts` (`developmentAgents`,
`requireDevelopmentAgent`) y en `backend/package.json` (scripts `agent`,
`agent:dist`).

---

## 9. Tests

- **Unit — dev tools** (`agents/__tests__/dev-tools.unit.test.ts`), contra un
  directorio temporal (sin tocar el repo real): `list_files` lista lo esperado y
  **excluye** `node_modules`; `read_file` lee un fichero; `read_file` **rechaza**
  rutas que escapan (`../`, absolutas); `search_repo` encuentra un patrón.
- **Unit — runner** (`agents/__tests__/dev-runner.unit.test.ts`): con
  `FakeLLMClient` guionizado, una *tool call* a `read_file` seguida de texto →
  `answer` es el texto, la tool queda en `toolCalls` y su resultado viaja al
  modelo; sin cliente → `mode: 'prompt'` y el prompt contiene identidad y skill;
  `requireDevelopmentAgent` rechaza agentes de runtime e inexistentes.
- **Sin red ni DB**: toda la suite pasa sin proveedor y sin Supabase.

---

## 10. Criterios de aceptación

1. `npm run agent -- testing "…"` imprime una propuesta (o el prompt si no hay
   proveedor) y **no modifica ningún fichero** del repositorio.
2. Un agente de runtime (`community`) o un nombre inventado por CLI → error.
3. `read_file`/`search_repo`/`list_files` no pueden leer fuera de la raíz.
4. Falta de proveedor LLM → `mode: 'prompt'`, no un fallo.
5. `typecheck` y `test:unit` verdes, sin API keys y sin Supabase.

---

## 11. Documentación a actualizar (al implementar)

- `docs/AI-DEVELOPMENT.md` §3: los agentes de desarrollo pasan de "solo
  declarados" a "ejecutables por CLI en modo lectura / propuesta".
- `AGENTS.md`: columna «Cómo se ejecuta» de los agentes de desarrollo.
- `ARCHITECTURE.md` §10 y §16: fase 15 como hecha; matizar la invariante
  «no escriben en el repo solos» con «ni siquiera pueden».
- `docs/README.md`: comando `npm run agent`.

---

## 12. Fuera de alcance

- **Tools especializadas** del `ARCHITECTURE.md` §10 (`run_tests`,
  `list_coverage_gaps`, `dependency_scan`, `search_specs`, `openapi_schema`…):
  aquí se implementa un catálogo **mínimo y compartido** de solo lectura
  (`list_files`, `read_file`, `search_repo`). Ejecutar tests o escanear
  dependencias añade superficie y procesos; queda para más adelante.
- **Escritura de propuestas en el repo** o aplicación automática de cambios
  (D-2): siempre las aplica un humano.
- **Ejecución por HTTP** de los agentes de desarrollo (D-1).
- **Auditoría en `audit_logs`** de corridas de desarrollo (D-6).
- **RAG/embeddings** sobre el repositorio: la búsqueda es literal (regex).

---

## 13. Criterios de aceptación de la REVIEW

- [ ] D-1…D-7 aprobadas (o corregidas).
- [ ] ¿El catálogo mínimo (`list_files`, `read_file`, `search_repo`) es
      suficiente, o hace falta `run_tests` ya en este bloque?
- [ ] ¿La salida debe poder escribirse en un `--out` o basta `stdout`?
- [ ] Confirmado: los agentes de desarrollo **no** se exponen por HTTP.
