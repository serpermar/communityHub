import type { MemberRole } from '@/types/roles'

export const DOCUMENT_CATEGORIES = [
  'MINUTES',
  'STATUTES',
  'INVOICE',
  'BUDGET',
  'MAINTENANCE',
  'OTHER',
] as const
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]

export interface CommunityDocument {
  id: string
  communityId: string
  title: string
  description: string | null
  category: DocumentCategory
  mimeType: string
  sizeBytes: number
  checksum: string
  minRole: MemberRole
  isPublic: boolean
  uploadedBy: string | null
  uploadedByName: string | null
  createdAt: string
  updatedAt: string
}

export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  MINUTES: 'Actas',
  STATUTES: 'Estatutos',
  INVOICE: 'Facturas',
  BUDGET: 'Presupuestos',
  MAINTENANCE: 'Mantenimiento',
  OTHER: 'Otros',
}
