// Reglas de la receta médica (fase 28, PLAN.md D30 punto 3). Funciones puras: el editor las
// usa para avisar antes de guardar y la hoja impresa para armar sus textos; la base repite
// lo esencial (al menos un medicamento, nombre obligatorio, máximo 30).

/** Tope de medicamentos por receta; el mismo que impone `save_prescription()`. */
export const MAX_PRESCRIPTION_ITEMS = 30

/** Un renglón mientras se captura (todavía sin guardar). */
export interface PrescriptionDraftItem {
  /** Identificador local para la lista (no se guarda). */
  key: string
  /** Producto del catálogo, o nulo si el medicamento se escribió a mano. */
  productId: string | null
  medicationName: string
  dose: string
  frequency: string
  duration: string
}

/** Lo que se manda a `save_prescription()`. */
export interface PrescriptionRpcItem {
  product_id: string | null
  medication_name: string
  dose: string | null
  frequency: string | null
  duration: string | null
}

/** Mensaje si la receta no se puede guardar; `null` si está bien. */
export function prescriptionProblem(items: PrescriptionDraftItem[]): string | null {
  if (items.length === 0) return 'Agrega al menos un medicamento a la receta.'
  if (items.length > MAX_PRESCRIPTION_ITEMS) {
    return `Una receta no puede llevar más de ${MAX_PRESCRIPTION_ITEMS} medicamentos.`
  }
  const missing = items.findIndex((item) => item.medicationName.trim() === '')
  if (missing >= 0) return `El medicamento ${missing + 1} no tiene nombre.`
  return null
}

/** Pasa los renglones capturados al formato de la RPC: recorta y deja vacíos como nulos. */
export function toRpcItems(items: PrescriptionDraftItem[]): PrescriptionRpcItem[] {
  const clean = (value: string): string | null => {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  return items.map((item) => ({
    product_id: item.productId,
    medication_name: item.medicationName.trim(),
    dose: clean(item.dose),
    frequency: clean(item.frequency),
    duration: clean(item.duration),
  }))
}

/** "No. 000123": el folio con ceros a la izquierda, como se ve en la receta. */
export function prescriptionFolioLabel(folio: number): string {
  return `No. ${String(folio).padStart(6, '0')}`
}

/**
 * ¿Cuántas hojas ocupa la receta? Caben 10 medicamentos por hoja carta (D30). Solo sirve
 * para avisar en pantalla que la impresión será de más de una página.
 */
export function prescriptionPages(itemCount: number): number {
  return Math.max(1, Math.ceil(itemCount / 10))
}
