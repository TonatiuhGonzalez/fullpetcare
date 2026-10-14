// Reglas del catálogo de proveedores (fase 29B, PLAN.md D30 punto 4). Funciones puras: el
// formulario las usa para avisar antes de guardar; la base solo exige un nombre no vacío y
// sin repetir.
import { normalizeSearchText } from './searchText'
import { isValidEmail, isValidPhone } from './validation'

export type SupplierType = 'medication' | 'food' | 'accessories' | 'other'

/** Tipos de proveedor, en el orden en que se ofrecen. */
export const SUPPLIER_TYPE_OPTIONS: Array<{ value: SupplierType; title: string }> = [
  { value: 'medication', title: 'Medicamentos' },
  { value: 'food', title: 'Alimento' },
  { value: 'accessories', title: 'Accesorios' },
  { value: 'other', title: 'Otro' },
]

/** Nombre en español del tipo de proveedor. */
export function supplierTypeLabel(type: SupplierType): string {
  return SUPPLIER_TYPE_OPTIONS.find((option) => option.value === type)?.title ?? 'Otro'
}

/**
 * Problemas de forma de un proveedor (lista vacía = se puede guardar). Teléfono y correo
 * son opcionales, pero si se escriben deben tener forma válida.
 */
export function supplierProblems(input: {
  phone?: string | null
  email?: string | null
}): string[] {
  const problems: string[] = []
  const phone = input.phone?.trim() ?? ''
  const email = input.email?.trim() ?? ''
  if (phone !== '' && !isValidPhone(phone)) {
    problems.push('El teléfono debe tener 10 dígitos.')
  }
  if (email !== '' && !isValidEmail(email)) {
    problems.push('El correo no parece válido (ej. ventas@proveedor.mx).')
  }
  return problems
}

/**
 * ¿Ya hay un proveedor con este nombre? Sin acentos, mayúsculas ni espacios (la ñ aparte).
 * `exceptId` evita que un proveedor choque consigo mismo al editarlo.
 */
export function isDuplicateSupplier(
  existing: Array<{ id: string; name: string }>,
  name: string,
  exceptId?: string,
): boolean {
  const wanted = normalizeSearchText(name)
  return existing.some((s) => s.id !== exceptId && normalizeSearchText(s.name) === wanted)
}
