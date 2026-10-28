import { useState } from 'react'
import { useForm } from 'react-hook-form'
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  Field,
  Input,
  LoadingState,
  SkeletonTable,
  Modal,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  TabPanel,
  INVOICE_STATUS_TONES,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import {
  createExpense,
  createInvoice,
  deleteExpense,
  getFinanceSummary,
  listExpenses,
  listInvoices,
  payInvoice,
  updateExpense,
} from '../api'
import {
  EXPENSE_CATEGORIES,
  EXPENSE_CATEGORY_LABELS,
  INVOICE_STATUS_LABELS,
  type Expense,
  type ExpenseCategory,
  type Invoice,
} from '../types'
import styles from './FinancePage.module.css'

const money = (value: number): string => `${value.toFixed(2)} €`
const today = (): string => new Date().toISOString().slice(0, 10)

export function FinancePage() {
  const { active } = useCommunity()
  const { filters, setFilter } = useUrlFilters({
    tab: ['summary', 'expenses', 'invoices'] as const,
  })
  const tab = (filters.tab || 'summary') as 'summary' | 'expenses' | 'invoices'

  return (
    <div className={styles.page}>
      <PageHeader
        title="Finanzas"
        actions={
          <Tabs
            ariaLabel="Secciones de finanzas"
            value={tab}
            onChange={(value) => setFilter('tab', value)}
            items={[
              { value: 'summary', label: 'Resumen' },
              { value: 'expenses', label: 'Gastos' },
              { value: 'invoices', label: 'Facturas' },
            ]}
          />
        }
      />

      <TabPanel value="summary" active={tab}>
        <SummaryTab communityId={active!.id} />
      </TabPanel>
      <TabPanel value="expenses" active={tab}>
        <ExpensesTab communityId={active!.id} />
      </TabPanel>
      <TabPanel value="invoices" active={tab}>
        <InvoicesTab communityId={active!.id} />
      </TabPanel>
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
    <div className={styles.summaryGrid}>
      <Card title={<span className={styles.cardTitle}>Gastos</span>}>
        <p className={styles.summaryValue}>{money(data.expenseTotal)}</p>
        <p className={styles.summaryMeta}>{data.expenseCount} gastos registrados.</p>
        <ul className={styles.summaryList}>
          {data.expenseByCategory.map((item) => (
            <li key={item.category} className={styles.summaryRow}>
              <span>{EXPENSE_CATEGORY_LABELS[item.category]}</span>
              <span>{money(item.total)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title={<span className={styles.cardTitle}>Facturas</span>}>
        <p className={styles.summaryValue}>{money(data.invoiceTotal)}</p>
        <ul className={styles.summaryList}>
          <li className={styles.summaryRow}>
            <span>Pendiente de cobro/pago</span>
            <span>{money(data.invoiceOpenAmount)}</span>
          </li>
          <li className={styles.summaryRow}>
            <span>Pagado</span>
            <span>{money(data.invoicePaidAmount)}</span>
          </li>
          <li className={styles.summaryRow}>
            <span>Pendientes</span>
            <span>{data.invoicePendingCount}</span>
          </li>
          <li className={styles.summaryRow}>
            <span>Vencidas</span>
            <span>{data.invoiceOverdueCount}</span>
          </li>
        </ul>
      </Card>
    </div>
  )
}

// --- Formularios tipados ---
type ExpenseForm = {
  concept: string
  amount: string
  expenseDate: string
  category: ExpenseCategory
  supplier: string
  notes: string
}

type InvoiceForm = {
  number: string
  amount: string
  issueDate: string
  dueDate: string
  concept: string
  supplier: string
}

function ExpensesTab({ communityId }: { communityId: string }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Expense | null>(null)

  const result = useResource(
    () => listExpenses(communityId, { page, limit: 20 }),
    [communityId, page],
  )

  // 1. Usamos react-hook-form para evitar que el input pierda el foco
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ExpenseForm>({
    defaultValues: {
      concept: '',
      amount: '',
      expenseDate: today(),
      category: 'OTHER',
      supplier: '',
      notes: '',
    },
  })

  const openCreate = () => {
    setEditing(null)
    reset({
      concept: '',
      amount: '',
      expenseDate: today(),
      category: 'OTHER',
      supplier: '',
      notes: '',
    })
    setError(null)
    setOpen(true)
  }

  const openEdit = (row: Expense) => {
    setEditing(row)
    reset({
      concept: row.concept,
      amount: String(row.amount),
      expenseDate: row.expenseDate,
      category: row.category,
      supplier: row.supplier ?? '',
      notes: row.notes ?? '',
    })
    setError(null)
    setOpen(true)
  }

  const save = handleSubmit(async (values) => {
    setError(null)
    setSaving(true)
    const input = {
      concept: values.concept.trim(),
      amount: Number(values.amount),
      expenseDate: values.expenseDate,
      category: values.category,
      supplier: values.supplier.trim() || null,
      notes: values.notes.trim() || null,
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
  })

  const remove = async (row: Expense) => {
    setError(null)
    try {
      await deleteExpense(row.id)
      setPendingDelete(null)
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    }
  }

  const columns: Column<Expense>[] = [
    { key: 'concept', header: 'Concepto', render: (row) => row.concept },
    {
      key: 'category',
      header: 'Categoría',
      render: (row) => EXPENSE_CATEGORY_LABELS[row.category],
    },
    { key: 'date', header: 'Fecha', render: (row) => row.expenseDate },
    { key: 'amount', header: 'Importe', render: (row) => money(row.amount) },
    { key: 'supplier', header: 'Proveedor', render: (row) => row.supplier ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className={styles.rowActions}>
          <Button size="sm" variant="secondary" onClick={() => openEdit(row)}>
            Editar
          </Button>
          <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
            Eliminar
          </Button>
        </div>
      ),
    },
  ]

  return (
    <div className={styles.tabContent}>
      <div className={styles.actionsRow}>
        <Button onClick={openCreate}>Nuevo gasto</Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {result.loading ? (
        <SkeletonTable columns={5} />
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
        <form className={styles.form} onSubmit={save} noValidate>
          <Field label="Concepto" htmlFor="exp-concept" error={errors.concept?.message} required>
            <Input
              id="exp-concept"
              {...register('concept', { required: 'El concepto es obligatorio.' })}
            />
          </Field>
          <div className={styles.formRow}>
            <Field label="Importe (€)" htmlFor="exp-amount" error={errors.amount?.message} required>
              <Input
                id="exp-amount"
                type="number"
                step="0.01"
                min="0"
                {...register('amount', { required: 'El importe es obligatorio.' })}
              />
            </Field>
            <Field label="Fecha" htmlFor="exp-date" error={errors.expenseDate?.message} required>
              <Input
                id="exp-date"
                type="date"
                {...register('expenseDate', { required: 'La fecha es obligatoria.' })}
              />
            </Field>
          </div>
          <Field label="Categoría" htmlFor="exp-category">
            <Select id="exp-category" {...register('category')}>
              {EXPENSE_CATEGORIES.map((value) => (
                <option key={value} value={value}>
                  {EXPENSE_CATEGORY_LABELS[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Proveedor" htmlFor="exp-supplier">
            <Input id="exp-supplier" {...register('supplier')} />
          </Field>
          <Field label="Notas" htmlFor="exp-notes">
            <Input id="exp-notes" {...register('notes')} />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className={styles.modalFooter}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving}>
              Guardar
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar gasto"
        description={
          pendingDelete ? `Se eliminará el gasto «${pendingDelete.concept}».` : undefined
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => (pendingDelete ? remove(pendingDelete) : undefined)}
      />
    </div>
  )
}

function InvoicesTab({ communityId }: { communityId: string }) {
  const [page, setPage] = useState(1)
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const result = useResource(
    () => listInvoices(communityId, { page, limit: 20 }),
    [communityId, page],
  )

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<InvoiceForm>({
    defaultValues: {
      number: '',
      amount: '',
      issueDate: today(),
      dueDate: today(),
      concept: '',
      supplier: '',
    },
  })

  const openCreate = () => {
    reset({
      number: '',
      amount: '',
      issueDate: today(),
      dueDate: today(),
      concept: '',
      supplier: '',
    })
    setError(null)
    setOpen(true)
  }

  const save = handleSubmit(async (values) => {
    setError(null)
    setSaving(true)
    try {
      await createInvoice(communityId, {
        number: values.number.trim(),
        amount: Number(values.amount),
        issueDate: values.issueDate,
        dueDate: values.dueDate,
        concept: values.concept.trim() || null,
        supplier: values.supplier.trim() || null,
      })
      setOpen(false)
      result.reload()
    } catch (caught) {
      setError(ApiError.from(caught).message)
    } finally {
      setSaving(false)
    }
  })

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
        <Badge tone={INVOICE_STATUS_TONES[row.effectiveStatus]}>
          {INVOICE_STATUS_LABELS[row.effectiveStatus]}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      render: (row) =>
        row.effectiveStatus === 'PENDING' || row.effectiveStatus === 'OVERDUE' ? (
          <div className={styles.actionsRow}>
            <Button size="sm" onClick={() => void pay(row)}>
              Marcar pagada
            </Button>
          </div>
        ) : null,
    },
  ]

  return (
    <div className={styles.tabContent}>
      <div className={styles.sectionHeader}>
        <h2 className={styles.sectionTitle}>Facturas</h2>
        <Button onClick={openCreate}>Nueva factura</Button>
      </div>

      {error && <Alert variant="error">{error}</Alert>}

      {result.loading ? (
        <SkeletonTable columns={5} />
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
        <form className={styles.form} onSubmit={save} noValidate>
          <div className={styles.formRow}>
            <Field label="Número" htmlFor="inv-number" error={errors.number?.message} required>
              <Input
                id="inv-number"
                {...register('number', { required: 'El número es obligatorio.' })}
              />
            </Field>
            <Field label="Importe (€)" htmlFor="inv-amount" error={errors.amount?.message} required>
              <Input
                id="inv-amount"
                type="number"
                step="0.01"
                min="0"
                {...register('amount', { required: 'El importe es obligatorio.' })}
              />
            </Field>
          </div>
          <div className={styles.formRow}>
            <Field label="Emisión" htmlFor="inv-issue" error={errors.issueDate?.message} required>
              <Input
                id="inv-issue"
                type="date"
                {...register('issueDate', { required: 'La fecha es obligatoria.' })}
              />
            </Field>
            <Field label="Vencimiento" htmlFor="inv-due" error={errors.dueDate?.message} required>
              <Input
                id="inv-due"
                type="date"
                {...register('dueDate', { required: 'La fecha es obligatoria.' })}
              />
            </Field>
          </div>
          <Field label="Concepto" htmlFor="inv-concept">
            <Input id="inv-concept" {...register('concept')} />
          </Field>
          <Field label="Proveedor" htmlFor="inv-supplier">
            <Input id="inv-supplier" {...register('supplier')} />
          </Field>
          {error && <Alert variant="error">{error}</Alert>}
          <div className={styles.modalFooter}>
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
