// Tests de useCartStore (tarea 5.13). Se mockea services/checkout.ts —
// mismo motivo que session.spec.ts/agenda.spec.ts: estos tests prueban la
// LÓGICA del store (¿recalcula bien los totales al agregar/quitar algo?
// ¿nunca deja el total en negativo?), no si Supabase responde.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCartStore } from './cart'
import type { CheckoutLineItem, CheckoutSummary, Ticket } from '@/services/checkout'

vi.mock('@/services/checkout', () => ({
  buildSummary: vi.fn(),
  charge: vi.fn(),
}))

import { buildSummary, charge } from '@/services/checkout'

// Baño, $250.00 con IVA al 16% incluido — mismos números que
// lib/money.spec.ts (splitTaxIncluded(25000, 1600) = 21552 neto + 3448 IVA).
const BANO: CheckoutLineItem = {
  serviceId: 'service-bano',
  description: 'Baño',
  quantity: 1,
  unitPriceCents: 25000,
  taxRateBp: 1600,
}

// El store recalcula subtotal/IVA/total él mismo a partir de lineItems
// (lib/money.ts), así que los demás campos de CheckoutSummary no importan
// aquí — solo lineItems es lo que loadAppointment() realmente usa.
function summaryWith(lineItems: CheckoutLineItem[]): CheckoutSummary {
  return { lineItems, subtotalCents: 0, taxCents: 0, discountCents: 0, totalCents: 0 }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(buildSummary).mockReset()
  vi.mocked(charge).mockReset()
})

describe('loadAppointment', () => {
  it('carga las partidas de la cita y calcula subtotal/IVA/total en vivo', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))

    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    expect(cart.status).toBe('ready')
    expect(cart.lineItems).toEqual([BANO])
    expect(cart.subtotalCents).toBe(21552)
    expect(cart.taxCents).toBe(3448)
    expect(cart.totalCents).toBe(25000)
  })

  it('un error de red dejan el carrito en estado "error" con un mensaje en español', async () => {
    vi.mocked(buildSummary).mockRejectedValue(new Error('network down'))

    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    expect(cart.status).toBe('error')
    expect(cart.errorMessage).toMatch(/no se pudo/i)
  })

  it('cargar una cita nueva reinicia el descuento y los pagos de la anterior', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))

    const cart = useCartStore()
    await cart.loadAppointment('appt-1')
    cart.setDiscount(1000)
    cart.addPayment({ method: 'cash', amountCents: 5000 })

    await cart.loadAppointment('appt-2')

    expect(cart.discountCents).toBe(0)
    expect(cart.payments).toEqual([])
  })
})

describe('agregar y quitar pagos recalcula lo que falta por cubrir', () => {
  it('sin pagos, falta cubrir el total completo', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    expect(cart.paidCents).toBe(0)
    expect(cart.remainingCents).toBe(25000)
    expect(cart.isFullyPaid).toBe(false)
  })

  it('agregar un pago parcial reduce lo que falta, sin marcar el cobro como listo', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.addPayment({ method: 'cash', amountCents: 15000 })

    expect(cart.paidCents).toBe(15000)
    expect(cart.remainingCents).toBe(10000)
    expect(cart.isFullyPaid).toBe(false)
  })

  it('dos pagos que juntos alcanzan el total dejan el cobro listo (efectivo + tarjeta)', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.addPayment({ method: 'cash', amountCents: 15000 })
    cart.addPayment({ method: 'card', amountCents: 10000 })

    expect(cart.paidCents).toBe(25000)
    expect(cart.remainingCents).toBe(0)
    expect(cart.isFullyPaid).toBe(true)
  })

  it('quitar un pago recalcula lo que falta de vuelta', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.addPayment({ method: 'cash', amountCents: 15000 })
    cart.addPayment({ method: 'card', amountCents: 10000 })
    cart.removePayment(1) // quita la de tarjeta

    expect(cart.paidCents).toBe(15000)
    expect(cart.remainingCents).toBe(10000)
    expect(cart.isFullyPaid).toBe(false)
  })

  it('un pago que EXCEDE el total (cambio en efectivo) no deja lo que falta en negativo', async () => {
    // Alguien paga $300 por una cuenta de $250: sobran $50 de cambio, pero
    // "lo que falta por cubrir" no puede ser -5000 — remainingCents se
    // recorta a 0, igual que lib/money.ts#applyDiscount con el total.
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.addPayment({ method: 'cash', amountCents: 30000 })

    expect(cart.remainingCents).toBe(0)
    expect(cart.isFullyPaid).toBe(true)
  })
})

describe('setDiscount', () => {
  it('el descuento reduce el total sin tocar el subtotal ni el IVA', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.setDiscount(5000)

    expect(cart.subtotalCents).toBe(21552)
    expect(cart.taxCents).toBe(3448)
    expect(cart.totalCents).toBe(20000)
  })

  it('un descuento mayor al total nunca deja el total en negativo', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.setDiscount(999999)

    expect(cart.totalCents).toBe(0)
  })

  it('un descuento negativo se recorta a 0 (error de captura, no un "descuento negativo")', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.setDiscount(-500)

    expect(cart.discountCents).toBe(0)
  })
})

describe('checkout', () => {
  it('cobra con los pagos y el descuento acumulados, y limpia el carrito', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const ticket = { sale: { id: 'sale-1' } } as Ticket
    vi.mocked(charge).mockResolvedValue(ticket)

    const cart = useCartStore()
    await cart.loadAppointment('appt-1')
    cart.setDiscount(2000)
    cart.addPayment({ method: 'cash', amountCents: 23000 })

    const result = await cart.checkout()

    expect(charge).toHaveBeenCalledWith({
      appointmentId: 'appt-1',
      payments: [{ method: 'cash', amountCents: 23000 }],
      discountCents: 2000,
    })
    expect(result).toBe(ticket)
    // El carrito queda listo para la SIGUIENTE cita, no arrastra la anterior.
    expect(cart.appointmentId).toBeNull()
    expect(cart.payments).toEqual([])
  })

  it('cobrar sin haber cargado ninguna cita lanza un error claro, sin llamar al servicio', async () => {
    const cart = useCartStore()
    await expect(cart.checkout()).rejects.toThrow(/no hay ninguna cita/i)
    expect(charge).not.toHaveBeenCalled()
  })
})
