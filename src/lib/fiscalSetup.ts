// Configuración fiscal del negocio (fase 11, tarea 11.15 / HMH Four #2044).
// Función pura: recibe los datos fiscales del negocio y el estado de su
// certificado, y dice qué falta y si ya puede facturar. Sin red ni base:
// la pantalla solo pinta lo que esto devuelve.
import { isValidPostalCode, isValidRFC } from './validation'

// Régimen fiscal (c_RegimenFiscal del SAT) del negocio emisor. Solo los que
// puede tener quien factura; el código se guarda tal cual lo publica el SAT
// (CLAUDE.md §8.4). `moral` / `fisica` dice a qué tipo de RFC aplica.
export interface TaxRegime {
  code: string
  title: string
  appliesTo: ('fisica' | 'moral')[]
}

export const TAX_REGIMES: TaxRegime[] = [
  { code: '601', title: 'General de Ley Personas Morales', appliesTo: ['moral'] },
  {
    code: '603',
    title: 'Personas Morales con Fines no Lucrativos',
    appliesTo: ['moral'],
  },
  { code: '605', title: 'Sueldos y Salarios', appliesTo: ['fisica'] },
  { code: '606', title: 'Arrendamiento', appliesTo: ['fisica'] },
  {
    code: '612',
    title: 'Personas Físicas con Actividades Empresariales y Profesionales',
    appliesTo: ['fisica'],
  },
  { code: '621', title: 'Incorporación Fiscal', appliesTo: ['fisica'] },
  {
    code: '622',
    title: 'Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras',
    appliesTo: ['fisica', 'moral'],
  },
  {
    code: '626',
    title: 'Régimen Simplificado de Confianza (RESICO)',
    appliesTo: ['fisica', 'moral'],
  },
]

export interface FiscalData {
  rfc: string | null
  legal_name: string | null
  tax_regime_code: string | null
  postal_code: string | null
}

// Lo que se guarda del lado del PAC (tabla tenant_invoicing_settings). `null`
// = todavía no se ha subido ningún certificado.
export interface InvoicingStatus {
  csdValidUntil: string | null
}

export type FiscalField = 'rfc' | 'legal_name' | 'tax_regime_code' | 'postal_code' | 'csd'

export interface FiscalProblem {
  field: FiscalField
  message: string
}

/** 'moral' (12 caracteres) o 'fisica' (13); null si el RFC no tiene la forma. */
export function rfcKind(rfc: string): 'fisica' | 'moral' | null {
  if (!isValidRFC(rfc)) return null
  return rfc.trim().length === 12 ? 'moral' : 'fisica'
}

/**
 * Lo que falta (o está mal) para facturar, en español y sin jerga. Lista vacía
 * = el negocio está listo. `now` se inyecta para poder probar la vigencia del
 * certificado sin depender del reloj.
 */
export function fiscalProblems(
  data: FiscalData,
  status: InvoicingStatus,
  now: Date = new Date(),
): FiscalProblem[] {
  const problems: FiscalProblem[] = []

  const rfc = data.rfc?.trim() ?? ''
  if (!rfc) {
    problems.push({ field: 'rfc', message: 'Falta el RFC del negocio.' })
  } else if (!isValidRFC(rfc)) {
    problems.push({
      field: 'rfc',
      message:
        'El RFC no tiene un formato válido (12 caracteres para empresas, 13 para personas).',
    })
  }

  if (!data.legal_name?.trim()) {
    problems.push({
      field: 'legal_name',
      message:
        'Falta la razón social, tal como aparece en tu constancia de situación fiscal.',
    })
  }

  const regime = TAX_REGIMES.find((r) => r.code === data.tax_regime_code)
  if (!data.tax_regime_code) {
    problems.push({ field: 'tax_regime_code', message: 'Falta el régimen fiscal.' })
  } else if (!regime) {
    problems.push({
      field: 'tax_regime_code',
      message: 'El régimen fiscal no está en la lista de regímenes permitidos.',
    })
  } else {
    const kind = rfcKind(rfc)
    if (kind && !regime.appliesTo.includes(kind)) {
      problems.push({
        field: 'tax_regime_code',
        message:
          kind === 'moral'
            ? 'Ese régimen es para personas físicas, pero el RFC es de una empresa.'
            : 'Ese régimen es para empresas, pero el RFC es de una persona física.',
      })
    }
  }

  const postalCode = data.postal_code?.trim() ?? ''
  if (!postalCode) {
    problems.push({
      field: 'postal_code',
      message: 'Falta el código postal del domicilio fiscal.',
    })
  } else if (!isValidPostalCode(postalCode)) {
    problems.push({
      field: 'postal_code',
      message: 'El código postal debe tener 5 dígitos.',
    })
  }

  if (!status.csdValidUntil) {
    problems.push({
      field: 'csd',
      message:
        'Falta subir el certificado digital (los archivos .cer y .key que te entrega el SAT).',
    })
  } else if (new Date(status.csdValidUntil).getTime() <= now.getTime()) {
    problems.push({
      field: 'csd',
      message: 'El certificado digital ya venció. Sube uno nuevo.',
    })
  }

  return problems
}

/** true si no falta nada: el negocio puede emitir facturas. */
export function isReadyToInvoice(
  data: FiscalData,
  status: InvoicingStatus,
  now: Date = new Date(),
): boolean {
  return fiscalProblems(data, status, now).length === 0
}
