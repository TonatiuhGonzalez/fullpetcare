<script setup lang="ts">
// Cobro rápido (fase 30, PLAN.md D30 punto 6): cobrar un servicio y/o productos al paso, sin
// cita y sin registrar al cliente. Pensado para "cosas sencillas" que tardan menos que dar de
// alta a la persona. Lleva quién atendió y el grupo de especie (perro, gato, ave, reptil), solo
// como dato de estadística. El cobro lo hace `checkout_quick_sale()` en la base; la pantalla
// solo arma el ticket. Si el cliente pide factura, se hace desde el punto de venta (donde sí
// se captura al cliente).
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import PaymentSummary from '@/components/PaymentSummary.vue'
import TicketView from '@/components/TicketView.vue'
import { checkoutErrorMessage } from '@/lib/checkoutErrors'
import { formatStock, isFractional, type SaleUnit } from '@/lib/fractional'
import { formatMXN, pesosToCents } from '@/lib/money'
import type { CardFormCode, SellableProduct, Ticket } from '@/services/checkout'
import * as membershipsService from '@/services/memberships'
import type { EmployeeSummary } from '@/services/memberships'
import * as servicesService from '@/services/services'
import type { Service } from '@/services/services'
import { useCartStore } from '@/stores/cart'
import { useSessionStore } from '@/stores/session'
import { useSpeciesCatalogStore } from '@/stores/speciesCatalog'

const session = useSessionStore()
const cart = useCartStore()
const speciesCatalog = useSpeciesCatalogStore()

const loading = ref(false)
const loadError = ref<string | null>(null)
const services = ref<Service[]>([])
const employees = ref<EmployeeSummary[]>([])

const serviceToAdd = ref<Service | null>(null)
const serviceQuantity = ref(1)
const productToAdd = ref<SellableProduct | null>(null)
const productQuantity = ref(1)
const productUnit = ref<SaleUnit>('package')
const lineError = ref<string | null>(null)

const methodLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer_spei: 'Transferencia',
  openpay: 'Openpay',
}

