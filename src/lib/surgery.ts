// Reglas del catálogo de cirugías y de su aplicación a una cita (fase 32, PLAN.md D30
// punto 9). Funciones puras: las pantallas las usan para avisar y totalizar antes de enviar;
// la base impone lo esencial (renglón con descripción, cantidad y precio válidos, honorario
// sin producto).
import type { SaleUnit } from './fractional'
import { splitTaxIncluded } from './money'

export type SurgeryItemKind = 'consumable' | 'medication' | 'fee'

export const SURGERY_KIND_OPTIONS: Array<{ value: SurgeryItemKind; title: string }> = [
  { value: 'fee', title: 'Honorario' },
  { value: 'consumable', title: 'Consumible' },
  { value: 'medication', title: 'Medicamento' },
]

export function surgeryKindLabel(kind: SurgeryItemKind): string {
  return (
    SURGERY_KIND_OPTIONS.find((option) => option.value === kind)?.title ?? 'Honorario'
  )
}

/** Un renglón mientras se captura o se ajusta (todavía sin guardar). */
export interface SurgeryLineDraft {
  /** Identificador local para la lista (no se guarda). */
  key: string
  kind: SurgeryItemKind
  /** Producto del inventario; nulo si es un honorario o no se lleva en inventario. */
  productId: string | null
  description: string
  quantity: number
  /** Precio por unidad vendida, con IVA incluido, en centavos (§8.2). */
  unitPriceCents: number
  taxRateBp: number
  /** Se cobra al cliente (false = uso interno). */
  isBillable: boolean
  unit: SaleUnit
}

/** Importe del renglón: precio × cantidad, en centavos enteros. */
export function lineTotalCents(
  line: Pick<SurgeryLineDraft, 'quantity' | 'unitPriceCents'>,
): number {
  return line.unitPriceCents * line.quantity
}

/**
 * Total de la cirugía (lo que se cobraría): suma de los renglones cobrables. Cada uno es un
 * entero ya con IVA incluido, así que la suma no pierde centavos.
 */
export function surgeryTotalCents(lines: SurgeryLineDraft[]): number {
  return lines.filter((l) => l.isBillable).reduce((sum, l) => sum + lineTotalCents(l), 0)
}

/** IVA contenido en el total, desglosado por renglón y luego sumado (como el ticket, §8.2). */
export function surgeryTaxCents(lines: SurgeryLineDraft[]): number {
  return lines
    .filter((l) => l.isBillable)
    .reduce(
      (sum, l) => sum + splitTaxIncluded(lineTotalCents(l), l.taxRateBp).taxCents,
      0,
    )
}

/** Mensaje si la lista de renglones no se puede guardar o aplicar; si no, `null`. */
export function surgeryLinesProblem(lines: SurgeryLineDraft[]): string | null {
  if (lines.length === 0) return 'Agrega al menos un renglón.'
  for (const [index, line] of lines.entries()) {
    const n = index + 1
    if (line.description.trim() === '') return `El renglón ${n} no tiene descripción.`
    if (!Number.isInteger(line.quantity) || line.quantity < 1) {
      return `La cantidad del renglón ${n} debe ser un entero mayor a 0.`
    }
    if (!Number.isInteger(line.unitPriceCents) || line.unitPriceCents < 0) {
      return `El precio del renglón ${n} debe ser 0 o mayor.`
    }
    if (line.kind === 'fee' && line.productId !== null) {
      return `El renglón ${n} es un honorario: no lleva producto.`
    }
  }
  return null
}

/** Lo que se manda a `save_surgery_package()` y `apply_surgery_lines()`. */
export interface SurgeryRpcLine {
  kind: SurgeryItemKind
  product_id: string | null
  description: string
  quantity: number
  unit_price_cents: number
  tax_rate_bp: number
  is_billable: boolean
  unit: SaleUnit
}

export function toRpcLines(lines: SurgeryLineDraft[]): SurgeryRpcLine[] {
  return lines.map((l) => ({
    kind: l.kind,
    product_id: l.productId,
    description: l.description.trim(),
    quantity: l.quantity,
    unit_price_cents: l.unitPriceCents,
    tax_rate_bp: l.taxRateBp,
    is_billable: l.isBillable,
    unit: l.unit,
  }))
}
