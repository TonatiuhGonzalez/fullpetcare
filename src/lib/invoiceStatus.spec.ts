import { describe, expect, it } from 'vitest'

import { pickCurrentInvoice } from './invoiceStatus'

const row = (id: string, status: string, created_at: string) => ({
  id,
  status,
  created_at,
})

describe('pickCurrentInvoice', () => {
  it('devuelve null si la venta nunca se ha querido facturar', () => {
    // La pantalla debe mostrar el botón "Facturar", no un estado.
    expect(pickCurrentInvoice([])).toBeNull()
  })

  it('la timbrada manda sobre una cancelada anterior y una pendiente', () => {
    // Tras "cancelar y sustituir" hay varias filas; mostrar la cancelada vieja
    // le haría creer a quien factura que la venta no tiene factura vigente.
    const rows = [
      row('a', 'cancelled', '2026-10-01T10:00:00Z'),
      row('b', 'stamped', '2026-10-02T10:00:00Z'),
      row('c', 'pending', '2026-10-03T10:00:00Z'),
    ]
    expect(pickCurrentInvoice(rows)?.id).toBe('b')
  })

  it('entre dos pendientes toma la más reciente (la del último error)', () => {
    // El mensaje de error útil es el del último intento.
    const rows = [
      row('a', 'pending', '2026-10-01T10:00:00Z'),
      row('b', 'pending', '2026-10-02T10:00:00Z'),
    ]
    expect(pickCurrentInvoice(rows)?.id).toBe('b')
  })

  it('una en proceso se muestra antes que una pendiente', () => {
    // Evita ofrecer "Facturar" otra vez mientras ya se está timbrando.
    const rows = [
      row('a', 'pending', '2026-10-03T10:00:00Z'),
      row('b', 'stamping', '2026-10-02T10:00:00Z'),
    ]
    expect(pickCurrentInvoice(rows)?.id).toBe('b')
  })

  it('si solo hay canceladas muestra la más reciente', () => {
    const rows = [
      row('a', 'cancelled', '2026-10-01T10:00:00Z'),
      row('b', 'cancelled', '2026-10-02T10:00:00Z'),
    ]
    expect(pickCurrentInvoice(rows)?.id).toBe('b')
  })
})
