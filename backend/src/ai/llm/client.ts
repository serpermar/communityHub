// ---------------------------------------------------------------------------
// Interfaz del cliente LLM (AI-4).
//
// Una sola interfaz, tres implementaciones (`groq.ts`, `gemini.ts`, `fake.ts`) y
// un router que elige (`router.ts`). El resto del modulo no sabe que proveedor
// hay detras: cambiar de Groq a Gemini o a cualquier API compatible es cambiar
// una variable de entorno, no tocar el asistente.
//
// Por que una interfaz y no el SDK de cada proveedor (D-02, AI-4): una
// dependencia por proveedor ata el codigo a un modelo cambiante, y el esquema
// OpenAI-compatible (que Groq habla) es estable y trivial de llamar con `fetch`.
//
// El contrato es MINIMO a proposito: un `chat` que recibe mensajes y tools y
// devuelve contenido + tool calls + consumo. No hay `embed`, ni streaming por
// tokens en la interfaz: el asistente emite el resultado por SSE, y el `fetch`
// del proveedor se hace sin `stream: true` para que el bucle de tools sea
// reconstruible sin acumular deltas del proveedor.
// ---------------------------------------------------------------------------

/** Los papeles que un mensaje puede tener. `tool` lleva el resultado de una tool. */
export type LLMRole = 'system' | 'user' | 'assistant' | 'tool'

/** Una llamada a tool propuesta por el modelo. */
export type LLMToolCall = {
  id: string
  name: string
  args: unknown
}

/** Un turno de la conversacion, en el formato comun de la interfaz. */
export type LLMMessage = {
  role: LLMRole
  content: string
  /** Solo en `assistant`: las tools que pide. */
  toolCalls?: LLMToolCall[]
  /** Solo en `tool`: a que llamada responde. */
  toolCallId?: string
  /** Solo en `tool`: el nombre de la tool, para el proveedor. */
  name?: string
}

/** La descripcion de una tool que se le ofrece al modelo (JSON-schema). */
export type ToolSpec = {
  name: string
  description: string
  parameters: Record<string, unknown>
}

/** La peticion que recibe el cliente. */
export type LLMChatRequest = {
  model: string
  messages: LLMMessage[]
  tools?: ToolSpec[]
  temperature?: number
  signal?: AbortSignal
}

/** El resultado de un turno. */
export type LLMResult = {
  content: string
  toolCalls: LLMToolCall[]
  tokensIn: number
  tokensOut: number
  model: string
}

/**
 * El cliente. `name` es solo para logs y auditoria; el resto del modulo usa
 * `chat`.
 */
export interface LLMClient {
  readonly name: string
  chat(request: LLMChatRequest): Promise<LLMResult>
}

/**
 * Falla de red, timeout, HTTP no-2xx o respuesta con forma inesperada.
 *
 * La capa LLM no conoce el contrato HTTP de la API (no importa `http/errors`):
 * lanza esto y el servicio lo traduce a `AI_PROVIDER_ERROR` (502) en un unico
 * sitio. Asi un fallo del proveedor nunca se confunde con un 500 del backend.
 */
export class LLMProviderError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'LLMProviderError'
  }
}

/** Extrae el JSON de una cadena `arguments` de una tool call con tolerancia. */
export function parseToolArguments(raw: unknown): unknown {
  if (raw == null || raw === '') return {}
  if (typeof raw === 'object') return raw

  try {
    return JSON.parse(String(raw))
  } catch {
    // Un modelo puede emitir argumentos mal formados. No se aborta la
    // conversacion por eso: la validacion de la tool los rechazara con un error
    // que el asistente puede explicar.
    return {}
  }
}
