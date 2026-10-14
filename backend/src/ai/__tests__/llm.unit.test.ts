// ---------------------------------------------------------------------------
// Cliente LLM: el fake y el parseo de argumentos (unitarios).
//
// El fake es lo que permite probar el asistente sin red (AI-3). Lo que se
// comprueba: que guarda cada peticion, que devuelve el guion en orden y que, sin
// guion pendiente, devuelve una respuesta vacia en vez de reventar. El parseo de
// argumentos tolera JSON mal formado sin abortar la conversacion.
// ---------------------------------------------------------------------------

import { describe, expect, it } from 'vitest'
import { parseToolArguments, type LLMResult } from '../llm/client.js'
import { FakeLLMClient } from '../llm/fake.js'

function result(content: string): LLMResult {
  return { content, toolCalls: [], tokensIn: 1, tokensOut: 2, model: 'fake' }
}

describe('FakeLLMClient', () => {
  it('devuelve el guion en orden y registra las peticiones', async () => {
    const client = new FakeLLMClient([result('uno'), result('dos')])

    const a = await client.chat({ model: 'm', messages: [] })
    const b = await client.chat({ model: 'm', messages: [] })

    expect(a.content).toBe('uno')
    expect(b.content).toBe('dos')
    expect(client.calls).toHaveLength(2)
  })

  it('sin guion pendiente devuelve una respuesta vacia', async () => {
    const client = new FakeLLMClient([])
    const out = await client.chat({ model: 'm', messages: [] })
    expect(out.content).toBe('')
    expect(out.toolCalls).toEqual([])
  })

  it('acepta una funcion que decide segun la peticion', async () => {
    const client = new FakeLLMClient((req) => result(`eco:${req.messages.at(-1)?.content ?? ''}`))
    const out = await client.chat({ model: 'm', messages: [{ role: 'user', content: 'hola' }] })
    expect(out.content).toBe('eco:hola')
  })

  it('push anade una respuesta mas a la cola', async () => {
    const client = new FakeLLMClient([])
    client.push(result('tarde'))
    expect((await client.chat({ model: 'm', messages: [] })).content).toBe('tarde')
  })
})

describe('parseToolArguments', () => {
  it('devuelve {} para null, undefined o cadena vacia', () => {
    expect(parseToolArguments(null)).toEqual({})
    expect(parseToolArguments(undefined)).toEqual({})
    expect(parseToolArguments('')).toEqual({})
  })

  it('devuelve el objeto tal cual si ya lo es', () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ a: 1 })
  })

  it('parsea una cadena JSON', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 })
  })

  it('ante un JSON mal formado devuelve {} en vez de lanzar', () => {
    expect(parseToolArguments('{no-json')).toEqual({})
  })
})
