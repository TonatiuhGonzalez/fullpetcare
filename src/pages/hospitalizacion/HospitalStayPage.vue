<script setup lang="ts">
// Ficha de una estancia (fase 33, PLAN.md D30 punto 10): la bitácora con sus biometrías, los
// medicamentos administrados (con inventario y cobro), lo que va costando y las acciones de dar
// de alta y cobrar. Por ahora solo la lee el personal; el dueño de la mascota la leerá con la
// cuenta del cliente (fase 16B).
import { computed, onMounted, ref } from 'vue'

import HospitalBillingDialog from '@/components/HospitalBillingDialog.vue'
import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageSkeleton from '@/components/PageSkeleton.vue'
import { CONTENT_WIDTH } from '@/lib/contentWidth'
import { formatDate, formatTime } from '@/lib/datetime'
import { isFractional, type SaleUnit } from '@/lib/fractional'
import {
  ELIMINATION_OPTIONS,
  MOOD_OPTIONS,
  MUCOUS_OPTIONS,
  eliminationLabel,
  formatTemperature,
  formatWeight,
  moodLabel,
  mucousLabel,
  noteProblem,
  noteToStored,
  stayCharge,
  type DayRule,
  type RateMode,
} from '@/lib/hospitalization'
import { formatMXN } from '@/lib/money'
import * as hospitalService from '@/services/hospitalization'
import type { StayDetail } from '@/services/hospitalization'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()
const session = useSessionStore()

const stay = ref<StayDetail | null>(null)
const products = ref<Product[]>([])
const loading = ref(true)
const errorMessage = ref<string | null>(null)
const busy = ref(false)

const isOpen = computed(() => stay.value !== null && stay.value.discharged_at === null)
const canBill = computed(
  () => session.role === 'owner' || session.role === 'receptionist',
)
const tz = computed(() => stay.value?.branchTimezone ?? 'America/Mexico_City')

