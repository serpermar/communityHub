import { api, cleanParams } from '@/services/http'
import type { ListResult } from '@/types/api'
import type { Expense, ExpenseCategory, FinanceSummary, Invoice, InvoiceStatus } from './types'

export interface ExpenseListQuery {
  from?: string
  to?: string
  category?: ExpenseCategory
  page?: number
  limit?: number
}

export function listExpenses(
  communityId: string,
  query: ExpenseListQuery,
): Promise<ListResult<Expense>> {
  return api.list<Expense>(`/communities/${communityId}/expenses`, {
    params: cleanParams({ ...query }),
  })
}

export function getExpense(expenseId: string): Promise<Expense> {
  return api.get<Expense>(`/expenses/${expenseId}`)
}

export interface ExpenseInput {
  concept: string
  amount: number
  expenseDate: string
  category: ExpenseCategory
  supplier: string | null
  notes: string | null
}

export function createExpense(communityId: string, input: ExpenseInput): Promise<Expense> {
  return api.post<Expense>(`/communities/${communityId}/expenses`, input)
}

export function updateExpense(expenseId: string, input: ExpenseInput): Promise<Expense> {
  return api.put<Expense>(`/expenses/${expenseId}`, input)
}

export function deleteExpense(expenseId: string): Promise<{ id: string; deleted: boolean }> {
  return api.delete<{ id: string; deleted: boolean }>(`/expenses/${expenseId}`)
}

export function listInvoices(
  communityId: string,
  query: { status?: InvoiceStatus; page?: number; limit?: number },
): Promise<ListResult<Invoice>> {
  return api.list<Invoice>(`/communities/${communityId}/invoices`, {
    params: cleanParams({ ...query }),
  })
}

export interface InvoiceInput {
  number: string
  amount: number
  issueDate: string
  dueDate: string
  concept: string | null
  supplier: string | null
}

export function createInvoice(communityId: string, input: InvoiceInput): Promise<Invoice> {
  return api.post<Invoice>(`/communities/${communityId}/invoices`, input)
}

export function payInvoice(communityId: string, invoiceId: string): Promise<Invoice> {
  return api.post<Invoice>(`/communities/${communityId}/invoices/${invoiceId}/pay`, {})
}

export function getFinanceSummary(communityId: string): Promise<FinanceSummary> {
  return api.get<FinanceSummary>(`/communities/${communityId}/finance/summary`)
}
