<script setup lang="ts">
// Cobrar una cita atendida (tarea 5.14): resumen de partidas, formas de
// pago acumuladas (useCartStore, tarea 5.12), descuento, y factura
// opcional (tarea 5.16). El cobro en sí lo hace checkout_appointment() en
// la base (services/checkout.ts#charge) — esta página solo arma lo que se
// le manda y muestra el resultado.
//
// Tarea 11.11: el ticket también puede llevar productos, y sin `id` la misma
// página cobra una VENTA DE MOSTRADOR (sin cita): se elige el cliente y se
// agregan solo productos (checkout_counter_sale()).
import { computed, onMounted, ref } from 'vue'

import * as appointmentsService from '@/services/appointments'
import type { Appointment } from '@/services/appointments'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as invoiceRequestsService from '@/services/invoiceRequests'
import type { CardFormCode, SellableProduct, Ticket } from '@/services/checkout'
import type { Database } from '@/types/database'
import { formatMXN, pesosToCents } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import { useCartStore } from '@/stores/cart'
import TicketView from '@/components/TicketView.vue'

type PaymentMethod = Database['public']['Enums']['payment_method']

// Sin `id` es una venta de mostrador (ruta /app/venta-mostrador).
const props = defineProps<{ id?: string }>()
const isCounterSale = computed(() => !props.id)

const session = useSessionStore()
const cart = useCartStore()

const appointment = ref<Appointment | null>(null)
const customer = ref<Customer | null>(null)
const loading = ref(false)
const loadError = ref<string | null>(null)

const discountInPesos = ref<number | null>(null)
const newPaymentMethod = ref<PaymentMethod>('cash')
const newPaymentAmountInPesos = ref<number | null>(null)
// Con tarjeta hay que elegir crédito o débito: la base no deja cobrar sin eso.
const newCardType = ref<CardFormCode | null>(null)

const customers = ref<Customer[]>([])
const selectedCustomerId = ref<string | null>(null)
const productToAdd = ref<SellableProduct | null>(null)
const productQuantity = ref(1)
const productError = ref<string | null>(null)

const requiresInvoice = ref(false)
const charging = ref(false)
const chargeError = ref<string | null>(null)
const ticket = ref<Ticket | null>(null)

const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer_spei: 'Transferencia',
  openpay: 'Openpay',
}

