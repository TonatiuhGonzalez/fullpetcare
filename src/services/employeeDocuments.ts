// Acceso a datos de los documentos escaneados de un empleado (fase 9,
// CLAUDE.md §6.7): credencial de elector, comprobante de domicilio,
// contrato firmado. Mismo patrón que services/pets.ts#uploadPhoto — ruta
// FIJA por (empleado, tipo de documento) y `upsert: true`, así que
// reemplazar un documento no acumula archivos huérfanos en el bucket.
import { supabase } from './supabase'
import type { Database } from '@/types/database'

export type EmployeeDocumentType = Database['public']['Enums']['employee_document_type']
export type EmployeeDocument = Database['public']['Tables']['employee_documents']['Row']

/**
 * Sube un documento al bucket privado `employee-documents` y guarda sus
 * metadatos (ruta, tipo). `uploaded_by` lo pone la base sola
 * (`default auth.uid()`, migración employee_documents.sql) — no hace
 * falta pedirle a supabase-js quién es el usuario actual solo para esto.
 */
export async function upload(
  tenantId: string,
  membershipId: string,
  documentType: EmployeeDocumentType,
  file: File,
): Promise<void> {
  const extension = file.name.split('.').pop() ?? 'jpg'
  const path = `${tenantId}/${membershipId}/${documentType}.${extension}`

  const { error: uploadError } = await supabase.storage
    .from('employee-documents')
    .upload(path, file, { upsert: true })
  if (uploadError) throw uploadError

  const { error: upsertError } = await supabase.from('employee_documents').upsert(
    {
      tenant_id: tenantId,
      membership_id: membershipId,
      document_type: documentType,
      storage_path: path,
      uploaded_at: new Date().toISOString(),
    },
    { onConflict: 'membership_id,document_type' },
  )
  if (upsertError) throw upsertError
}

/** Los documentos vigentes de un empleado (uno por tipo, como mucho). */
export async function listByMembership(membershipId: string): Promise<EmployeeDocument[]> {
  const { data, error } = await supabase
    .from('employee_documents')
    .select('*')
    .eq('membership_id', membershipId)
    .is('deleted_at', null)

  if (error) throw error
  return data ?? []
}

/** URL firmada de un documento — igual que pets.ts#getPhotoUrl, nunca una URL pública (el bucket es privado). */
export async function getSignedUrl(storagePath: string): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('employee-documents')
    .createSignedUrl(storagePath, 60)

  if (error) throw error
  return data.signedUrl
}
