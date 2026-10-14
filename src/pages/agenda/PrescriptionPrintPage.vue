<script setup lang="ts">
// Hoja de la receta, lista para imprimir desde el navegador (fase 28, PLAN.md D30 punto 3).
// Hoja carta vertical: empresa y sucursal, folio y fecha, veterinario con cédula, paciente,
// propietario, diagnóstico, tabla de medicamentos, indicaciones, próxima visita y firma.
// Sin precios. La cédula y el nombre salen de la COPIA que guardó la receta al emitirse.
import { computed, onMounted, ref } from 'vue'

import PageSkeleton from '@/components/PageSkeleton.vue'
import { useDelayedLoading } from '@/composables/useDelayedLoading'
import { CONTENT_WIDTH } from '@/lib/contentWidth'
import { formatDate, formatDateOnly } from '@/lib/datetime'
import { sexLabel, speciesLabel } from '@/lib/petLabels'
import { prescriptionFolioLabel, prescriptionPages } from '@/lib/prescription'
import * as appointmentsService from '@/services/appointments'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import * as customersService from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as prescriptionsService from '@/services/prescriptions'
import type { PrescriptionWithItems } from '@/services/prescriptions'
import * as recordsService from '@/services/records'
import type { MedicalRecord } from '@/services/records'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()

const session = useSessionStore()

const loading = ref(false)
const showSkeleton = useDelayedLoading(loading)
const errorMessage = ref<string | null>(null)

const prescription = ref<PrescriptionWithItems | null>(null)
const branch = ref<Branch | null>(null)
const pet = ref<Pet | null>(null)
const ownerName = ref('')
const ownerPhone = ref<string | null>(null)
const lastWeightKg = ref<string | null>(null)
const medicalRecord = ref<MedicalRecord | null>(null)

const timezone = computed(() => branch.value?.timezone ?? 'America/Mexico_City')

