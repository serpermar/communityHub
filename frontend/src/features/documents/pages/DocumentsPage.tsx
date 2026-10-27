import { useState } from 'react'
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
  Modal,
  PageHeader,
  Pagination,
  Select,
  SkeletonTable,
  EmptyFolderIcon,
  type Column,
} from '@/components/ui'
import { ApiError } from '@/services/ApiError'
import { MEMBER_ROLES, MEMBER_ROLE_LABELS, type MemberRole } from '@/types/roles'
import { useCommunity } from '@/context/CommunityContext'
import { useResource } from '@/hooks/useResource'
import { useUrlFilters } from '@/hooks/useUrlFilters'
import { formatDate } from '@/utils/format'
import { deleteDocument, getDownloadUrl, listDocuments, uploadDocument } from '../api'
import {
  DOCUMENT_CATEGORIES,
  DOCUMENT_CATEGORY_LABELS,
  type CommunityDocument,
  type DocumentCategory,
} from '../types'
import { DocumentPreviewModal, isPreviewable } from '../components/DocumentPreviewModal'
import styles from './DocumentsPage.module.css'

const fileSize = (bytes: number): string =>
  bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(0)} KB`

export function DocumentsPage() {
  const { active, role } = useCommunity()
  const isAdmin = role === 'ADMIN'
  const { filters, page, pageSize, setFilter, setPage, setPageSize } = useUrlFilters(
    { category: DOCUMENT_CATEGORIES },
    { pageSizeOptions: [10, 20, 50], defaultPageSize: 20 },
  )
  const { category } = filters
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<CommunityDocument | null>(null)

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [uploadCategory, setUploadCategory] = useState<DocumentCategory>('OTHER')
  const [minRole, setMinRole] = useState<MemberRole>('NEIGHBOR')
  const [isPublic, setIsPublic] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<CommunityDocument | null>(null)

  const result = useResource(
    () =>
      listDocuments(active!.id, {
        category: (category || undefined) as DocumentCategory | undefined,
        page,
        limit: pageSize,
      }),
    [active?.id, category, page, pageSize],
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
      setPendingDelete(null)
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
    {
      key: 'title',
      header: 'Documento',
      sortable: true,
      sortValue: (row) => row.title,
      render: (row) => row.title,
    },
    {
      key: 'category',
      header: 'Categoría',
      sortable: true,
      sortValue: (row) => DOCUMENT_CATEGORY_LABELS[row.category],
      render: (row) => DOCUMENT_CATEGORY_LABELS[row.category],
    },
    {
      key: 'size',
      header: 'Tamaño',
      sortable: true,
      sortValue: (row) => row.sizeBytes,
      render: (row) => fileSize(row.sizeBytes),
    },
    {
      key: 'minRole',
      header: 'Visibilidad',
      render: (row) => (
        <Badge tone="slate">{row.isPublic ? 'Todos' : MEMBER_ROLE_LABELS[row.minRole]}</Badge>
      ),
    },
    {
      key: 'date',
      header: 'Subido',
      sortable: true,
      sortValue: (row) => row.createdAt,
      render: (row) => formatDate(row.createdAt),
    },
    {
      key: 'actions',
      header: '',
      render: (row) => (
        <div className={styles.rowActions}>
          {isPreviewable(row.mimeType) && (
            <Button size="sm" variant="ghost" onClick={() => setPreviewDoc(row)}>
              Vista previa
            </Button>
          )}
          <Button size="sm" variant="secondary" onClick={() => void onDownload(row)}>
            Descargar
          </Button>
          {isAdmin && (
            <Button size="sm" variant="danger" onClick={() => setPendingDelete(row)}>
              Eliminar
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className={styles.page}>
      <PageHeader
        title="Documentos"
        actions={isAdmin && <Button onClick={() => setOpen(true)}>Subir documento</Button>}
      />

      <Card>
        <Select
          aria-label="Categoría"
          value={category}
          onChange={(event) => setFilter('category', event.target.value)}
          className={styles.filterSelect}
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
              empty={
                <EmptyState
                  icon={<EmptyFolderIcon className={styles.emptyIcon} />}
                  title="No hay documentos"
                  description="Sube el primer documento de la comunidad."
                  action={
                    isAdmin ? (
                      <Button onClick={() => setOpen(true)}>Subir documento</Button>
                    ) : undefined
                  }
                />
              }
            />
          </Card>
          <Pagination
            page={result.data.meta.page}
            totalPages={result.data.meta.totalPages}
            total={result.data.meta.total}
            onPage={setPage}
            pageSize={pageSize}
            pageSizeOptions={[10, 20, 50]}
            onPageSize={setPageSize}
          />
        </>
      ) : null}

      <Modal open={open} title="Subir documento" onClose={() => setOpen(false)}>
        <form className={styles.form} onSubmit={onUpload} noValidate>
          <Field label="Archivo" htmlFor="doc-file" required>
            <input
              id="doc-file"
              type="file"
              className={styles.fileInput}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </Field>
          <Field label="Título" htmlFor="doc-title" required>
            <Input
              id="doc-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <div className={styles.formRow}>
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
          <label className={styles.checkboxLabel}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(event) => setIsPublic(event.target.checked)}
            />
            Visible para todos
          </label>
          {serverError && <Alert variant="error">{serverError}</Alert>}
          <div className={styles.modalFooter}>
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={uploading}>
              Subir
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Eliminar documento"
        description={
          pendingDelete ? `Se eliminará «${pendingDelete.title}» de la biblioteca.` : undefined
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => (pendingDelete ? onDelete(pendingDelete) : undefined)}
      />

      <DocumentPreviewModal
        document={previewDoc}
        open={previewDoc !== null}
        onClose={() => setPreviewDoc(null)}
      />
    </div>
  )
}
