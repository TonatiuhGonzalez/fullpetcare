// Tests de useCartStore (tarea 5.13). Se mockea services/checkout.ts —
// mismo motivo que session.spec.ts/agenda.spec.ts: estos tests prueban la
// LÓGICA del store (¿recalcula bien los totales al agregar/quitar algo?
// ¿nunca deja el total en negativo?), no si Supabase responde.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCartStore } from './cart'
import type {
  CheckoutLineItem,
  CheckoutSummary,
  SellableProduct,
  Ticket,
} from '@/services/checkout'

vi.mock('@/services/checkout', () => ({
  buildSummary: vi.fn(),
  charge: vi.fn(),
  chargeCounterSale: vi.fn(),
  listSellableProducts: vi.fn(),
  listRecentlySoldProductIds: vi.fn(),
}))

// El store ahora también carga las categorías. Se mockea para que el test no importe el
// cliente real de Supabase (en CI no hay .env.local y fallaría al importarlo).
vi.mock('@/services/productCategories', () => ({ listActive: vi.fn() }))

import {
  buildSummary,
  charge,
  chargeCounterSale,
  listRecentlySoldProductIds,
  listSellableProducts,
} from '@/services/checkout'
import { listActive as listActiveCategories } from '@/services/productCategories'

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
  return {
    lineItems,
    supplyItems: [],
    subtotalCents: 0,
    taxCents: 0,
    discountCents: 0,
    totalCents: 0,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.mocked(buildSummary).mockReset()
  vi.mocked(charge).mockReset()
  vi.mocked(chargeCounterSale).mockReset()
  vi.mocked(listSellableProducts).mockReset()
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
    expect(cart.changeCents).toBe(5000)
    expect(cart.isCovered).toBe(true)
  })

  it('el monto cuenta como cubierto solo cuando ya no falta nada', async () => {
    // Qué se rompería: se ocultaría el formulario de agregar pago con la cuenta a medias y no
    // habría forma de completarla.
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    expect(cart.isCovered).toBe(false)
    cart.addPayment({ method: 'cash', amountCents: 10000 })
    expect(cart.isCovered).toBe(false)
    cart.addPayment({ method: 'cash', amountCents: 15000 })
    expect(cart.isCovered).toBe(true)
  })

  it('pagar de más con tarjeta no deja cobrar: no se da cambio de una tarjeta', async () => {
    // Qué se rompería: se cobraría a la tarjeta más de lo que vale la cuenta, sin forma de
    // devolver la diferencia en el mostrador.
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    cart.addPayment({ method: 'card', amountCents: 30000, paymentFormCode: '04' })

    expect(cart.changeCents).toBe(0)
    expect(cart.unpayableExcessCents).toBe(5000)
    expect(cart.isFullyPaid).toBe(false)
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
      products: [], // sin productos extra: el cobro de solo servicios sigue igual
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

// Alimento, $100.00 con IVA al 16% incluido, 3 piezas en existencia.
const ALIMENTO: SellableProduct = {
  id: 'product-alimento',
  name: 'Alimento 2 kg',
  sku: null,
  priceCents: 10000,
  taxRateBp: 1600,
  stock: 3,
  categoryId: null,
}

describe('productos en el ticket (tarea 11.11)', () => {
  it('suma el producto al total con su propio IVA, junto al servicio', async () => {
    // Qué se rompería: el total en pantalla no coincidiría con el que guarda la base.
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    expect(cart.addProduct(ALIMENTO, 2)).toBe(true)

    expect(cart.totalCents).toBe(25000 + 20000)
    // IVA por partida: 3448 (baño) + 2759 (20000 - round(20000 x 10000 / 11600)).
    expect(cart.taxCents).toBe(3448 + 2759)
  })

  it('no deja agregar más piezas que la existencia, ni un producto sin existencia', () => {
    // Qué se rompería: ofrecer en el ticket algo que la base va a rechazar al cobrar.
    const cart = useCartStore()

    expect(cart.addProduct({ ...ALIMENTO, stock: 0 })).toBe(false)
    expect(cart.addProduct(ALIMENTO, 3)).toBe(true)
    expect(cart.addProduct(ALIMENTO, 1)).toBe(false) // ya hay 3 de 3
    expect(cart.productItems[0].quantity).toBe(3)
  })

  it('agregar dos veces el mismo producto suma su cantidad en una sola partida', () => {
    const cart = useCartStore()
    cart.addProduct(ALIMENTO, 1)
    cart.addProduct(ALIMENTO, 1)

    expect(cart.productItems).toHaveLength(1)
    expect(cart.productItems[0].quantity).toBe(2)
  })

  it('cambiar la cantidad respeta el tope y quitar el producto lo saca del total', () => {
    const cart = useCartStore()
    cart.addProduct(ALIMENTO, 1)

    expect(cart.setProductQuantity(ALIMENTO.id, 4)).toBe(false)
    expect(cart.setProductQuantity(ALIMENTO.id, 0)).toBe(false)
    expect(cart.setProductQuantity(ALIMENTO.id, 2)).toBe(true)
    expect(cart.totalCents).toBe(20000)

    cart.removeProduct(ALIMENTO.id)
    expect(cart.totalCents).toBe(0)
  })

  it('una venta de mostrador cobra solo productos, sin cita', async () => {
    // Qué se rompería: un cliente que solo compra un producto no podría cobrarse.
    vi.mocked(chargeCounterSale).mockResolvedValue({} as Ticket)
    const cart = useCartStore()
    cart.loadCounterSale('branch-1', 'customer-1')
    cart.addProduct(ALIMENTO, 2)
    cart.addPayment({ method: 'cash', amountCents: 20000 })

    await cart.checkout()

    expect(charge).not.toHaveBeenCalled()
    expect(chargeCounterSale).toHaveBeenCalledWith({
      branchId: 'branch-1',
      customerId: 'customer-1',
      products: [{ productId: 'product-alimento', quantity: 2 }],
      payments: [{ method: 'cash', amountCents: 20000 }],
      discountCents: 0,
    })
    expect(cart.productItems).toEqual([]) // el carrito queda limpio
  })

  it('una venta libre (sin cliente) se cobra mandando el cliente en null', async () => {
    // Qué se rompería: la venta libre de la fase 13 lanzaría "no hay ninguna cita ni venta
    // cargada" por no tener cliente, y recepción no podría vender un shampoo al paso.
    vi.mocked(chargeCounterSale).mockResolvedValue({} as Ticket)
    const cart = useCartStore()
    cart.loadCounterSale('branch-1')
    cart.addProduct(ALIMENTO, 1)
    cart.addPayment({ method: 'cash', amountCents: 10000 })

    await cart.checkout()

    expect(chargeCounterSale).toHaveBeenCalledWith(
      expect.objectContaining({ branchId: 'branch-1', customerId: null }),
    )
  })

  it('el cliente puesto con setCounterCustomer viaja en el cobro de la venta libre', async () => {
    // Qué se rompería: al facturar a alguien que no era cliente, se le daría de alta pero la
    // venta saldría sin ligarse a él (decisión 10 de la fase 13).
    vi.mocked(chargeCounterSale).mockResolvedValue({} as Ticket)
    const cart = useCartStore()
    cart.loadCounterSale('branch-1')
    cart.addProduct(ALIMENTO, 1)
    cart.addPayment({ method: 'cash', amountCents: 10000 })
    cart.setCounterCustomer('customer-nuevo')

    await cart.checkout()

    expect(chargeCounterSale).toHaveBeenCalledWith(
      expect.objectContaining({ customerId: 'customer-nuevo' }),
    )
  })

  it('el cobro de una cita manda sus productos extra', async () => {
    vi.mocked(buildSummary).mockResolvedValue(summaryWith([BANO]))
    vi.mocked(charge).mockResolvedValue({} as Ticket)
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')
    cart.addProduct(ALIMENTO, 1)
    cart.addPayment({ method: 'card', amountCents: 35000, paymentFormCode: '28' })

    await cart.checkout()

    expect(charge).toHaveBeenCalledWith(
      expect.objectContaining({
        appointmentId: 'appt-1',
        products: [{ productId: 'product-alimento', quantity: 1 }],
        payments: [{ method: 'card', amountCents: 35000, paymentFormCode: '28' }],
      }),
    )
  })
})

describe('insumos cobrables de la consulta (tarea 11.14)', () => {
  // Alimento de $100.00 (IVA 16 % incluido) usado en la consulta.
  const INSUMO = {
    appointmentProductId: 'ap-1',
    description: 'Vacuna triple',
    quantity: 2,
    unitPriceCents: 10000,
    taxRateBp: 1600,
  }

  it('suman al total junto con el servicio, para que lo mostrado alcance lo que cobra la base', async () => {
    // Qué se rompería: la pantalla pediría $250 y la base $450: el pago "alcanza"
    // en pantalla pero el RPC lo rechazaría por no cubrir el total.
    vi.mocked(buildSummary).mockResolvedValue({
      ...summaryWith([BANO]),
      supplyItems: [INSUMO],
    })
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')

    expect(cart.totalCents).toBe(25000 + 20000)
    expect(cart.remainingCents).toBe(45000)
  })

  it('cargar otra cita no arrastra los insumos de la anterior', async () => {
    vi.mocked(buildSummary).mockResolvedValueOnce({
      ...summaryWith([BANO]),
      supplyItems: [INSUMO],
    })
    vi.mocked(buildSummary).mockResolvedValueOnce(summaryWith([BANO]))
    const cart = useCartStore()
    await cart.loadAppointment('appt-1')
    await cart.loadAppointment('appt-2')

    expect(cart.supplyItems).toEqual([])
    expect(cart.totalCents).toBe(25000)
  })
})

describe('loadCatalog (categorías y últimos vendidos)', () => {
  it('carga productos, categorías y últimos vendidos juntos', async () => {
    // Qué se rompería: el punto de venta no tendría con qué armar las dos filas.
    vi.mocked(listSellableProducts).mockResolvedValue([ALIMENTO])
    vi.mocked(listActiveCategories).mockResolvedValue([{ id: 'c1' } as never])
    vi.mocked(listRecentlySoldProductIds).mockResolvedValue(['product-alimento'])
    const cart = useCartStore()

    await cart.loadCatalog('tenant-a', 'branch-1')

    expect(cart.catalog).toEqual([ALIMENTO])
    expect(cart.categories).toHaveLength(1)
    expect(cart.recentSoldProductIds).toEqual(['product-alimento'])
    expect(cart.errorMessage).toBeNull()
  })

  it('si fallan las categorías o los últimos vendidos, el catálogo igual sirve', async () => {
    // Qué se rompería: un fallo en una comodidad (categorías, últimos vendidos) bloquearía
    // toda la venta; el catálogo es lo único indispensable para cobrar.
    vi.mocked(listSellableProducts).mockResolvedValue([ALIMENTO])
    vi.mocked(listActiveCategories).mockRejectedValue(new Error('sin red'))
    vi.mocked(listRecentlySoldProductIds).mockRejectedValue(new Error('sin red'))
    const cart = useCartStore()

    await cart.loadCatalog('tenant-a', 'branch-1')

    expect(cart.catalog).toEqual([ALIMENTO])
    expect(cart.categories).toEqual([])
    expect(cart.recentSoldProductIds).toEqual([])
    expect(cart.errorMessage).toBeNull()
  })

  it('si falla el catálogo, avisa y lo deja vacío', async () => {
    vi.mocked(listSellableProducts).mockRejectedValue(new Error('sin red'))
    vi.mocked(listActiveCategories).mockResolvedValue([])
    vi.mocked(listRecentlySoldProductIds).mockResolvedValue([])
    const cart = useCartStore()

    await cart.loadCatalog('tenant-a', 'branch-1')

    expect(cart.catalog).toEqual([])
    expect(cart.errorMessage).toMatch(/productos/)
  })
})
