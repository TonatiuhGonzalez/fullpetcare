<script setup lang="ts">
// Línea de tiempo del historial de una mascota (tarea 6.3): un ícono y un
// color distinto por tipo de evento (`v-timeline` de Vuetify). Componente
// tonto (CLAUDE.md §4): recibe los eventos ya mezclados y ordenados por
// services/petHistory.ts#getTimeline() (que a su vez usa
// lib/timeline.ts#buildTimeline(), la función pura que decide el orden).
import { formatDate } from '@/lib/datetime'
import type { TimelineEntry } from '@/lib/timeline'

const props = defineProps<{
  entries: TimelineEntry[]
  branchTimezone: string
}>()

const iconByType: Record<TimelineEntry['type'], string> = {
  grooming: 'mdi-content-cut',
  veterinary: 'mdi-stethoscope',
  vaccination: 'mdi-needle',
  weight: 'mdi-scale-bathroom',
}
const colorByType: Record<TimelineEntry['type'], string> = {
  grooming: 'secondary',
  veterinary: 'primary',
  vaccination: 'warning',
  weight: 'info',
}

/** Id único DENTRO de su tipo (cada tipo trae su propio campo de id) — se combina con el tipo para que la key de Vue nunca choque entre tipos distintos. */
function entryKey(entry: TimelineEntry): string {
  switch (entry.type) {
    case 'grooming':
    case 'veterinary':
      return `${entry.type}-${entry.appointmentId}`
    case 'vaccination':
      return `${entry.type}-${entry.vaccinationId}`
    case 'weight':
      return `${entry.type}-${entry.weightId}`
  }
}

function title(entry: TimelineEntry): string {
  switch (entry.type) {
    case 'grooming':
      return entry.cutStyle ? `Estética — ${entry.cutStyle}` : 'Estética'
    case 'veterinary':
      return entry.reason ? `Veterinaria — ${entry.reason}` : 'Veterinaria'
    case 'vaccination':
      return `Vacuna: ${entry.vaccineName}`
    case 'weight':
      return `Peso: ${(entry.weightGrams / 1000).toFixed(1)} kg`
  }
}

/** El detalle clínico (diagnóstico) solo aparece si RLS lo dejó pasar — un groomer no lo ve (CLAUDE.md §6.1), y aquí simplemente no llega el dato. */
function subtitle(entry: TimelineEntry): string | null {
  if (entry.type === 'grooming') return entry.groomerNotes
  if (entry.type === 'veterinary') return entry.diagnosis
  return null
}
</script>

<template>
  <p v-if="props.entries.length === 0" class="text-medium-emphasis">Sin historial todavía.</p>
  <v-timeline v-else density="compact" side="end" truncate-line="both">
    <v-timeline-item
      v-for="entry in props.entries"
      :key="entryKey(entry)"
      :dot-color="colorByType[entry.type]"
      :icon="iconByType[entry.type]"
      size="small"
    >
      <div class="d-flex justify-space-between align-start ga-2">
        <div>
          <p class="text-body-2 font-weight-medium mb-0">{{ title(entry) }}</p>
          <p v-if="subtitle(entry)" class="text-caption text-medium-emphasis mb-0">
            {{ subtitle(entry) }}
          </p>
        </div>
        <p class="text-caption text-medium-emphasis text-no-wrap">
          {{ formatDate(entry.at, props.branchTimezone) }}
        </p>
      </div>
    </v-timeline-item>
  </v-timeline>
</template>
