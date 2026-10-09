<script setup lang="ts">
// Vista de groomer/vet: COLUMNAS = días (una ventana fija, normalmente "hoy +
// 6 días" — la decide AgendaPage.vue vía stores/agenda.ts#visibleDates, este
// componente solo pinta las fechas que le llegan), FILAS = horas. Envuelve
// EventCalendar (@event-calendar/core, MIT) con su vista `timeGridWeek`
// — CLAUDE.md §3.
//
// Componente "tonto" (CLAUDE.md §4): recibe los bloques YA calculados (hora
// local de la sucursal, texto, color) — no sabe nada de citas ni de Supabase.
// No lleva fila de empleado: la agenda de un groomer/vet ya son solo SUS
// citas (RLS, role_permission_hardening.sql).
//
// "hoy + N días" (casi nunca empieza en lunes) se logra con una vista
// personalizada de duración fija. `views` solo se lee al crear el
// calendario, así que si cambia `days` se destruye y se vuelve a crear.
//
// Mismo criterio de fechas que EmployeeDayScheduler.vue: llegan como hora
// de pared de la sucursal, sin zona.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCalendar, destroyCalendar, TimeGrid } from '@event-calendar/core'
import '@event-calendar/core/index.css'

import { minutesToSlotTime } from '@/lib/calendarGrid'
import type { CalendarBlock, HourRange } from '@/lib/calendarGrid'
import { renderEventContent, toCalendarEvents } from './calendarEvents'

const props = defineProps<{
  /** 'YYYY-MM-DD', el primer día de la ventana. */
  startDate: string
  /** Cuántos días consecutivos mostrar (columnas). */
  days: number
  hourRange: HourRange
  blocks: CalendarBlock[]
}>()

const emit = defineEmits<{ select: [id: string] }>()

const host = ref<HTMLElement | null>(null)
let calendar: ReturnType<typeof createCalendar> | null = null

function mountCalendar() {
  if (!host.value) return
  calendar = createCalendar(host.value, [TimeGrid], {
    view: 'timeGridWindow',
    views: { timeGridWindow: { type: 'timeGridWeek', duration: { days: props.days } } },
    date: props.startDate,
    headerToolbar: { start: '', center: '', end: '' },
    locale: 'es-MX',
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    allDaySlot: false,
    slotMinTime: minutesToSlotTime(props.hourRange.startMinutes),
    slotMaxTime: minutesToSlotTime(props.hourRange.endMinutes),
    slotDuration: '00:30',
    height: '640px',
    events: toCalendarEvents(props.blocks),
    editable: false,
    eventContent: renderEventContent,
    eventClick: (info) => emit('select', String(info.event.id)),
    // Tooltip nativo con el texto completo: con citas simultáneas la
    // tarjeta queda angosta y recorta el texto.
    eventDidMount: (info) => {
      info.el.title = String(info.event.title)
    },
  })
}

function unmountCalendar() {
  if (calendar) void destroyCalendar(calendar)
  calendar = null
}

onMounted(mountCalendar)
onBeforeUnmount(unmountCalendar)

watch(
  () => props.days,
  () => {
    unmountCalendar()
    mountCalendar()
  },
)
watch(
  () => props.startDate,
  (date) => calendar?.setOption('date', date),
)
watch(
  () => props.hourRange,
  (range) => {
    calendar?.setOption('slotMinTime', minutesToSlotTime(range.startMinutes))
    calendar?.setOption('slotMaxTime', minutesToSlotTime(range.endMinutes))
  },
)
watch(
  () => props.blocks,
  (blocks) => calendar?.setOption('events', toCalendarEvents(blocks)),
)
</script>

<template>
  <div ref="host" class="ec-host" />
</template>

<style scoped lang="scss">
// Mismo enlace con la paleta de Vuetify que EventCalendarScheduler.vue
// (el DOM de EventCalendar no es Vue, por eso :deep()).
.ec-host :deep(.ec) {
  --ec-border-color: rgba(var(--v-border-color), 0.3);
  --ec-bg-color: rgb(var(--v-theme-surface));
  --ec-text-color: rgb(var(--v-theme-on-surface));
  --ec-today-bg-color: rgba(var(--v-theme-primary), 0.08);
  --ec-highlight-color: rgba(var(--v-theme-primary), 0.08);
  font-family: inherit;
}

// Máximo 2 líneas con "…" (no media línea cortada); texto completo en el
// tooltip (eventDidMount).
.ec-host :deep(.ec-event-title) {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  font-size: 0.8rem;
  line-height: 1.2;
}

// Las líneas de cada hora las dibuja EventCalendar con degradados de fondo
// que se REPITEN. El reset global de Vuetify pone `background-repeat:
// no-repeat` a todo, así que sin esto casi no se veían. Mismo orden que
// las capas de `background-image` de EventCalendar: la 2 y la 4 son las
// líneas de las horas (se repiten en vertical); las demás son rellenos.
.ec-host :deep(.ec-body .ec-day) {
  background-repeat: no-repeat, repeat-y, no-repeat, repeat-y;
}
</style>
