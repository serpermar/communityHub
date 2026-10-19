# Agentes y skills · CommunityHub

Índice de los agentes y las skills del proyecto. El detalle (cómo funcionan, cómo se
ejecutan, cómo se auditan) está en
[`docs/AI-DEVELOPMENT.md`](./docs/AI-DEVELOPMENT.md).

La **fuente de verdad** del comportamiento es el registro en código
(`backend/src/agents/registry.ts`); los ficheros de este directorio son su
definición legible y se inyectan como contexto al ejecutar el agente. Un **test de
sincronía** falla si el registro y los ficheros se desvían.

---

## Agentes

| Agente | Clase | Roles que lo ejecutan | Skills |
|---|---|---|---|
| [`community.agent.md`](./agents/community.agent.md) | runtime | NEIGHBOR, PROVIDER, ADMIN, PRESIDENT | community-management, incident-management, reservations, finance |
| [`maintenance.agent.md`](agents/maintenance.agent.md) | runtime | ADMIN, PRESIDENT | incident-management |
| `finance.agent.md` | runtime | ADMIN | finance |
| `documentation.agent.md` | development | — (solo declarado) | documentation |
| `testing.agent.md` | development | — (solo declarado) | testing |
| `security.agent.md` | development | — (solo declarado) | security |

Los agentes **de runtime** se ejecutan con `POST /api/v1/ai/agents/:name/run` y se
listan en `GET /api/v1/ai/agents`. Los de **desarrollo** existen como declaración
(qué sabe y cómo trabaja cada rol de desarrollo) y **no** son ejecutables por HTTP:
no escriben en el repositorio por sí solos.

El registro en código vive en `backend/src/agents/registry.ts` (`AGENTS`,
`findAgent`, `runtimeAgents`, `requireRuntimeAgent`).

---

## Skills

| Skill | Fichero | De qué sabe |
|---|---|---|
| community-management | `skills/community-management/SKILL.md` | Datos, miembros, avisos, documentos, votaciones |
| incident-management | `skills/incident-management/SKILL.md` | Incidencias, con `playbooks/` (triage, escalado, cierre) y `examples.md` |
| reservations | `skills/reservations/SKILL.md` | Zonas comunes, disponibilidad y reservas |
| finance | `skills/finance/SKILL.md` | Gastos, facturas y saldo (solo ADMIN) |
| authentication | `skills/authentication/SKILL.md` | Sesiones, tokens y roles |
| database | `skills/database/SKILL.md` | Esquema, RLS y funciones `SECURITY DEFINER` |
| security | `skills/security/SKILL.md` | Modelo de amenaza y autorización |
| testing | `skills/testing/SKILL.md` | Estrategia de tests del proyecto |
| documentation | `skills/documentation/SKILL.md` | Mantener docs y specs alineados |

El loader está en `backend/src/agents/skills.ts` (`SKILLS`, `loadSkill`,
`loadAllSkills`, `skillFilesOnDisk`).

---

## Cómo se relacionan

```
agents/*.agent.md ──(identidad)──┐
                                 ├──► system prompt del agente
skills/<slug>/SKILL.md ─(contexto)┘

AgentRegistry (código) ──(verdad)──► tools permitidas ∧ rol ──► ALL_TOOLS
```

Para el detalle (flujo SDD, MCP, token de sesión, auditoría) ver
[`docs/AI-DEVELOPMENT.md`](docs/AI-DEVELOPMENT.md).
