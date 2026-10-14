// ---------------------------------------------------------------------------
// Eleccion del cliente LLM (AI-3, AI-4).
//
// Orden: fake en tests > Groq (primario) > Gemini (respaldo) > null. `null` es un
// valor legitimo, no un error: significa "modo degradado", y el servicio lo
// traduce a `503 AI_NOT_CONFIGURED` en el chat y a heuristica en `classify`.
//
// El override existe para los tests: sin poder inyectar un fake guionizado, la
// unica forma de probar el bucle de tools seria salir a la red.
// ---------------------------------------------------------------------------

import { env } from '../../config/env.js'
import type { LLMClient } from './client.js'
import { FakeLLMClient } from './fake.js'
import { GeminiClient } from './gemini.js'
import { GroqClient } from './groq.js'

function build(): LLMClient | null {
  // D-6: con la IA apagada no hay cliente aunque haya claves. El clasificador
  // caera a heuristica y el chat devolvera 503.
  if (!env.AI_ENABLED) return null

  // AI-3: en test NUNCA se sale a la red. El fake no necesita clave.
  if (env.isTest) return new FakeLLMClient()

  if (env.GROQ_API_KEY) return new GroqClient(env.GROQ_API_KEY)
  if (env.GEMINI_API_KEY) return new GeminiClient(env.GEMINI_API_KEY)

  return null
}

let override: LLMClient | null | undefined
let cached: LLMClient | null | undefined

/** Cliente activo, construido una sola vez (salvo override de test). */
export function getLLMClient(): LLMClient | null {
  if (override !== undefined) return override
  if (cached === undefined) cached = build()
  return cached
}

/** Inyecta un cliente (tests). `null` fuerza modo degradado. */
export function setLLMClient(client: LLMClient | null): void {
  override = client
}

/** Vuelve a la eleccion por entorno. */
export function resetLLMClient(): void {
  override = undefined
  cached = undefined
}
