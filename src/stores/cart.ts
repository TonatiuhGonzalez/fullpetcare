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
import type { CheckoutLineItem, NewPayment } from '@/services/checkout'
import { applyDiscount, sumLineItems } from '@/lib/money'

export const useCartStore = defineStore('cart', () => {
  const appointmentId = ref<string | null>(null)
  const lineItems = ref<CheckoutLineItem[]>([])
  const discountCents = ref(0)
  const payments = ref<NewPayment[]>([])
  const status = ref<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const errorMessage = ref<string | null>(null)

  const subtotalCents = computed(() => sumLineItems(lineItems.value).subtotalCents)
  const taxCents = computed(() => sumLineItems(lineItems.value).taxCents)
  /** Lo que hay que cobrar: subtotal + IVA, menos el descuento (nunca negativo). */
  const totalCents = computed(() => {
    const grossTotalCents = sumLineItems(lineItems.value).totalCents
    return applyDiscount(grossTotalCents, discountCents.value)
  })
  const paidCents = computed(() =>
    payments.value.reduce((sum, p) => sum + p.amountCents, 0),
  )
  /** Cuánto falta por pagar. 0 cuando el pago ya cubre (o excede) el total. */
  const remainingCents = computed(() => Math.max(0, totalCents.value - paidCents.value))
  /** Listo para cobrar: hay al menos un pago y alcanza el total. */
  const isFullyPaid = computed(() => payments.value.length > 0 && remainingCents.value === 0)

  /** Carga las partidas de una cita atendida y reinicia descuento/pagos. */
  async function loadAppointment(id: string): Promise<void> {
    appointmentId.value = id
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

  /** Cobra la cita cargada con los pagos acumulados y limpia el carrito. */
  async function checkout(): Promise<checkoutService.Ticket> {
    if (!appointmentId.value) throw new Error('No hay ninguna cita cargada para cobrar.')

    const ticket = await checkoutService.charge({
      appointmentId: appointmentId.value,
      payments: payments.value,
      discountCents: discountCents.value,
    })
    reset()
    return ticket
  }

  function reset(): void {
    appointmentId.value = null
    lineItems.value = []
    discountCents.value = 0
    payments.value = []
    status.value = 'idle'
    errorMessage.value = null
  }

  return {
    appointmentId,
    lineItems,
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
    setDiscount,
    addPayment,
    removePayment,
    checkout,
    reset,
  }
})
