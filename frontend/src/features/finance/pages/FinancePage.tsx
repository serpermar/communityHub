import { useState } from 'react'
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  Modal,
  Pagination,
  Select,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { createExpense, createInvoice, deleteExpense, getFinanceSummary, listExpenses, listInvoices, payInvoice, updateExpense } from '../api'
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  type Expense,
  type ExpenseCategory,
  type Invoice,
} from '../types'

const money = (value: number): string => `${value.toFixed(2)} €`
const today = (): string => new Date().toISOString().slice(0, 10)

export function FinancePage() {
  const { active } = useCommunity()
  const [tab, setTab] = useState<'summary' | 'expenses' | 'invoices'>('summary')

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-slate-800">Finanzas</h1>
      <div className="flex gap-2">
        {(
          [
            ['summary', 'Resumen'],
            ['expenses', 'Gastos'],
            ['invoices', 'Facturas'],
          ] as const
        ).map(([value, label]) => (
          <Button
            key={value}
            size="sm"
            variant={tab === value ? 'primary' : 'secondary'}
            onClick={() => setTab(value)}
          >
            {label}
          </Button>
        ))}
      </div>

      {tab === 'summary' && <SummaryTab communityId={active!.id} />}
      {tab === 'expenses' && <ExpensesTab communityId={active!.id} />}
      {tab === 'invoices' && <InvoicesTab communityId={active!.id} />}
    </div>
  )
}

