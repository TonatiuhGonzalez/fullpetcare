<script setup lang="ts">
// Vista pública de una mascota (tarea 7.12), servida por la Edge Function
// public-pet-view (tarea 7.4) — este componente NUNCA habla con
// Postgres/RLS directo, solo llama esa función con el token de la URL.
// El DTO que regresa ya es la lista blanca completa (CLAUDE.md §7.4): no
// hay nada más "interno" que filtrar de este lado.
import { computed, onMounted, ref } from 'vue'
import { format } from 'date-fns'

import { supabase } from '@/services/supabase'
import { formatDate } from '@/lib/datetime'
import { classifyVaccineStatus, type VaccineStatus } from '@/lib/vaccination'
import { sexLabel, speciesLabel } from '@/lib/petLabels'
import type { Database } from '@/types/database'

type AppointmentKind = Database['public']['Enums']['service_kind']

const props = defineProps<{ token: string }>()
const emit = defineEmits<{ 'business-name': [name: string] }>()

interface PublicVaccination {
  vaccineName: string
  appliedAt: string
  nextDueDate: string | null
}
interface PublicVisit {
  kind: AppointmentKind
  startsAt: string
  branchTimezone: string
  employeeName: string
  detail: string | null
}
interface PublicUpcoming {
  kind: AppointmentKind
  startsAt: string
  branchTimezone: string
}
interface PublicPetDto {
  businessName: string
  businessTimezone: string
  pet: {
    name: string
    species: Database['public']['Enums']['pet_species']
    breed: string | null
    sex: Database['public']['Enums']['pet_sex'] | null
    birthDate: string | null
    photoUrl: string | null
  }
  vaccinations: PublicVaccination[]
  visits: PublicVisit[]
  upcomingAppointments: PublicUpcoming[]
}

const status = ref<'loading' | 'ready' | 'error'>('loading')
const data = ref<PublicPetDto | null>(null)
const today = format(new Date(), 'yyyy-MM-dd')

const kindLabels: Record<AppointmentKind, string> = { grooming: 'Estética', veterinary: 'Veterinaria' }
const vaccineStatusLabels: Record<VaccineStatus, string> = {
  current: 'Vigente',
  due_soon: 'Por vencer',
  overdue: 'Vencida',
}
const vaccineStatusColors: Record<VaccineStatus, string> = {
  current: 'success',
  due_soon: 'warning',
  overdue: 'error',
}

function vaccineStatus(vaccination: PublicVaccination): VaccineStatus | null {
  return classifyVaccineStatus(vaccination.nextDueDate, today)
}

const petIcon = computed(() => (data.value?.pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'))

async function load(): Promise<void> {
  status.value = 'loading'
  try {
    const { data: result, error } = await supabase.functions.invoke('public-pet-view', {
      body: { token: props.token },
    })
    // La Edge Function devuelve el MISMO mensaje genérico para token
    // revocado, vencido, inexistente o mal formado (tarea 7.7) — de este
    // lado no hay nada más específico que mostrar, ni falta que hace
    // (CLAUDE.md §7.4: nunca detalles técnicos en la vista pública).
    if (error || !result) {
      status.value = 'error'
      return
    }
    data.value = result as PublicPetDto
    emit('business-name', data.value.businessName)
    status.value = 'ready'
  } catch {
    status.value = 'error'
  }
}

onMounted(load)
</script>

<template>
  <v-container class="py-4" style="max-width: 480px">
    <v-progress-circular
      v-if="status === 'loading'"
      indeterminate
      color="primary"
      class="d-block mx-auto mt-8"
    />

    <v-alert v-else-if="status === 'error'" type="warning" variant="tonal" class="mt-4">
      Este link no es válido o ya venció. Pide uno nuevo al negocio.
    </v-alert>

    <template v-else-if="data">
      <v-card class="pa-4 mb-4 text-center">
        <v-avatar size="120" color="primary" class="mb-2">
          <v-img v-if="data.pet.photoUrl" :src="data.pet.photoUrl" :alt="data.pet.name" cover />
          <v-icon v-else :icon="petIcon" size="64" />
        </v-avatar>
        <h1 class="text-h5">{{ data.pet.name }}</h1>
        <p class="text-body-2 text-medium-emphasis">
          {{ speciesLabel(data.pet.species) }}<span v-if="data.pet.breed"> · {{ data.pet.breed }}</span> ·
          {{ sexLabel(data.pet.sex) }}
        </p>
        <p v-if="data.pet.birthDate" class="text-caption text-medium-emphasis">
          Nació: {{ data.pet.birthDate }}
        </p>
      </v-card>

      <v-card v-if="data.upcomingAppointments.length > 0" class="pa-4 mb-4">
        <p class="text-subtitle-1 mb-2">Próximas citas</p>
        <v-list density="compact">
          <v-list-item v-for="(appointment, index) in data.upcomingAppointments" :key="index">
            <template #title>
              {{ formatDate(appointment.startsAt, appointment.branchTimezone) }}
            </template>
            <template #subtitle>{{ kindLabels[appointment.kind] }}</template>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card class="pa-4 mb-4">
        <p class="text-subtitle-1 mb-2">Cartilla de vacunación</p>
        <p v-if="data.vaccinations.length === 0" class="text-medium-emphasis">
          Sin vacunas aplicadas todavía.
        </p>
        <v-list v-else density="compact">
          <v-list-item v-for="(vaccination, index) in data.vaccinations" :key="index">
            <template #title>{{ vaccination.vaccineName }}</template>
            <template #subtitle>
              Aplicada: {{ formatDate(vaccination.appliedAt, data.businessTimezone) }}
            </template>
            <template #append>
              <v-chip
                v-if="vaccineStatus(vaccination)"
                size="small"
                :color="vaccineStatusColors[vaccineStatus(vaccination)!]"
                variant="tonal"
              >
                {{ vaccineStatusLabels[vaccineStatus(vaccination)!] }}
              </v-chip>
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card class="pa-4">
        <p class="text-subtitle-1 mb-2">Historial de visitas</p>
        <p v-if="data.visits.length === 0" class="text-medium-emphasis">Sin visitas todavía.</p>
        <v-list v-else density="compact">
          <v-list-item v-for="(visit, index) in data.visits" :key="index">
            <template #title>
              {{ kindLabels[visit.kind] }}<span v-if="visit.detail"> — {{ visit.detail }}</span>
            </template>
            <template #subtitle>
              {{ formatDate(visit.startsAt, visit.branchTimezone) }}
              <span v-if="visit.employeeName"> · {{ visit.employeeName }}</span>
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>
  </v-container>
</template>
