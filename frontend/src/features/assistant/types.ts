export interface ChatSession {
  id: string
  title: string | null
  communityId: string | null
  createdAt: string
}

export interface ChatCitation {
  tool: string
  ids: string[]
}

export interface ChatToolCall {
  name: string
  args: unknown
}

export interface ChatMessage {
  id: string
  role: string
  content: string
  toolCalls: ChatToolCall[] | null
  citations: ChatCitation[] | null
  tokensIn: number | null
  tokensOut: number | null
  createdAt: string
}

export interface AiTool {
  name: string
  description: string
  roles: string[]
  requiresCommunity: boolean
}

export interface ChatStreamBody {
  message: string
  sessionId?: string
  communityId?: string
}

export type ChatEvent =
  | { type: 'meta'; sessionId: string; model: string }
  | { type: 'tool_call'; name: string; args: unknown }
  | { type: 'citation'; tool: string; ids: string[] }
  | { type: 'token'; delta: string }
  | { type: 'done'; tokensIn: number; tokensOut: number }
  | { type: 'error'; code: string; message: string }

export interface IncidentProposal {
  category: string
  priority: string
  title: string
  description: string
  confidence: number
  needsHumanReview: boolean
}

export interface IncidentDraft {
  id: string
  proposal: IncidentProposal
  status: string
  confidence: number
  needsHumanReview: boolean
  createdAt: string
  expiresAt: string
}
