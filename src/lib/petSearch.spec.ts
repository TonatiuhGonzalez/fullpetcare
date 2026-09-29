import { describe, expect, it } from 'vitest'

import { matchesPetSearch } from './petSearch'

const rocky = { name: 'Rocky', species: 'dog' as const }

describe('matchesPetSearch', () => {
  // Sin texto, el buscador no debe esconder nada. Si fallara, la pestaña
  // se abriría con la tabla vacía hasta que alguien escribiera algo.
  it('con el buscador vacío o con solo espacios muestra todas las mascotas', () => {
    expect(matchesPetSearch(rocky, 'Ana Robles', '')).toBe(true)
    expect(matchesPetSearch(rocky, 'Ana Robles', '   ')).toBe(true)
  })

  // Las tres columnas de la tabla (nombre, especie, dueño) tienen que
  // ser buscables; si una no lo fuera, recepción no encontraría "los
  // gatos" o "las mascotas de Ana".
  it('busca por nombre, por especie en español y por dueño', () => {
    expect(matchesPetSearch(rocky, 'Ana Robles', 'rock')).toBe(true)
    expect(matchesPetSearch(rocky, 'Ana Robles', 'perro')).toBe(true)
    expect(matchesPetSearch(rocky, 'Ana Robles', 'robles')).toBe(true)
    expect(matchesPetSearch(rocky, 'Ana Robles', 'gato')).toBe(false)
  })

  // En México se escribe "Andrés" y "Andres" indistintamente; distinguir
  // acentos o mayúsculas haría parecer que la mascota no existe.
  it('ignora mayúsculas y acentos', () => {
    expect(matchesPetSearch(rocky, 'Andrés Pérez', 'ANDRES')).toBe(true)
    expect(matchesPetSearch({ name: 'Frida', species: 'cat' }, 'Ana', 'GATO')).toBe(true)
  })
})