async function start(): Promise<void> {
  const tenantId = session.activeTenantId
  const branchId = session.activeBranchId
  if (!tenantId || !branchId) return
  loading.value = true
  loadError.value = null
  cart.loadQuickSale(branchId)
  try {
    const [grooming, veterinary, catalogLoad, people] = await Promise.all([
      servicesService.listByKind(tenantId, 'grooming'),
      servicesService.listByKind(tenantId, 'veterinary'),
      cart.loadCatalog(tenantId, branchId),
      membershipsService.listBranchEmployees(tenantId, branchId),
      speciesCatalog.load(tenantId),
    ])
    void catalogLoad
    services.value = [...grooming, ...veterinary].filter((s) => s.is_active)
    employees.value = people
  } catch {
    loadError.value = 'No se pudo cargar el catálogo. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(start)
// Al cambiar de sucursal el catálogo y la existencia son otros.
watch(() => session.activeBranchId, start)
onBeforeUnmount(() => cart.reset())

const hasLines = computed(
  () => cart.quickServices.length > 0 || cart.productItems.length > 0,
)

function addService(): void {
  lineError.value = null
  if (!serviceToAdd.value) return
  if (!Number.isInteger(serviceQuantity.value) || serviceQuantity.value < 1) {
    lineError.value = 'La cantidad debe ser un entero mayor a 0.'
    return
  }
  cart.addService(serviceToAdd.value, serviceQuantity.value)
  serviceToAdd.value = null
  serviceQuantity.value = 1
}

function addProduct(): void {
  lineError.value = null
  if (!productToAdd.value) return
  const unit = isFractional(productToAdd.value) ? productUnit.value : 'package'
  if (!cart.addProduct(productToAdd.value, productQuantity.value, unit)) {
    lineError.value = `Solo hay ${formatStock(productToAdd.value.stock, productToAdd.value)} de "${productToAdd.value.name}".`
    return
  }
  productToAdd.value = null
  productQuantity.value = 1
  productUnit.value = 'package'
}

function setServiceQuantity(serviceId: string, value: string | number): void {
  lineError.value = null
  if (!cart.setServiceQuantity(serviceId, Number(value))) {
    lineError.value = 'La cantidad debe ser un entero mayor a 0.'
  }
}

function setProductQuantity(key: string, value: string | number): void {
  lineError.value = null
  if (!cart.setProductQuantity(key, Number(value))) {
    lineError.value = 'La cantidad debe ser un entero y no puede pasar de la existencia.'
  }
}

// --- Pago ---------------------------------------------------------------------------
const discountInPesos = ref<number | null>(null)
const newPaymentMethod = ref<'cash' | 'card' | 'transfer_spei' | 'openpay'>('cash')
const newPaymentAmountInPesos = ref<number | null>(null)
const newCardType = ref<CardFormCode | null>(null)
const cardTypeMissing = computed(
  () => newPaymentMethod.value === 'card' && !newCardType.value,
)
const charging = ref(false)
const chargeError = ref<string | null>(null)
const ticket = ref<Ticket | null>(null)

function applyDiscount(): void {
  cart.setDiscount(
    discountInPesos.value != null ? pesosToCents(discountInPesos.value) : 0,
  )
}

function fillRemaining(): void {
  newPaymentAmountInPesos.value = cart.remainingCents / 100
}

function addPayment(): void {
  if (newPaymentAmountInPesos.value == null || newPaymentAmountInPesos.value <= 0) {
    chargeError.value = 'Captura el monto del pago.'
    return
  }
  chargeError.value = null
  if (cardTypeMissing.value) return
  cart.addPayment({
    method: newPaymentMethod.value,
    amountCents: pesosToCents(newPaymentAmountInPesos.value),
    ...(newPaymentMethod.value === 'card' ? { paymentFormCode: newCardType.value! } : {}),
  })
  newPaymentAmountInPesos.value = null
  newCardType.value = null
}

async function charge(): Promise<void> {
  charging.value = true
  chargeError.value = null
  try {
    ticket.value = await cart.checkout()
  } catch (error) {
    chargeError.value = checkoutErrorMessage(error)
  } finally {
    charging.value = false
  }
}

function newSale(): void {
  ticket.value = null
  discountInPesos.value = null
  newPaymentAmountInPesos.value = null
  chargeError.value = null
  lineError.value = null
  void start()
}

const groupItems = computed(() =>
  speciesCatalog.groups.map((g) => ({ title: g.name, value: g.id })),
)
const employeeItems = computed(() =>
  employees.value.map((e) => ({ title: e.fullName, value: e.userId })),
)
</script>

<template>
  <v-container class="py-6">
    <PageHeader
      title="Cobro rápido"
      subtitle="Cobra un servicio o productos al paso, sin cita y sin registrar al cliente."
    />

    <v-alert v-if="loadError" type="error" density="compact" variant="tonal" class="mb-4">
      {{ loadError }}
    </v-alert>

    <v-row>
      <!-- Qué se cobra. -->
      <v-col cols="12" md="7">
        <v-card variant="outlined" class="pa-4">
          <h2 class="text-subtitle-1 font-weight-bold mb-3">¿Qué se cobra?</h2>

          <div class="d-flex align-end ga-2 mb-3">
            <v-autocomplete
              v-model="serviceToAdd"
              :items="services"
              item-title="name"
              return-object
              label="Servicio"
              variant="outlined"
              density="compact"
              hide-details
              :loading="loading"
              no-data-text="No hay servicios activos"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item
                  v-bind="itemProps"
                  :subtitle="formatMXN(item.raw.price_cents)"
                />
              </template>
            </v-autocomplete>
            <v-text-field
              v-model.number="serviceQuantity"
              label="Cant."
              type="number"
              min="1"
              step="1"
              variant="outlined"
              density="compact"
              hide-details
              style="max-width: 90px"
            />
            <IconButton
              icon="mdi-plus"
              color="primary"
              variant="tonal"
              :disabled="!serviceToAdd"
              aria-label="Agregar servicio"
              @click="addService"
            />
          </div>

          <div class="d-flex align-end ga-2 mb-3">
            <v-autocomplete
              v-model="productToAdd"
              :items="cart.catalog"
              item-title="name"
              return-object
              label="Producto"
              variant="outlined"
              density="compact"
              hide-details
              :loading="loading"
              no-data-text="No hay productos con existencia"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item
                  v-bind="itemProps"
                  :subtitle="`${formatMXN(item.raw.priceCents)} · hay ${formatStock(item.raw.stock, item.raw)}`"
                />
              </template>
            </v-autocomplete>
            <v-btn-toggle
              v-if="productToAdd && isFractional(productToAdd)"
              v-model="productUnit"
              mandatory
              density="compact"
              color="primary"
              variant="outlined"
              divided
            >
              <v-btn value="package" size="small">{{
                productToAdd.packageName ?? 'Envase'
              }}</v-btn>
              <v-btn value="unit" size="small">{{
                productToAdd.unitName ?? 'Unidad'
              }}</v-btn>
            </v-btn-toggle>
            <v-text-field
              v-model.number="productQuantity"
              label="Cant."
              type="number"
              min="1"
              step="1"
              variant="outlined"
              density="compact"
              hide-details
              style="max-width: 90px"
            />
            <IconButton
              icon="mdi-plus"
              color="primary"
              variant="tonal"
              :disabled="!productToAdd"
              aria-label="Agregar producto"
              @click="addProduct"
            />
          </div>

          <v-alert
            v-if="lineError"
            type="warning"
            density="compact"
            variant="tonal"
            class="mb-3"
          >
            {{ lineError }}
          </v-alert>

          <v-list v-if="hasLines" density="compact" class="border rounded">
            <v-list-item v-for="item in cart.quickServices" :key="`s-${item.serviceId}`">
              <template #title>{{ item.description }}</template>
              <template #subtitle
                >{{ formatMXN(item.unitPriceCents) }} c/u · servicio</template
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
                  @update:model-value="setServiceQuantity(item.serviceId, $event)"
                />
                <span class="mr-2">{{
                  formatMXN(item.unitPriceCents * item.quantity)
                }}</span>
                <IconButton
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  aria-label="Quitar servicio"
                  @click="cart.removeService(item.serviceId)"
                />
              </template>
            </v-list-item>
            <v-list-item v-for="item in cart.productItems" :key="item.key">
              <template #title>{{ item.description }}</template>
              <template #subtitle
                >{{ formatMXN(item.unitPriceCents) }} c/u · producto</template
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
                  @update:model-value="setProductQuantity(item.key, $event)"
                />
                <span class="mr-2">{{
                  formatMXN(item.unitPriceCents * item.quantity)
                }}</span>
                <IconButton
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  aria-label="Quitar producto"
                  @click="cart.removeProduct(item.key)"
                />
              </template>
            </v-list-item>
          </v-list>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">
            Agrega un servicio o un producto para empezar.
          </p>
        </v-card>
      </v-col>

      <!-- Quién atendió, especie y pago. -->
      <v-col cols="12" md="5">
        <v-card variant="outlined" class="pa-4">
          <h2 class="text-subtitle-1 font-weight-bold mb-3">Cobro</h2>

          <v-select
            v-model="cart.quickAttendedBy"
            :items="employeeItems"
            label="¿Quién atendió?"
            variant="outlined"
            density="compact"
            clearable
            hint="Para el reporte por empleado. Si no se indica, cuenta para quien cobra."
            persistent-hint
            class="mb-3"
          />
          <v-select
            v-model="cart.quickSpeciesGroupId"
            :items="groupItems"
            label="Especie de la mascota"
            variant="outlined"
            density="compact"
            clearable
            hint="Solo para estadística."
            persistent-hint
            class="mb-3"
          />

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
            variant="outlined"
            density="compact"
            hide-details
            class="mb-2"
            @update:model-value="applyDiscount"
          />
          <div class="d-flex justify-space-between text-h6 font-weight-bold mb-3">
            <span>Total</span>
            <span>{{ formatMXN(cart.totalCents) }}</span>
          </div>

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
                <IconButton
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  aria-label="Quitar pago"
                  @click="cart.removePayment(index)"
                />
              </template>
            </v-list-item>
          </v-list>

          <div v-if="!cart.isCovered" class="d-flex align-end ga-2 mb-2">
            <v-select
              v-model="newPaymentMethod"
              :items="[
                { title: 'Efectivo', value: 'cash' },
                { title: 'Tarjeta', value: 'card' },
                { title: 'Transferencia', value: 'transfer_spei' },
                { title: 'Openpay', value: 'openpay' },
              ]"
              label="Método*"
              variant="outlined"
              density="compact"
              hide-details
            />
            <v-text-field
              v-model.number="newPaymentAmountInPesos"
              label="Monto (MXN)*"
              type="number"
              min="0"
              step="0.01"
              variant="outlined"
              density="compact"
              hide-details
            />
            <v-btn variant="text" size="small" @click="fillRemaining">Todo</v-btn>
            <IconButton
              icon="mdi-plus"
              color="primary"
              variant="tonal"
              :disabled="cardTypeMissing"
              aria-label="Agregar pago"
              @click="addPayment"
            />
          </div>
          <v-select
            v-if="!cart.isCovered && newPaymentMethod === 'card'"
            v-model="newCardType"
            :items="[
              { title: 'Tarjeta de crédito', value: '04' },
              { title: 'Tarjeta de débito', value: '28' },
            ]"
            label="Tipo de tarjeta*"
            variant="outlined"
            density="compact"
            hide-details
            class="mb-2"
          />

          <PaymentSummary />

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
            :disabled="!hasLines || !cart.isFullyPaid"
            @click="charge"
          >
            Cobrar {{ formatMXN(cart.totalCents) }}
          </v-btn>
        </v-card>
      </v-col>
    </v-row>

    <!-- Ticket: se imprime desde el navegador (TicketView). -->
    <v-dialog :model-value="!!ticket" max-width="480" persistent scrollable>
      <v-card v-if="ticket" class="pa-4">
        <v-alert type="success" density="compact" variant="tonal" class="mb-4">
          Cobro registrado.
        </v-alert>
        <TicketView :ticket="ticket" />
        <v-btn block color="primary" class="mt-4 no-print" @click="newSale"
          >Nuevo cobro</v-btn
        >
      </v-card>
    </v-dialog>
  </v-container>
</template>
