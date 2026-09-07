<script setup lang="ts">
// Cartilla de vacunación (tarea 6.4): una fila por VACUNA (no por
// aplicación), con el estado de la dosis más reciente. Componente tonto
// (CLAUDE.md §4): recibe la lista ya cargada por
// services/records.ts#listVaccinationsByPet, no habla con Supabase.
import { computed } from 'vue'
import { format } from 'date-fns'

import { classifyVaccineStatus, type VaccineStatus } from '@/lib/vaccination'
import { formatDate } from '@/lib/datetime'
import type { VaccinationWithName } from '@/services/records'

const props = defineProps<{
  vaccinations: VaccinationWithName[]
  branchTimezone: string
}>()

const statusLabels: Record<VaccineStatus, string> = {
  current: 'Vigente',
  due_soon: 'Por vencer',
  overdue: 'Vencida',
}
const statusColors: Record<VaccineStatus, string> = {
  current: 'success',
  due_soon: 'warning',
  overdue: 'error',
}

interface CartillaRow {
  vaccineName: string
  appliedAt: string
  nextDueDate: string | null
  status: VaccineStatus | null
}

const rows = computed<CartillaRow[]>(() => {
  const today = format(new Date(), 'yyyy-MM-dd')
  const seenVaccineNames = new Set<string>()
  const result: CartillaRow[] = []

  // listVaccinationsByPet ya ordena de la aplicación más reciente a la
  // más vieja — la PRIMERA vez que aparece cada nombre de vacuna en el
  // arreglo es, por construcción, su aplicación más reciente.
  for (const vaccination of props.vaccinations) {
    if (seenVaccineNames.has(vaccination.vaccineName)) continue
    seenVaccineNames.add(vaccination.vaccineName)
    result.push({
      vaccineName: vaccination.vaccineName,
      appliedAt: vaccination.applied_at,
      nextDueDate: vaccination.next_due_date,
      status: classifyVaccineStatus(vaccination.next_due_date, today),
    })
  }
  return result
})
</script>

<template>
  <v-card variant="outlined">
    <v-card-title class="text-subtitle-1">Cartilla de vacunación</v-card-title>
    <v-card-text v-if="rows.length === 0" class="text-medium-emphasis">
      Sin vacunas aplicadas todavía.
    </v-card-text>
    <v-list v-else density="compact">
      <v-list-item v-for="row in rows" :key="row.vaccineName">
        <template #title>{{ row.vaccineName }}</template>
        <template #subtitle>
          Aplicada: {{ formatDate(row.appliedAt, branchTimezone) }}
          <span v-if="row.nextDueDate"> · Próxima dosis: {{ row.nextDueDate }}</span>
        </template>
        <template #append>
          <v-chip v-if="row.status" size="small" :color="statusColors[row.status]" variant="tonal">
            {{ statusLabels[row.status] }}
          </v-chip>
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