/** El cliente tiene capturados los datos fiscales que pide invoice_requests. */
const customerHasFiscalData = computed(
  () =>
    !!customer.value?.rfc &&
    !!customer.value?.legal_name &&
    !!customer.value?.tax_regime_code &&
    !!customer.value?.cfdi_use &&
    !!customer.value?.postal_code,
)

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  loadError.value = null
  try {
    if (isCounterSale.value) {
      cart.reset()
      customers.value = await customersService.list(session.activeTenantId)
      return
    }

    const found = await appointmentsService.getById(session.activeTenantId, props.id!)
    appointment.value = found
    if (!found) return

    customer.value = await customersService.getById(
      session.activeTenantId,
      found.customer_id,
    )
    requiresInvoice.value = customer.value?.requires_invoice ?? false

    if (found.status === 'completed') {
      await cart.loadAppointment(found.id)
      await loadProducts(found.branch_id)
    }
  } catch {
    loadError.value = 'No se pudo cargar la cita. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** Productos con existencia en la sucursal donde se cobra. */
async function loadProducts(branchId: string): Promise<void> {
  if (session.activeTenantId) await cart.loadCatalog(session.activeTenantId, branchId)
}

/** Venta de mostrador: al elegir cliente se arma el carrito de la sucursal activa. */
async function handleSelectCustomer(customerId: string | null): Promise<void> {
  selectedCustomerId.value = customerId
  customer.value = customers.value.find((c) => c.id === customerId) ?? null
  requiresInvoice.value = customer.value?.requires_invoice ?? false
  if (!customerId || !session.activeBranchId) {
    cart.reset()
    return
  }
  cart.loadCounterSale(session.activeBranchId, customerId)
  await loadProducts(session.activeBranchId)
}

function handleAddProduct(): void {
  productError.value = null
  if (!productToAdd.value) return
  if (!cart.addProduct(productToAdd.value, productQuantity.value)) {
    productError.value = `Solo hay ${productToAdd.value.stock} pieza(s) de "${productToAdd.value.name}".`
    return
  }
  productToAdd.value = null
  productQuantity.value = 1
}

function handleProductQuantity(productId: string, value: string | number): void {
  productError.value = null
  if (!cart.setProductQuantity(productId, Number(value))) {
    productError.value =
      'La cantidad debe ser un entero y no puede pasar de la existencia.'
  }
}

function applyDiscount(): void {
  cart.setDiscount(
    discountInPesos.value != null ? pesosToCents(discountInPesos.value) : 0,
  )
}

/** Con tarjeta no se puede agregar el pago hasta elegir crédito o débito. */
const cardTypeMissing = computed(
  () => newPaymentMethod.value === 'card' && !newCardType.value,
)

function handleAddPayment(): void {
  if (newPaymentAmountInPesos.value == null || newPaymentAmountInPesos.value <= 0) return
  if (cardTypeMissing.value) return
  cart.addPayment({
    method: newPaymentMethod.value,
    amountCents: pesosToCents(newPaymentAmountInPesos.value),
    ...(newPaymentMethod.value === 'card' ? { paymentFormCode: newCardType.value! } : {}),
  })
  newPaymentAmountInPesos.value = null
  newCardType.value = null
}

/** Prellena el pago con exactamente lo que falta — el caso más común (un solo método). */
function fillRemaining(): void {
  newPaymentAmountInPesos.value = cart.remainingCents / 100
}

async function handleCharge(): Promise<void> {
  if (!session.activeTenantId || !customer.value) return
  charging.value = true
  chargeError.value = null
  try {
    const chargedTicket = await cart.checkout()

    if (requiresInvoice.value && customerHasFiscalData.value) {
      await invoiceRequestsService.create(
        session.activeTenantId,
        chargedTicket.sale.id,
        {
          rfc: customer.value.rfc!,
          legalName: customer.value.legal_name!,
          taxRegimeCode: customer.value.tax_regime_code!,
          cfdiUse: customer.value.cfdi_use!,
          postalCode: customer.value.postal_code!,
        },
        chargedTicket.payments.map((p) => ({
          method: p.method,
          amountCents: p.amount_cents,
          paymentFormCode: (p.payment_form_code ?? undefined) as CardFormCode | undefined,
        })),
      )
    }

    ticket.value = chargedTicket
  } catch (err) {
    chargeError.value = checkoutErrorMessage(err)
  } finally {
    charging.value = false
  }
}

/**
 * checkout_appointment() (checkout_rpc.sql) rechaza casos de negocio con un
 * mensaje propio en español — se reconocen aquí por su texto para
 * mostrarlos tal cual (son los mismos que ya prueba checkout-rpc.spec.ts),
 * en vez de un genérico "revisa tu conexión" que sería falso y confundiría
 * más de lo que ayuda (CLAUDE.md §5.4: los mensajes de error no mienten
 * sobre la causa).
 */
function checkoutErrorMessage(err: unknown): string {
  // NO "err instanceof Error": un error de `.rpc()`/`.from()` de
  // supabase-js NO es una instancia de Error salvo que se use
  // `.throwOnError()` — sin eso, PostgREST devuelve un objeto plano
  // `{ message, details, hint, code }` (comprobado contra la respuesta
  // real de checkout_appointment()). Los errores de supabase.auth (que sí
  // usa `instanceof Error` en session.ts) son distintos: esos SÍ son
  // instancias reales de AuthError.
  const message =
    typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message)
      : ''

  if (/no cubre el total/i.test(message))
    return 'El monto pagado no cubre el total de la venta.'
  if (/no tiene existencia|no hay existencia suficiente/i.test(message)) {
    return 'Un producto ya no tiene existencia suficiente. Quítalo o baja la cantidad.'
  }
  if (/producto no existe/i.test(message)) return 'Un producto ya no está disponible.'
  if (/crédito o de débito/i.test(message))
    return 'Elige si la tarjeta fue de crédito o de débito.'
  if (/ya fue cobrada/i.test(message)) return 'Esta cita ya fue cobrada.'
  if (/debe estar atendida/i.test(message)) {
    return 'Esta cita todavía no está atendida — no se puede cobrar.'
  }
  if (/no tienes permiso para cobrar/i.test(message)) {
    return 'No tienes permiso para cobrar citas.'
  }
  if (/no perteneces|no tienes acceso/i.test(message)) {
    return 'No tienes acceso para cobrar esta cita.'
  }
  return 'No se pudo cobrar. Revisa tu conexión.'
}
</script>

