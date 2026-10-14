// ---------------------------------------------------------------------------
// Cliente Groq (AI-4).
//
// Groq habla el esquema OpenAI-compatible de `/chat/completions`, que es estable
// y trivial de llamar con `fetch` nativo. Por eso no hay SDK (D-02): menos
// dependencias, menos superficie que un proveedor pueda romper.
//
// La funcion de este archivo es traducir entre los tipos internos
// (`LLMMessage`/`ToolSpec`/`LLMResult`) y el JSON del proveedor. Nada de negocio:
// no decide que tools existen ni que hacer con su resultado.
// ---------------------------------------------------------------------------

import {
  LLMProviderError,
  parseToolArguments,
  type LLMChatRequest,
  type LLMClient,
  type LLMMessage,
  type LLMResult,
  type ToolSpec,
} from './client.js'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

type OpenAIWireMessage = {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

type OpenAIWireTool = {
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}

type OpenAIResponse = {
  choices?: {
    message?: {
      content?: string | null
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[]
    }
  }[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
  model?: string
}

function toWireMessage(message: LLMMessage): OpenAIWireMessage {
  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) },
      })),
    }
  }

  if (message.role === 'tool') {
    return { role: 'tool', content: message.content, tool_call_id: message.toolCallId }
  }

  return { role: message.role, content: message.content }
}

function toWireTool(tool: ToolSpec): OpenAIWireTool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  }
}

export class GroqClient implements LLMClient {
  readonly name = 'groq'

  constructor(private readonly apiKey: string) {}

  async chat(request: LLMChatRequest): Promise<LLMResult> {
    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toWireMessage),
    }

    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(toWireTool)
      body.tool_choice = 'auto'
    }

    if (request.temperature !== undefined) {
      body.temperature = request.temperature
    }

    let response: Response
    try {
      response = await fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: request.signal,
      })
    } catch (cause) {
      throw new LLMProviderError('No se pudo contactar con Groq.', { cause })
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new LLMProviderError(`Groq respondio ${response.status}: ${detail.slice(0, 300)}`)
    }

    let data: OpenAIResponse
    try {
      data = (await response.json()) as OpenAIResponse
    } catch (cause) {
      throw new LLMProviderError('Groq devolvio una respuesta que no es JSON.', { cause })
    }

    const message = data.choices?.[0]?.message
    if (!message) {
      throw new LLMProviderError('Groq no devolvio ninguna opcion.')
    }

    const toolCalls = (message.tool_calls ?? []).map((call, index) => ({
      id: call.id ?? `call_${index}`,
      name: call.function?.name ?? '',
      args: parseToolArguments(call.function?.arguments),
    }))

    return {
      content: message.content ?? '',
      toolCalls,
      tokensIn: data.usage?.prompt_tokens ?? 0,
      tokensOut: data.usage?.completion_tokens ?? 0,
      model: data.model ?? request.model,
    }
  }
}
