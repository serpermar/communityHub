export const EXPENSE_CATEGORIES = [
  'MAINTENANCE',
  'CLEANING',
  'SECURITY',
  'UTILITIES',
  'ADMIN',
  'INSURANCE',
  'OTHER',
] as const
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]

export interface Expense {
  id: string
  communityId: string
  concept: string
  category: ExpenseCategory
  amount: number
  expenseDate: string
  supplier: string | null
  notes: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export const INVOICE_STATUSES = ['PENDING', 'PAID', 'OVERDUE', 'CANCELLED'] as const
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number]

export interface Invoice {
  id: string
  communityId: string
  number: string
  concept: string | null
  amount: number
  issueDate: string
  dueDate: string
  paidAt: string | null
  status: 'PENDING' | 'PAID' | 'CANCELLED'
  effectiveStatus: InvoiceStatus
  supplier: string | null
  isGenerated: boolean
  createdBy: string | null
  createdByName: string | null
  createdAt: string
  updatedAt: string
}

export interface FinanceSummary {
  expenseTotal: number
  expenseCount: number
  expenseByCategory: { category: ExpenseCategory; total: number; count: number }[]
  expenseRecent: {
    id: string
    concept: string
    category: ExpenseCategory
    amount: number
    expenseDate: string
    supplier: string | null
  }[]
  invoiceTotal: number
  invoiceCount: number
  invoiceOpenAmount: number
  invoicePaidAmount: number
  invoicePendingCount: number
  invoiceOverdueCount: number
}

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  MAINTENANCE: 'Mantenimiento',
  CLEANING: 'Limpieza',
  SECURITY: 'Seguridad',
  UTILITIES: 'Suministros',
  ADMIN: 'Administración',
  INSURANCE: 'Seguros',
  OTHER: 'Otros',
}

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  PENDING: 'Pendiente',
  PAID: 'Pagada',
  OVERDUE: 'Vencida',
  CANCELLED: 'Cancelada',
}
