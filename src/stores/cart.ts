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
import * as categoriesService from '@/services/productCategories'
import type { ProductCategory } from '@/services/productCategories'
import type {
  CheckoutLineItem,
  CheckoutProductItem,
  CheckoutSupplyItem,
  QuickServiceLine,
  NewPayment,
  SellableProduct,
} from '@/services/checkout'
import { applyDiscount, sumLineItems } from '@/lib/money'
import { baseUnits, priceForUnit, type SaleUnit } from '@/lib/fractional'
import { canRemove } from '@/lib/inventory'
import { paymentChange } from '@/lib/paymentChange'

export const useCartStore = defineStore('cart', () => {
  const appointmentId = ref<string | null>(null)
  const lineItems = ref<CheckoutLineItem[]>([])
  /** Insumos cobrables de la consulta: ya salieron del inventario, solo se cobran. */
  const supplyItems = ref<CheckoutSupplyItem[]>([])
  /** Productos agregados al ticket (de la cita o de una venta de mostrador). */
  const productItems = ref<CheckoutProductItem[]>([])
  /** Productos que se pueden ofrecer: activos y con existencia en la sucursal. */
  const catalog = ref<SellableProduct[]>([])
  /** Categorías activas del negocio (13G): agrupan el catálogo en el punto de venta. */
  const categories = ref<ProductCategory[]>([])
  /** Ids de los productos vendidos hace poco en la sucursal, del más reciente al más antiguo (con repetidos). */
  const recentSoldProductIds = ref<string[]>([])
  /** Servicios de un cobro rápido (fase 30): sin cita, con el precio del catálogo. */
  const quickServices = ref<Array<CheckoutLineItem>>([])
  /** Es un cobro rápido (servicios y productos sin cita ni cliente). */
  const isQuickSale = ref(false)
  const quickAttendedBy = ref<string | null>(null)
  const quickSpeciesGroupId = ref<string | null>(null)
  /** Solo en venta de mostrador (sin cita). El cliente es opcional: venta libre = null. */
  const counterBranchId = ref<string | null>(null)
  const counterCustomerId = ref<string | null>(null)
  const discountCents = ref(0)
  const payments = ref<NewPayment[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  // Servicios y productos se desglosan por partida con la misma función
  // (lib/money.ts), igual que la base: el IVA nunca se calcula sobre el total.
  const allItems = computed(() => [
    ...lineItems.value,
    ...quickServices.value,
    ...supplyItems.value,
    ...productItems.value,
  ])
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
  /** El monto ya está cubierto: hay pagos y no falta nada. La pantalla deja de ofrecer agregar otro pago. */
  const isCovered = computed(
    () => payments.value.length > 0 && remainingCents.value === 0,
  )
  /** Cambio que se le devuelve al cliente en efectivo (0 si no pagó de más). */
  const changeCents = computed(
    () => paymentChange(totalCents.value, payments.value).changeCents,
  )
  /** Lo pagado de más que no vino en efectivo y no se puede devolver; debe ser 0 para cobrar. */
  const unpayableExcessCents = computed(
    () => paymentChange(totalCents.value, payments.value).unpayableExcessCents,
  )
  /** Listo para cobrar: hay al menos un pago, alcanza el total y no hay sobrepago imposible de devolver. */
  const isFullyPaid = computed(() => isCovered.value && unpayableExcessCents.value === 0)

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
      supplyItems.value = summary.supplyItems
      status.value = 'ready'
    } catch {
      status.value = 'error'
      errorMessage.value = 'No se pudo cargar el resumen de cobro. Revisa tu conexión.'
    }
  }

  /** Prepara una venta de mostrador: sin cita ni servicios, solo productos y, opcionalmente, cliente. */
  function loadCounterSale(branchId: string, customerId: string | null = null): void {
    reset()
    counterBranchId.value = branchId
    counterCustomerId.value = customerId
    status.value = 'ready'
  }

  /** Prepara un cobro rápido: servicios y/o productos, sin cita ni cliente (fase 30). */
  function loadQuickSale(branchId: string): void {
    reset()
    counterBranchId.value = branchId
    isQuickSale.value = true
    status.value = 'ready'
  }

  /** Suma un servicio del catálogo al cobro rápido (si ya estaba, suma a su cantidad). */
  function addService(
    service: { id: string; name: string; price_cents: number; tax_rate_bp: number },
    quantity = 1,
  ): void {
    const existing = quickServices.value.find((s) => s.serviceId === service.id)
    if (existing) {
      existing.quantity += quantity
      return
    }
    quickServices.value.push({
      serviceId: service.id,
      description: service.name,
      quantity,
      unitPriceCents: service.price_cents,
      taxRateBp: service.tax_rate_bp,
    })
  }

  /** Cambia la cantidad de un servicio del cobro rápido; false si no es un entero mayor a 0. */
  function setServiceQuantity(serviceId: string, quantity: number): boolean {
    const item = quickServices.value.find((s) => s.serviceId === serviceId)
    if (!item || !Number.isInteger(quantity) || quantity < 1) return false
    item.quantity = quantity
    return true
  }

  function removeService(serviceId: string): void {
    quickServices.value = quickServices.value.filter((s) => s.serviceId !== serviceId)
  }

  /** Liga (o quita) el cliente de una venta de mostrador ya abierta; p. ej. el que se da de alta para facturar. */
  function setCounterCustomer(customerId: string | null): void {
    counterCustomerId.value = customerId
  }

  /**
   * Carga lo que necesita el punto de venta: los productos vendibles de la sucursal
   * (activos y con existencia) y, aparte, sus categorías y los últimos vendidos. Estos dos
   * últimos son comodidades: si fallan, el catálogo igual sirve (todo cae en "Sin categoría" y
   * la fila de últimos vendidos queda vacía), así que no bloquean la venta.
   */
  async function loadCatalog(tenantId: string, branchId: string): Promise<void> {
    const [catalogResult, categoriesResult, recentResult] = await Promise.allSettled([
      checkoutService.listSellableProducts(tenantId, branchId),
      categoriesService.listActive(tenantId),
      checkoutService.listRecentlySoldProductIds(tenantId, branchId),
    ])
    if (catalogResult.status === 'fulfilled') {
      catalog.value = catalogResult.value
    } else {
      catalog.value = []
      errorMessage.value = 'No se pudieron cargar los productos. Revisa tu conexión.'
    }
    categories.value =
      categoriesResult.status === 'fulfilled' ? categoriesResult.value : []
    recentSoldProductIds.value =
      recentResult.status === 'fulfilled' ? recentResult.value : []
  }

  /** Unidades base de un producto que el ticket ya lleva (todas sus partidas), sin contar `exceptKey`. */
  function unitsInTicket(productId: string, exceptKey?: string): number {
    return productItems.value
      .filter((p) => p.productId === productId && p.key !== exceptKey)
      .reduce((sum, p) => sum + baseUnits(p.quantity, p.unit, p), 0)
  }

  function itemKey(productId: string, unit: SaleUnit): string {
    return `${productId}:${unit}`
  }

  /** Lo mismo que `PresentationLike` pero desde un producto vendible. */
  function presentationOfProduct(product: SellableProduct) {
    return {
      unitsPerPackage: product.unitsPerPackage,
      unitPriceCents: product.unitPriceCents,
    }
  }

  /**
   * Suma `quantity` del producto al ticket, en `unit` (por defecto el envase; solo un producto
   * fraccionado admite 'unit'). Devuelve false si no hay existencia suficiente (con 0 no se
   * agrega, decisión #2): la pantalla avisa. La existencia se compara en UNIDADES BASE contra
   * todo lo que el ticket ya lleva de ese producto, venga en envases o en sueltas. Si la
   * partida ya estaba, suma a su cantidad. La base vuelve a validar al cobrar.
   */
  function addProduct(
    product: SellableProduct,
    quantity = 1,
    unit: SaleUnit = 'package',
  ): boolean {
    if (unit === 'unit' && product.unitsPerPackage <= 1) return false
    const key = itemKey(product.id, unit)
    const existing = productItems.value.find((p) => p.key === key)
    const nextQuantity = (existing?.quantity ?? 0) + quantity
    const needed = unitsInTicket(product.id, key) + baseUnits(nextQuantity, unit, product)
    if (!canRemove(product.stock, needed)) return false

    if (existing) {
      existing.quantity = nextQuantity
      existing.stock = product.stock
    } else {
      const defaultPrice = priceForUnit(
        unit,
        product.priceCents,
        presentationOfProduct(product),
      )
      productItems.value.push({
        key,
        productId: product.id,
        description: product.name,
        quantity: nextQuantity,
        unitPriceCents: defaultPrice,
        defaultUnitPriceCents: defaultPrice,
        packagePriceCents: product.priceCents,
        fixedUnitPriceCents: product.unitPriceCents,
        taxRateBp: product.taxRateBp,
        stock: product.stock,
        unit,
        unitsPerPackage: product.unitsPerPackage,
        packageName: product.packageName,
        unitName: product.unitName,
      })
    }
    return true
  }

  /** Cambia la cantidad de una partida del ticket; false si es inválida o excede la existencia. */
  function setProductQuantity(key: string, quantity: number): boolean {
    const item = productItems.value.find((p) => p.key === key)
    if (!item) return false
    const needed =
      unitsInTicket(item.productId, key) + baseUnits(quantity, item.unit, item)
    if (!Number.isInteger(quantity) || !canRemove(item.stock, needed)) return false
    item.quantity = quantity
    return true
  }

  /**
   * Pasa una partida de envase a unidad suelta (o al revés), conservando la cantidad. Si ya
   * hay otra partida del mismo producto en la unidad destino, se suman. false si no se puede
   * (producto sin fraccionar o no alcanza la existencia).
   */
  function setProductUnit(key: string, unit: SaleUnit): boolean {
    const item = productItems.value.find((p) => p.key === key)
    if (!item || item.unit === unit) return !!item
    if (unit === 'unit' && item.unitsPerPackage <= 1) return false

    const targetKey = itemKey(item.productId, unit)
    const target = productItems.value.find((p) => p.key === targetKey)
    const mergedQuantity = item.quantity + (target?.quantity ?? 0)
    const needed =
      unitsInTicket(item.productId, key) -
      (target ? baseUnits(target.quantity, target.unit, target) : 0) +
      baseUnits(mergedQuantity, unit, item)
    if (!canRemove(item.stock, needed)) return false

    const defaultPrice = priceForUnit(unit, item.packagePriceCents, {
      unitsPerPackage: item.unitsPerPackage,
      unitPriceCents: item.fixedUnitPriceCents,
    })
    if (target) {
      target.quantity = mergedQuantity
      productItems.value = productItems.value.filter((p) => p.key !== key)
    } else {
      item.key = targetKey
      item.unit = unit
      item.quantity = mergedQuantity
      item.defaultUnitPriceCents = defaultPrice
      item.unitPriceCents = defaultPrice
    }
    return true
  }

  /** Corrige el precio de la unidad de una partida en ESTA venta (no cambia el del producto). */
  function setProductUnitPrice(key: string, cents: number): boolean {
    const item = productItems.value.find((p) => p.key === key)
    if (!item || !Number.isInteger(cents) || cents < 0) return false
    item.unitPriceCents = cents
    return true
  }

  function removeProduct(key: string): void {
    productItems.value = productItems.value.filter((p) => p.key !== key)
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
      unit: p.unit,
      // Solo si se corrigió el precio en esta venta.
      ...(p.unitPriceCents !== p.defaultUnitPriceCents
        ? { unitPriceCents: p.unitPriceCents }
        : {}),
    }))

    let ticket: checkoutService.Ticket
    if (isQuickSale.value && counterBranchId.value) {
      const services: QuickServiceLine[] = quickServices.value.map((s) => ({
        serviceId: s.serviceId,
        quantity: s.quantity,
      }))
      ticket = await checkoutService.chargeQuickSale({
        branchId: counterBranchId.value,
        services,
        products,
        payments: payments.value,
        discountCents: discountCents.value,
        attendedBy: quickAttendedBy.value,
        speciesGroupId: quickSpeciesGroupId.value,
      })
    } else if (appointmentId.value) {
      ticket = await checkoutService.charge({
        appointmentId: appointmentId.value,
        payments: payments.value,
        discountCents: discountCents.value,
        products,
      })
    } else if (counterBranchId.value) {
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
    quickServices.value = []
    isQuickSale.value = false
    quickAttendedBy.value = null
    quickSpeciesGroupId.value = null
    productItems.value = []
    catalog.value = []
    categories.value = []
    recentSoldProductIds.value = []
    lineItems.value = []
    supplyItems.value = []
    discountCents.value = 0
    payments.value = []
    status.value = 'idle'
    errorMessage.value = null
  }

  return {
    appointmentId,
    lineItems,
    supplyItems,
    productItems,
    catalog,
    categories,
    recentSoldProductIds,
    counterBranchId,
    counterCustomerId,
    quickServices,
    isQuickSale,
    quickAttendedBy,
    quickSpeciesGroupId,
    loadQuickSale,
    addService,
    setServiceQuantity,
    removeService,
    discountCents,
    payments,
    status,
    errorMessage,
    subtotalCents,
    taxCents,
    totalCents,
    paidCents,
    remainingCents,
    changeCents,
    unpayableExcessCents,
    isCovered,
    isFullyPaid,
    loadAppointment,
    loadCounterSale,
    setCounterCustomer,
    loadCatalog,
    addProduct,
    unitsInTicket,
    setProductUnit,
    setProductUnitPrice,
    setProductQuantity,
    removeProduct,
    setDiscount,
    addPayment,
    removePayment,
    checkout,
    reset,
  }
})
