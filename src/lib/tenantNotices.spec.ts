import { describe, expect, it } from 'vitest'

import { noticeRestrictsAccess, noticeSeverity, noticeText } from './tenantNotices'

const TZ = 'America/Mexico_City'

describe('noticeText', () => {
  it('por vencer: dice la fecha de vencimiento en la zona del negocio', () => {
    // Un instante a las 03:00 UTC del 16 es todavía el 15 en México: si se
    // mostrara en UTC, el cliente creería que tiene un día menos (o más).
    const text = noticeText(
      {
        notice: 'expiring',
        publicReason: null,
        planExpiresAt: '2026-10-16T03:00:00Z',
        graceEndsAt: null,
      },
      TZ,
    )
    expect(text).toContain('15 de octubre de 2026')
    expect(text).toContain('vence')
  })

  it('gracia: dice cuándo venció y hasta cuándo puede regularizar', () => {
    // El cliente necesita la fecha límite para actuar antes del solo lectura.
    const text = noticeText(
      {
        notice: 'grace',
        publicReason: null,
        planExpiresAt: '2026-10-10T18:00:00Z',
        graceEndsAt: '2026-10-12T18:00:00Z',
      },
      TZ,
    )
    expect(text).toContain('10 de octubre de 2026')
    expect(text).toContain('12 de octubre de 2026')
    expect(text).toContain('solo lectura')
  })

  it('solo lectura: incluye el motivo público si existe', () => {
    // El motivo explica el porqué; sin él (bloqueo solo por vigencia) el texto
    // no debe dejar un paréntesis vacío.
    const base = { notice: 'read_only' as const, planExpiresAt: null, graceEndsAt: null }
    expect(noticeText({ ...base, publicReason: 'Falta de pago' }, TZ)).toContain(
      '(Falta de pago)',
    )
    expect(noticeText({ ...base, publicReason: null }, TZ)).not.toContain('()')
  })

  it('baja: dice que el negocio fue dado de baja', () => {
    const text = noticeText(
      {
        notice: 'blocked',
        publicReason: 'Cancelación solicitada por el cliente',
        planExpiresAt: null,
        graceEndsAt: null,
      },
      TZ,
    )
    expect(text).toContain('dado de baja')
  })
})

describe('gravedad y restricciones', () => {
  it('solo solo-lectura y baja restringen el acceso', () => {
    // Los avisos preventivos (por vencer, gracia) no deben abrir el diálogo
    // del login ni bloquear nada: son solo un banner.
    expect(noticeRestrictsAccess('expiring')).toBe(false)
    expect(noticeRestrictsAccess('grace')).toBe(false)
    expect(noticeRestrictsAccess('read_only')).toBe(true)
    expect(noticeRestrictsAccess('blocked')).toBe(true)
  })

  it('la baja es error, solo lectura y gracia advertencia, por vencer informativo', () => {
    expect(noticeSeverity('blocked')).toBe('error')
    expect(noticeSeverity('read_only')).toBe('warning')
    expect(noticeSeverity('grace')).toBe('warning')
    expect(noticeSeverity('expiring')).toBe('info')
  })
})
