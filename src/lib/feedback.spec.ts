import { describe, expect, it } from 'vitest'

import { MAX_MESSAGE_LENGTH, MAX_SCREENSHOT_BYTES, messageProblem, screenshotProblem } from './feedback'

describe('messageProblem', () => {
  it('rechaza un mensaje vacío o de solo espacios', () => {
    // La base también lo rechaza (check btrim <> ''); avisar antes evita un
    // viaje al servidor y un error técnico para algo que la persona puede corregir.
    expect(messageProblem('')).toBe('Escribe tu comentario.')
    expect(messageProblem('   \n ')).toBe('Escribe tu comentario.')
  })

  it('acepta exactamente el máximo y rechaza uno más', () => {
    // Borde: el límite coincide con el check de la base. Si la UI dejara pasar
    // uno más, el envío fallaría en el servidor con un error confuso.
    expect(messageProblem('a'.repeat(MAX_MESSAGE_LENGTH))).toBeNull()
    expect(messageProblem('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toMatch(/2000/)
  })

  it('no cuenta los espacios de los extremos (se recortan al enviar)', () => {
    // El servicio hace trim() antes de guardar; medir con espacios rechazaría
    // un mensaje que en realidad sí cabe.
    expect(messageProblem(`  ${'a'.repeat(MAX_MESSAGE_LENGTH)}  `)).toBeNull()
  })
})

describe('screenshotProblem', () => {
  it('acepta JPG, PNG y WebP', () => {
    // Son los tipos que permite el bucket; otro formato lo rechazaría Storage.
    for (const type of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(screenshotProblem({ type, size: 1000 })).toBeNull()
    }
  })

  it('rechaza un PDF o un GIF', () => {
    // Sin esta validación la persona vería un error técnico de Storage.
    expect(screenshotProblem({ type: 'application/pdf', size: 1000 })).toMatch(/imagen/)
    expect(screenshotProblem({ type: 'image/gif', size: 1000 })).toMatch(/imagen/)
  })

  it('acepta 5 MB exactos y rechaza un byte más', () => {
    // Borde del límite del bucket.
    expect(screenshotProblem({ type: 'image/png', size: MAX_SCREENSHOT_BYTES })).toBeNull()
    expect(screenshotProblem({ type: 'image/png', size: MAX_SCREENSHOT_BYTES + 1 })).toMatch(/5 MB/)
  })
})
