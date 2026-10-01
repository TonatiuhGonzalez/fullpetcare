// Estado del cobro en curso: las partidas de la cita que se está
// cobrando, el descuento, y los PAGOS que se van agregando para cubrir el
// total — piénsalo como una caja registradora: primero se ve cuánto hay
// que cobrar, y luego se van sumando formas de pago (efectivo, tarjeta...)
// hasta cubrirlo, viendo en vivo cuánto falta.
//
// Las partidas (qué servicios trae la cita) se cargan de una sola vez
// desde services/checkout.ts#buildSummary y no se editan aquí: lo que
// realmente se cobra lo decide checkout_appointment() en la base, a
// partir de los appointment_services de la cita (CLAUDE.md §6.3) — este
// store solo refleja ese mismo cálculo para que la UI lo muestre ANTES de
// cobrar, con la misma fórmula (lib/money.ts) que usará el servidor.
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'

import * as checkoutService from '@/services/checkout'
import type {
  CheckoutLineItem,
  CheckoutProductItem,
  NewPayment,
  SellableProduct,
} from '@/services/checkout'
import { applyDiscount, sumLineItems } from '@/lib/money'
import { canRemove } from '@/lib/inventory'

export const useCartStore = defineStore('cart', () => {
  const appointmentId = ref<string | null>(null)
  const lineItems = ref<CheckoutLineItem[]>([])
  /** Productos agregados al ticket (de la cita o de una venta de mostrador). */
  const productItems = ref<CheckoutProductItem[]>([])
  /** Productos que se pueden ofrecer: activos y con existencia en la sucursal. */
  const catalog = ref<SellableProduct[]>([])
  /** Solo en venta de mostrador (sin cita). */
  const counterBranchId = ref<string | null>(null)
  const counterCustomerId = ref<string | null>(null)
  const discountCents = ref(0)
  const payments = ref<NewPayment[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  // Servicios y productos se desglosan por partida con la misma función
  // (lib/money.ts), igual que la base: el IVA nunca se calcula sobre el total.
  const allItems = computed(() => [...lineItems.value, ...productItems.value])
  const subtotalCents = computed(() => sumLineItems(allItems.value).subtotalCents)
  const taxCents = computed(() => sumLineItems(allItems.value).taxCents)
  /** Lo que hay que cobrar: subtotal + IVA, menos el descuento (nunca negativo). */
  const totalCents = computed(() => {
    const grossTotalCents = sumLineItems(allItems.value).totalCents
    return applyDiscount(grossTotalCents, discountCents.value)
  })
  const paidCents = computed(() =>
    payments.value.reduce((sum, p) => sum + p.amountCents, 0),
  )
  /** Cuánto falta por pagar. 0 cuando el pago ya cubre (o excede) el total. */
  const remainingCents = computed(() => Math.max(0, totalCents.value - paidCents.value))
  /** Listo para cobrar: hay al menos un pago y alcanza el total. */
  const isFullyPaid = computed(
    () => payments.value.length > 0 && remainingCents.value === 0,
  )

  /** Carga las partidas de una cita atendida y reinicia descuento/pagos. */
  async function loadAppointment(id: string): Promise<void> {
    appointmentId.value = id
    counterBranchId.value = null
    counterCustomerId.value = null
    productItems.value = []
    discountCents.value = 0
    payments.value = []
    status.value = 'loading'
    errorMessage.value = null
    try {
      const summary = await checkoutService.buildSummary(id)
      lineItems.value = summary.lineItems
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudo cargar el resumen de cobro. Revisa tu conexión.'
    }
  }

  /** Prepara una venta de mostrador: sin cita ni servicios, solo productos. */
  function loadCounterSale(branchId: string, customerId: string): void {
    reset()
    counterBranchId.value = branchId
    counterCustomerId.value = customerId
    status.value = 'ready'
  }

  /** Carga los productos vendibles de la sucursal (activos y con existencia). */
  async function loadCatalog(tenantId: string, branchId: string): Promise<void> {
    try {
      catalog.value = await checkoutService.listSellableProducts(tenantId, branchId)
    } catch {
      catalog.value = []
      errorMessage.value = 'No se pudieron cargar los productos. Revisa tu conexión.'
    }
  }

  /**
   * Suma `quantity` piezas de un producto al ticket. Devuelve false si no hay
   * existencia suficiente (con 0 no se agrega, decisión #2): la pantalla avisa.
   * Si ya estaba en el ticket, suma a su cantidad. La base vuelve a validar al cobrar.
   */
  function addProduct(product: SellableProduct, quantity = 1): boolean {
    const existing = productItems.value.find((p) => p.productId === product.id)
    const nextQuantity = (existing?.quantity ?? 0) + quantity
    if (!canRemove(product.stock, nextQuantity)) return false

    if (existing) {
      existing.quantity = nextQuantity
      existing.stock = product.stock
    } else {
      productItems.value.push({
        productId: product.id,
        description: product.name,
        quantity: nextQuantity,
        unitPriceCents: product.priceCents,
        taxRateBp: product.taxRateBp,
        stock: product.stock,
      })
    }
    return true
  }

  /** Cambia la cantidad de un producto del ticket; false si es inválida o excede la existencia. */
  function setProductQuantity(productId: string, quantity: number): boolean {
    const item = productItems.value.find((p) => p.productId === productId)
    if (!item || !canRemove(item.stock, quantity)) return false
    item.quantity = quantity
    return true
  }

  function removeProduct(productId: string): void {
    productItems.value = productItems.value.filter((p) => p.productId !== productId)
  }

  function setDiscount(cents: number): void {
    // Nunca negativo: un descuento "de -50 pesos" no tiene sentido y solo
    // pasaría por un error de captura.
    discountCents.value = Math.max(0, cents)
  }

  function addPayment(payment: NewPayment): void {
    payments.value.push(payment)
  }

  function removePayment(index: number): void {
    payments.value.splice(index, 1)
  }

  /**
   * Cobra con los pagos acumulados y limpia el carrito: la cita cargada (con
   * sus productos extra) o, si no hay cita, la venta de mostrador.
   */
  async function checkout(): Promise<checkoutService.Ticket> {
    const products = productItems.value.map((p) => ({
      productId: p.productId,
      quantity: p.quantity,
    }))

    let ticket: checkoutService.Ticket
    if (appointmentId.value) {
      ticket = await checkoutService.charge({
        appointmentId: appointmentId.value,
        payments: payments.value,
        discountCents: discountCents.value,
        products,
      })
    } else if (counterBranchId.value && counterCustomerId.value) {
      ticket = await checkoutService.chargeCounterSale({
        branchId: counterBranchId.value,
        customerId: counterCustomerId.value,
        products,
        payments: payments.value,
        discountCents: discountCents.value,
      })
    } else {
      throw new Error('No hay ninguna cita ni venta de mostrador cargada para cobrar.')
    }
    reset()
    return ticket
  }

  function reset(): void {
    appointmentId.value = null
    counterBranchId.value = null
    counterCustomerId.value = null
    productItems.value = []
    catalog.value = []
    lineItems.value = []
    discountCents.value = 0
    payments.value = []
    status.value = 'idle'
    errorMessage.value = null
  }

  return {
    appointmentId,
    lineItems,
    productItems,
    catalog,
    counterBranchId,
    counterCustomerId,
    discountCents,
    payments,
    status,
    errorMessage,
    subtotalCents,
    taxCents,
    totalCents,
    paidCents,
    remainingCents,
    isFullyPaid,
    loadAppointment,
    loadCounterSale,
    loadCatalog,
    addProduct,
    setProductQuantity,
    removeProduct,
    setDiscount,
    addPayment,
    removePayment,
    checkout,
    reset,
  }
})
