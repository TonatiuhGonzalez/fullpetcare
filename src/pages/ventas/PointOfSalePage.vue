<script setup lang="ts">
// Punto de venta (fase 13, tarea 13.4; PLAN.md D18): cobrar productos al paso, sin cita
// y sin pedir cliente. Se abre desde el botón flotante de AppLayout (/app/venta-mostrador).
//
// Reutiliza useCartStore (el carrito de siempre, en modo "venta de mostrador") y el
// cobro checkout_counter_sale() de la base: esta página solo arma el ticket y lo manda.
// La factura (con cliente nuevo o registrado) llega en las tareas 13.5 y 13.6; mientras
// tanto, tras cobrar se puede facturar desde el detalle de la venta, como siempre.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import TicketView from '@/components/TicketView.vue'
import { checkoutErrorMessage } from '@/lib/checkoutErrors'
import { formatMXN, pesosToCents } from '@/lib/money'
import { findBySku, searchProducts } from '@/lib/productSearch'
import type { CardFormCode, SellableProduct, Ticket } from '@/services/checkout'
import { useCartStore } from '@/stores/cart'
import { useSessionStore } from '@/stores/session'
import type { Database } from '@/types/database'

type PaymentMethod = Database['public']['Enums']['payment_method']

const session = useSessionStore()
const cart = useCartStore()

const loading = ref(true)
const loadError = ref<string | null>(null)

// --- Captura de productos ---------------------------------------------------
const barcode = ref('')
const barcodeField = ref<{ focus: () => void } | null>(null)
const productToAdd = ref<SellableProduct | null>(null)
/** Texto escrito en "Buscar por nombre": se limpia al elegir para que el campo quede listo para el siguiente. */
const nameSearch = ref('')
/** Aviso bajo el campo de código: producto no encontrado o sin existencia suficiente. */
const entryMessage = ref<string | null>(null)

function focusBarcode(): void {
  barcodeField.value?.focus()
}

/** Suma una pieza al ticket; avisa si la existencia no alcanza (cantidades siempre enteras). */
function addToTicket(product: SellableProduct): void {
  entryMessage.value = null
  if (!cart.addProduct(product, 1)) {
    entryMessage.value = `Solo hay ${product.stock} pieza(s) de "${product.name}".`
  }
}

/**
 * Un lector de código de barras "teclea" el código y manda Enter, así que Enter (o el
 * botón Agregar) dispara esto. La búsqueda es por código EXACTO (lib/productSearch.ts).
 */
function handleBarcode(): void {
  const code = barcode.value.trim()
  if (!code) return
  const product = findBySku(cart.catalog, code)
  if (product) {
    addToTicket(product)
  } else {
    entryMessage.value = `No hay un producto con existencia con el código "${code}".`
  }
  barcode.value = ''
  focusBarcode()
}

// Productos sin código (el código es opcional) se agregan por nombre.
watch(productToAdd, (product) => {
  if (!product) return
  addToTicket(product)
  productToAdd.value = null
  nameSearch.value = ''
})

function handleQuantity(productId: string, value: string | number): void {
  entryMessage.value = null
  if (!cart.setProductQuantity(productId, Number(value))) {
    entryMessage.value =
      'La cantidad debe ser un entero y no puede pasar de la existencia.'
  }
}

const pieceCount = computed(() =>
  cart.productItems.reduce((sum, p) => sum + p.quantity, 0),
)

// --- Consultar precio ---------------------------------------------------------
const showPriceCheck = ref(false)
const priceQuery = ref('')
const priceResults = computed(() => searchProducts(cart.catalog, priceQuery.value))

// --- Cancelar la venta ----------------------------------------------------------
const showCancel = ref(false)

async function startSale(): Promise<void> {
  const tenantId = session.activeTenantId
  const branchId = session.activeBranchId
  if (!tenantId || !branchId) {
    loadError.value = 'Elige una sucursal para poder cobrar.'
    loading.value = false
    return
  }
  loading.value = true
  loadError.value = null
  // Primero se arma la venta (reset) y luego se carga el catálogo: reset() lo vacía.
  cart.loadCounterSale(branchId)
  await cart.loadCatalog(tenantId, branchId)
  loading.value = false
  resetPaymentForm()
  focusBarcode()
}

function handleCancel(): void {
  showCancel.value = false
  entryMessage.value = null
  void startSale()
}

onMounted(startSale)
// Si el usuario sale a otra pantalla con el ticket a medias, no se arrastra a la siguiente.
onBeforeUnmount(() => cart.reset())

// --- Cobro ------------------------------------------------------------------------
const showPayment = ref(false)
const charging = ref(false)
const chargeError = ref<string | null>(null)
const ticket = ref<Ticket | null>(null)

const discountInPesos = ref<number | null>(null)
const newPaymentMethod = ref<PaymentMethod>('cash')
const newPaymentAmountInPesos = ref<number | null>(null)
// Con tarjeta hay que elegir crédito o débito: la base no deja cobrar sin eso.
const newCardType = ref<CardFormCode | null>(null)

