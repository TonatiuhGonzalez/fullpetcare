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
import { isFrontDesk, visibleTimelineTypes } from '@/lib/roles'
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

// groomer/vet: historial limitado a lo que les toca (UAT) —
// visibleTimelineTypes() ya explica el porqué de cada caso.
// medical_records ya viene filtrado por RLS para groomer (fase 4); esto
// es lo mismo pero para lo que RLS SÍ deja leer (vaccination/weight) y
// que ahora también hay que ocultar en su vista.
const visibleTimeline = computed(() =>
  timeline.value.filter((entry) => visibleTimelineTypes(session.role).includes(entry.type)),
)

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
    <!-- groomer/vet no tienen acceso al listado/ficha de clientes (UAT,
         router/index.ts) — para ellos este botón regresa a la agenda, de
         donde llegaron (vía la cita que están atendiendo), en vez de a
         una página a la que no pueden entrar. -->
    <v-btn
      v-if="pet && isFrontDesk(session.role)"
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2"
      :to="`/app/clientes/${pet.customer_id}`"
    >
      Volver al cliente
    </v-btn>
    <v-btn
      v-else-if="pet"
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2"
      to="/app/agenda"
    >
      Volver a la agenda
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
              <!-- Puede VER la ficha (RLS ya lo permite), pero editarla es
                   tarea de recepción (CLAUDE.md §6.1) — el backend ya lo
                   rechaza (pets_update), esto solo evita el botón. -->
              <v-btn
                v-if="isFrontDesk(session.role)"
                variant="text"
                prepend-icon="mdi-pencil"
                @click="showEditPet = true"
              >
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

      <!-- Cartilla: RLS ya limita a groomer a solo la vacuna VIGENTE de
           cada tipo (role_permission_hardening.sql) — VaccinationCard
           igual se queda con "una fila por vacuna, la más reciente" (tarea
           6.4), así que no necesita cambio para mostrarse bien con esos
           datos ya recortados.

           Peso: a groomer, RLS igual solo le llega LA pesada más
           reciente — una gráfica con un solo punto no dice nada útil, así
           que directamente se oculta para él (el "Peso actual" de la
           tarjeta de arriba ya cubre lo que sí puede ver). -->
      <v-row>
        <v-col cols="12" md="6">
          <VaccinationCard :vaccinations="vaccinations" :branch-timezone="displayTimezone" />
        </v-col>
        <v-col v-if="session.role !== 'groomer'" cols="12" md="6">
          <WeightChart :weights="weights" />
        </v-col>
      </v-row>

      <v-card class="pa-4 mt-4">
        <p class="text-subtitle-1 mb-2">Historial</p>
        <PetTimeline :entries="visibleTimeline" :branch-timezone="displayTimezone" />
      </v-card>

      <!-- Generar/revocar el link público es tarea de recepción (UAT,
           share_links_insert/update en role_permission_hardening.sql). -->
      <ShareLinkManager
        v-if="session.activeTenantId && isFrontDesk(session.role)"
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
