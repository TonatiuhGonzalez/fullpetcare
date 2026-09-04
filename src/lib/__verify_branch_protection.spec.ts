// Archivo desechable: solo existe para verificar que un PR con un test roto
// no puede mergearse a main (tarea 1.40). Se borra en el mismo PR de prueba.
import { describe, it, expect } from 'vitest'

describe('verificación de branch protection', () => {
  it('falla a propósito', () => {
    expect(true).toBe(false)
  })
})