const methodLabels: Record<PaymentMethod, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer_spei: 'Transferencia',
  openpay: 'Openpay',
}

const cardTypeMissing = computed(
  () => newPaymentMethod.value === 'card' && !newCardType.value,
)

function resetPaymentForm(): void {
  discountInPesos.value = null
  newPaymentMethod.value = 'cash'
  newPaymentAmountInPesos.value = null
  newCardType.value = null
  chargeError.value = null
  ticket.value = null
}

function openPayment(): void {
  chargeError.value = null
  showPayment.value = true
}

function applyDiscount(): void {
  cart.setDiscount(
    discountInPesos.value != null ? pesosToCents(discountInPesos.value) : 0,
  )
}

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
  charging.value = true
  chargeError.value = null
  try {
    ticket.value = await cart.checkout()
  } catch (err) {
    chargeError.value = checkoutErrorMessage(err)
  } finally {
    charging.value = false
  }
}

/** Después del ticket: venta nueva, con existencias frescas (la que se acaba de vender ya bajó). */
function handleNewSale(): void {
  showPayment.value = false
  void startSale()
}
</script>

<template>
  <!-- Pantalla completa de cobro: sin el ancho máximo de 860 px del resto de la app. -->
  <v-container fluid :max-width="null as unknown as undefined" class="py-4 pos">
    <v-alert v-if="loadError" type="error" density="compact" variant="tonal" class="mb-3">
      {{ loadError }}
    </v-alert>
    <v-alert
      v-else-if="cart.errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-3"
    >
      {{ cart.errorMessage }}
    </v-alert>

    <v-card class="pa-4 d-flex flex-column pos-card">
      <!-- Barra de captura: código de barras, nombre y consulta de precio. -->
      <div class="d-flex flex-wrap align-center ga-3">
        <v-icon icon="mdi-barcode-scan" size="large" class="text-medium-emphasis" />
        <v-text-field
          ref="barcodeField"
          v-model="barcode"
          label="Código de barras"
          density="compact"
          hide-details
          autofocus
          class="pos-field"
          :disabled="loading"
          @keydown.enter.prevent="handleBarcode"
        />
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-plus"
          :disabled="loading || !barcode.trim()"
          @click="handleBarcode"
        >
          Agregar
        </v-btn>

        <v-divider vertical class="mx-1" />

        <v-autocomplete
          v-model="productToAdd"
          v-model:search="nameSearch"
          :items="cart.catalog"
          item-title="name"
          return-object
          label="Buscar por nombre"
          variant="outlined"
          density="compact"
          hide-details
          class="pos-field"
          :disabled="loading"
          no-data-text="No hay productos con existencia"
        >
          <template #item="{ props: itemProps, item }">
            <v-list-item
              v-bind="itemProps"
              :subtitle="`${formatMXN(item.raw.priceCents)} · hay ${item.raw.stock}`"
            />
          </template>
        </v-autocomplete>

        <v-spacer />

        <v-btn
          variant="outlined"
          prepend-icon="mdi-tag-search-outline"
          :disabled="loading"
          @click="showPriceCheck = true"
        >
          Consultar precio
        </v-btn>
      </div>
      <p v-if="entryMessage" class="text-caption text-error mt-2 mb-0">
        {{ entryMessage }}
      </p>

      <!-- Ticket en curso. -->
      <div class="pos-lines mt-4">
        <v-table density="comfortable" fixed-header height="100%">
          <thead>
            <tr>
              <th>Descripción</th>
              <th class="text-right">Precio unitario</th>
              <th class="text-center">Cantidad</th>
              <th class="text-right">Importe</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in cart.productItems" :key="item.productId">
              <td>{{ item.description }}</td>
              <td class="text-right">{{ formatMXN(item.unitPriceCents) }}</td>
              <td class="text-center">
                <v-text-field
                  :model-value="item.quantity"
                  type="number"
                  min="1"
                  step="1"
                  density="compact"
                  hide-details
                  class="pos-qty"
                  aria-label="Cantidad"
                  @update:model-value="handleQuantity(item.productId, $event)"
                />
              </td>
              <td class="text-right">
                {{ formatMXN(item.unitPriceCents * item.quantity) }}
              </td>
              <td class="text-right">
                <v-btn
                  icon="mdi-delete-outline"
                  size="small"
                  variant="text"
                  aria-label="Quitar producto"
                  @click="cart.removeProduct(item.productId)"
                />
              </td>
            </tr>
            <tr v-if="cart.productItems.length === 0">
              <td colspan="5" class="text-center text-medium-emphasis py-8">
                <v-progress-circular v-if="loading" indeterminate color="primary" />
                <template v-else>
                  Escanea un código de barras o busca un producto por nombre.
                </template>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>

      <!-- Pie: resumen, total y acciones. -->
      <div class="d-flex flex-wrap align-center ga-3 mt-4">
        <v-chip prepend-icon="mdi-store-outline" variant="tonal">
          {{ session.activeBranch?.name ?? 'Sin sucursal' }}
        </v-chip>
        <v-chip prepend-icon="mdi-package-variant-closed" variant="tonal">
          {{ pieceCount }} {{ pieceCount === 1 ? 'pieza' : 'piezas' }}
        </v-chip>

        <v-spacer />

        <div class="text-h4 font-weight-bold text-primary mr-4" aria-live="polite">
          Total {{ formatMXN(cart.totalCents) }}
        </div>

        <v-btn
          variant="outlined"
          :disabled="cart.productItems.length === 0"
          @click="showCancel = true"
        >
          Cancelar
        </v-btn>
        <v-btn
          color="primary"
          size="large"
          prepend-icon="mdi-cash"
          :disabled="cart.productItems.length === 0"
          @click="openPayment"
        >
          Cobrar
        </v-btn>
      </div>
    </v-card>

    <!-- Consultar precio: busca un producto y muestra su precio, sin tocar el ticket. -->
    <v-dialog v-model="showPriceCheck" max-width="560" @after-leave="priceQuery = ''">
      <v-card>
        <v-card-title>Consultar precio</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="priceQuery"
            label="Nombre o código de barras"
            autofocus
            hide-details
            prepend-inner-icon="mdi-magnify"
            class="mb-2"
          />
          <v-list v-if="priceResults.length > 0" density="compact">
            <v-list-item v-for="p in priceResults" :key="p.id" :title="p.name">
              <template #subtitle>
                {{ p.sku ? `Código ${p.sku} · ` : '' }}hay {{ p.stock }}
              </template>
              <template #append>
                <span class="text-h6">{{ formatMXN(p.priceCents) }}</span>
              </template>
            </v-list-item>
          </v-list>
          <p v-else-if="priceQuery.trim()" class="text-body-2 text-medium-emphasis mt-3">
            No hay productos con existencia que coincidan.
          </p>
          <p v-else class="text-body-2 text-medium-emphasis mt-3">
            Escribe para buscar. El precio ya incluye IVA.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showPriceCheck = false">Cerrar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Confirmar que se descarta la venta en curso. -->
    <v-dialog v-model="showCancel" max-width="400">
      <v-card>
        <v-card-title>¿Cancelar la venta?</v-card-title>
        <v-card-text>Se vacía el ticket y se pierde lo capturado.</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="showCancel = false">Seguir vendiendo</v-btn>
          <v-btn color="error" variant="tonal" @click="handleCancel"
            >Cancelar venta</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Cobro: descuento, formas de pago y, al terminar, el ticket. -->
    <v-dialog
      v-model="showPayment"
      max-width="560"
      :persistent="charging || !!ticket"
      scrollable
    >
      <v-card v-if="ticket" class="pa-4">
        <v-alert type="success" density="compact" variant="tonal" class="mb-4">
          Cobro registrado.
        </v-alert>
        <TicketView :ticket="ticket" />
        <v-btn
          v-if="session.canView('invoicing')"
          block
          variant="tonal"
          class="mt-4 no-print"
          prepend-icon="mdi-file-document-outline"
          :to="`/app/ventas/${ticket.sale.id}`"
        >
          Facturar esta venta
        </v-btn>
        <v-btn block color="primary" class="mt-4 no-print" @click="handleNewSale">
          Nueva venta
        </v-btn>
      </v-card>

      <v-card v-else>
        <v-card-title>Cobrar {{ formatMXN(cart.totalCents) }}</v-card-title>
        <v-card-text>
          <div class="d-flex justify-space-between text-body-2 mb-1">
            <span>Subtotal</span>
            <span>{{ formatMXN(cart.subtotalCents) }}</span>
          </div>
          <div class="d-flex justify-space-between text-body-2 mb-3">
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
                  aria-label="Quitar pago"
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

          <v-alert v-if="chargeError" type="error" density="compact" variant="tonal">
            {{ chargeError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="charging" @click="showPayment = false"
            >Volver al ticket</v-btn
          >
          <v-btn
            color="primary"
            variant="flat"
            :loading="charging"
            :disabled="!cart.isFullyPaid"
            @click="handleCharge"
          >
            Cobrar {{ formatMXN(cart.totalCents) }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>

<style scoped lang="scss">
// La tarjeta ocupa el alto disponible para que la tabla de partidas crezca y el total
// quede siempre abajo, como en una caja registradora.
.pos-card {
  min-height: calc(100vh - 120px);
}

.pos-lines {
  flex: 1 1 0;
  min-height: 240px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 4px;
  overflow: hidden;
}

.pos-field {
  min-width: 220px;
  max-width: 320px;
}

.pos-qty {
  width: 90px;
  margin: 0 auto;
}
</style>
