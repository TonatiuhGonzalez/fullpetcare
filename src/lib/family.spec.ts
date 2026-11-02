// Tests de lib/family.ts (fase 31, tarea 31.6): etiqueta y validación de la familia.
import { describe, expect, it } from 'vitest'

import { familyErrorMessage, familyLabel, familyProblem } from './family'

describe('familyLabel', () => {
  // Qué prueba: la etiqueta del usuario: "Familia Pérez – Nube, Toby".
  it('une el nombre con las mascotas', () => {
    expect(familyLabel('Familia Pérez', ['Nube', 'Toby'])).toBe(
      'Familia Pérez – Nube, Toby',
    )
  })

  // Qué prueba: sin mascotas, solo el nombre; y nombres repetidos o en blanco no se duplican.
  // Qué se rompería: la etiqueta diría "Familia Pérez – " o repetiría a una mascota.
  it('sin mascotas deja solo el nombre y quita repetidos y vacíos', () => {
    expect(familyLabel(' Familia Pérez ', [])).toBe('Familia Pérez')
    expect(familyLabel('Familia Pérez', ['Nube', ' ', 'Nube'])).toBe(
      'Familia Pérez – Nube',
    )
  })
})

describe('familyProblem', () => {
  const ok = { name: 'Familia Pérez', memberIds: ['a', 'b'], holderId: 'a' }

  it('acepta una familia completa', () => {
    expect(familyProblem(ok)).toBeNull()
  })

  // Qué prueba: los tres casos que rechaza la base, para avisar antes de enviar.
  it('rechaza sin nombre, sin miembros y con titular que no es miembro', () => {
    expect(familyProblem({ ...ok, name: '  ' })).not.toBeNull()
    expect(familyProblem({ ...ok, memberIds: [], holderId: null })).not.toBeNull()
    expect(familyProblem({ ...ok, holderId: 'z' })).not.toBeNull()
    expect(familyProblem({ ...ok, holderId: null })).not.toBeNull()
  })
})

describe('familyErrorMessage', () => {
  // Qué prueba: el mensaje de la función (ya en español) se muestra; un error de red no.
  it('muestra el mensaje de la base solo para errores de negocio', () => {
    expect(
      familyErrorMessage(
        { message: 'Ana ya pertenece a la familia "X".', code: '23514' },
        'Falló',
      ),
    ).toBe('Ana ya pertenece a la familia "X".')
    expect(familyErrorMessage({ message: 'TypeError: fetch failed' }, 'Falló')).toBe(
      'Falló',
    )
    expect(familyErrorMessage(null, 'Falló')).toBe('Falló')
  })
})
