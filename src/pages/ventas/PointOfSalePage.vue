<script setup lang="ts">
// Punto de venta (fase 13, tarea 13.4; PLAN.md D18): cobrar productos al paso, sin cita
// y sin pedir cliente. Se abre desde el botón flotante de AppLayout (/app/venta-mostrador).
//
// Reutiliza useCartStore (el carrito de siempre, en modo "venta de mostrador") y el
// cobro checkout_counter_sale() de la base: esta página solo arma el ticket y lo manda.
// Factura (tareas 13.5 y 13.6): si quien compra pide factura, o no es cliente (se capturan
// sus datos fiscales y se le da de alta) o ya lo es (se elige de la lista y, si le faltan
// datos fiscales, se le piden en el momento). En ambos casos la venta queda ligada al
// cliente. Tras cobrar, siempre se puede facturar desde el detalle de la venta.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import CustomerFormDialog from '@/components/CustomerFormDialog.vue'
import PaymentSummary from '@/components/PaymentSummary.vue'
import PosProductTile from '@/components/PosProductTile.vue'
import TicketView from '@/components/TicketView.vue'
import { checkoutErrorMessage } from '@/lib/checkoutErrors'
import { formatMXN, pesosToCents } from '@/lib/money'
import {
  groupByCategory,
  productsInCategory,
  recentlySold,
} from '@/lib/productCategories'
import { filterProducts, findBySku, searchProducts } from '@/lib/productSearch'
import { customerFiscalProblems } from '@/lib/validation'
import type { CardFormCode, SellableProduct, Ticket } from '@/services/checkout'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as invoiceRequestsService from '@/services/invoiceRequests'
import { useCartStore } from '@/stores/cart'
import { useSessionStore } from '@/stores/session'
import type { Database } from '@/types/database'

type PaymentMethod = Database['public']['Enums']['payment_method']

const session = useSessionStore()
const cart = useCartStore()

const loading = ref(true)
const loadError = ref<string | null>(null)

// --- Captura de productos ---------------------------------------------------
/** Campo único: lo que teclea una persona (nombre) o "teclea" un lector (código + Enter). */
const barcode = ref('')
const barcodeField = ref<{ focus: () => void } | null>(null)
/** Aviso de captura (se muestra en un toast de 3 s): producto no encontrado o sin existencia suficiente. */
const entryMessage = ref<string | null>(null)
const showEntryToast = ref(false)
/** Cambia en cada aviso: reinicia los 3 segundos si llega otro mientras el anterior sigue visible. */
const entryToastKey = ref(0)
/** Último producto agregado: su fila del ticket se resalta un momento para confirmar la captura. */
const lastAddedId = ref<string | null>(null)
let flashTimer: ReturnType<typeof setTimeout> | undefined

/** Con texto en el campo, la fila de arriba muestra los productos que coinciden. */
const searchResults = computed(() => filterProducts(cart.catalog, barcode.value))
const isSearching = computed(() => barcode.value.trim().length > 0)

// Fila de arriba: categorías, o los productos de la categoría abierta.
const categoryTiles = computed(() => groupByCategory(cart.catalog, cart.categories))
const openCategoryId = ref<string | null>(null)
const openCategory = computed(
  () => categoryTiles.value.find((c) => c.id === openCategoryId.value) ?? null,
)
const categoryProducts = computed(() =>
  openCategoryId.value
    ? productsInCategory(cart.catalog, cart.categories, openCategoryId.value)
    : [],
)

// Fila de abajo: últimos vendidos, tantos como quepan en el ancho (sin scroll).
const TILE_WIDTH = 170
const TILE_GAP = 8
const recentRow = ref<HTMLElement | null>(null)
const recentCapacity = ref(4)
let recentObserver: ResizeObserver | undefined
const recentProducts = computed(() =>
  recentlySold(cart.catalog, cart.recentSoldProductIds, recentCapacity.value),
)

