<script setup lang="ts">
// Agenda en lista, para celular (< 600 px; fase 26, PLAN.md D29). El calendario de horas no se
// lee en una pantalla de 390 px, así que en su lugar se muestran las mismas citas ordenadas por
// hora, tocables, con el estado y el tipo en texto (aquí sí caben: el calendario los resume en
// color). Recibe los mismos bloques que el calendario, por eso no sabe nada de citas ni de zonas.
import { computed } from 'vue'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

import EmptyState from '@/components/EmptyState.vue'
import VisitKindChip from '@/components/VisitKindChip.vue'
import { groupBlocksByDay, timeRange } from '@/lib/agendaList'
import { AGENDA_STATUSES } from '@/lib/agendaStatus'
import type { CalendarBlock } from '@/lib/calendarGrid'

const props = defineProps<{
  blocks: CalendarBlock[]
  // Nombre del empleado de una cita (el calendario lo da la fila; aquí va en el texto).
  employeeName?: (userId: string) => string
}>()

const emit = defineEmits<{ select: [appointmentId: string] }>()

const groups = computed(() => groupBlocksByDay(props.blocks))
// El encabezado de día solo hace falta si hay más de un día (la semana de groomer/vet).
const showDayHeaders = computed(() => groups.value.length > 1)

function dayLabel(date: string): string {
  const [year, month, day] = date.split('-').map(Number)
  const text = format(new Date(year, month - 1, day), "EEEE d 'de' MMMM", { locale: es })
  return text.charAt(0).toUpperCase() + text.slice(1)
}

const ORIGIN_LABELS = { urgent: 'Urgente', walk_in: 'Sin cita' } as const
</script>

<template>
  <div class="agenda-list">
    <EmptyState
      v-if="groups.length === 0"
      compact
      illustration="calendar"
      title="Sin citas"
      message="No hay citas en este periodo."
    />

    <section v-for="group in groups" :key="group.date" class="agenda-list__group">
      <h3 v-if="showDayHeaders" class="agenda-list__day">{{ dayLabel(group.date) }}</h3>
      <v-card
        v-for="block in group.blocks"
        :key="block.id"
        variant="outlined"
        class="agenda-list__item"
        :style="{ '--ec-status': `var(--v-theme-${AGENDA_STATUSES[block.status].color})` }"
        role="button"
        tabindex="0"
        :aria-label="`${timeRange(block)}, ${block.pet}, ${block.customer}`"
        @click="emit('select', block.id)"
        @keydown.enter="emit('select', block.id)"
      >
        <div class="agenda-list__time">{{ timeRange(block) }}</div>
        <div class="agenda-list__main">
          <div class="agenda-list__pet">{{ block.pet }}</div>
          <div class="text-body-2 text-medium-emphasis">{{ block.customer }}</div>
          <div v-if="employeeName && block.resource" class="text-caption text-medium-emphasis">
            {{ employeeName(block.resource) }}
          </div>
          <div class="d-flex flex-wrap ga-1 mt-2">
            <v-chip
              size="x-small"
              variant="tonal"
              :color="AGENDA_STATUSES[block.status].color"
              :prepend-icon="AGENDA_STATUSES[block.status].icon"
            >
              {{ AGENDA_STATUSES[block.status].label }}
            </v-chip>
            <VisitKindChip :kind="block.kind" size="x-small" />
            <v-chip v-if="block.origin" size="x-small" variant="outlined">
              {{ ORIGIN_LABELS[block.origin] }}
            </v-chip>
          </div>
        </div>
      </v-card>
    </section>
  </div>
</template>

<style scoped lang="scss">
.agenda-list {
  padding: 12px;
}

.agenda-list__day {
  margin: 8px 0;
  font-size: 0.875rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
}

.agenda-list__item {
  display: flex;
  gap: 12px;
  padding: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  // Borde izquierdo del color del estado: el mismo recurso que el bloque del calendario.
  border-left: 4px solid rgb(var(--ec-status, var(--v-theme-secondary)));
}

.agenda-list__time {
  flex: none;
  width: 4.5rem;
  font-size: 0.8125rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.agenda-list__main {
  flex: 1;
  min-width: 0;
}

.agenda-list__pet {
  font-weight: 600;
  overflow-wrap: anywhere;
}
</style>