async function load(): Promise<void> {
  const tenantId = session.activeTenantId
  if (!tenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const rx = await prescriptionsService.getByAppointment(tenantId, props.id)
    prescription.value = rx
    if (!rx) return

    const appointment = await appointmentsService.getById(tenantId, props.id)
    if (!appointment) return
    const [foundBranch, foundPet, customer, record, weights] = await Promise.all([
      branchesService.getById(appointment.branch_id),
      petsService.getById(tenantId, appointment.pet_id),
      customersService.getById(tenantId, appointment.customer_id),
      recordsService.getMedicalRecordByAppointment(appointment.id),
      petsService.listWeights(tenantId, appointment.pet_id),
    ])
    branch.value = foundBranch
    pet.value = foundPet
    medicalRecord.value = record
    ownerName.value = customer ? `${customer.first_name} ${customer.last_name}` : ''
    ownerPhone.value = customer?.phone ?? null
    lastWeightKg.value = weights[0] ? (weights[0].weight_grams / 1000).toFixed(1) : null
  } catch {
    errorMessage.value = 'No se pudo cargar la receta. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// Fecha de nacimiento tal cual (sin zona, §8.3). La edad calculada ("3 años 2 meses",
// `lib/petAge.ts`) llega con la fase 27: al integrarla, la hoja cambia a la edad.
const petBirth = computed(() =>
  pet.value?.birth_date ? formatDateOnly(pet.value.birth_date) : null,
)

const pages = computed(() => prescriptionPages(prescription.value?.items.length ?? 0))

function print(): void {
  window.print()
}
</script>

<template>
  <v-container :max-width="CONTENT_WIDTH.narrow" class="py-6">
    <div class="d-flex align-center justify-space-between mb-3 no-print">
      <v-btn
        variant="text"
        prepend-icon="mdi-arrow-left"
        :to="`/app/citas/${props.id}/atender`"
      >
        Volver a la consulta
      </v-btn>
      <v-btn
        color="primary"
        prepend-icon="mdi-printer"
        :disabled="!prescription"
        @click="print"
      >
        Imprimir
      </v-btn>
    </div>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4 no-print"
    >
      {{ errorMessage }}
    </v-alert>
    <v-alert
      v-if="pages > 1"
      type="info"
      density="compact"
      variant="tonal"
      class="mb-4 no-print"
    >
      Esta receta ocupa {{ pages }} hojas.
    </v-alert>

    <PageSkeleton v-if="showSkeleton" />

    <p v-else-if="!loading && !prescription" class="text-body-2 text-medium-emphasis">
      Esta cita todavía no tiene receta.
    </p>

    <div
      v-else-if="prescription && pet"
      class="prescription-print"
      data-testid="prescription-sheet"
    >
      <header class="prescription-print__header">
        <div>
          <h1 class="prescription-print__business">
            {{ session.activeMembership?.tenantName }}
          </h1>
          <p v-if="branch">
            {{ branch.name }}<span v-if="branch.address"> · {{ branch.address }}</span>
          </p>
          <p v-if="branch?.phone">Tel. {{ branch.phone }}</p>
        </div>
        <div class="prescription-print__folio">
          <p class="font-weight-bold">{{ prescriptionFolioLabel(prescription.folio) }}</p>
          <p>{{ formatDate(prescription.issued_at, timezone) }}</p>
        </div>
      </header>

      <section class="prescription-print__block">
        <p>
          <strong>Médico veterinario:</strong> {{ prescription.issuer_name_snapshot }}
        </p>
        <p>
          <strong>Cédula profesional:</strong> {{ prescription.issuer_license_snapshot }}
        </p>
      </section>

      <section class="prescription-print__block prescription-print__grid">
        <div>
          <p class="prescription-print__label">Paciente</p>
          <p>
            <strong>{{ pet.name }}</strong> · {{ speciesLabel(pet.species) }}
            <span v-if="pet.breed"> · {{ pet.breed }}</span>
          </p>
          <p>
            {{ sexLabel(pet.sex) }}<span v-if="petBirth"> · Nac. {{ petBirth }}</span
            ><span v-if="lastWeightKg"> · {{ lastWeightKg }} kg</span>
          </p>
        </div>
        <div>
          <p class="prescription-print__label">Propietario</p>
          <p>
            <strong>{{ ownerName }}</strong>
          </p>
          <p v-if="ownerPhone">Tel. {{ ownerPhone }}</p>
        </div>
      </section>

      <section v-if="medicalRecord?.diagnosis" class="prescription-print__block">
        <p class="prescription-print__label">Diagnóstico</p>
        <p>{{ medicalRecord.diagnosis }}</p>
      </section>

      <table class="prescription-print__table">
        <thead>
          <tr>
            <th>Medicamento</th>
            <th>Dosis</th>
            <th>Frecuencia</th>
            <th>Duración</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in prescription.items" :key="row.id">
            <td>{{ row.medication_name }}</td>
            <td>{{ row.dose ?? '—' }}</td>
            <td>{{ row.frequency ?? '—' }}</td>
            <td>{{ row.duration ?? '—' }}</td>
          </tr>
        </tbody>
      </table>

      <section v-if="medicalRecord?.indications" class="prescription-print__block">
        <p class="prescription-print__label">Indicaciones</p>
        <p class="prescription-print__multiline">{{ medicalRecord.indications }}</p>
      </section>

      <section v-if="medicalRecord?.next_visit_date" class="prescription-print__block">
        <p>
          <strong>Próxima visita:</strong>
          {{ formatDate(`${medicalRecord.next_visit_date}T12:00:00Z`, timezone) }}
        </p>
      </section>

      <footer class="prescription-print__signature">
        <div class="prescription-print__line" />
        <p>{{ prescription.issuer_name_snapshot }}</p>
        <p>Cédula profesional {{ prescription.issuer_license_snapshot }}</p>
      </footer>
    </div>
  </v-container>
</template>

<style scoped lang="scss">
.prescription-print {
  background: #fff;
  color: #000;
  border: 1px solid rgba(0, 0, 0, 0.2);
  padding: 32px;
  font-size: 0.95rem;
  line-height: 1.5;

  &__header {
    display: flex;
    justify-content: space-between;
    gap: 16px;
    border-bottom: 2px solid #000;
    padding-bottom: 12px;
    margin-bottom: 16px;
  }

  &__business {
    font-size: 1.35rem;
    font-weight: 700;
  }

  &__folio {
    text-align: right;
    white-space: nowrap;
  }

  &__block {
    margin-bottom: 14px;
  }

  &__grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  &__label {
    font-size: 0.75rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    font-weight: 700;
  }

  &__multiline {
    white-space: pre-line;
  }

  &__table {
    width: 100%;
    border-collapse: collapse;
    margin: 12px 0 18px;

    th,
    td {
      border: 1px solid #000;
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
    }

    th {
      background: #eee;
    }

    // Un renglón no se parte entre dos hojas.
    tr {
      break-inside: avoid;
    }
  }

  &__signature {
    margin-top: 72px;
    width: 55%;
    margin-left: auto;
    text-align: center;
    break-inside: avoid;
  }

  &__line {
    border-top: 1px solid #000;
    margin-bottom: 6px;
  }
}
</style>

<!--
  Sin "scoped" a propósito, igual que TicketView: @media print oculta TODO lo demás de la
  página (menú, barra) y deja solo la receta. `position: absolute` (y no `fixed`) para que
  una receta de más de una hoja fluya a la segunda en vez de cortarse.
-->
<style lang="scss">
@media print {
  @page {
    size: letter portrait;
    margin: 14mm;
  }

  body * {
    visibility: hidden;
  }
  .prescription-print,
  .prescription-print * {
    visibility: visible;
  }
  .prescription-print {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    border: 0;
    padding: 0;
  }
  .no-print {
    display: none;
  }
}
</style>
