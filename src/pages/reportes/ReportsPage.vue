<script setup lang="ts">
// Pantalla de Reportes (fase 12, tarea 12.12 / HMH Four #2078): ventas del periodo
// (por día, método de pago y sucursal), lo más vendido y la actividad por empleado,
// con descarga a CSV. La ve quien tenga "reports:view" (router y menú; por defecto
// solo el dueño). Todo se calcula en la base; aquí solo se dibuja. Las barras son
// de CSS (sin librería de gráficas, D11).
import { computed, onMounted, ref, watch } from 'vue'

import { formatMXN } from '@/lib/money'
import {
  PERIOD_LABELS,
  barPercents,
  centsToPesosText,
  formatDayLabel,
  toCsv,
  type CsvColumn,
  type PeriodPreset,
} from '@/lib/reports'
import type { BranchRow, DayRow, StaffRow, TopItem } from '@/services/reports'
import { useReportsStore } from '@/stores/reports'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const reports = useReportsStore()

const tab = ref<'summary' | 'items' | 'staff'>('summary')

const presetItems = (Object.keys(PERIOD_LABELS) as PeriodPreset[]).map((value) => ({
  value,
  title: PERIOD_LABELS[value],
}))
const branchItems = computed(() => [
  { value: null as string | null, title: 'Todas mis sucursales' },
  ...session.activeBranches.map((b) => ({ value: b.id as string | null, title: b.name })),
])

onMounted(() => reports.load())
// Otro negocio u otra sucursal activa: se parte de cero para no mostrar datos ajenos.
watch(
  () => session.activeTenantId,
  () => {
    reports.reset()
    reports.load()
  },
)

const summary = computed(() => reports.summary)
const averageTicket = computed(() => {
  const t = summary.value?.totals
  return t && t.salesCount > 0 ? Math.round(t.totalCents / t.salesCount) : 0
})

const dayBars = computed(() => {
  const days = summary.value?.byDay ?? []
  const widths = barPercents(days.map((d) => d.totalCents))
  return days.map((day, i) => ({ day, percent: widths[i] }))
})
const maxDayCents = computed(() =>
  Math.max(0, ...(summary.value?.byDay ?? []).map((d) => d.totalCents)),
)

const methodBars = computed(() => {
  const m = summary.value?.byMethod
  if (!m) return []
  const rows = [
    { label: 'Efectivo', cents: m.cashCents },
    { label: 'Tarjeta', cents: m.cardCents },
    { label: 'Transferencia', cents: m.transferCents },
    ...(m.openpayCents ? [{ label: 'Openpay', cents: m.openpayCents }] : []),
  ]
  const widths = barPercents(rows.map((r) => r.cents))
  return rows.map((r, i) => ({ ...r, percent: widths[i] }))
})

const rangeLabel = computed(() => {
  const { from, to } = reports.range
  if (!from || !to) return ''
  return from === to
    ? formatDayLabel(from, true)
    : `${formatDayLabel(from, true)} al ${formatDayLabel(to, true)}`
})

function dayTitle(day: DayRow): string {
  return `${formatDayLabel(day.day, true)}: ${formatMXN(day.totalCents)} · ${day.salesCount} venta(s)`
}

// --- CSV --------------------------------------------------------------------

