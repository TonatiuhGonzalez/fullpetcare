// Configuración fiscal del negocio (fase 11, tarea 11.15 / HMH Four #2044).
// Los datos fiscales (RFC, razón social, régimen, CP) viven en `tenants` y se
// escriben por la RPC update_tenant_fiscal_data (solo el dueño). El estado ante
// el PAC vive en tenant_invoicing_settings y lo escribe únicamente la Edge
// Function `invoicing`, que también recibe el certificado digital y lo manda
// directo al PAC sin guardarlo.
import { supabase } from './supabase'
import type { FiscalData, InvoicingStatus } from '@/lib/fiscalSetup'

const GENERIC_ERROR =
  'No se pudo completar la operación. Revisa tu conexión e intenta de nuevo.'

export interface FiscalSetup {
  data: FiscalData
  status: InvoicingStatus
}

/** Datos fiscales del negocio + vigencia de su certificado (null si no hay). */
export async function getSetup(tenantId: string): Promise<FiscalSetup> {
  const [tenant, settings] = await Promise.all([
    supabase
      .from('tenants')
      .select('rfc, legal_name, tax_regime_code, postal_code')
      .eq('id', tenantId)
      .maybeSingle(),
    supabase
      .from('tenant_invoicing_settings')
      .select('csd_valid_until')
      .eq('tenant_id', tenantId)
      .is('deleted_at', null)
      .maybeSingle(),
  ])
  if (tenant.error) throw tenant.error
  if (settings.error) throw settings.error

  return {
    data: {
      rfc: tenant.data?.rfc ?? null,
      legal_name: tenant.data?.legal_name ?? null,
      tax_regime_code: tenant.data?.tax_regime_code ?? null,
      postal_code: tenant.data?.postal_code ?? null,
    },
    status: { csdValidUntil: settings.data?.csd_valid_until ?? null },
  }
}

/** Guarda los datos fiscales. Los errores de la base ya vienen en español. */
export async function saveFiscalData(tenantId: string, data: FiscalData): Promise<void> {
  const { error } = await supabase.rpc('update_tenant_fiscal_data', {
    p_tenant_id: tenantId,
    p_rfc: data.rfc ?? '',
    p_legal_name: data.legal_name ?? '',
    p_tax_regime_code: data.tax_regime_code ?? '',
    p_postal_code: data.postal_code ?? '',
  })
  if (error) {
    // 22023 y 42501 los escribimos nosotros con `raise exception`, en español.
    const isOurs = ['22023', '42501'].includes(error.code ?? '')
    throw new Error(isOurs ? error.message : GENERIC_ERROR)
  }
}

export interface CertificateFiles {
  cer: File
  key: File
  password: string
}

/**
 * Manda los datos fiscales al PAC y, si se dan, el certificado. Devuelve la
 * vigencia del certificado. El certificado va solo en esta petición: ni el
 * navegador ni nuestra base lo guardan.
 */
export async function syncWithPac(
  tenantId: string,
  certificate?: CertificateFiles,
): Promise<InvoicingStatus> {
  const form = new FormData()
  form.set('action', 'setup')
  form.set('tenantId', tenantId)
  if (certificate) {
    form.set('cer', certificate.cer)
    form.set('key', certificate.key)
    form.set('password', certificate.password)
  }

  const { data, error } = await supabase.functions.invoke<{
    csdValidUntil: string | null
  }>('invoicing', { body: form })
  if (error || !data) throw new Error(await functionErrorMessage(error))
  return { csdValidUntil: data.csdValidUntil }
}

// supabase-js deja el Response crudo en `.context`; la función responde con un
// `message` ya en español. Si no hay (el gateway contestó), mensaje genérico.
async function functionErrorMessage(error: unknown): Promise<string> {
  const response =
    error && typeof error === 'object' && 'context' in error
      ? (error as { context: unknown }).context
      : null
  if (response instanceof Response) {
    try {
      const body = await response.clone().json()
      if (typeof body?.message === 'string') return body.message
    } catch {
      // El cuerpo no era JSON: se usa el mensaje genérico.
    }
  }
  return GENERIC_ERROR
}
