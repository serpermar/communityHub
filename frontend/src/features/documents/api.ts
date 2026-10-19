import { api, cleanParams } from '@/services/http'
import type { ListResult } from '@/types/api'
import type { MemberRole } from '@/types/roles'
import type { CommunityDocument, DocumentCategory } from './types'

export interface DocumentListQuery {
  category?: DocumentCategory
  q?: string
  page?: number
  limit?: number
}

export function listDocuments(
  communityId: string,
  query: DocumentListQuery,
): Promise<ListResult<CommunityDocument>> {
  return api.list<CommunityDocument>(`/communities/${communityId}/documents`, {
    params: cleanParams({ ...query }),
  })
}

export function getDocument(documentId: string): Promise<CommunityDocument> {
  return api.get<CommunityDocument>(`/documents/${documentId}`)
}

export interface UploadDocumentInput {
  file: File
  title: string
  category: DocumentCategory
  minRole: MemberRole
  isPublic: boolean
}

export function uploadDocument(
  communityId: string,
  input: UploadDocumentInput,
): Promise<CommunityDocument> {
  const form = new FormData()
  form.append('file', input.file)
  form.append('title', input.title)
  form.append('category', input.category)
  form.append('minRole', input.minRole)
  form.append('isPublic', input.isPublic ? 'true' : 'false')
  return api.upload<CommunityDocument>(`/communities/${communityId}/documents`, form)
}

export function getDownloadUrl(documentId: string): Promise<{ url: string; expiresIn: number }> {
  return api.get<{ url: string; expiresIn: number }>(`/documents/${documentId}/download`)
}

export function deleteDocument(documentId: string): Promise<{ id: string; deleted: boolean }> {
  return api.delete<{ id: string; deleted: boolean }>(`/documents/${documentId}`)
}
