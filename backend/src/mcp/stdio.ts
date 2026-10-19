// ---------------------------------------------------------------------------
// Entrypoint stdio del servidor MCP (M-2).
//
// Un proceso aparte que habla MCP por stdin/stdout, para clientes locales (por
// ejemplo un editor). El actor se lee del entorno: la variable
// `MCP_SESSION_TOKEN` lleva el token emitido por `POST /api/v1/mcp/sessions`.
//
// No acepta credenciales como argumento de linea de comandos a proposito: los
// argumentos se ven en la lista de procesos de la maquina, el entorno no.
//
//     MCP_SESSION_TOKEN=<token> node dist/mcp/stdio.js
//
// El proceso NO es un segundo servidor web: solo habla MCP. Necesita el mismo
// `.env` que el backend para validar el token y leer la base de datos.
// ---------------------------------------------------------------------------

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { env } from '../config/env.js'
import { roleInCommunity } from '../ai/service.js'
import { buildMcpServer } from './server.js'
import { verifyMcpSessionToken } from './session.js'

async function main(): Promise<void> {
  if (!env.MCP_ENABLED) {
    process.stderr.write('El servidor MCP está desactivado (MCP_ENABLED=false).\n')
    process.exit(1)
  }

  const token = process.env.MCP_SESSION_TOKEN

  if (!token) {
    process.stderr.write('Falta MCP_SESSION_TOKEN. Genéralo con POST /api/v1/mcp/sessions.\n')
    process.exit(1)
  }

  const payload = verifyMcpSessionToken(token)
  const role = await roleInCommunity(payload.userId, payload.communityId)

  if (!role) {
    process.stderr.write('La sesión MCP no es válida: el usuario ya no pertenece a la comunidad.\n')
    process.exit(1)
  }

  const server = buildMcpServer({ ...payload, role })
  const transport = new StdioServerTransport()

  await server.connect(transport)
}

main().catch((error: unknown) => {
  process.stderr.write(`El servidor MCP no pudo arrancar: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exit(1)
})
