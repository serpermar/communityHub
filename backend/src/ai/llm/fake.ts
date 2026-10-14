// ---------------------------------------------------------------------------
// Cliente LLM de mentira para los tests (AI-3).
//
// El asistente tiene que poder probarse sin red, sin clave y sin gastar cuota.
// Este cliente cumple la misma interfaz que Groq y Gemini, pero no sale del
// proceso: devuelve lo que la prueba le haya guionizado.
//
// Dos formas de usarlo:
//
//   new FakeLLMClient([{ content: 'hola', toolCalls: [], tokensIn: 3, tokensOut: 1, model: 'fake' }])
//
// o, para respuestas que dependen de la peticion (p.ej. una tool call cuando el
// modelo ve una tool en el prompt):
//
//   new FakeLLMClient((req) => ({ ... }))
//
// Guarda cada peticion en `calls` para poder afirmar que el bucle de tools la
// construyo como toca.
// ---------------------------------------------------------------------------

import type { LLMChatRequest, LLMClient, LLMResult } from './client.js'

export type FakeScript = LLMResult[] | ((request: LLMChatRequest) => LLMResult | Promise<LLMResult>)

function emptyResult(model: string): LLMResult {
  return { content: '', toolCalls: [], tokensIn: 0, tokensOut: 0, model }
}

export class FakeLLMClient implements LLMClient {
  readonly name = 'fake'

  /** Todas las peticiones que ha recibido, en orden. */
  readonly calls: LLMChatRequest[] = []

  private readonly script: FakeScript
  private queue: LLMResult[]

  constructor(script: FakeScript = []) {
    this.script = script
    this.queue = Array.isArray(script) ? [...script] : []
  }

  async chat(request: LLMChatRequest): Promise<LLMResult> {
    this.calls.push(request)

    if (typeof this.script === 'function') {
      return this.script(request)
    }

    // Sin guion pendiente devuelve una respuesta vacia en vez de reventar: en un
    // test que solo quiere comprobar el camino feliz, quedarse sin guion no
    // deberia ser un error confuso.
    const next = this.queue.shift()
    return next ?? emptyResult(request.model)
  }

  /** Anade una respuesta mas al final de la cola. */
  push(result: LLMResult): void {
    this.queue.push(result)
  }
}
