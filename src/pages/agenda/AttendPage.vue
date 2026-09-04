<script setup lang="ts">
// Atender una cita (tarea 4.12): bifurca el formulario según
// `appointment.kind` y controla el ciclo de vida de la cita alrededor de
// esa ficha — al abrir la marca `in_progress`, al guardar la ficha la
// marca `completed` (tarea 4.16). El estado en sí lo valida
// services/appointments.ts#changeStatus() con lib/appointmentStatus.ts
// (tareas 4.8-4.9); esta página solo decide CUÁNDO llamarlo.
import { onMounted, ref } from 'vue'

import * as appointmentsService from '@/services/appointments'
import type { Appointment } from '@/services/appointments'
import * as customersService from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import * as recordsService from '@/services/records'
import type { GroomingRecord, MedicalRecord, VaccinationWithName } from '@/services/records'
import GroomingRecordForm from '@/components/GroomingRecordForm.vue'
import MedicalRecordForm from '@/components/MedicalRecordForm.vue'
import VaccinationDialog from '@/components/VaccinationDialog.vue'
import { formatDate } from '@/lib/datetime'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ id: string }>()

const session = useSessionStore()

const appointment = ref<Appointment | null>(null)
const branch = ref<Branch | null>(null)
const pet = ref<Pet | null>(null)
const customerName = ref('')
const existingGrooming = ref<GroomingRecord | null>(null)
const existingMedical = ref<MedicalRecord | null>(null)
const appliedVaccines = ref<VaccinationWithName[]>([])

const loading = ref(false)
const errorMessage = ref<string | null>(null)
const justCompleted = ref(false)
const showVaccinationDialog = ref(false)

async function load(): Promise<void> {
  const tenantId = session.activeTenantId
  if (!tenantId) return

  loading.value = true
  errorMessage.value = null
  try {
    const found = await appointmentsService.getById(tenantId, props.id)
    appointment.value = found
    if (!found) return

    const [foundBranch, foundCustomer, foundPet] = await Promise.all([
      branchesService.getById(found.branch_id),
      customersService.getById(tenantId, found.customer_id),
      petsService.getById(tenantId, found.pet_id),
    ])
    branch.value = foundBranch
    pet.value = foundPet
    customerName.value = foundCustomer ? `${foundCustomer.first_name} ${foundCustomer.last_name}` : ''

    if (found.kind === 'grooming') {
      existingGrooming.value = await recordsService.getGroomingRecordByAppointment(found.id)
    } else {
      existingMedical.value = await recordsService.getMedicalRecordByAppointment(found.id)
      appliedVaccines.value = await recordsService.listVaccinationsByPet(tenantId, found.pet_id)
    }

    // Al abrir la cita para atenderla, pasa de "agendada" a "en curso" —
    // si ya estaba en curso (se reabrió) o completada (se corrige algo),
    // no hay transición que hacer (canTransition la rechazaría de todos
    // modos, ver lib/appointmentStatus.ts).
    if (found.status === 'scheduled') {
      await appointmentsService.changeStatus(tenantId, found.id, 'in_progress')
      appointment.value = { ...found, status: 'in_progress' }
    }
  } catch {
    errorMessage.value = 'No se pudo cargar la cita. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

async function handleSaved(): Promise<void> {
  const tenantId = session.activeTenantId
  if (!appointment.value || !tenantId) return

  justCompleted.value = false
  // Si la cita ya estaba completada (se reabrió solo para corregir un
  // dato de la ficha), no hay transición "completed → completed" que
  // hacer — guardar la ficha de nuevo no debe lanzar un error de estado.
  if (appointment.value.status === 'completed') {
    justCompleted.value = true
    return
  }

  try {
    await appointmentsService.changeStatus(tenantId, appointment.value.id, 'completed')
    appointment.value = { ...appointment.value, status: 'completed' }
    justCompleted.value = true
  } catch {
    errorMessage.value = 'La ficha se guardó, pero no se pudo marcar la cita como completada.'
  }
}

// Se recarga la lista completa en vez de anexar la vacuna recién
// guardada a mano: así se muestra con el nombre de la vacuna (el join
// que hace listVaccinationsByPet), no con el vaccine_id crudo.
async function handleVaccinationSaved(): Promise<void> {
  const tenantId = session.activeTenantId
  if (!tenantId || !pet.value) return
  appliedVaccines.value = await recordsService.listVaccinationsByPet(tenantId, pet.value.id)
}
</script>

<template>
  <v-container class="py-6" style="max-width: 640px">
    <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-2" :to="`/app/citas/${props.id}`">
      Volver al detalle de la cita
    </v-btn>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-alert v-if="justCompleted" type="success" density="compact" variant="tonal" class="mb-4">
      Cita completada. El cobro estará disponible en la siguiente fase del proyecto.
    </v-alert>

    <v-progress-circular v-if="loading && !appointment" indeterminate color="primary" />

    <v-card v-else-if="appointment && pet" class="pa-4">
      <h1 class="text-h5 mb-1">{{ pet.name }}</h1>
      <p class="text-body-2 text-medium-emphasis mb-4">
        {{ customerName }} · {{ appointment.kind === 'grooming' ? 'Estética' : 'Veterinaria' }}
      </p>

      <GroomingRecordForm
        v-if="appointment.kind === 'grooming'"
        :tenant-id="session.activeTenantId!"
        :appointment-id="appointment.id"
        :pet-id="pet.id"
        :initial-record="existingGrooming"
        @saved="handleSaved"
      />

      <template v-else>
        <MedicalRecordForm
          :tenant-id="session.activeTenantId!"
          :appointment-id="appointment.id"
          :pet-id="pet.id"
          :initial-record="existingMedical"
          @saved="handleSaved"
        />

        <v-divider class="my-4" />

        <div class="d-flex align-center justify-space-between mb-2">
          <p class="text-subtitle-2">Vacunas aplicadas</p>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-needle" @click="showVaccinationDialog = true">
            Aplicar vacuna
          </v-btn>
        </div>
        <v-list v-if="appliedVaccines.length" density="compact">
          <v-list-item
            v-for="v in appliedVaccines"
            :key="v.id"
            :title="v.vaccineName"
            :subtitle="formatDate(v.applied_at, branch?.timezone ?? 'America/Mexico_City')"
          />
        </v-list>
        <p v-else class="text-body-2 text-medium-emphasis">Esta mascota no tiene vacunas registradas.</p>

        <VaccinationDialog
          v-model="showVaccinationDialog"
          :tenant-id="session.activeTenantId!"
          :pet-id="pet.id"
          :pet-species="pet.species"
          :applied-by-user-id="session.user!.id"
          :branch-timezone="branch?.timezone ?? 'America/Mexico_City'"
          :appointment-id="appointment.id"
          @saved="handleVaccinationSaved"
        />
      </template>
    </v-card>
  </v-container>
</template>