async function load(): Promise<void> {
  const tenantId = session.activeTenantId
  if (!tenantId) return
  errorMessage.value = null
  try {
    const [detail, catalog] = await Promise.all([
      hospitalService.getDetail(tenantId, props.id),
      productsService.list(tenantId).catch(() => [] as Product[]),
    ])
    stay.value = detail
    products.value = catalog
  } catch {
    errorMessage.value = 'No se pudo cargar la estancia. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// ── Costo ────────────────────────────────────────────────────────────────────
const charge = computed(() => {
  if (!stay.value) return { days: 0, amountCents: 0 }
  const end = stay.value.discharged_at ? new Date(stay.value.discharged_at) : new Date()
  return stayCharge(
    {
      rateMode: stay.value.rate_mode as RateMode,
      rateCents: stay.value.rate_cents,
      dayRule: stay.value.day_rule as DayRule,
    },
    new Date(stay.value.admitted_at),
    end,
    tz.value,
  )
})

const billableMeds = computed(() =>
  (stay.value?.medications ?? []).filter(
    (m) => m.is_billable && m.billed_sale_id === null,
  ),
)
const medsTotalCents = computed(() =>
  billableMeds.value.reduce((s, m) => s + m.unit_price_cents * m.quantity, 0),
)

const stayLabel = computed(() => {
  if (!stay.value) return ''
  return stay.value.rate_mode === 'per_day'
    ? `Estancia: ${charge.value.days} ${charge.value.days === 1 ? 'día' : 'días'} × ${formatMXN(stay.value.rate_cents)}`
    : 'Estancia (monto único)'
})

// ── Nota ─────────────────────────────────────────────────────────────────────
const noteContent = ref('')
const noteTemperature = ref<number | null>(null)
const noteWeight = ref<number | null>(null)
const noteHeartRate = ref<number | null>(null)
const noteMucous = ref<string | null>(null)
const noteMood = ref<string | null>(null)
const noteElimination = ref<string | null>(null)
const noteTime = ref('')
const noteError = ref<string | null>(null)

function resetNote(): void {
  noteContent.value = ''
  noteTemperature.value = null
  noteWeight.value = null
  noteHeartRate.value = null
  noteMucous.value = null
  noteMood.value = null
  noteElimination.value = null
  noteTime.value = ''
}

async function saveNote(): Promise<void> {
  const input = {
    content: noteContent.value,
    temperatureC:
      noteTemperature.value === null || String(noteTemperature.value) === ''
        ? null
        : Number(noteTemperature.value),
    weightKg:
      noteWeight.value === null || String(noteWeight.value) === ''
        ? null
        : Number(noteWeight.value),
    heartRateBpm:
      noteHeartRate.value === null || String(noteHeartRate.value) === ''
        ? null
        : Number(noteHeartRate.value),
    mucousColor: noteMucous.value,
    mood: noteMood.value,
    elimination: noteElimination.value,
  }
  const problem = noteProblem(input)
  if (problem) {
    noteError.value = problem
    return
  }
  const stored = noteToStored(input)
  busy.value = true
  noteError.value = null
  try {
    await hospitalService.addNote({
      stayId: props.id,
      content: stored.content,
      // La hora se captura como la de hoy en el reloj del navegador; vacía = ahora.
      notedAt: noteTime.value ? new Date(noteTime.value).toISOString() : null,
      temperatureDeciC: stored.temperature_deci_c,
      weightGrams: stored.weight_grams,
      heartRateBpm: stored.heart_rate_bpm,
      mucousColor: stored.mucous_color,
      mood: stored.mood,
      elimination: stored.elimination,
    })
    resetNote()
    await load()
  } catch (error) {
    noteError.value = hospitalService.errorMessage(error)
  } finally {
    busy.value = false
  }
}

// ── Medicamentos ─────────────────────────────────────────────────────────────
const medProduct = ref<Product | null>(null)
const medQuantity = ref(1)
const medUnit = ref<SaleUnit>('package')
const medBillable = ref(true)
const medError = ref<string | null>(null)

const productItems = computed(() => products.value.filter((p) => p.is_active))

async function addMedication(): Promise<void> {
  if (!medProduct.value) return
  if (!Number.isInteger(medQuantity.value) || medQuantity.value < 1) {
    medError.value = 'La cantidad debe ser un entero mayor a 0.'
    return
  }
  busy.value = true
  medError.value = null
  try {
    const unit: SaleUnit = isFractional({
      unitsPerPackage: medProduct.value.units_per_package,
    })
      ? medUnit.value
      : 'package'
    await hospitalService.administerMedication({
      stayId: props.id,
      productId: medProduct.value.id,
      quantity: medQuantity.value,
      isBillable: medBillable.value,
      unit,
    })
    medProduct.value = null
    medQuantity.value = 1
    medUnit.value = 'package'
    medBillable.value = true
    await load()
  } catch (error) {
    medError.value = hospitalService.errorMessage(error)
  } finally {
    busy.value = false
  }
}

async function removeMedication(id: string): Promise<void> {
  busy.value = true
  medError.value = null
  try {
    await hospitalService.removeMedication(id)
    await load()
  } catch (error) {
    medError.value = hospitalService.errorMessage(error)
  } finally {
    busy.value = false
  }
}

// ── Alta y cobro ─────────────────────────────────────────────────────────────
const showDischargeConfirm = ref(false)
const showBilling = ref(false)
const billedNotice = ref(false)

async function discharge(): Promise<void> {
  busy.value = true
  errorMessage.value = null
  try {
    await hospitalService.discharge(props.id)
    showDischargeConfirm.value = false
    await load()
  } catch (error) {
    showDischargeConfirm.value = false
    errorMessage.value = hospitalService.errorMessage(error)
  } finally {
    busy.value = false
  }
}

async function handleBilled(): Promise<void> {
  billedNotice.value = true
  await load()
}

function noteFacts(note: StayDetail['notes'][number]): string[] {
  return [
    formatTemperature(note.temperature_deci_c),
    formatWeight(note.weight_grams),
    note.heart_rate_bpm !== null ? `${note.heart_rate_bpm} lpm` : null,
    mucousLabel(note.mucous_color) ? `Mucosas: ${mucousLabel(note.mucous_color)}` : null,
    moodLabel(note.mood),
    eliminationLabel(note.elimination),
  ].filter((f): f is string => f !== null)
}
</script>

<template>
  <v-container :max-width="CONTENT_WIDTH.narrow" class="py-6">
    <v-btn
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2"
      to="/app/hospitalizacion"
    >
      Volver a hospitalización
    </v-btn>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>
    <v-alert
      v-if="billedNotice"
      type="success"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      Estancia cobrada.
    </v-alert>

    <PageSkeleton v-if="loading" :blocks="2" />

    <p v-else-if="!stay" class="text-body-2 text-medium-emphasis">
      La estancia no existe o no tienes acceso.
    </p>

    <template v-else>
      <PageHeader
        :title="stay.petName"
        :subtitle="`${stay.ownerName} · ${stay.spaceName}`"
      >
        <template #actions>
          <v-btn
            v-if="isOpen"
            color="primary"
            variant="tonal"
            prepend-icon="mdi-exit-run"
            @click="showDischargeConfirm = true"
          >
            Dar de alta
          </v-btn>
          <v-btn
            v-else-if="canBill && stay.billed_sale_id === null"
            color="primary"
            prepend-icon="mdi-cash-register"
            @click="showBilling = true"
          >
            Cobrar
          </v-btn>
          <v-chip v-else-if="stay.billed_sale_id" color="success" variant="tonal"
            >Cobrada</v-chip
          >
        </template>
      </PageHeader>

      <v-card variant="outlined" class="pa-4 mb-4" data-testid="stay-summary">
        <div class="d-flex flex-wrap ga-4">
          <div>
            <div class="text-caption text-medium-emphasis">Ingreso</div>
            <div>
              {{ formatDate(stay.admitted_at, tz) }}
              {{ formatTime(stay.admitted_at, tz) }}
            </div>
          </div>
          <div v-if="stay.discharged_at">
            <div class="text-caption text-medium-emphasis">Alta</div>
            <div>
              {{ formatDate(stay.discharged_at, tz) }}
              {{ formatTime(stay.discharged_at, tz) }}
            </div>
          </div>
          <div>
            <div class="text-caption text-medium-emphasis">Estancia</div>
            <div>{{ stayLabel }} = {{ formatMXN(charge.amountCents) }}</div>
          </div>
          <div v-if="billableMeds.length > 0">
            <div class="text-caption text-medium-emphasis">Medicamentos por cobrar</div>
            <div>{{ formatMXN(medsTotalCents) }}</div>
          </div>
        </div>
        <p v-if="stay.reason" class="text-body-2 mt-3 mb-0">
          <strong>Motivo:</strong> {{ stay.reason }}
        </p>
      </v-card>

      <v-row>
        <!-- Bitácora -->
        <v-col cols="12" md="7">
          <h2 class="text-subtitle-1 font-weight-bold mb-2">Bitácora</h2>

          <v-card v-if="isOpen" variant="outlined" class="pa-4 mb-4">
            <v-textarea
              v-model="noteContent"
              label="Lo realizado / observaciones"
              rows="2"
              auto-grow
              variant="outlined"
              density="comfortable"
            />
            <v-row dense>
              <v-col cols="6" sm="4">
                <v-text-field
                  v-model.number="noteTemperature"
                  label="Temperatura (°C)"
                  type="number"
                  step="0.1"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="6" sm="4">
                <v-text-field
                  v-model.number="noteWeight"
                  label="Peso (kg)"
                  type="number"
                  step="0.1"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="6" sm="4">
                <v-text-field
                  v-model.number="noteHeartRate"
                  label="Frec. cardiaca (lpm)"
                  type="number"
                  step="1"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="noteMucous"
                  :items="[...MUCOUS_OPTIONS]"
                  label="Mucosas"
                  clearable
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="noteMood"
                  :items="[...MOOD_OPTIONS]"
                  label="Estado de ánimo"
                  clearable
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="4">
                <v-select
                  v-model="noteElimination"
                  :items="[...ELIMINATION_OPTIONS]"
                  label="Micción / defecación"
                  clearable
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="12" sm="6">
                <v-text-field
                  v-model="noteTime"
                  label="Hora (vacía = ahora)"
                  type="datetime-local"
                  variant="outlined"
                  density="compact"
                  hide-details
                />
              </v-col>
            </v-row>
            <v-alert
              v-if="noteError"
              type="error"
              density="compact"
              variant="tonal"
              class="mt-3"
            >
              {{ noteError }}
            </v-alert>
            <div class="d-flex justify-end mt-3">
              <v-btn color="primary" :loading="busy" @click="saveNote"
                >Agregar nota</v-btn
              >
            </div>
          </v-card>

          <p v-if="stay.notes.length === 0" class="text-body-2 text-medium-emphasis">
            Aún no hay notas.
          </p>
          <v-card
            v-for="note in stay.notes"
            :key="note.id"
            variant="outlined"
            class="pa-3 mb-2"
            data-testid="hospital-note"
          >
            <div class="text-caption text-medium-emphasis">
              {{ formatDate(note.noted_at, tz) }} {{ formatTime(note.noted_at, tz) }}
            </div>
            <div v-if="noteFacts(note).length > 0" class="d-flex flex-wrap ga-1 my-1">
              <v-chip
                v-for="fact in noteFacts(note)"
                :key="fact"
                size="x-small"
                variant="tonal"
              >
                {{ fact }}
              </v-chip>
            </div>
            <p v-if="note.content" class="text-body-2 mb-0" style="white-space: pre-line">
              {{ note.content }}
            </p>
          </v-card>
        </v-col>

        <!-- Medicamentos -->
        <v-col cols="12" md="5">
          <h2 class="text-subtitle-1 font-weight-bold mb-2">
            Medicamentos administrados
          </h2>

          <v-card v-if="isOpen" variant="outlined" class="pa-4 mb-4">
            <v-autocomplete
              v-model="medProduct"
              :items="productItems"
              item-title="name"
              return-object
              label="Producto"
              variant="outlined"
              density="compact"
              hide-details
              no-data-text="Sin productos"
              class="mb-2"
            />
            <div class="d-flex align-center ga-2">
              <v-btn-toggle
                v-if="
                  medProduct &&
                  isFractional({ unitsPerPackage: medProduct.units_per_package })
                "
                v-model="medUnit"
                mandatory
                density="compact"
                color="primary"
                variant="outlined"
                divided
              >
                <v-btn value="package" size="small">{{
                  medProduct.package_name ?? 'Envase'
                }}</v-btn>
                <v-btn value="unit" size="small">{{
                  medProduct.unit_name ?? 'Unidad'
                }}</v-btn>
              </v-btn-toggle>
              <v-text-field
                v-model.number="medQuantity"
                label="Cant."
                type="number"
                min="1"
                step="1"
                variant="outlined"
                density="compact"
                hide-details
                style="max-width: 100px"
              />
              <v-btn
                color="primary"
                variant="tonal"
                :disabled="!medProduct"
                :loading="busy"
                @click="addMedication"
              >
                Administrar
              </v-btn>
            </div>
            <v-switch
              v-model="medBillable"
              label="Cobrar al cliente"
              color="primary"
              density="compact"
              hide-details
            />
            <v-alert
              v-if="medError"
              type="error"
              density="compact"
              variant="tonal"
              class="mt-2"
            >
              {{ medError }}
            </v-alert>
          </v-card>

          <p
            v-if="stay.medications.length === 0"
            class="text-body-2 text-medium-emphasis"
          >
            Aún no se administra ningún medicamento.
          </p>
          <v-list v-else density="compact" class="border rounded">
            <v-list-item v-for="med in stay.medications" :key="med.id">
              <template #title>{{ med.name_snapshot }} × {{ med.quantity }}</template>
              <template #subtitle>
                {{ formatDate(med.administered_at, tz) }}
                {{ formatTime(med.administered_at, tz) }} ·
                {{
                  med.billed_sale_id
                    ? 'Cobrado'
                    : med.is_billable
                      ? formatMXN(med.unit_price_cents * med.quantity)
                      : 'Uso interno'
                }}
              </template>
              <template v-if="isOpen && med.billed_sale_id === null" #append>
                <IconButton
                  icon="mdi-close"
                  size="x-small"
                  variant="text"
                  :disabled="busy"
                  aria-label="Quitar medicamento"
                  @click="removeMedication(med.id)"
                />
              </template>
            </v-list-item>
          </v-list>
        </v-col>
      </v-row>

      <v-dialog v-model="showDischargeConfirm" max-width="420">
        <v-card>
          <v-card-title>Dar de alta a {{ stay.petName }}</v-card-title>
          <v-card-text>
            La estancia se cierra ahora: ya no se podrán agregar notas ni medicamentos y
            los días se cuentan hasta este momento.
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn variant="text" @click="showDischargeConfirm = false">Cancelar</v-btn>
            <v-btn color="primary" :loading="busy" @click="discharge">Dar de alta</v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>

      <HospitalBillingDialog
        v-model="showBilling"
        :stay-id="stay.id"
        :stay-label="stayLabel"
        :stay-amount-cents="charge.amountCents"
        :medications="
          billableMeds.map((m) => ({
            label: `${m.name_snapshot} × ${m.quantity}`,
            amountCents: m.unit_price_cents * m.quantity,
          }))
        "
        @billed="handleBilled"
      />
    </template>
  </v-container>
</template>
