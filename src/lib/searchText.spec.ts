import { describe, expect, it } from 'vitest'

import { normalizeSearchText } from './searchText'

describe('normalizeSearchText', () => {
  it('quita acentos y mayúsculas para que "jose" encuentre "José"', () => {
    // Es la queja original (observación 10): quien escribe sin acento no encontraba al cliente.
    expect(normalizeSearchText('José')).toBe('jose')
    expect(normalizeSearchText('  ÁNGEL  ')).toBe('angel')
  })

  it('no confunde la ñ con la n', () => {
    // "pena" (tristeza) y "peña" son palabras distintas; igualarlas devolvería clientes de más.
    expect(normalizeSearchText('Peña')).toBe('peña')
    expect(normalizeSearchText('PEÑA')).toBe('peña')
    expect(normalizeSearchText('Peña')).not.toBe(normalizeSearchText('Pena'))
  })

  it('deja igual lo que no tiene acentos', () => {
    expect(normalizeSearchText('shampoo 250 ml')).toBe('shampoo 250 ml')
  })
})
