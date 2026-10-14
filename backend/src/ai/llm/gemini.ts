// ---------------------------------------------------------------------------
// Cliente Gemini (AI-4), el respaldo de Groq.
//
// La API de Google (`generativelanguage.googleapis.com`) NO es OpenAI-compatible:
// los turnos van en `contents`, el system prompt en `systemInstruction`, las
// tools en `functionDeclarations` y las tool calls se devuelven como
// `functionCall` sin id. Este archivo traduce de ida y vuelta.
//
// Es el fallback: los tests no lo tocan (AI-3 usa el fake) y en el peor caso solo
// tiene que no romper el arranque. Aun asi se implementa entero para que un
// despliegue con solo `GEMINI_API_KEY` funcione y no sea codigo muerto.
//
// Nota de despliegue: `LLM_PRIMARY_MODEL` trae el id de Groq
// (`openai/gpt-oss-120b`). Un despliegue que use el fallback Gemini debe apuntar
// esas variables a un modelo de Google; la traduccion no adivina el proveedor a
// partir del nombre.
// ---------------------------------------------------------------------------

import {
  LLMProviderError,
  type LLMChatRequest,
  type LLMClient,
  type LLMMessage,
  type LLMResult,
  type ToolSpec,
} from './client.js'

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

type GeminiPart =
  | { text: string }
  | { functionCall: { name: string; args: Record<string, unknown> } }
  | { functionResponse: { name: string; response: Record<string, unknown> } }

type GeminiContent = { role: 'user' | 'model'; parts: GeminiPart[] }

type GeminiResponse = {
  candidates?: { content?: { parts?: GeminiPart[] } }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

function toContents(messages: LLMMessage[]): { system: string; contents: GeminiContent[] } {
  const systemParts: string[] = []
  const contents: GeminiContent[] = []

  for (const message of messages) {
    if (message.role === 'system') {
      systemParts.push(message.content)
      continue
    }

    if (message.role === 'user') {
      contents.push({ role: 'user', parts: [{ text: message.content }] })
      continue
    }

    if (message.role === 'assistant') {
      const parts: GeminiPart[] = []
      if (message.content) parts.push({ text: message.content })
      for (const call of message.toolCalls ?? []) {
        parts.push({
          functionCall: { name: call.name, args: (call.args as Record<string, unknown>) ?? {} },
        })
      }
      contents.push({ role: 'model', parts })
      continue
    }

    // role === 'tool'
    contents.push({
      role: 'user',
      parts: [{ functionResponse: { name: message.name ?? '', response: { result: message.content } } }],
    })
  }

  return { system: systemParts.join('\n\n'), contents }
}

function toFunctionDeclarations(tools: ToolSpec[]) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }))
}

export class GeminiClient implements LLMClient {
  readonly name = 'gemini'

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMChatRequest): Promise<LLMResult> {
    const { system, contents } = toContents(request.messages)

    const body: Record<string, unknown> = { contents }

    if (system) {
      body.systemInstruction = { parts: [{ text: system }] }
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = [{ functionDeclarations: toFunctionDeclarations(request.tools) }]
    }

    if (request.temperature !== undefined) {
      body.generationConfig = { temperature: request.temperature }
    }

    const url = `${GEMINI_BASE}/${encodeURIComponent(request.model)}:generateContent?key=${encodeURIComponent(this.apiKey)}`

    let response: Response
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: request.signal,
      })
    } catch (cause) {
      throw new LLMProviderError('No se pudo contactar con Gemini.', { cause })
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LLMProviderError(`Gemini respondio ${response.status}: ${detail.slice(0, 300)}`)
    }

    let data: GeminiResponse
    try {
      data = (await response.json()) as GeminiResponse
    } catch (cause) {
      throw new LLMProviderError('Gemini devolvio una respuesta que no es JSON.', { cause })
    }

    const parts = data.candidates?.[0]?.content?.parts ?? []
    const content = parts
      .map((part) => ('text' in part ? part.text : ''))
      .filter(Boolean)
      .join('')

    const toolCalls = parts
      .map((part, index) => ('functionCall' in part ? { id: `gemini_call_${index}`, ...part.functionCall } : null))
      .filter((call): call is { id: string; name: string; args: Record<string, unknown> } => call !== null)

    return {
      content,
      toolCalls,
      tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
      tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
      model: request.model,
    }
  }
}
