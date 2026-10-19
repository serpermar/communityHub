// ---------------------------------------------------------------------------
// El catalogo completo de tools.
//
// Vive en un archivo aparte de `registry.ts` para no crear un ciclo: cada modulo
// de tools importa `defineTool` del registro, y el registro no puede importarlos
// a ellos sin arriesgarse a leer un `const` todavia no inicializado. Aqui solo se
// concatenan las listas, que ya estan construidas.
// ---------------------------------------------------------------------------

import { announcementTools } from './announcements.js'
import { areaTools } from './areas.js'
import { communityTools } from './community.js'
import { documentTools } from './documents.js'
import { financeTools } from './finance.js'
import { incidentTools } from './incidents.js'
import { integrationTools } from './integrations.js'
import { votingTools } from './voting.js'
import type { ToolDefinition } from './registry.js'

export const ALL_TOOLS: ToolDefinition[] = [
  ...communityTools,
  ...incidentTools,
  ...areaTools,
  ...announcementTools,
  ...documentTools,
  ...financeTools,
  ...votingTools,
  ...integrationTools,
]

export * from './registry.js'
