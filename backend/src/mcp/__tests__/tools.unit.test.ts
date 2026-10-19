// ---------------------------------------------------------------------------
// Catalogo MCP (unitarios).
//
// La regla central del bloque: por MCP solo salen tools de SOLO LECTURA. Este
// test fija esa frontera: las financieras y la de borradores quedan fuera, y el
// catalogo se acota por rol.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { mcpToolsFor } from '../tools.js'

function names(role: Parameters<typeof mcpToolsFor>[0]): string[] {
  return mcpToolsFor(role).map((tool) => tool.name)
}

describe('mcpToolsFor', () => {
  it('un ADMIN ve las de lectura, incluida get_weather', () => {
    const list = names('ADMIN')
    expect(list).toContain('get_community')
    expect(list).toContain('get_incidents')
    expect(list).toContain('get_weather')
  })

  it('excluye las tools sensibles aunque el rol pueda usarlas', () => {
    const list = names('ADMIN')
    expect(list).not.toContain('get_expenses')
    expect(list).not.toContain('get_invoices')
    expect(list).not.toContain('get_finance_summary')
    expect(list).not.toContain('prepare_incident_draft')
  })

  it('un NEIGHBOR no ve ninguna tool de solo ADMIN', () => {
    const list = names('NEIGHBOR')
    expect(list).toContain('get_community')
    expect(list).not.toContain('get_expenses')
  })

  it('ninguna tool ofrecida es sensible', () => {
    for (const tool of mcpToolsFor('ADMIN')) {
      expect(tool.sensitive).toBe(false)
    }
  })
})
