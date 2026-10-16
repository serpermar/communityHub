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
import { MEMBER_ROLES, MEMBER_ROLE_LABELS, type MemberRole } from '@/types/roles'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { formatDate } from '@/utils/format'
import { deleteDocument, getDownloadUrl, listDocuments, uploadDocument } from '../api'
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type CommunityDocument,
  type DocumentCategory,
} from '../types'

const fileSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

export function DocumentsPage() {
  const { active, role } = useCommunity()
  const isAdmin = role === 'ADMIN'
  const [page, setPage] = useState(1)
  const [category, setCategory] = useState<DocumentCategory | ''>('')
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>('OTHER')
  const [minRole, setMinRole] = useState<MemberRole>('NEIGHBOR')
  const [isPublic, setIsPublic] = useState(false)
  const [uploading, setUploading] = useState(false)

  const result = useResource(
    () =>
      listDocuments(active!.id, {
        category: category || undefined,
        page,
        limit: 20,
      }),
    [active?.id, category, page],
  )

  const onDownload = async (document: CommunityDocument) => {
    try {
      const { url } = await getDownloadUrl(document.id)
      window.open(url, '_blank', 'noopener')
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  }

  const onDelete = async (document: CommunityDocument) => {
    setServerError(null)
    try {
      await deleteDocument(document.id)
      result.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    }
  }

  const onUpload = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!file) {
      setServerError('Selecciona un archivo.')
      return
    }
    setServerError(null)
    setUploading(true)
    try {
      await uploadDocument(active!.id, {
        file,
        title: title.trim(),
        category: uploadCategory,
        minRole,
        isPublic,
      })
      setFile(null)
      setTitle('')
      setOpen(false)
      result.reload()
    } catch (caught) {
      setServerError(ApiError.from(caught).message)
    } finally {
      setUploading(false)
    }
  }

  const columns: Column<CommunityDocument>[] = [
    { key: 'title', header: 'Documento', render: (row) => row.title },
    {
      key: 'category',
      header: 'Categoría',
      render: (row) => DOCUMENT_CATEGORY_LABELS[row.category],
    },
    { key: 'size', header: 'Tamaño', render: (row) => fileSize(row.sizeBytes) },
    {
      key: 'minRole',
      header: 'Visibilidad',
      render: (row) => (
        <Badge tone="slate">{row.isPublic ? 'Todos' : MEMBER_ROLE_LABELS[row.minRole]}</Badge>
      ),
    },
    { key: 'date', header: 'Subido', render: (row) => formatDate(row.createdAt) },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={() => void onDownload(row)}>
            Descargar
          </Button>
          {isAdmin && (
            <Button size="sm" variant="danger" onClick={() => void onDelete(row)}>
              Eliminar
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-slate-800">Documentos</h1>
        {isAdmin && <Button onClick={() => setOpen(true)}>Subir documento</Button>}
      </div>

      <Card>
        <Select
          aria-label="Categoría"
          value={category}
          onChange={(event) => {
            setCategory(event.target.value as DocumentCategory | '')
            setPage(1)
          }}
          className="sm:w-64"
        >
          <option value="">Todas las categorías</option>
          {DOCUMENT_CATEGORIES.map((value) => (
            <option key={value} value={value}>
              {DOCUMENT_CATEGORY_LABELS[value]}
            </option>
          ))}
        </Select>
      </Card>

      {serverError && <Alert variant="error">{serverError}</Alert>}

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
              empty={<EmptyState title="No hay documentos" />}
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

      <Modal open={open} title="Subir documento" onClose={() => setOpen(false)}>
        <form className="space-y-3" onSubmit={onUpload} noValidate>
          <Field label="Archivo" htmlFor="doc-file" required>
            <input
              id="doc-file"
              type="file"
              className="block w-full text-sm"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Título" htmlFor="doc-title" required>
            <Input id="doc-title" value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Categoría" htmlFor="doc-category">
              <Select
                id="doc-category"
                value={uploadCategory}
                onChange={(event) => setUploadCategory(event.target.value as DocumentCategory)}
              >
                {DOCUMENT_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {DOCUMENT_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Visible desde rol" htmlFor="doc-role">
              <Select
                id="doc-role"
                value={minRole}
                onChange={(event) => setMinRole(event.target.value as MemberRole)}
              >
                {MEMBER_ROLES.map((value) => (
                  <option key={value} value={value}>
                    {MEMBER_ROLE_LABELS[value]}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            Visible para todos
          </label>
          {serverError && <Alert variant="error">{serverError}</Alert>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={uploading}>
              Subir
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
