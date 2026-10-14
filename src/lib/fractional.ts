// Medicamentos fraccionados (fase 29C, PLAN.md D30 punto 5). Funciones puras: son las MISMAS
// reglas que aplica la base (migración 20261023120000_fractional_products.sql) y viven aquí
// para que la pantalla muestre y avise ANTES de enviar.
//
// Modelo: la existencia se guarda en la UNIDAD BASE (tableta, ml), siempre entera (§8.2). Un
// envase (caja, frasco) son `unitsPerPackage` unidades. Con `unitsPerPackage = 1` el producto
// no se fracciona y todo es como siempre.

/** Lo que hace falta saber de un producto para fraccionarlo o mostrarlo. */
export interface Presentation {
  unitsPerPackage: number
  packageName: string | null
  unitName: string | null
  /** Precio de la unidad fijado en el producto; nulo = se calcula del envase. */
  unitPriceCents: number | null
}

/** Unidad en que se vende o se usa: el envase completo o una unidad suelta. */
export type SaleUnit = 'package' | 'unit'

/** Tope de unidades por envase; el mismo que la base. */
export const MAX_UNITS_PER_PACKAGE = 10000

/** La presentación de una fila de `products` (nombres de columna de la base). */
export function presentationOf(product: {
  units_per_package: number
  package_name: string | null
  unit_name: string | null
  unit_price_cents: number | null
}): Presentation {
  return {
    unitsPerPackage: product.units_per_package,
    packageName: product.package_name,
    unitName: product.unit_name,
    unitPriceCents: product.unit_price_cents,
  }
}

export function isFractional(
  presentation: Pick<Presentation, 'unitsPerPackage'>,
): boolean {
  return presentation.unitsPerPackage > 1
}

/**
 * Precio de UNA unidad suelta, en centavos con IVA incluido: el que se fijó en el producto
 * o, si no hay, el del envase entre sus unidades, redondeado al centavo más cercano.
 *
 * El redondeo puede hacer que N unidades sumen unos centavos de más o de menos que el envase
 * (un envase de $100.00 con 3 unidades da $33.33 × 3 = $99.99). Es el mismo criterio que
 * el IVA por partida: se redondea una vez, por unidad, y se multiplica.
 */
export function unitPriceCents(
  packagePriceCents: number,
  presentation: Pick<Presentation, 'unitsPerPackage' | 'unitPriceCents'>,
): number {
  if (presentation.unitPriceCents !== null) return presentation.unitPriceCents
  return Math.round(packagePriceCents / presentation.unitsPerPackage)
}

/** Precio de la unidad en la que se vende: el del envase o el de la unidad suelta. */
export function priceForUnit(
  unit: SaleUnit,
  packagePriceCents: number,
  presentation: Pick<Presentation, 'unitsPerPackage' | 'unitPriceCents'>,
): number {
  return unit === 'unit'
    ? unitPriceCents(packagePriceCents, presentation)
    : packagePriceCents
}

/** Unidades base que salen del inventario al vender `quantity` de `unit`. */
export function baseUnits(
  quantity: number,
  unit: SaleUnit,
  presentation: Pick<Presentation, 'unitsPerPackage'>,
): number {
  return unit === 'unit' ? quantity : quantity * presentation.unitsPerPackage
}

/** Envases completos y unidades sueltas que forman una existencia. */
export function splitStock(
  stock: number,
  presentation: Pick<Presentation, 'unitsPerPackage'>,
): { packages: number; loose: number } {
  const n = presentation.unitsPerPackage
  return { packages: Math.floor(stock / n), loose: stock % n }
}

/**
 * El envase abierto, derivado de la existencia: lo que sobra después de contar envases
 * completos es el que está abierto y lo que le queda. Sin sobrante, no hay envase abierto.
 * `used` es lo que ya se sacó de él.
 */
export function openPackage(
  stock: number,
  presentation: Pick<Presentation, 'unitsPerPackage'>,
): { isOpen: boolean; remaining: number; used: number } {
  if (!isFractional(presentation) || stock <= 0)
    return { isOpen: false, remaining: 0, used: 0 }
  const remaining = stock % presentation.unitsPerPackage
  if (remaining === 0) return { isOpen: false, remaining: 0, used: 0 }
  return { isOpen: true, remaining, used: presentation.unitsPerPackage - remaining }
}

function plural(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`
}

/**
 * Existencia para mostrar. Sin fraccionar, el número de siempre ("5 en existencia"). Fraccionado,
 * las unidades y cómo se reparten: "63 tabletas · 3 cajas y 3 sueltas".
 */
export function formatStock(
  stock: number,
  presentation: Pick<Presentation, 'unitsPerPackage' | 'packageName' | 'unitName'>,
): string {
  if (!isFractional(presentation)) return `${stock} en existencia`
  const unit = presentation.unitName ?? 'unidad'
  const box = presentation.packageName ?? 'envase'
  const { packages, loose } = splitStock(stock, presentation)
  const parts: string[] = []
  if (packages > 0) parts.push(`${packages} ${plural(packages, box)}`)
  if (loose > 0) parts.push(`${loose} ${plural(loose, 'suelta')}`)
  const split = parts.join(' y ')
  return `${stock} ${plural(stock, unit)}${split ? ` · ${split}` : ''}`
}

export interface PresentationInput {
  unitsPerPackage: number
  unitName: string
  unitPriceCents: number | null
  unitSatCode: string
}

/** Mensaje si la presentación no sirve (en español, para mostrarlo tal cual); si no, `null`. */
export function presentationProblem(input: PresentationInput): string | null {
  const n = input.unitsPerPackage
  if (!Number.isInteger(n) || n < 1 || n > MAX_UNITS_PER_PACKAGE) {
    return `Las unidades por envase deben ser un entero entre 1 y ${MAX_UNITS_PER_PACKAGE}.`
  }
  if (n === 1) return null
  if (input.unitName.trim() === '') {
    return 'Escribe cómo se llama la unidad suelta (tableta, ml...).'
  }
  if (
    input.unitPriceCents !== null &&
    (!Number.isInteger(input.unitPriceCents) || input.unitPriceCents < 0)
  ) {
    return 'El precio de la unidad debe ser 0 o mayor.'
  }
  if (
    input.unitSatCode.trim() !== '' &&
    !/^[A-Z0-9]{2,3}$/.test(input.unitSatCode.trim())
  ) {
    return 'La clave de unidad del SAT debe tener 2 o 3 caracteres.'
  }
  return null
}