function download(name: string, csv: string): void {
  const { from, to } = reports.range
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${name}_${from}_${to}.csv`
  link.click()
  URL.revokeObjectURL(url)
}

const money = (cents: number) => centsToPesosText(cents)

function exportDays(): void {
  const cols: CsvColumn<DayRow>[] = [
    { header: 'Fecha', value: (r) => r.day },
    { header: 'Ventas', value: (r) => r.salesCount },
    { header: 'Subtotal (antes de descuento)', value: (r) => money(r.subtotalCents) },
    { header: 'IVA (antes de descuento)', value: (r) => money(r.ivaCents) },
    { header: 'Descuento', value: (r) => money(r.discountCents) },
    { header: 'Total', value: (r) => money(r.totalCents) },
  ]
  download('ventas-por-dia', toCsv(summary.value?.byDay ?? [], cols))
}

function exportMethods(): void {
  const rows = methodBars.value
  download(
    'ventas-por-metodo-de-pago',
    toCsv(rows, [
      { header: 'Método de pago', value: (r) => r.label },
      { header: 'Cobrado (sin el cambio entregado)', value: (r) => money(r.cents) },
    ]),
  )
}

function exportBranches(): void {
  const cols: CsvColumn<BranchRow>[] = [
    { header: 'Sucursal', value: (r) => r.branchName },
    { header: 'Ventas', value: (r) => r.salesCount },
    { header: 'Descuento', value: (r) => money(r.discountCents) },
    { header: 'Total', value: (r) => money(r.totalCents) },
  ]
  download('ventas-por-sucursal', toCsv(summary.value?.byBranch ?? [], cols))
}

function exportItems(): void {
  type Row = TopItem & { type: string }
  const items = reports.topItems
  const rows: Row[] = [
    ...(items?.services ?? []).map((i) => ({ ...i, type: 'Servicio' })),
    ...(items?.products ?? []).map((i) => ({ ...i, type: 'Producto' })),
  ]
  download(
    'mas-vendido',
    toCsv<Row>(rows, [
      { header: 'Tipo', value: (r) => r.type },
      { header: 'Concepto', value: (r) => r.name },
      { header: 'Cantidad', value: (r) => r.quantity },
      {
        header: 'Importe (con IVA, antes de descuento)',
        value: (r) => money(r.revenueCents),
      },
      { header: 'IVA incluido', value: (r) => money(r.ivaCents) },
    ]),
  )
}

function exportStaff(): void {
  const cols: CsvColumn<StaffRow>[] = [
    { header: 'Empleado', value: (r) => r.fullName },
    { header: 'Citas completadas', value: (r) => r.appointmentsCompleted },
    { header: 'Servicios', value: (r) => money(r.servicesCents) },
    { header: 'Productos', value: (r) => money(r.productsCents) },
    { header: 'Total', value: (r) => money(r.totalCents) },
  ]
  download('actividad-por-empleado', toCsv(reports.staff, cols))
}
</script>

<template>
  <v-container class="py-4" style="max-width: 1000px">
    <h1 class="text-h5 mb-1">Reportes</h1>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Solo cuentan las ventas pagadas. Las fechas son las de cada sucursal.
    </p>

    <!-- Filtros -->
    <v-row dense class="mb-2">
      <v-col cols="12" sm="4">
        <v-select
          :model-value="reports.preset"
          :items="presetItems"
          label="Periodo"
          density="compact"
          hide-details
          @update:model-value="reports.setPreset($event)"
        />
      </v-col>
      <v-col v-if="session.activeBranches.length > 1" cols="12" sm="4">
        <v-select
          :model-value="reports.branchId"
          :items="branchItems"
          item-title="title"
          item-value="value"
          label="Sucursal"
          density="compact"
          hide-details
          @update:model-value="reports.setBranch($event)"
        />
      </v-col>
    </v-row>
    <v-row v-if="reports.preset === 'range'" dense class="mb-2">
      <v-col cols="6" sm="3">
        <v-text-field
          v-model="reports.customRange.from"
          type="date"
          label="Desde"
          density="compact"
          hide-details
        />
      </v-col>
      <v-col cols="6" sm="3">
        <v-text-field
          v-model="reports.customRange.to"
          type="date"
          label="Hasta"
          density="compact"
          hide-details
        />
      </v-col>
      <v-col cols="12" sm="3">
        <v-btn color="primary" @click="reports.load()">Aplicar</v-btn>
      </v-col>
    </v-row>
    <p v-if="rangeLabel" class="text-body-2 mb-3">{{ rangeLabel }}</p>

    <v-alert
      v-if="reports.errorMessage"
      type="error"
      variant="tonal"
      density="compact"
      class="mb-4"
    >
      {{ reports.errorMessage }}
    </v-alert>
    <v-progress-linear v-if="reports.status === 'loading'" indeterminate class="mb-4" />

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="summary">Resumen de ventas</v-tab>
      <v-tab value="items">Lo más vendido</v-tab>
      <v-tab value="staff">Empleados</v-tab>
    </v-tabs>

    <!-- Resumen -->
    <template v-if="tab === 'summary' && summary">
      <v-row dense class="mb-2">
        <v-col cols="6" md="3">
          <v-card variant="outlined" class="pa-3">
            <div class="text-caption text-medium-emphasis">Total vendido</div>
            <div class="text-h6">{{ formatMXN(summary.totals.totalCents) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card variant="outlined" class="pa-3">
            <div class="text-caption text-medium-emphasis">Ventas</div>
            <div class="text-h6">{{ summary.totals.salesCount }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card variant="outlined" class="pa-3">
            <div class="text-caption text-medium-emphasis">Ticket promedio</div>
            <div class="text-h6">{{ formatMXN(averageTicket) }}</div>
          </v-card>
        </v-col>
        <v-col cols="6" md="3">
          <v-card variant="outlined" class="pa-3">
            <div class="text-caption text-medium-emphasis">Canceladas (no suman)</div>
            <div class="text-h6">{{ summary.cancelled.salesCount }}</div>
            <div class="text-caption">{{ formatMXN(summary.cancelled.totalCents) }}</div>
          </v-card>
        </v-col>
      </v-row>
      <p class="text-caption text-medium-emphasis mb-4">
        Subtotal {{ formatMXN(summary.totals.subtotalCents) }} + IVA
        {{ formatMXN(summary.totals.ivaCents) }} − descuentos
        {{ formatMXN(summary.totals.discountCents) }} =
        {{ formatMXN(summary.totals.totalCents) }}. El subtotal y el IVA son los guardados
        en cada venta, <strong>antes del descuento</strong>: en una venta con descuento el
        IVA se ve algo mayor al real. El total sí es exacto.
      </p>

      <v-card variant="outlined" class="pa-4 mb-4">
        <div class="d-flex align-center mb-2">
          <h2 class="text-subtitle-1">Ventas por día</h2>
          <v-spacer />
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-download"
            @click="exportDays"
            >Descargar CSV</v-btn
          >
        </div>
        <div v-if="maxDayCents === 0" class="text-body-2 text-medium-emphasis">
          No hubo ventas en este periodo.
        </div>
        <template v-else>
          <div class="bars" role="img" aria-label="Ventas por día">
            <div
              v-for="bar in dayBars"
              :key="bar.day.day"
              class="bars__col"
              :title="dayTitle(bar.day)"
            >
              <div class="bars__bar" :style="{ height: `${bar.percent}%` }" />
            </div>
          </div>
          <div
            class="d-flex justify-space-between text-caption text-medium-emphasis mt-1"
          >
            <span>{{ formatDayLabel(dayBars[0].day.day) }}</span>
            <span>Día más alto: {{ formatMXN(maxDayCents) }}</span>
            <span>{{ formatDayLabel(dayBars[dayBars.length - 1].day.day) }}</span>
          </div>
        </template>
      </v-card>

      <v-card variant="outlined" class="pa-4 mb-4">
        <div class="d-flex align-center mb-2">
          <h2 class="text-subtitle-1">Cobrado por método de pago</h2>
          <v-spacer />
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-download"
            @click="exportMethods"
            >Descargar CSV</v-btn
          >
        </div>
        <div v-for="row in methodBars" :key="row.label" class="mb-2">
          <div class="d-flex justify-space-between text-body-2">
            <span>{{ row.label }}</span>
            <strong>{{ formatMXN(row.cents) }}</strong>
          </div>
          <div class="hbar">
            <div class="hbar__fill" :style="{ width: `${row.percent}%` }" />
          </div>
        </div>
        <p class="text-caption text-medium-emphasis mt-2">
          Es lo cobrado sin el cambio entregado ({{
            formatMXN(summary.byMethod.changeGivenCents)
          }}
          en el periodo). Si un cliente paga con tarjeta de más, ese sobrepago sí aparece
          aquí y la suma por métodos puede ser mayor al total vendido.
        </p>
      </v-card>

      <v-card v-if="summary.byBranch.length > 1" variant="outlined" class="pa-4 mb-4">
        <div class="d-flex align-center mb-2">
          <h2 class="text-subtitle-1">Por sucursal</h2>
          <v-spacer />
          <v-btn
            size="small"
            variant="tonal"
            prepend-icon="mdi-download"
            @click="exportBranches"
            >Descargar CSV</v-btn
          >
        </div>
        <v-table density="compact">
          <thead>
            <tr>
              <th>Sucursal</th>
              <th class="text-right">Ventas</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in summary.byBranch" :key="b.branchId">
              <td>{{ b.branchName }}</td>
              <td class="text-right">{{ b.salesCount }}</td>
              <td class="text-right">{{ formatMXN(b.totalCents) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>

    <!-- Lo más vendido -->
    <template v-if="tab === 'items' && reports.topItems">
      <div class="d-flex align-center mb-2">
        <p class="text-caption text-medium-emphasis">
          El importe es con IVA y <strong>antes del descuento</strong> de la venta, así
          que si hubo descuentos la suma puede ser mayor al total vendido. Un insumo
          cobrado en una consulta cuenta como producto.
        </p>
        <v-spacer />
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-download"
          @click="exportItems"
          >Descargar CSV</v-btn
        >
      </div>
      <v-card
        v-for="group in [
          { title: 'Servicios', rows: reports.topItems.services },
          { title: 'Productos', rows: reports.topItems.products },
        ]"
        :key="group.title"
        variant="outlined"
        class="pa-4 mb-4"
      >
        <h2 class="text-subtitle-1 mb-2">{{ group.title }}</h2>
        <p v-if="group.rows.length === 0" class="text-body-2 text-medium-emphasis">
          Sin ventas en este periodo.
        </p>
        <v-table v-else density="compact">
          <thead>
            <tr>
              <th>Concepto</th>
              <th class="text-right">Cantidad</th>
              <th class="text-right">Importe</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in group.rows" :key="item.itemId">
              <td>{{ item.name }}</td>
              <td class="text-right">{{ item.quantity }}</td>
              <td class="text-right">{{ formatMXN(item.revenueCents) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>

    <!-- Empleados -->
    <template v-if="tab === 'staff' && reports.status !== 'idle'">
      <div class="d-flex align-center mb-2">
        <p class="text-caption text-medium-emphasis">
          Cada partida se atribuye así: un servicio, al empleado de su cita; un producto
          vendido junto con un servicio, al empleado de la primera cita del ticket; una
          venta de mostrador, a quien cobró. Lo que no tiene empleado aparece como "Sin
          asignar". Importes con IVA y antes del descuento.
        </p>
        <v-spacer />
        <v-btn
          size="small"
          variant="tonal"
          prepend-icon="mdi-download"
          @click="exportStaff"
          >Descargar CSV</v-btn
        >
      </div>
      <v-card variant="outlined" class="pa-4 mb-4">
        <p v-if="reports.staff.length === 0" class="text-body-2 text-medium-emphasis">
          Sin actividad en este periodo.
        </p>
        <v-table v-else density="compact">
          <thead>
            <tr>
              <th>Empleado</th>
              <th class="text-right">Citas</th>
              <th class="text-right">Servicios</th>
              <th class="text-right">Productos</th>
              <th class="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in reports.staff" :key="row.userId ?? 'none'">
              <td>{{ row.fullName }}</td>
              <td class="text-right">{{ row.appointmentsCompleted }}</td>
              <td class="text-right">{{ formatMXN(row.servicesCents) }}</td>
              <td class="text-right">{{ formatMXN(row.productsCents) }}</td>
              <td class="text-right">{{ formatMXN(row.totalCents) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped lang="scss">
// Barras por día: una columna flexible por día; la altura sale del porcentaje.
.bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 160px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  &__col {
    flex: 1 1 0;
    min-width: 2px;
    // Con pocos días las barras no se vuelven bloques enormes.
    max-width: 56px;
    height: 100%;
    display: flex;
    align-items: flex-end;
  }

  &__bar {
    width: 100%;
    background: rgb(var(--v-theme-primary));
    border-radius: 2px 2px 0 0;
  }
}

.hbar {
  height: 8px;
  border-radius: 4px;
  background: rgba(var(--v-theme-primary), 0.12);

  &__fill {
    height: 100%;
    border-radius: 4px;
    background: rgb(var(--v-theme-primary));
  }
}
</style>