function updateRecentCapacity(width: number): void {
  recentCapacity.value = Math.max(
    1,
    Math.floor((width + TILE_GAP) / (TILE_WIDTH + TILE_GAP)),
  )
}

/** Piezas de cada producto que ya lleva el ticket, para marcarlas en su tarjeta. */
const quantityInTicket = computed(
  () => new Map(cart.productItems.map((p) => [p.productId, p.quantity])),
)

/** Muestra un aviso de captura en un toast de 3 s; un aviso nuevo reinicia el tiempo. */
function setEntryMessage(message: string): void {
  entryMessage.value = message
  showEntryToast.value = true
  entryToastKey.value++
}

function focusBarcode(): void {
  barcodeField.value?.focus()
}

/** Suma una pieza al ticket; avisa si la existencia no alcanza (cantidades siempre enteras). */
function addToTicket(product: SellableProduct): boolean {
  if (!cart.addProduct(product, 1)) {
    setEntryMessage(`Solo hay ${product.stock} pieza(s) de "${product.name}".`)
    return false
  }
  lastAddedId.value = product.id
  clearTimeout(flashTimer)
  flashTimer = setTimeout(() => (lastAddedId.value = null), 1200)
  return true
}

/** Un toque en una tarjeta de producto (de cualquiera de las dos filas): suma una pieza y deja el campo listo para lo siguiente. */
function handleTileClick(product: SellableProduct): void {
  addToTicket(product)
  barcode.value = ''
  focusBarcode()
}

/**
 * Un lector de código de barras "teclea" el código y manda Enter, así que Enter (o el
 * botón Agregar) dispara esto. Con código EXACTO (lib/productSearch.ts) agrega el
 * producto; si no, el texto se queda y la fila de arriba ya muestra las coincidencias por nombre.
 */
function handleBarcode(): void {
  const code = barcode.value.trim()
  if (!code) return
  const product = findBySku(cart.catalog, code)
  if (product) {
    addToTicket(product)
    barcode.value = ''
  } else if (searchResults.value.length > 0) {
    setEntryMessage(
      `No hay un producto con el código "${code}". Elige uno de los que aparecen arriba.`,
    )
  } else {
    setEntryMessage(`No hay un producto con existencia que coincida con "${code}".`)
    barcode.value = ''
  }
  focusBarcode()
}

/** Al volver al campo se selecciona lo escrito: el siguiente escaneo reemplaza el texto en vez de pegarse a él. */
function selectOnFocus(event: FocusEvent): void {
  ;(event.target as HTMLInputElement | null)?.select()
}

function handleQuantity(productId: string, value: string | number): void {
  if (!cart.setProductQuantity(productId, Number(value))) {
    setEntryMessage('La cantidad debe ser un entero y no puede pasar de la existencia.')
  }
}

/** Botones − y +: cambian la cantidad en uno (la existencia máxima la valida el store). */
function stepQuantity(productId: string, current: number, delta: number): void {
  handleQuantity(productId, current + delta)
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
  openCategoryId.value = null
  cart.loadCounterSale(branchId)
  await cart.loadCatalog(tenantId, branchId)
  loading.value = false
  resetPaymentForm()
  focusBarcode()
}

function handleCancel(): void {
  showCancel.value = false
  showEntryToast.value = false
  void startSale()
}

// Atajos: F2 va al campo de captura y F9 abre el cobro. No actúan con un diálogo abierto
// (se escribiría en el campo de atrás) ni mientras carga.
function handleShortcut(event: KeyboardEvent): void {
  if (event.key !== 'F2' && event.key !== 'F9') return
  if (loading.value || showPayment.value || showCancel.value || showPriceCheck.value)
    return
  event.preventDefault()
  if (event.key === 'F2') {
    focusBarcode()
  } else if (cart.productItems.length > 0) {
    openPayment()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleShortcut)
  if (recentRow.value && typeof ResizeObserver !== 'undefined') {
    recentObserver = new ResizeObserver(([entry]) =>
      updateRecentCapacity(entry.contentRect.width),
    )
    recentObserver.observe(recentRow.value)
  }
  void startSale()
})
// Si el usuario sale a otra pantalla con el ticket a medias, no se arrastra a la siguiente.
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleShortcut)
  recentObserver?.disconnect()
  clearTimeout(flashTimer)
  cart.reset()
})

