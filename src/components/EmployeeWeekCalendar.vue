<script setup lang="ts">
// Vista de groomer/vet (rediseño 2026-09-08, pedido explícito): COLUMNAS
// = días (una ventana fija, normalmente "hoy + 6 días" — la decide
// AgendaPage.vue vía stores/agenda.ts#visibleDates, este componente solo
// pinta las fechas que le llegan), FILAS = horas. Envuelve
// DayPilotCalendar de @daypilot/daypilot-lite-vue con viewType="Days"
// (a diferencia de "Week", "Days" no obliga a alinear a lunes — hace
// falta para "hoy + 6 días", que casi nunca empieza en lunes).
//
// Se configura con UN SOLO objeto `:config` — mismo motivo que
// EmployeeDayScheduler.vue: props sueltas por atributo no llegaban de
// forma confiable al control real (verificado a mano en el navegador
// con el Scheduler); `:config` sí.
//
// Componente "tonto" (CLAUDE.md §4): recibe los bloques YA calculados
// (hora local de la sucursal, texto, color) — no sabe nada de citas ni de
// Supabase. No lleva fila de empleado: la agenda de un groomer/vet ya
// son solo SUS citas (RLS, role_permission_hardening.sql), no hace falta
// esa dimensión aquí.
import { computed } from 'vue'
import { DayPilot, DayPilotCalendar } from '@daypilot/daypilot-lite-vue'

import type { CalendarBlock, HourRange } from '@/lib/calendarGrid'

const props = defineProps<{
  /** 'YYYY-MM-DD', el primer día de la ventana. */
  startDate: string
  /** Cuántos días consecutivos mostrar (columnas). */
  days: number
  hourRange: HourRange
  blocks: CalendarBlock[]
}>()

const emit = defineEmits<{ select: [id: string] }>()

const config = computed<DayPilot.CalendarConfig>(() => ({
  viewType: 'Days',
  days: props.days,
  startDate: props.startDate,
  businessBeginsHour: Math.floor(props.hourRange.startMinutes / 60),
  businessEndsHour: Math.ceil(props.hourRange.endMinutes / 60),
  heightSpec: 'BusinessHoursNoScroll',
  height: 640,
  events: props.blocks.map((block) => ({
    id: block.id,
    start: block.start,
    end: block.end,
    text: block.text,
    backColor: block.color,
    fontColor: '#ffffff',
    borderColor: 'transparent',
  })),
  onEventClick: (args) => emit('select', String(args.e.id())),
}))
</script>

<template>
  <DayPilotCalendar :config="config" />
</template>
