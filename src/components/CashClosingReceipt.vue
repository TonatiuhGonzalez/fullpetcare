<script setup lang="ts">
// Comprobante de un corte de caja, imprimible (tarea 12.11). Componente "tonto"
// (CLAUDE.md §4): recibe el corte ya cerrado y su resumen, y no habla con nada.
// Mismo estilo que TicketView: la clase `ticket-print` y `window.print()`.
import { computed } from 'vue'

import { cashDifference, describeDifference } from '@/lib/cashCount'
import { formatDate, formatTime } from '@/lib/datetime'
import { formatMXN } from '@/lib/money'
import type { CashOverview, CashSession } from '@/services/cashRegister'

const props = defineProps<{
  session: CashSession
  /** Lo cobrado en el turno (null si no se pudo leer): el comprobante sale igual. */
  overview: CashOverview | null
  branchName: string
  timezone: string
  names: Record<string, string>
}>()

const difference = computed(() =>
  cashDifference(props.session.counted_cents ?? 0, props.session.expected_cents ?? 0),
)
const differenceText = computed(() => describeDifference(difference.value, formatMXN))
const differenceColor = computed(() =>
  difference.value.kind === 'exact'
    ? 'success'
    : difference.value.kind === 'surplus'
      ? 'info'
      : 'error',
)

function stamp(instant: string): string {
  return `${formatDate(instant, props.timezone)} ${formatTime(instant, props.timezone)}`
}

function print(): void {
  window.print()
}

const nameOf = (id: string | null) => (id ? (props.names[id] ?? 'Sin nombre') : '—')
</script>

<template>
  <div>
    <div class="ticket-print pa-4">
      <div class="text-center mb-3">
        <h2 class="text-h6">{{ branchName }}</h2>
        <p class="text-body-2 text-medium-emphasis">Corte de caja</p>
      </div>

      <p>
        <strong>Abrió:</strong> {{ nameOf(session.opened_by) }} ·
        {{ stamp(session.opened_at) }}
      </p>
      <p v-if="session.closed_at">
        <strong>Cerró:</strong> {{ nameOf(session.closed_by) }} ·
        {{ stamp(session.closed_at) }}
      </p>

      <v-divider class="my-2" />

      <div class="d-flex justify-space-between">
        <span>Fondo inicial</span
        ><span>{{ formatMXN(session.opening_float_cents) }}</span>
      </div>
      <template v-if="overview">
        <div class="d-flex justify-space-between">
          <span>Efectivo cobrado (sin cambio)</span
          ><span>{{ formatMXN(overview.cashCents) }}</span>
        </div>
        <div v-if="overview.incomeCents" class="d-flex justify-space-between">
          <span>Ingresos</span><span>+ {{ formatMXN(overview.incomeCents) }}</span>
        </div>
        <div v-if="overview.outflowCents" class="d-flex justify-space-between">
          <span>Retiros y gastos</span
          ><span>− {{ formatMXN(overview.outflowCents) }}</span>
        </div>
      </template>

      <v-divider class="my-2" />

      <div class="d-flex justify-space-between">
        <span>Efectivo esperado</span
        ><span>{{ formatMXN(session.expected_cents ?? 0) }}</span>
      </div>
      <div class="d-flex justify-space-between">
        <span>Efectivo contado</span
        ><span>{{ formatMXN(session.counted_cents ?? 0) }}</span>
      </div>
      <div class="d-flex justify-space-between font-weight-bold mt-1">
        <span>Diferencia</span>
        <span>{{ formatMXN(difference.differenceCents) }}</span>
      </div>
      <p class="mt-1">{{ differenceText }}</p>

      <template v-if="overview">
        <v-divider class="my-2" />
        <p class="text-caption text-medium-emphasis mb-1">
          Otros cobros del turno (no entran al efectivo)
        </p>
        <div class="d-flex justify-space-between">
          <span>Tarjeta</span><span>{{ formatMXN(overview.cardCents) }}</span>
        </div>
        <div class="d-flex justify-space-between">
          <span>Transferencia</span><span>{{ formatMXN(overview.transferCents) }}</span>
        </div>
        <div v-if="overview.openpayCents" class="d-flex justify-space-between">
          <span>Openpay</span><span>{{ formatMXN(overview.openpayCents) }}</span>
        </div>
      </template>

      <template v-if="session.opening_note || session.closing_note">
        <v-divider class="my-2" />
        <p v-if="session.opening_note">
          <strong>Nota de apertura:</strong> {{ session.opening_note }}
        </p>
        <p v-if="session.closing_note">
          <strong>Nota de cierre:</strong> {{ session.closing_note }}
        </p>
      </template>
    </div>

    <div class="d-flex align-center ga-2 mt-2 no-print">
      <v-chip :color="differenceColor" variant="tonal">{{ differenceText }}</v-chip>
      <v-spacer />
      <v-btn variant="tonal" prepend-icon="mdi-printer" @click="print">Imprimir</v-btn>
    </div>
  </div>
</template>