<template>
  <v-container class="py-6" style="max-width: 560px">
    <v-btn
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2"
      :to="isCounterSale ? '/app/agenda' : `/app/citas/${props.id}`"
    >
      {{ isCounterSale ? 'Volver a la agenda' : 'Volver al detalle de la cita' }}
    </v-btn>

    <v-alert v-if="loadError" type="error" density="compact" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>

    <v-progress-circular v-if="loading" indeterminate color="primary" />

    <template v-else-if="appointment || isCounterSale">
      <v-alert
        v-if="appointment && appointment.status !== 'completed'"
        type="warning"
        density="compact"
        variant="tonal"
      >
        Esta cita todavía no está atendida — se cobra después de guardar su ficha de
        atención.
      </v-alert>

      <v-card v-else-if="ticket" class="pa-4">
        <v-alert type="success" density="compact" variant="tonal" class="mb-4">
          Cobro registrado.
        </v-alert>
        <TicketView :ticket="ticket" />
        <v-btn block variant="tonal" class="mt-4 no-print" to="/app/agenda">
          Volver a la agenda
        </v-btn>
      </v-card>

      <v-card v-else class="pa-4">
        <h1 class="text-h5 mb-3">
          {{ isCounterSale ? 'Venta de mostrador' : 'Cobrar' }}
        </h1>

        <v-autocomplete
          v-if="isCounterSale"
          :model-value="selectedCustomerId"
          :items="customers"
          :item-title="(c: Customer) => `${c.first_name} ${c.last_name}`"
          item-value="id"
          label="Cliente"
          density="compact"
          no-data-text="Sin resultados"
          @update:model-value="handleSelectCustomer"
        />
        <p v-else class="text-body-2 text-medium-emphasis mb-4">
          {{ customer?.first_name }} {{ customer?.last_name }}
        </p>

        <template v-if="!isCounterSale || selectedCustomerId">
          <v-list density="compact">
            <v-list-item v-for="item in cart.lineItems" :key="item.serviceId">
              <template #title>
                {{ item.description }} {{ item.quantity > 1 ? `× ${item.quantity}` : '' }}
              </template>
              <template #append>{{
                formatMXN(item.unitPriceCents * item.quantity)
              }}</template>
            </v-list-item>
            <v-list-item v-for="item in cart.productItems" :key="item.productId">
              <template #title>{{ item.description }}</template>
              <template #subtitle
                >{{ formatMXN(item.unitPriceCents) }} c/u · hay {{ item.stock }}</template
              >
              <template #append>
                <v-text-field
                  :model-value="item.quantity"
                  type="number"
                  min="1"
                  step="1"
                  density="compact"
                  hide-details
                  style="width: 80px"
                  class="mr-2"
                  aria-label="Cantidad"
                  @update:model-value="handleProductQuantity(item.productId, $event)"
                />
                <span class="mr-2">{{
                  formatMXN(item.unitPriceCents * item.quantity)
                }}</span>
                <v-btn
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  aria-label="Quitar producto"
                  @click="cart.removeProduct(item.productId)"
                />
              </template>
            </v-list-item>
          </v-list>

          <p class="text-subtitle-2 mt-3 mb-2">Agregar producto</p>
          <div class="d-flex align-end ga-2 mb-1">
            <v-autocomplete
              v-model="productToAdd"
              :items="cart.catalog"
              item-title="name"
              return-object
              label="Producto"
              density="compact"
              hide-details
              no-data-text="No hay productos con existencia"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item
                  v-bind="itemProps"
                  :subtitle="`${formatMXN(item.raw.priceCents)} · hay ${item.raw.stock}`"
                />
              </template>
            </v-autocomplete>
            <v-text-field
              v-model.number="productQuantity"
              label="Cant."
              type="number"
              min="1"
              step="1"
              density="compact"
              hide-details
              style="max-width: 90px"
            />
            <v-btn
              icon="mdi-plus"
              color="primary"
              variant="tonal"
              :disabled="!productToAdd"
              aria-label="Agregar producto"
              @click="handleAddProduct"
            />
          </div>
          <p v-if="productError" class="text-caption text-error mb-2">
            {{ productError }}
          </p>

          <v-divider class="my-3" />

          <div class="d-flex justify-space-between text-body-2 mb-1">
            <span>Subtotal</span>
            <span>{{ formatMXN(cart.subtotalCents) }}</span>
          </div>
          <div class="d-flex justify-space-between text-body-2 mb-2">
            <span>IVA</span>
            <span>{{ formatMXN(cart.taxCents) }}</span>
          </div>

          <v-text-field
            v-model.number="discountInPesos"
            label="Descuento (MXN)"
            type="number"
            min="0"
            step="0.01"
            density="compact"
            @update:model-value="applyDiscount"
          />

          <div class="d-flex justify-space-between text-h6 mb-3">
            <span>Total</span>
            <span>{{ formatMXN(cart.totalCents) }}</span>
          </div>

          <v-divider class="my-3" />

          <p class="text-subtitle-2 mb-2">Forma de pago</p>

          <v-list v-if="cart.payments.length > 0" density="compact" class="mb-2">
            <v-list-item v-for="(payment, index) in cart.payments" :key="index">
              <template #title>
                {{ methodLabels[payment.method] }}
                {{
                  payment.paymentFormCode === '28'
                    ? '(débito)'
                    : payment.paymentFormCode === '04'
                      ? '(crédito)'
                      : ''
                }}
              </template>
              <template #append>
                <span class="mr-2">{{ formatMXN(payment.amountCents) }}</span>
                <v-btn
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  @click="cart.removePayment(index)"
                />
              </template>
            </v-list-item>
          </v-list>

          <div class="d-flex align-end ga-2 mb-2">
            <v-select
              v-model="newPaymentMethod"
              :items="[
                { title: 'Efectivo', value: 'cash' },
                { title: 'Tarjeta', value: 'card' },
                { title: 'Transferencia', value: 'transfer_spei' },
                { title: 'Openpay', value: 'openpay' },
              ]"
              label="Método"
              density="compact"
              hide-details
            />
            <v-text-field
              v-model.number="newPaymentAmountInPesos"
              label="Monto (MXN)"
              type="number"
              min="0"
              step="0.01"
              density="compact"
              hide-details
            />
            <v-btn variant="text" size="small" @click="fillRemaining">Todo</v-btn>
            <v-btn
              icon="mdi-plus"
              color="primary"
              variant="tonal"
              :disabled="cardTypeMissing"
              aria-label="Agregar pago"
              @click="handleAddPayment"
            />
          </div>

          <v-select
            v-if="newPaymentMethod === 'card'"
            v-model="newCardType"
            :items="[
              { title: 'Tarjeta de crédito', value: '04' },
              { title: 'Tarjeta de débito', value: '28' },
            ]"
            label="Tipo de tarjeta"
            density="compact"
            :error="cardTypeMissing && newPaymentAmountInPesos != null"
            hint="Elige crédito o débito para poder registrar el pago."
            persistent-hint
            class="mb-2"
          />

          <p class="text-body-2 mb-3">
            Pagado: {{ formatMXN(cart.paidCents) }} · Falta:
            {{ formatMXN(cart.remainingCents) }}
          </p>

          <v-checkbox
            v-model="requiresInvoice"
            label="Requiere factura"
            density="compact"
            :disabled="!customerHasFiscalData"
          />
          <p
            v-if="requiresInvoice && !customerHasFiscalData"
            class="text-caption text-warning mb-2"
          >
            Este cliente no tiene datos fiscales completos — edítalos en su ficha antes de
            facturar.
          </p>

          <v-alert
            v-if="chargeError"
            type="error"
            density="compact"
            variant="tonal"
            class="mb-3"
          >
            {{ chargeError }}
          </v-alert>

          <v-btn
            block
            color="primary"
            size="large"
            :loading="charging"
            :disabled="
              !cart.isFullyPaid || (isCounterSale && cart.productItems.length === 0)
            "
            @click="handleCharge"
          >
            Cobrar {{ formatMXN(cart.totalCents) }}
          </v-btn>
        </template>
      </v-card>
    </template>
  </v-container>
</template>
