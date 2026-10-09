<script setup lang="ts">
// Vista pública de una mascota (tarea 7.12), servida por la Edge Function
// public-pet-view (tarea 7.4) — este componente NUNCA habla con
// Postgres/RLS directo, solo llama esa función con el token de la URL.
// El DTO que regresa ya es la lista blanca completa (CLAUDE.md §7.4): no
// hay nada más "interno" que filtrar de este lado.
//
// Rediseño de la fase 15 (PLAN.md D20): foto grande, cartilla con un resumen y estados
// con ícono y texto, y el tipo de visita con su color. Es solo presentación: no cambia
// lo que la función devuelve.
import { computed, onMounted, ref } from 'vue'

import VisitKindChip from '@/components/VisitKindChip.vue'
import { branchToday, formatDate, formatDateOnly } from '@/lib/datetime'
import { sexLabel, speciesLabel } from '@/lib/petLabels'
import {
  cardHeadline,
  cardOverview,
  classifyVaccineStatus,
  type VaccineStatus,
} from '@/lib/vaccination'
import { supabase } from '@/services/supabase'
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

// "Hoy" en la zona horaria del negocio, no la del teléfono de quien abre el link.
const today = computed(() => (data.value ? branchToday(data.value.businessTimezone) : ''))

// Cada estado lleva color, ícono y texto: el color nunca va solo.
const vaccineStatus: Record<
  VaccineStatus,
  { label: string; color: 'success' | 'warning' | 'error'; icon: string }
> = {
  current: { label: 'Vigente', color: 'success', icon: 'mdi-check-circle' },
  due_soon: { label: 'Por vencer', color: 'warning', icon: 'mdi-clock-alert-outline' },
  overdue: { label: 'Vencida', color: 'error', icon: 'mdi-alert-circle' },
}

function statusOf(vaccination: PublicVaccination): VaccineStatus | null {
  return classifyVaccineStatus(vaccination.nextDueDate, today.value)
}

// Resumen de la cartilla: lo más urgente primero (vencidas, por vencer, al día).
const headline = computed(() => {
  if (!data.value) return null
  return cardHeadline(cardOverview(data.value.vaccinations.map(statusOf)))
})

