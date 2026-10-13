// Tests de lib/tenantLogo.ts (fase 26, tarea 26.8): las reglas de la imagen de la empresa.
import { describe, expect, it } from 'vitest'

import { LOGO_MAX_BYTES, logoExtension, logoFileProblem, logoPath } from './tenantLogo'

describe('logoExtension', () => {
  // Qué prueba: que solo los tres tipos que acepta el bucket tienen extensión.
  // Qué se rompería: se dejaría elegir un PDF o un SVG y Storage lo rechazaría con un error
  // técnico, o peor, se guardaría una ruta con extensión que `set_tenant_logo()` no acepta.
  it('conoce JPG, PNG y WebP y nada más', () => {
    expect(logoExtension('image/jpeg')).toBe('jpg')
    expect(logoExtension('image/png')).toBe('png')
    expect(logoExtension('image/webp')).toBe('webp')
    expect(logoExtension('image/svg+xml')).toBeNull()
    expect(logoExtension('application/pdf')).toBeNull()
  })
})

describe('logoFileProblem', () => {
  // Qué prueba: el borde exacto del tope. 2 MB justos sí; un byte más, no.
  // Qué se rompería: un archivo de 2 MB + 1 byte pasaría la revisión y fallaría en Storage.
  it('acepta hasta 2 MB exactos y rechaza un byte más', () => {
    expect(logoFileProblem({ type: 'image/png', size: LOGO_MAX_BYTES })).toBeNull()
    expect(logoFileProblem({ type: 'image/png', size: LOGO_MAX_BYTES + 1 })).toMatch(/2 MB/)
  })

  // Qué prueba: que un tipo no admitido da un aviso en español y no un error técnico.
  it('avisa cuando el archivo no es una imagen admitida', () => {
    expect(logoFileProblem({ type: 'application/pdf', size: 10 })).toMatch(/JPG, PNG o WebP/)
  })
})

describe('logoPath', () => {
  // Qué prueba: que la ruta empieza con el id del negocio. Es lo que revisa la política de
  // Storage; sin eso, la imagen quedaría fuera de la carpeta de su negocio y nadie la leería.
  it('arma la ruta con el negocio como primera carpeta', () => {
    expect(logoPath('b0000000-0000-4000-8000-000000000001', 'png')).toBe(
      'b0000000-0000-4000-8000-000000000001/logo.png',
    )
  })
})