// --- Cobro ------------------------------------------------------------------------
const showPayment = ref(false)
const charging = ref(false)
const chargeError = ref<string | null>(null)
const ticket = ref<Ticket | null>(null)
/** Si la solicitud de factura falló DESPUÉS de cobrar: el cobro ya está hecho, solo se avisa. */
const invoiceWarning = ref<string | null>(null)

// Factura: el cliente que se da de alta con sus datos fiscales. Se conserva aunque el
// cobro falle, para que reintentar no lo dé de alta dos veces.
const requiresInvoice = ref(false)
const invoiceCustomer = ref<Customer | null>(null)
const showCustomerForm = ref(false)
/** ¿Quien pide factura ya es cliente registrado (se elige) o no (se captura y se da de alta)? */
const invoiceMode = ref<'new' | 'registered'>('new')
const customers = ref<Customer[]>([])
const customersLoaded = ref(false)
const customersError = ref<string | null>(null)

/** Lo que le falta al cliente elegido para facturarle; vacío si ya se puede (o si no hay cliente). */
const invoiceProblems = computed(() =>
  invoiceCustomer.value ? customerFiscalProblems(invoiceCustomer.value) : [],
)
/** Hay cliente y ya tiene todos sus datos fiscales: se puede cobrar con factura. */
const invoiceReady = computed(
  () => !!invoiceCustomer.value && invoiceProblems.value.length === 0,
)

async function loadCustomers(): Promise<void> {
  if (customersLoaded.value || !session.activeTenantId) return
  customersError.value = null
  try {
    customers.value = await customersService.list(session.activeTenantId)
    customersLoaded.value = true
  } catch {
    customersError.value = 'No se pudo cargar la lista de clientes. Revisa tu conexión.'
  }
}

// Cambiar entre "cliente nuevo" y "registrado" descarta lo elegido; la lista se carga la primera vez.
watch([requiresInvoice, invoiceMode], ([invoice, mode], [, previousMode]) => {
  if (mode !== previousMode) invoiceCustomer.value = null
  if (invoice && mode === 'registered') void loadCustomers()
})

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
  invoiceWarning.value = null
  requiresInvoice.value = false
  invoiceMode.value = 'new'
  invoiceCustomer.value = null
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

/** Cliente dado de alta, o cliente registrado al que se le completaron los datos fiscales. */
function handleCustomerSaved(customer: Customer): void {
  invoiceCustomer.value = customer
  const index = customers.value.findIndex((c) => c.id === customer.id)
  if (index >= 0) customers.value[index] = customer
}

/** Solicitud de factura de una venta ya cobrada, con los datos fiscales del cliente dado de alta. */
async function createInvoiceRequest(sold: Ticket, customer: Customer): Promise<void> {
  if (!session.activeTenantId) return
  await invoiceRequestsService.create(
    session.activeTenantId,
    sold.sale.id,
    {
      rfc: customer.rfc ?? '',
      legalName: customer.legal_name ?? '',
      taxRegimeCode: customer.tax_regime_code ?? '',
      cfdiUse: customer.cfdi_use ?? '',
      postalCode: customer.postal_code ?? '',
    },
    sold.payments.map((p) => ({
      method: p.method,
      amountCents: p.amount_cents,
      paymentFormCode: (p.payment_form_code ?? undefined) as CardFormCode | undefined,
    })),
  )
}