const petIcon = computed(() =>
  data.value?.pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog',
)

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
  <v-container class="py-4" max-width="480">
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
      <!-- Foto grande de la mascota sobre una franja de color de marca. -->
      <v-card class="pet-hero mb-4">
        <div class="pet-hero__cover" />
        <div class="px-4 pb-5 text-center">
          <v-avatar size="136" color="primary" class="pet-hero__photo">
            <v-img
              v-if="data.pet.photoUrl"
              :src="data.pet.photoUrl"
              :alt="data.pet.name"
              cover
            />
            <v-icon v-else :icon="petIcon" size="72" />
          </v-avatar>
          <h1 class="text-h4 font-weight-bold mt-3">{{ data.pet.name }}</h1>
          <div class="d-flex flex-wrap justify-center ga-2 mt-3">
            <v-chip size="small" variant="tonal" :prepend-icon="petIcon">
              {{ speciesLabel(data.pet.species) }}
            </v-chip>
            <v-chip v-if="data.pet.breed" size="small" variant="tonal">
              {{ data.pet.breed }}
            </v-chip>
            <v-chip v-if="data.pet.sex" size="small" variant="tonal">
              {{ sexLabel(data.pet.sex) }}
            </v-chip>
          </div>
          <p v-if="data.pet.birthDate" class="text-body-2 text-medium-emphasis mt-3">
            Nació el {{ formatDateOnly(data.pet.birthDate) }}
          </p>
        </div>
      </v-card>

      <v-card v-if="data.upcomingAppointments.length > 0" class="pa-4 mb-4">
        <h2 class="section-title">
          <v-icon icon="mdi-calendar-clock-outline" color="primary" class="mr-2" />
          Próximas citas
        </h2>
        <v-list density="comfortable" class="pa-0">
          <v-list-item
            v-for="(appointment, index) in data.upcomingAppointments"
            :key="index"
            class="px-0"
          >
            <template #title>
              {{ formatDate(appointment.startsAt, appointment.branchTimezone) }}
            </template>
            <template #append>
              <VisitKindChip :kind="appointment.kind" />
            </template>
          </v-list-item>
        </v-list>
      </v-card>

      <v-card class="pa-4 mb-4">
        <h2 class="section-title">
          <v-icon icon="mdi-needle" color="primary" class="mr-2" />
          Cartilla de vacunación
        </h2>

        <p v-if="data.vaccinations.length === 0" class="text-medium-emphasis">
          Sin vacunas aplicadas todavía.
        </p>
        <template v-else>
          <v-alert
            v-if="headline"
            :type="vaccineStatus[headline.level].color"
            :icon="vaccineStatus[headline.level].icon"
            variant="tonal"
            density="comfortable"
            class="mb-2"
          >
            {{ headline.text }}
          </v-alert>

          <!-- Una fila por vacuna: nombre y estado arriba, fechas debajo a todo el ancho (con
               el estado a un lado, "Próxima dosis: 18 de octubre de 2026" se cortaba). -->
          <ul class="vaccine-list">
            <li v-for="(vaccination, index) in data.vaccinations" :key="index">
              <div class="d-flex align-center justify-space-between ga-2">
                <span class="font-weight-medium">{{ vaccination.vaccineName }}</span>
                <v-chip
                  v-if="statusOf(vaccination)"
                  size="small"
                  variant="tonal"
                  :color="vaccineStatus[statusOf(vaccination)!].color"
                  :prepend-icon="vaccineStatus[statusOf(vaccination)!].icon"
                >
                  {{ vaccineStatus[statusOf(vaccination)!].label }}
                </v-chip>
              </div>
              <div class="text-body-2 text-medium-emphasis">
                Aplicada: {{ formatDate(vaccination.appliedAt, data.businessTimezone) }}
              </div>
              <div
                v-if="vaccination.nextDueDate"
                class="text-body-2 text-medium-emphasis"
              >
                Próxima dosis: {{ formatDateOnly(vaccination.nextDueDate) }}
              </div>
            </li>
          </ul>
        </template>
      </v-card>

      <v-card class="pa-4">
        <h2 class="section-title">
          <v-icon icon="mdi-history" color="primary" class="mr-2" />
          Historial de visitas
        </h2>
        <p v-if="data.visits.length === 0" class="text-medium-emphasis">
          Sin visitas todavía.
        </p>
        <v-list v-else lines="two" density="comfortable" class="pa-0">
          <v-list-item v-for="(visit, index) in data.visits" :key="index" class="px-0">
            <template #title>
              {{ formatDate(visit.startsAt, visit.branchTimezone) }}
            </template>
            <template #subtitle>
              {{ [visit.detail, visit.employeeName].filter(Boolean).join(' · ') }}
            </template>
            <template #append>
              <VisitKindChip :kind="visit.kind" />
            </template>
          </v-list-item>
        </v-list>
      </v-card>
    </template>
  </v-container>
</template>

<style scoped lang="scss">
// Franja de color de marca (los mismos verdes del panel del login).
$brand-deep: #0a4d49;
$brand: #0f6b66;

.pet-hero {
  &__cover {
    height: 96px;
    background: linear-gradient(160deg, $brand-deep 0%, $brand 100%);
  }

  // La foto sube sobre la franja; el borde del color de la tarjeta la separa del fondo.
  &__photo {
    margin-top: -68px;
    border: 4px solid rgb(var(--v-theme-surface));
  }
}

.vaccine-list {
  list-style: none;
  margin: 0;
  padding: 0;

  li {
    padding: 12px 0;
  }

  li + li {
    border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  }
}

.section-title {
  display: flex;
  align-items: center;
  margin-bottom: 8px;
  font-size: 1rem;
  font-weight: 700;
}
</style>
