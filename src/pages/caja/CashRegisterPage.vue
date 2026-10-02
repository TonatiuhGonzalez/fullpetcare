<script setup lang="ts">
// Pantalla de Caja (fase 12, tarea 12.11 / HMH Four #2077): abrir la caja de la
// sucursal activa con un fondo, ver lo cobrado en el turno, registrar retiros y
// gastos, cerrar contando el efectivo y consultar los cortes anteriores. La ve
// quien tenga "cash_register:view" (router y menú); abrir, cerrar y registrar
// pide "cash_register:edit". Los permisos reales los aplica la base; esto solo
// evita mostrar botones que fallarían.
import { computed, onMounted, ref, watch } from 'vue'

import CashClosingReceipt from '@/components/CashClosingReceipt.vue'
import CashCloseDialog from '@/components/CashCloseDialog.vue'
import CashMovementDialog from '@/components/CashMovementDialog.vue'
import { MOVEMENT_LABELS, type CashMovementKind } from '@/lib/cashRegister'
import { cashDifference, describeDifference } from '@/lib/cashCount'
import { formatDate, formatTime } from '@/lib/datetime'
import { formatMXN } from '@/lib/money'
import type { CashOverview, CashSession } from '@/services/cashRegister'
import { useCashRegisterStore } from '@/stores/cashRegister'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const cashRegister = useCashRegisterStore()

const canEdit = computed(() => session.canEdit('cash_register'))
const branchName = computed(() => session.activeBranch?.name ?? '')
const timezone = computed(() => session.activeBranch?.timezone ?? 'America/Mexico_City')

const floatText = ref('')
const openNote = ref('')
const opening = ref(false)
const openError = ref<string | null>(null)

const showMovement = ref(false)
const showClose = ref(false)
const snackbar = ref({ show: false, text: '' })

const detail = ref<{ session: CashSession; overview: CashOverview | null } | null>(null)
const showDetail = ref(false)

onMounted(() => cashRegister.load())
// La caja es por sucursal: al cambiar de sucursal en la barra, se recarga.
watch(
  () => session.activeBranchId,
  () => cashRegister.load(),
)

const stamp = (instant: string) =>
  `${formatDate(instant, timezone.value)} ${formatTime(instant, timezone.value)}`
const nameOf = (id: string | null) =>
  id ? (cashRegister.names[id] ?? 'Sin nombre') : '—'

async function handleOpen(): Promise<void> {
  opening.value = true
  openError.value = null
  const error = await cashRegister.open(floatText.value, openNote.value)
  opening.value = false
  if (error) {
    openError.value = error
    return
  }
  floatText.value = ''
  openNote.value = ''
  snackbar.value = { show: true, text: 'Caja abierta.' }
}

function movementSign(type: CashMovementKind): string {
  return MOVEMENT_LABELS[type].sign
}

async function openDetail(closed: CashSession): Promise<void> {
  detail.value = {
    session: closed,
    overview: await cashRegister.fetchOverview(closed.id),
  }
  showDetail.value = true
}

function differenceLabel(closed: CashSession): { text: string; color: string } {
  const diff = cashDifference(closed.counted_cents ?? 0, closed.expected_cents ?? 0)
  return {
    text: describeDifference(diff, formatMXN),
    color: diff.kind === 'exact' ? 'success' : diff.kind === 'surplus' ? 'info' : 'error',
  }
}

const methodRows = computed(() => {
  const o = cashRegister.overview
  if (!o) return []
  return [
    { label: 'Efectivo (sin el cambio entregado)', cents: o.cashCents },
    { label: 'Tarjeta', cents: o.cardCents },
    { label: 'Transferencia', cents: o.transferCents },
    ...(o.openpayCents ? [{ label: 'Openpay', cents: o.openpayCents }] : []),
  ]
})
</script>

