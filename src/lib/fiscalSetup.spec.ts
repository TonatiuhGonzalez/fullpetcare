import { describe, expect, it } from 'vitest'

import { fiscalProblems, isReadyToInvoice, rfcKind } from './fiscalSetup'

const NOW = new Date('2026-10-02T12:00:00Z')
const VALID_MORAL = {
  rfc: 'PFE120515AB1',
  legal_name: 'Patitas Felices SA de CV',
  tax_regime_code: '601',
  postal_code: '97000',
}
const CSD_OK = { csdValidUntil: '2030-01-01T00:00:00Z' }

const fields = (problems: ReturnType<typeof fiscalProblems>) =>
  problems.map((p) => p.field)

describe('rfcKind', () => {
  it('distingue empresa (12) de persona física (13)', () => {
    // Si se confundieran, el régimen se validaría contra el tipo de
    // contribuyente equivocado y se rechazaría un alta correcta.
    expect(rfcKind('PFE120515AB1')).toBe('moral')
    expect(rfcKind('RUCS850312AB1')).toBe('fisica')
  })

  it('devuelve null si el RFC no tiene la forma', () => {
    expect(rfcKind('ABC')).toBeNull()
  })
})

describe('fiscalProblems', () => {
  it('no reporta nada cuando todo está completo y el certificado vigente', () => {
    // El camino feliz: si reportara algo de más, nadie podría quedar listo.
    expect(fiscalProblems(VALID_MORAL, CSD_OK, NOW)).toEqual([])
  })

  it('reporta cada dato faltante por separado, en español', () => {
    // Es lo que pide la tarea: la pantalla dice CUÁL falta, no un
    // genérico "datos incompletos".
    const problems = fiscalProblems(
      { rfc: null, legal_name: '  ', tax_regime_code: null, postal_code: '' },
      { csdValidUntil: null },
      NOW,
    )
    expect(fields(problems)).toEqual([
      'rfc',
      'legal_name',
      'tax_regime_code',
      'postal_code',
      'csd',
    ])
    expect(problems[0].message).toMatch(/RFC/)
  })

  it('rechaza un RFC con mala forma', () => {
    // Un RFC mal escrito haría que el PAC rechace el alta del negocio.
    expect(fields(fiscalProblems({ ...VALID_MORAL, rfc: 'XYZ' }, CSD_OK, NOW))).toEqual([
      'rfc',
    ])
  })

  it('rechaza un régimen que no corresponde al tipo de RFC', () => {
    // 605 (sueldos) es solo de personas físicas; con RFC de empresa el
    // SAT rechazaría las facturas ya timbradas.
    const problems = fiscalProblems(
      { ...VALID_MORAL, tax_regime_code: '605' },
      CSD_OK,
      NOW,
    )
    expect(fields(problems)).toEqual(['tax_regime_code'])
    expect(problems[0].message).toMatch(/personas físicas/)
  })

  it('acepta RESICO (626) tanto para persona física como para empresa', () => {
    // 626 aplica a ambos; un falso rechazo bloquearía a todos los RESICO.
    const fisica = { ...VALID_MORAL, rfc: 'RUCS850312AB1', tax_regime_code: '626' }
    expect(fiscalProblems(fisica, CSD_OK, NOW)).toEqual([])
    expect(
      fiscalProblems({ ...VALID_MORAL, tax_regime_code: '626' }, CSD_OK, NOW),
    ).toEqual([])
  })

  it('rechaza un régimen fuera del catálogo', () => {
    expect(
      fields(fiscalProblems({ ...VALID_MORAL, tax_regime_code: '999' }, CSD_OK, NOW)),
    ).toEqual(['tax_regime_code'])
  })

  it('rechaza un código postal que no tiene 5 dígitos', () => {
    expect(
      fields(fiscalProblems({ ...VALID_MORAL, postal_code: '970' }, CSD_OK, NOW)),
    ).toEqual(['postal_code'])
  })

  it('avisa si el certificado ya venció, y no si vence justo después de ahora', () => {
    // El borde: un certificado vencido hace que todo timbrado falle; uno
    // que vence mañana todavía sirve hoy.
    const expired = fiscalProblems(
      VALID_MORAL,
      { csdValidUntil: '2026-10-02T12:00:00Z' },
      NOW,
    )
    expect(fields(expired)).toEqual(['csd'])
    expect(expired[0].message).toMatch(/venció/)
    expect(
      fiscalProblems(VALID_MORAL, { csdValidUntil: '2026-10-02T12:00:01Z' }, NOW),
    ).toEqual([])
  })
})

describe('isReadyToInvoice', () => {
  it('solo es true sin ningún problema', () => {
    // Es la marca "listo para facturar": un falso positivo dejaría
    // intentar timbrar con un negocio sin certificado.
    expect(isReadyToInvoice(VALID_MORAL, CSD_OK, NOW)).toBe(true)
    expect(isReadyToInvoice(VALID_MORAL, { csdValidUntil: null }, NOW)).toBe(false)
  })
})
