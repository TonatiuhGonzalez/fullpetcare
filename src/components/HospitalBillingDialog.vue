<script setup lang="ts">
// Cobro de una estancia ya dada de alta (fase 33, PLAN.md D30 punto 10): muestra el desglose
// (la estancia y los medicamentos cobrables), el descuento y los pagos. El importe lo decide la
// base (`bill_hospital_stay`); aquí se calcula igual solo para mostrarlo y armar el cambio.
import { computed, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { checkoutErrorMessage } from '@/lib/checkoutErrors'
import { applyDiscount, formatMXN, pesosToCents } from '@/lib/money'
import { paymentChange } from '@/lib/paymentChange'
import * as hospitalService from '@/services/hospitalization'

const props = defineProps<{
  modelValue: boolean
  stayId: string
  /** Lo que se cobra por la estancia (días × tarifa o monto único), con IVA incluido. */
  stayLabel: string
  stayAmountCents: number
  /** Medicamentos cobrables sin cobrar: nombre y su importe. */
  medications: Array<{ label: string; amountCents: number }>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  billed: [saleId: string]
}>()

interface PaymentRow {
  method: 'cash' | 'card' | 'transfer_spei' | 'openpay'
  amountCents: number
  paymentFormCode?: '04' | '28'
}

const methodLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer_spei: 'Transferencia',
  openpay: 'Openpay',
}

const discountInPesos = ref<number | null>(null)
const payments = ref<PaymentRow[]>([])
const method = ref<PaymentRow['method']>('cash')
const amountInPesos = ref<number | null>(null)
const cardType = ref<'04' | '28' | null>(null)
const charging = ref(false)
const errorMessage = ref<string | null>(null)

const grossCents = computed(
  () => props.stayAmountCents + props.medications.reduce((s, m) => s + m.amountCents, 0),
)
const discountCents = computed(() =>
  discountInPesos.value != null ? Math.max(0, pesosToCents(discountInPesos.value)) : 0,
)
const totalCents = computed(() => applyDiscount(grossCents.value, discountCents.value))
const paidCents = computed(() => payments.value.reduce((s, p) => s + p.amountCents, 0))
const remainingCents = computed(() => Math.max(0, totalCents.value - paidCents.value))
const change = computed(() => paymentChange(totalCents.value, payments.value))
const canCharge = computed(
  () => paidCents.value >= totalCents.value && change.value.unpayableExcessCents === 0,
)
const cardTypeMissing = computed(() => method.value === 'card' && !cardType.value)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    discountInPesos.value = null
    payments.value = []
    amountInPesos.value = null
    cardType.value = null
    method.value = 'cash'
    errorMessage.value = null
  },
)

function addPayment(): void {
  if (amountInPesos.value == null || amountInPesos.value <= 0) {
    errorMessage.value = 'Captura el monto del pago.'
    return
  }
  if (cardTypeMissing.value) return
  errorMessage.value = null
  payments.value.push({
    method: method.value,
    amountCents: pesosToCents(amountInPesos.value),
    ...(method.value === 'card' ? { paymentFormCode: cardType.value! } : {}),
  })
  amountInPesos.value = null
  cardType.value = null
}

function close(): void {
  emit('update:modelValue', false)
}

async function charge(): Promise<void> {
  charging.value = true
  errorMessage.value = null
  try {
    const saleId = await hospitalService.bill(
      props.stayId,
      payments.value,
      discountCents.value,
    )
    emit('billed', saleId)
    close()
  } catch (error) {
    errorMessage.value = checkoutErrorMessage(error)
  } finally {
    charging.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    scrollable
    :persistent="charging"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Cobrar {{ formatMXN(totalCents) }}</v-card-title>
      <v-card-text>
        <div class="d-flex justify-space-between text-body-2 mb-1">
          <span>{{ stayLabel }}</span>
          <span>{{ formatMXN(stayAmountCents) }}</span>
        </div>
        <div
          v-for="(med, index) in medications"
          :key="index"
          class="d-flex justify-space-between text-body-2 mb-1"
        >
          <span>{{ med.label }}</span>
          <span>{{ formatMXN(med.amountCents) }}</span>
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
          class="my-3"
        />

        <v-list v-if="payments.length > 0" density="compact" class="mb-2">
          <v-list-item v-for="(payment, index) in payments" :key="index">
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
                @click="payments.splice(index, 1)"
              />
            </template>
          </v-list-item>
        </v-list>

        <div v-if="remainingCents > 0" class="d-flex align-end ga-2 mb-2">
          <v-select
            v-model="method"
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
            v-model.number="amountInPesos"
            label="Monto (MXN)*"
            type="number"
            min="0"
            step="0.01"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-btn variant="text" size="small" @click="amountInPesos = remainingCents / 100"
            >Todo</v-btn
          >
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
          v-if="remainingCents > 0 && method === 'card'"
          v-model="cardType"
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

        <p class="text-body-2 mb-1">
          Pagado: {{ formatMXN(paidCents) }} · Falta: {{ formatMXN(remainingCents) }}
        </p>
        <v-alert
          v-if="change.changeCents > 0"
          type="success"
          density="compact"
          variant="tonal"
        >
          Cambio a devolver: {{ formatMXN(change.changeCents) }}
        </v-alert>
        <v-alert
          v-if="change.unpayableExcessCents > 0"
          type="error"
          density="compact"
          variant="tonal"
          class="mt-2"
        >
          Se pagó de más {{ formatMXN(change.unpayableExcessCents) }} que no es efectivo y
          no se puede devolver. Baja ese pago o quítalo.
        </v-alert>
        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mt-3"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="charging" variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="charging" :disabled="!canCharge" @click="charge">
          Cobrar {{ formatMXN(totalCents) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
