// Tests de lib/speciesCatalog.ts (fase 27, tarea 27.7): duplicados, búsqueda de raza y variantes.
import { describe, expect, it } from 'vitest'

import {
  aliasesToText,
  filterBreeds,
  isDuplicateName,
  parseAliases,
} from './speciesCatalog'

const breeds = [
  { id: 'b1', name: 'Xoloitzcuintle', search_aliases: ['xolo', 'perro pelón mexicano'] },
  { id: 'b2', name: 'Salchicha', search_aliases: ['dachshund', 'teckel'] },
  { id: 'b3', name: 'Schnauzer', search_aliases: ['esnauzer'] },
  { id: 'b4', name: 'Bóxer', search_aliases: ['boxer'] },
]

describe('filterBreeds', () => {
  // Qué prueba: la queja original: el veterinario no recuerda cómo se escribe la raza.
  // Escribir "xolo" debe encontrar Xoloitzcuintle.
  // Qué se rompería: tendría que escribir el nombre completo sin error, igual que hoy.
  it('encuentra una raza por su variante', () => {
    expect(filterBreeds(breeds, 'xolo').map((b) => b.id)).toEqual(['b1'])
    expect(filterBreeds(breeds, 'dachs').map((b) => b.id)).toEqual(['b2'])
  })

  // Qué prueba: ignora acentos y mayúsculas, en el texto y en el nombre.
  it('ignora acentos y mayúsculas', () => {
    expect(filterBreeds(breeds, 'BOXER').map((b) => b.id)).toEqual(['b4'])
    expect(filterBreeds(breeds, 'pelon').map((b) => b.id)).toEqual(['b1'])
  })

  // Qué prueba: las que empiezan con el texto van antes que las que solo lo contienen.
  it('pone primero las coincidencias que empiezan con el texto', () => {
    // "s" empieza Salchicha y Schnauzer; "esnauzer" no empieza con "s" pero Xolo no la contiene.
    const ids = filterBreeds(breeds, 'sc').map((b) => b.id)
    expect(ids[0]).toBe('b3')
  })

  // Qué prueba: sin texto no se filtra nada; sin coincidencias, lista vacía.
  it('regresa todas sin texto y ninguna sin coincidencias', () => {
    expect(filterBreeds(breeds, '  ')).toHaveLength(4)
    expect(filterBreeds(breeds, 'zzz')).toEqual([])
  })
})

describe('isDuplicateName', () => {
  const list = [{ id: 'a', name: 'Loro' }]

  // Qué prueba: "loro " y "LORO" son la misma especie.
  // Qué se rompería: el catálogo tendría dos "Loro" y la lista del formulario confundiría.
  it('detecta el mismo nombre sin importar acentos, mayúsculas ni espacios', () => {
    expect(isDuplicateName(list, ' LORO ')).toBe(true)
  })

  // Qué prueba: editarse a sí mismo no cuenta como duplicado.
  it('no choca consigo misma al editar', () => {
    expect(isDuplicateName(list, 'Loro', 'a')).toBe(false)
  })

  // Qué prueba: la ñ no es la n.
  it('distingue la ñ de la n', () => {
    expect(isDuplicateName([{ id: 'x', name: 'Cabaña' }], 'Cabana')).toBe(false)
  })
})

describe('parseAliases y aliasesToText', () => {
  // Qué prueba: el campo de texto con comas se vuelve una lista limpia.
  // Qué se rompería: se guardarían variantes vacías o repetidas, y la búsqueda las cargaría.
  it('separa por coma, recorta y quita vacíos y repetidos', () => {
    expect(parseAliases(' xolo, , Xolo ,perro pelón ')).toEqual(['xolo', 'perro pelón'])
  })

  it('escribe la lista de vuelta separada por coma', () => {
    expect(aliasesToText(['xolo', 'teckel'])).toBe('xolo, teckel')
  })
})