function SummaryTab({ communityId }: { communityId: string }) {
  const summary = useResource(() => getFinanceSummary(communityId), [communityId])
  if (summary.loading) return <LoadingState />
  if (summary.error) return <ErrorState error={summary.error} onRetry={summary.reload} />
  if (!summary.data) return null
  const data = summary.data

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card title="Gastos">
        <p className="text-2xl font-semibold text-slate-800">{money(data.expenseTotal)}</p>
        <p className="text-sm text-slate-500">{data.expenseCount} gastos registrados.</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          {data.expenseByCategory.map((item) => (
            <li key={item.category} className="flex items-center justify-between">
              <span>{EXPENSE_CATEGORY_LABELS[item.category]}</span>
              <span>{money(item.total)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Facturas">
        <p className="text-2xl font-semibold text-slate-800">{money(data.invoiceTotal)}</p>
        <ul className="mt-3 space-y-1 text-sm text-slate-600">
          <li className="flex items-center justify-between">
            <span>Pendiente de cobro/pago</span>
            <span>{money(data.invoiceOpenAmount)}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Pagado</span>
            <span>{money(data.invoicePaidAmount)}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Pendientes</span>
            <span>{data.invoicePendingCount}</span>
          </li>
          <li className="flex items-center justify-between">
            <span>Vencidas</span>
            <span>{data.invoiceOverdueCount}</span>
          </li>
        </ul>
      </Card>
    </div>
  )
}

function ExpensesTab({ communityId }: { communityId: string }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [concept, setConcept] = useState('')
  const [amount, setAmount] = useState('')
  const [expenseDate, setExpenseDate] = useState(today())
  const [category, setCategory] = useState<ExpenseCategory>('OTHER')
  const [supplier, setSupplier] = useState('')
  const [notes, setNotes] = useState('')

  const result = useResource(() => listExpenses(communityId, { page, limit: 20 }), [
    communityId,
    page,
  ])

  const openCreate = () => {
    setEditing(null)
    setConcept('')
    setAmount('')
    setExpenseDate(today())
    setCategory('OTHER')
    setSupplier('')
    setNotes('')
    setError(null)
    setOpen(true)
  }

  const openEdit = (row: Expense) => {
    setEditing(row)
    setConcept(row.concept)
    setAmount(String(row.amount))
    setExpenseDate(row.expenseDate)
    setCategory(row.category)
    setSupplier(row.supplier ?? '')
    setNotes(row.notes ?? '')
    setError(null)
    setOpen(true)
  }

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaving(true)
    const input = {
      concept: concept.trim(),
      amount: Number(amount),
      expenseDate,
      category,
      supplier: supplier.trim() || null,
      notes: notes.trim() || null,
    }
    try {
      if (editing) await updateExpense(editing.id, input)
      else await createExpense(communityId, input)
      setOpen(false)
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (row: Expense) => {
    setError(null)
    try {
      await deleteExpense(row.id)
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const columns: Column<Expense>[] = [
    { key: 'concept', header: 'Concepto', render: (row) => row.concept },
    { key: 'category', header: 'Categoría', render: (row) => EXPENSE_CATEGORY_LABELS[row.category] },
    { key: 'date', header: 'Fecha', render: (row) => row.expenseDate },
    { key: 'amount', header: 'Importe', render: (row) => money(row.amount) },
    { key: 'supplier', header: 'Proveedor', render: (row) => row.supplier ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
            Editar
          </Button>
          <Button size="sm" variant="danger" onClick={() => void remove(row)}>
            Eliminar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openCreate}>Nuevo gasto</Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <>
          <Card>
            <DataTable
              columns={columns}
              rows={result.data.data}
              rowKey={(row) => row.id}
              empty={<EmptyState title="No hay gastos" />}
            />
          </Card>
          <Pagination
            page={result.data.meta.page}
            totalPages={result.data.meta.totalPages}
            total={result.data.meta.total}
            onPage={setPage}
          />
        </>
      ) : null}

      <Modal
        open={open}
        title={editing ? 'Editar gasto' : 'Nuevo gasto'}
        onClose={() => setOpen(false)}
      >
        <form className="space-y-3" onSubmit={save} noValidate>
          <Field label="Concepto" htmlFor="exp-concept" required>
            <Input id="exp-concept" value={concept} onChange={(e) => setConcept(e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Importe (€)" htmlFor="exp-amount" required>
              <Input
                id="exp-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
            <Field label="Fecha" htmlFor="exp-date" required>
              <Input
                id="exp-date"
                type="date"
                value={expenseDate}
                onChange={(e) => setExpenseDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Categoría" htmlFor="exp-category">
            <Select
              id="exp-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as ExpenseCategory)}
            >
              {EXPENSE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {EXPENSE_CATEGORY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Proveedor" htmlFor="exp-supplier">
            <Input id="exp-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Notas" htmlFor="exp-notes">
            <Input id="exp-notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function InvoicesTab({ communityId }: { communityId: string }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [number, setNumber] = useState('')
  const [amount, setAmount] = useState('')
  const [issueDate, setIssueDate] = useState(today())
  const [dueDate, setDueDate] = useState(today())
  const [concept, setConcept] = useState('')
  const [supplier, setSupplier] = useState('')

  const result = useResource(() => listInvoices(communityId, { page, limit: 20 }), [
    communityId,
    page,
  ])

  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await createInvoice(communityId, {
        number: number.trim(),
        amount: Number(amount),
        issueDate,
        dueDate,
        concept: concept.trim() || null,
        supplier: supplier.trim() || null,
      })
      setNumber('')
      setAmount('')
      setIssueDate(today())
      setDueDate(today())
      setConcept('')
      setSupplier('')
      setOpen(false)
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setSaving(false)
    }
  }

  const pay = async (row: Invoice) => {
    setError(null)
    try {
      await payInvoice(communityId, row.id)
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const columns: Column<Invoice>[] = [
    { key: 'number', header: 'Número', render: (row) => row.number },
    { key: 'concept', header: 'Concepto', render: (row) => row.concept ?? '—' },
    { key: 'amount', header: 'Importe', render: (row) => money(row.amount) },
    { key: 'due', header: 'Vence', render: (row) => row.dueDate },
    {
      key: 'status',
      header: 'Estado',
      render: (row) => (
        <Badge
          tone={
            row.effectiveStatus === 'PAID'
              ? 'green'
              : row.effectiveStatus === 'OVERDUE'
                ? 'red'
                : row.effectiveStatus === 'CANCELLED'
                  ? 'slate'
                  : 'amber'
          }
        >
          {row.effectiveStatus}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.effectiveStatus === 'PENDING' || row.effectiveStatus === 'OVERDUE' ? (
          <div className="flex justify-end">
            <Button size="sm" onClick={() => void pay(row)}>
              Marcar pagada
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-800">Facturas</h2>
        <Button onClick={() => setOpen(true)}>Nueva factura</Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {result.loading ? (
        <LoadingState />
      ) : result.error ? (
        <ErrorState error={result.error} onRetry={result.reload} />
      ) : result.data ? (
        <>
          <Card>
            <DataTable
              columns={columns}
              rows={result.data.data}
              rowKey={(row) => row.id}
              empty={<EmptyState title="No hay facturas" />}
            />
          </Card>
          <Pagination
            page={result.data.meta.page}
            totalPages={result.data.meta.totalPages}
            total={result.data.meta.total}
            onPage={setPage}
          />
        </>
      ) : null}

      <Modal open={open} title="Nueva factura" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={save} noValidate>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Número" htmlFor="inv-number" required>
              <Input id="inv-number" value={number} onChange={(e) => setNumber(e.target.value)} />
            </Field>
            <Field label="Importe (€)" htmlFor="inv-amount" required>
              <Input
                id="inv-amount"
                type="number"
                step="0.01"
                min="0"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Emisión" htmlFor="inv-issue" required>
              <Input
                id="inv-issue"
                type="date"
                value={issueDate}
                onChange={(e) => setIssueDate(e.target.value)}
              />
            </Field>
            <Field label="Vencimiento" htmlFor="inv-due" required>
              <Input
                id="inv-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Concepto" htmlFor="inv-concept">
            <Input id="inv-concept" value={concept} onChange={(e) => setConcept(e.target.value)} />
          </Field>
          <Field label="Proveedor" htmlFor="inv-supplier">
            <Input id="inv-supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Crear factura
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
