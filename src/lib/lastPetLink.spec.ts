// Tests de lib/lastPetLink.ts (fase 16A): el link recordado por la app instalada.
import { describe, expect, it } from 'vitest'

import { forgetLastPetLink, readLastPetLink, saveLastPetLink } from './lastPetLink'

function fakeStorage(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (key: string) => data[key] ?? null,
    setItem: (key: string, value: string) => {
      data[key] = value
    },
    removeItem: (key: string) => {
      delete data[key]
    },
  }
}

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ' // 43 caracteres base64url

describe('lastPetLink', () => {
  // Qué prueba: ida y vuelta con un token válido.
  it('guarda y lee un token con forma válida', () => {
    const storage = fakeStorage()
    saveLastPetLink(TOKEN, storage)
    expect(readLastPetLink(storage)).toBe(TOKEN)
  })

  // Qué prueba: lo guardado es editable por cualquiera; algo con otra forma no se usa.
  // Qué se rompería: la app instalada navegaría a una ruta armada con texto arbitrario.
  it('ignora un valor con forma de no-token', () => {
    const storage = fakeStorage({ 'fpc.lastPetLink': '../app/agenda' })
    expect(readLastPetLink(storage)).toBeNull()
  })

  it('no guarda algo que no parece un token', () => {
    const storage = fakeStorage()
    saveLastPetLink('hola', storage)
    expect(readLastPetLink(storage)).toBeNull()
  })

  // Qué prueba: al revocarse el link se borra, pero solo si es el mismo; uno más nuevo
  // abierto después no se pierde.
  it('borra el token solo si es el guardado', () => {
    const storage = fakeStorage()
    saveLastPetLink(TOKEN, storage)
    forgetLastPetLink('otro-token-distinto-de-veinte-o-mas', storage)
    expect(readLastPetLink(storage)).toBe(TOKEN)
    forgetLastPetLink(TOKEN, storage)
    expect(readLastPetLink(storage)).toBeNull()
  })

  // Qué prueba: un almacenamiento que lanza (ventana privada) no rompe la pantalla.
  it('tolera un almacenamiento bloqueado', () => {
    const broken = {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
      removeItem: () => {
        throw new Error('bloqueado')
      },
    }
    expect(readLastPetLink(broken)).toBeNull()
    expect(() => saveLastPetLink(TOKEN, broken)).not.toThrow()
    expect(() => forgetLastPetLink(TOKEN, broken)).not.toThrow()
  })
})
