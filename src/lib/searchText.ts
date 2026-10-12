// Texto de búsqueda sin acentos ni mayúsculas (C1.20, PLAN.md D26 punto 10).
//
// Es la copia en el navegador de `app.search_norm()` de la base: la base decide las
// búsquedas de clientes y productos (`search_customers`, `search_products`), y esta función
// solo se usa donde la lista ya está en memoria (empresas del superadmin) o para comparar un
// código exacto (el escáner de código de barras). Las dos deben decir lo mismo.
//
// La ñ NO se confunde con la n: "pena" y "peña" son palabras distintas. Un `normalize('NFD')`
// a secas las igualaría, porque descompone la ñ en n + tilde y luego borra la tilde.

/** Minúsculas, sin acentos y sin espacios en los extremos; conserva la ñ. */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[ñÑ]/g, '\u0001')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\u0001/g, 'ñ')
    .toLowerCase()
    .trim()
}
