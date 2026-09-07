<script setup lang="ts">
// Ficha de mascota FINAL (tarea 6.6): foto, datos, alertas médicas,
// cartilla de vacunación, gráfica de peso, línea de tiempo de todo su
// historial (estética + veterinaria mezcladas, CLAUDE.md §1 punto 6), y
// próximas citas. Reemplaza la versión provisional de la tarea 2.20, que
// solo tenía foto/datos/peso actual — el historial completo necesitaba
// que existieran citas de verdad (fase 3) y fichas de atención (fase 4),
// que en la fase 2 todavía no existían.
import { computed, onMounted, ref } from 'vue'

import * as petsService from '@/services/pets'
import type { Pet, PetWeight } from '@/services/pets'
import * as recordsService from '@/services/records'
import type { VaccinationWithName } from '@/services/records'
import * as appointmentsService from '@/services/appointments'
import type { UpcomingAppointment } from '@/services/appointments'
import * as petHistoryService from '@/services/petHistory'
import type { TimelineEntry } from '@/lib/timeline'
import { formatDate, formatTime } from '@/lib/datetime'
import { sexLabel, speciesLabel } from '@/lib/petLabels'
import { useSessionStore } from '@/stores/session'
import PetFormDialog from '@/components/PetFormDialog.vue'
import VaccinationCard from '@/components/VaccinationCard.vue'
import WeightChart from '@/components/WeightChart.vue'
import PetTimeline from '@/components/PetTimeline.vue'
import ShareLinkManager from '@/components/ShareLinkManager.vue'

const props = defineProps<{ id: string }>()

const session = useSessionStore()

const pet = ref<Pet | null>(null)
const weights = ref<PetWeight[]>([])
const vaccinations = ref<VaccinationWithName[]>([])
const timeline = ref<TimelineEntry[]>([])
const upcomingAppointments = ref<UpcomingAppointment[]>([])
const photoUrl = ref<string | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const showEditPet = ref(false)

const currentWeightKg = computed(() => {
  const latest = weights.value[0]
  if (!latest) return null
  return (latest.weight_grams / 1000).toFixed(1)
})

// El historial y la cartilla pueden mezclar visitas de MÁS de una
// sucursal (una mascota no está atada a una sola) — se usa la sucursal
// ACTIVA de la sesión para mostrar fechas, la misma aproximación que ya
// usa el resto de la app fuera de la agenda (CLAUDE.md §8.3: siempre una
// zona de sucursal, nunca la del navegador; aquí, a falta de "la
// sucursal de este evento en particular" para vacunas y pesos —que no
// llevan sucursal—, se usa la de la sesión).
const displayTimezone = computed(() => session.activeBranch?.timezone ?? 'America/Mexico_City')

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [foundPet, weightHistory, vaccinationHistory, historyTimeline, upcoming] =
      await Promise.all([
        petsService.getById(session.activeTenantId, props.id),
        petsService.listWeights(session.activeTenantId, props.id),
        recordsService.listVaccinationsByPet(session.activeTenantId, props.id),
        petHistoryService.getTimeline(session.activeTenantId, props.id),
        appointmentsService.listUpcomingByPet(session.activeTenantId, props.id),
      ])
    pet.value = foundPet
    weights.value = weightHistory
    vaccinations.value = vaccinationHistory
    timeline.value = historyTimeline
    upcomingAppointments.value = upcoming
    photoUrl.value = foundPet?.photo_path
      ? await petsService.getPhotoUrl(foundPet.photo_path)
      : null
  } catch {
    errorMessage.value = 'No se pudo cargar la mascota. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6" style="max-width: 720px">
    <v-btn
      v-if="pet"
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2"
      :to="`/app/clientes/${pet.customer_id}`"
    >
      Volver al cliente
    </v-btn>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-progress-circular v-if="loading && !pet" indeterminate color="primary" />

    <template v-else-if="pet">
      <v-card class="pa-4 mb-4">
        <div class="d-flex align-start">
          <v-avatar size="96" class="mr-4" color="primary">
            <v-img v-if="photoUrl" :src="photoUrl" :alt="pet.name" cover />
            <v-icon v-else :icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'" size="48" />
          </v-avatar>

          <div class="flex-grow-1">
            <div class="d-flex align-center">
              <h1 class="text-h5">{{ pet.name }}</h1>
              <v-spacer />
              <v-btn variant="text" prepend-icon="mdi-pencil" @click="showEditPet = true">
                Editar
              </v-btn>
            </div>

            <p class="mb-1">
              {{ speciesLabel(pet.species) }}<span v-if="pet.breed"> · {{ pet.breed }}</span> ·
              {{ sexLabel(pet.sex) }}
            </p>
            <p v-if="pet.birth_date" class="mb-1 text-body-2 text-medium-emphasis">
              Nació: {{ pet.birth_date }}
            </p>
            <p class="mb-1 text-body-2">
              {{ pet.is_sterilized ? 'Esterilizado(a)' : 'No esterilizado(a)' }}
            </p>
            <p class="mb-1">
              <strong>Peso actual:</strong>
              {{ currentWeightKg ? `${currentWeightKg} kg` : 'Sin registros todavía' }}
            </p>

            <v-alert
              v-if="pet.medical_alerts"
              type="warning"
              density="compact"
              variant="tonal"
              class="mt-2"
            >
              {{ pet.medical_alerts }}
            </v-alert>
            <p v-if="pet.grooming_notes" class="text-body-2 text-medium-emphasis mt-2">
              <strong>Preferencias de corte:</strong> {{ pet.grooming_notes }}
            </p>
          </div>
        </div>
      </v-card>

      <v-card v-if="upcomingAppointments.length > 0" class="pa-4 mb-4">
        <p class="text-subtitle-1 mb-2">Próximas citas</p>
        <v-list density="compact">
          <v-list-item
            v-for="appointment in upcomingAppointments"
            :key="appointment.id"
            :to="`/app/citas/${appointment.id}`"
          >
            <template #title>
              {{ formatDate(appointment.starts_at, appointment.branchTimezone) }} ·
              {{ formatTime(appointment.starts_at, appointment.branchTimezone) }}
            </template>
            <template #subtitle>
              {{ appointment.kind === 'grooming' ? 'Estética' : 'Veterinaria' }} ·
              {{ appointment.branchName }}
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <v-row>
        <v-col cols="12" md="6">
          <VaccinationCard :vaccinations="vaccinations" :branch-timezone="displayTimezone" />
        </v-col>
        <v-col cols="12" md="6">
          <WeightChart :weights="weights" />
        </v-col>
      </v-row>

      <v-card class="pa-4 mt-4">
        <p class="text-subtitle-1 mb-2">Historial</p>
        <PetTimeline :entries="timeline" :branch-timezone="displayTimezone" />
      </v-card>

      <ShareLinkManager
        v-if="session.activeTenantId"
        class="mt-4"
        :tenant-id="session.activeTenantId"
        :pet-id="pet.id"
      />
    </template>

    <PetFormDialog
      v-if="pet"
      v-model="showEditPet"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="pet.customer_id"
      :pet="pet"
      @saved="handleSaved"
    />
  </v-container>
</template>