async function handleCharge(): Promise<void> {
  const customer = requiresInvoice.value ? invoiceCustomer.value : null
  if (requiresInvoice.value && !invoiceReady.value) return
  charging.value = true
  chargeError.value = null
  try {
    // La venta se liga al cliente recién dado de alta (o a ninguno: venta libre).
    cart.setCounterCustomer(customer?.id ?? null)
    const sold = await cart.checkout()
    ticket.value = sold

    if (customer) {
      try {
        await createInvoiceRequest(sold, customer)
      } catch {
        invoiceWarning.value =
          'El cobro quedó registrado, pero no se pudo crear la solicitud de factura. Puedes facturarla desde el detalle de la venta.'
      }
    }
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
      <!-- Barra de captura: un solo campo para código de barras o nombre, y consulta de precio. -->
      <div class="d-flex flex-wrap align-center ga-3">
        <v-icon icon="mdi-barcode-scan" size="large" class="text-medium-emphasis" />
        <v-text-field
          ref="barcodeField"
          v-model="barcode"
          label="Código de barras o nombre (F2)"
          density="compact"
          hide-details
          autofocus
          clearable
          prepend-inner-icon="mdi-magnify"
          class="pos-field"
          :disabled="loading"
          @focus="selectOnFocus"
          @keydown.enter.prevent="handleBarcode"
        />
        <v-btn
          color="primary"
          variant="tonal"
          prepend-icon="mdi-plus"
          :disabled="loading || !barcode?.trim()"
          @click="handleBarcode"
        >
          Agregar
        </v-btn>

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
      <!-- Fila de arriba: categorías; al abrir una (o al escribir en el campo), sus productos. -->
      <div class="d-flex align-center ga-2 mt-3">
        <!-- Categoría abierta: ocupa el primer lugar de la fila (fija, solo indica; no se toca). -->
        <v-card
          v-if="openCategory && !isSearching"
          variant="flat"
          color="primary"
          class="pos-row-item pos-category pos-category--open pa-2 d-flex flex-column align-center justify-center"
          :aria-label="`Categoría ${openCategory.name}`"
        >
          <v-icon :icon="openCategory.icon" size="32" />
          <div class="pos-category-name text-body-2 font-weight-medium mt-1">
            {{ openCategory.name }}
          </div>
        </v-card>
        <div class="pos-row" aria-label="Categorías y productos">
          <template v-if="isSearching">
            <PosProductTile
              v-for="product in searchResults"
              :key="product.id"
              class="pos-row-item"
              :product="product"
              :in-ticket="quantityInTicket.get(product.id) ?? 0"
              @select="handleTileClick"
            />
            <p
              v-if="searchResults.length === 0"
              class="text-body-2 text-medium-emphasis align-self-center mb-0"
            >
              Ningún producto coincide.
            </p>
          </template>
          <template v-else-if="openCategory">
            <PosProductTile
              v-for="product in categoryProducts"
              :key="product.id"
              class="pos-row-item"
              :product="product"
              :in-ticket="quantityInTicket.get(product.id) ?? 0"
              @select="handleTileClick"
            />
          </template>
          <template v-else>
            <v-card
              v-for="category in categoryTiles"
              :key="category.id"
              variant="outlined"
              class="pos-row-item pos-category pa-2 d-flex flex-column align-center justify-center"
              role="button"
              tabindex="0"
              :aria-label="`Abrir categoría ${category.name}`"
              @click="openCategoryId = category.id"
              @keydown.enter.prevent="openCategoryId = category.id"
              @keydown.space.prevent="openCategoryId = category.id"
            >
              <v-icon :icon="category.icon" size="32" color="primary" />
              <div class="pos-category-name text-body-2 font-weight-medium mt-1">
                {{ category.name }}
              </div>
            </v-card>
            <p
              v-if="!loading && categoryTiles.length === 0"
              class="text-body-2 text-medium-emphasis align-self-center mb-0"
            >
              No hay productos con existencia.
            </p>
          </template>
        </div>
        <v-btn
          v-if="openCategory && !isSearching"
          variant="tonal"
          prepend-icon="mdi-arrow-left"
          @click="openCategoryId = null"
        >
          Volver
        </v-btn>
      </div>

      <!-- Fila de abajo: últimos productos vendidos, los que quepan en el ancho. -->
      <div class="text-caption text-medium-emphasis mt-3 mb-1">Últimos vendidos</div>
      <div ref="recentRow" class="pos-recent">
        <PosProductTile
          v-for="product in recentProducts"
          :key="product.id"
          class="pos-row-item"
          :product="product"
          :in-ticket="quantityInTicket.get(product.id) ?? 0"
          @select="handleTileClick"
        />
        <p
          v-if="!loading && recentProducts.length === 0"
          class="text-body-2 text-medium-emphasis mb-0"
        >
          Aún no hay ventas recientes.
        </p>
      </div>

      <!-- Ticket en curso. -->
      <div class="pos-lines mt-4">
        <v-table density="comfortable" fixed-header height="100%">
          <thead>
            <tr>
              <th>Descripción</th>
              <th class="text-right col-price">Precio unitario</th>
              <th class="text-center col-qty">Cantidad</th>
              <th class="text-right col-amount">Importe</th>
              <th class="col-actions" />
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="item in cart.productItems"
              :key="item.productId"
              :class="{ 'pos-row-flash': item.productId === lastAddedId }"
            >
              <td class="pos-description" :title="item.description">
                {{ item.description }}
              </td>
              <td class="text-right">{{ formatMXN(item.unitPriceCents) }}</td>
              <td class="text-center">
                <div class="d-flex align-center justify-center ga-1">
                  <v-btn
                    icon="mdi-minus"
                    size="x-small"
                    variant="tonal"
                    aria-label="Quitar una pieza"
                    :disabled="item.quantity <= 1"
                    @click="stepQuantity(item.productId, item.quantity, -1)"
                  />
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
                  <v-btn
                    icon="mdi-plus"
                    size="x-small"
                    variant="tonal"
                    aria-label="Agregar una pieza"
                    @click="stepQuantity(item.productId, item.quantity, 1)"
                  />
                </div>
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
                  Escanea un código, escribe un nombre o toca un producto de arriba.
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
          Cobrar (F9)
        </v-btn>
      </div>
    </v-card>

    <!-- Avisos de captura: toast de 3 segundos (no hay existencia, código no encontrado…). -->
    <v-snackbar
      :key="entryToastKey"
      v-model="showEntryToast"
      :timeout="3000"
      color="error"
      location="top"
    >
      {{ entryMessage }}
    </v-snackbar>

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
        <v-alert
          v-if="invoiceWarning"
          type="warning"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          {{ invoiceWarning }}
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

          <!-- Con el monto cubierto ya no tiene sentido registrar otro pago. -->
          <div v-if="!cart.isCovered" class="d-flex align-end ga-2 mb-2">
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
            v-if="!cart.isCovered && newPaymentMethod === 'card'"
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

          <PaymentSummary />

          <v-checkbox
            v-model="requiresInvoice"
            label="Requiere factura"
            density="compact"
            hide-details
          />
          <div v-if="requiresInvoice" class="mb-3">
            <v-radio-group v-model="invoiceMode" inline density="compact" hide-details>
              <template #label>¿Ya es cliente registrado?</template>
              <v-radio label="No, es nuevo" value="new" />
              <v-radio label="Sí" value="registered" />
            </v-radio-group>

            <!-- Cliente registrado: selector de la lista. -->
            <template v-if="invoiceMode === 'registered'">
              <v-autocomplete
                v-model="invoiceCustomer"
                :items="customers"
                :item-title="(c: Customer) => `${c.first_name} ${c.last_name}`"
                return-object
                label="Cliente"
                density="compact"
                hide-details
                class="mt-2"
                no-data-text="Sin resultados"
                :loading="!customersLoaded && !customersError"
              />
              <p v-if="customersError" class="text-caption text-error mt-1 mb-0">
                {{ customersError }}
              </p>
              <v-alert
                v-if="invoiceCustomer && invoiceProblems.length > 0"
                type="warning"
                density="compact"
                variant="tonal"
                class="mt-2"
              >
                A este cliente le faltan datos para facturarle.
                {{ invoiceProblems.join(' ') }}
                <template #append>
                  <v-btn size="small" variant="flat" @click="showCustomerForm = true">
                    Completar datos
                  </v-btn>
                </template>
              </v-alert>
            </template>

            <!-- Cliente nuevo: se capturan sus datos y se le da de alta. -->
            <template v-else>
              <v-btn
                variant="tonal"
                size="small"
                prepend-icon="mdi-account-plus-outline"
                class="mt-2"
                :disabled="!!invoiceCustomer"
                @click="showCustomerForm = true"
              >
                {{ invoiceCustomer ? 'Datos capturados' : 'Capturar datos del cliente' }}
              </v-btn>
              <p
                v-if="!invoiceCustomer"
                class="text-caption text-medium-emphasis mt-1 mb-0"
              >
                Se le dará de alta como cliente y la venta quedará ligada a él.
              </p>
            </template>

            <v-alert
              v-if="invoiceReady && invoiceCustomer"
              type="success"
              density="compact"
              variant="tonal"
              class="mt-2"
            >
              Se facturará a {{ invoiceCustomer.legal_name }} ({{ invoiceCustomer.rfc }}).
            </v-alert>
          </div>

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
            :disabled="!cart.isFullyPaid || (requiresInvoice && !invoiceReady)"
            @click="handleCharge"
          >
            Cobrar {{ formatMXN(cart.totalCents) }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <CustomerFormDialog
      v-model="showCustomerForm"
      :tenant-id="session.activeTenantId ?? ''"
      :customer="invoiceMode === 'registered' ? invoiceCustomer : null"
      invoice-required
      @saved="handleCustomerSaved"
    />
  </v-container>
</template>

<style scoped lang="scss">
// Columnas de la tabla del ticket con ancho fijo: solo "Descripción" ocupa el resto, y un
// nombre largo se corta con "…" en vez de empujar las demás columnas.
.pos-lines :deep(table) {
  table-layout: fixed;
  width: 100%;
}

.col-price,
.col-amount {
  width: 160px;
}

.col-qty {
  width: 190px;
}

.col-actions {
  width: 64px;
}

.pos-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

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
  min-width: 260px;
  max-width: 420px;
}

// Fila de arriba: UNA sola fila con scroll horizontal (categorías o productos).
.pos-row {
  display: flex;
  flex: 1 1 0;
  min-width: 0;
  gap: 8px;
  overflow-x: auto;
  padding-bottom: 6px;
}

// Fila de abajo: una sola fila SIN scroll; la página calcula cuántas tarjetas caben.
.pos-recent {
  display: flex;
  gap: 8px;
  overflow: hidden;
}

// Mismo ancho y alto para categorías y productos, así las dos filas se alinean.
.pos-row-item {
  flex: 0 0 170px;
  width: 170px;
  height: 92px;
}

.pos-category {
  cursor: pointer;
  text-align: center;
  transition: background-color 0.15s;

  &:hover,
  &:focus-visible {
    background-color: rgba(var(--v-theme-primary), 0.08);
  }
}

.pos-category--open {
  cursor: default;
}

.pos-category-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

// Fila recién agregada: confirma que la captura entró.
.pos-row-flash td {
  background-color: rgba(var(--v-theme-primary), 0.14);
}

.pos-qty {
  width: 72px;
  margin: 0 auto;
}
</style>