<template>
  <v-container class="py-4" style="max-width: 860px">
    <div class="d-flex align-center mb-4">
      <div>
        <h1 class="text-h5">Caja</h1>
        <p class="text-body-2 text-medium-emphasis">{{ branchName }}</p>
      </div>
    </div>

    <v-alert
      v-if="cashRegister.errorMessage"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      {{ cashRegister.errorMessage }}
    </v-alert>
    <v-progress-linear
      v-if="cashRegister.status === 'loading' && !cashRegister.openSession"
      indeterminate
      class="mb-4"
    />

    <!-- Sin sucursal elegida -->
    <v-alert v-if="!session.activeBranchId" type="info" variant="tonal" density="compact">
      Elige una sucursal en la barra de arriba para ver su caja.
    </v-alert>

    <!-- Caja cerrada: abrir -->
    <v-card
      v-else-if="cashRegister.status !== 'loading' && !cashRegister.openSession"
      variant="outlined"
      class="pa-4 mb-6"
    >
      <h2 class="text-h6 mb-1">La caja está cerrada</h2>
      <p class="text-body-2 text-medium-emphasis mb-4">
        El <strong>fondo</strong> es el efectivo con el que empieza el turno (por ejemplo,
        para dar cambio). Se cuenta aparte de lo que cobres. Puedes cobrar aunque no abras
        la caja, pero esas ventas no quedarán dentro de ningún corte.
      </p>
      <template v-if="canEdit">
        <v-alert
          v-if="openError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
          >{{ openError }}</v-alert
        >
        <v-row dense>
          <v-col cols="12" sm="4">
            <v-text-field
              v-model="floatText"
              label="Fondo inicial"
              prefix="$"
              inputmode="decimal"
              density="compact"
            />
          </v-col>
          <v-col cols="12" sm="8">
            <v-text-field v-model="openNote" label="Nota (opcional)" density="compact" />
          </v-col>
        </v-row>
        <v-btn color="primary" :loading="opening" @click="handleOpen">Abrir caja</v-btn>
      </template>
      <p v-else class="text-body-2">No tienes permiso para abrir la caja.</p>
    </v-card>

    <!-- Caja abierta -->
    <template v-else-if="cashRegister.openSession">
      <v-card variant="outlined" class="pa-4 mb-4">
        <div class="d-flex align-center flex-wrap ga-2 mb-3">
          <v-chip color="success" variant="tonal">Caja abierta</v-chip>
          <span class="text-body-2">
            Desde {{ stamp(cashRegister.openSession.opened_at) }} ·
            {{ nameOf(cashRegister.openSession.opened_by) }}
          </span>
          <v-spacer />
          <v-btn
            v-if="canEdit"
            variant="tonal"
            prepend-icon="mdi-cash-minus"
            @click="showMovement = true"
          >
            Registrar movimiento
          </v-btn>
          <v-btn
            v-if="canEdit"
            color="primary"
            prepend-icon="mdi-lock-outline"
            @click="showClose = true"
          >
            Cerrar caja
          </v-btn>
        </div>

        <div class="d-flex justify-space-between mb-1">
          <span>Fondo inicial</span>
          <strong>{{ formatMXN(cashRegister.openSession.opening_float_cents) }}</strong>
        </div>
        <v-divider class="my-2" />
        <p class="text-caption text-medium-emphasis mb-1">Cobrado en este turno</p>
        <div
          v-for="row in methodRows"
          :key="row.label"
          class="d-flex justify-space-between"
        >
          <span>{{ row.label }}</span>
          <span>{{ formatMXN(row.cents) }}</span>
        </div>
        <p
          v-if="cashRegister.overview?.changeGivenCents"
          class="text-caption text-medium-emphasis mt-1"
        >
          Ya se descontaron {{ formatMXN(cashRegister.overview.changeGivenCents) }} de
          cambio entregado.
        </p>
      </v-card>

      <v-card variant="outlined" class="pa-4 mb-6">
        <h2 class="text-subtitle-1 mb-2">Movimientos de efectivo</h2>
        <p
          v-if="cashRegister.movements.length === 0"
          class="text-body-2 text-medium-emphasis"
        >
          Aún no hay retiros, gastos ni ingresos en este turno.
        </p>
        <v-list v-else density="compact" class="pa-0">
          <v-list-item v-for="m in cashRegister.movements" :key="m.id">
            <v-list-item-title>
              {{ MOVEMENT_LABELS[m.movement_type].title }}: {{ m.reason }}
            </v-list-item-title>
            <v-list-item-subtitle
              >{{ stamp(m.created_at) }} ·
              {{ nameOf(m.created_by) }}</v-list-item-subtitle
            >
            <template #append>
              <strong
                >{{ movementSign(m.movement_type) }}
                {{ formatMXN(m.amount_cents) }}</strong
              >
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>

    <!-- Historial -->
    <template v-if="session.activeBranchId">
      <h2 class="text-h6 mb-2">Cortes anteriores</h2>
      <p
        v-if="cashRegister.history.length === 0 && cashRegister.status === 'ready'"
        class="text-body-2 text-medium-emphasis"
      >
        Todavía no hay cortes cerrados en esta sucursal.
      </p>
      <v-list v-else lines="two" class="border rounded">
        <v-list-item
          v-for="closed in cashRegister.history"
          :key="closed.id"
          @click="openDetail(closed)"
        >
          <v-list-item-title>
            {{ stamp(closed.closed_at ?? closed.opened_at) }} · cerró
            {{ nameOf(closed.closed_by) }}
          </v-list-item-title>
          <v-list-item-subtitle>
            Esperado {{ formatMXN(closed.expected_cents ?? 0) }} · contado
            {{ formatMXN(closed.counted_cents ?? 0) }}
          </v-list-item-subtitle>
          <template #append>
            <v-chip size="small" variant="tonal" :color="differenceLabel(closed).color">
              {{ differenceLabel(closed).text }}
            </v-chip>
          </template>
        </v-list-item>
      </v-list>
    </template>

    <CashMovementDialog
      v-model="showMovement"
      @saved="snackbar = { show: true, text: 'Movimiento registrado.' }"
    />
    <CashCloseDialog v-model="showClose" :branch-name="branchName" :timezone="timezone" />

    <v-dialog v-model="showDetail" max-width="520">
      <v-card v-if="detail">
        <v-card-title>Corte de caja</v-card-title>
        <v-card-text>
          <CashClosingReceipt
            :session="detail.session"
            :overview="detail.overview"
            :branch-name="branchName"
            :timezone="timezone"
            :names="cashRegister.names"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showDetail = false">Cerrar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.show" color="success" timeout="3000">{{
      snackbar.text
    }}</v-snackbar>
  </v-container>
</template>
