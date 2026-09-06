export interface Ticket {
  id: number
  subject: string
  status: number
  priority: number
  requester_id: number
  responder_id: number | null
  created_at: string
  updated_at: string
  due_by: string | null
  description?: string
  description_text?: string
  tags?: string[]
  type?: string | null
  custom_fields?: Record<string, unknown>
}

export interface SearchTicketsResponse {
  total: number
  results: Ticket[]
}

export interface Agent {
  id: number
  contact: {
    name: string
    email: string
  }
}

export interface Contact {
  id: number
  name: string
  email: string
}

export interface AppConfig {
  domain: string
}

export interface Conversation {
  id: number
  body_text?: string
  body?: string
  incoming: boolean
  private: boolean
  user_id: number
  created_at: string
}

export interface FetchProgress {
  fetched: number
  total: number
  page: number
  totalPages: number
  phase: 'tickets' | 'agents' | 'contacts' | 'conversations'
  status: 'fetching' | 'rate_limited' | 'retrying'
  retryAfterSeconds?: number
  message?: string
}

export interface EnrichedTicket extends Ticket {
  requesterName: string
  agentName: string
}

export class FreshdeskApiError extends Error {
  status: number
  retryAfterSeconds?: number
  recoverable: boolean

  constructor(
    message: string,
    status: number,
    options?: { retryAfterSeconds?: number; recoverable?: boolean },
  ) {
    super(message)
    this.name = 'FreshdeskApiError'
    this.status = status
    this.retryAfterSeconds = options?.retryAfterSeconds
    this.recoverable = options?.recoverable ?? false
  }
}
