<script setup lang="ts">
// Vista de dueño/recepción: un solo día, FILAS = empleados, COLUMNAS = horas
// de ese día. Envuelve EventCalendar (@event-calendar/core, MIT) con su vista
// `resourceTimelineDay` — CLAUDE.md §3.
//
// `slotMinTime`/`slotMaxTime` RECORTAN las horas fuera del horario de la
// sucursal (el Scheduler de DayPilot Lite, usado antes, solo podía
// atenuarlas).
//
// Componente "tonto" (CLAUDE.md §4): recibe los bloques YA calculados (hora
// local de la sucursal, texto, color) — no sabe nada de citas ni de Supabase.
//
// EventCalendar no es un componente Vue: se crea con createCalendar() sobre
// un elemento del DOM. Por eso el ciclo de vida se hace a mano: crear en
// onMounted, actualizar opciones con setOption() cuando cambian las props,
// destruir en onBeforeUnmount.
//
// Las fechas llegan como hora local de la sucursal SIN zona
// (lib/datetime.ts#toNaiveLocalIso). EventCalendar las lee como hora de
// pared del navegador y las pinta igual: correcto para el requisito de
// §8.3 (ver la hora de la sucursal, no la del navegador). Por eso NO se
// activa `nowIndicator`: usaría el reloj del navegador.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { createCalendar, destroyCalendar, ResourceTimeline } from '@event-calendar/core'
import '@event-calendar/core/index.css'

import { minutesToSlotTime } from '@/lib/calendarGrid'
import type { CalendarBlock, HourRange } from '@/lib/calendarGrid'

export interface SchedulerRow {
  id: string
  name: string
}

const props = defineProps<{
  /** 'YYYY-MM-DD', el día que se está mostrando. */
  date: string
  hourRange: HourRange
  /** Una fila por empleado de la sucursal activa. */
  rows: SchedulerRow[]
  blocks: CalendarBlock[]
}>()

const emit = defineEmits<{ select: [id: string] }>()

const host = ref<HTMLElement | null>(null)
let calendar: ReturnType<typeof createCalendar> | null = null
let resizeObserver: ResizeObserver | null = null

// Ancho de la columna de nombres (170 px) — también
// está en el CSS de abajo (--ec-sidebar-width).
const SIDEBAR_PX = 170
const MIN_SLOT_PX = 90

// EventCalendar necesita el ancho de cada hora en píxeles (`slotWidth`).
// Se calcula para que las horas LLENEN el ancho disponible (sin hueco a la
// derecha en pantallas anchas) y nunca bajen de MIN_SLOT_PX, para que el
// texto de una cita de una hora siga siendo legible; si no caben, aparece
// scroll horizontal.
function computeSlotWidth(): number {
  const hours = Math.max(
    1,
    Math.ceil((props.hourRange.endMinutes - props.hourRange.startMinutes) / 60),
  )
  // Ancho real de la columna de nombres, ya pintada (si aún no existe, el valor de arriba).
  const sidebar =
    host.value?.querySelector<HTMLElement>('.ec-sidebar')?.offsetWidth ?? SIDEBAR_PX
  const available = (host.value?.clientWidth ?? 0) - sidebar
  return Math.max(MIN_SLOT_PX, Math.floor(available / hours))
}

function toEvents(blocks: CalendarBlock[]) {
  return blocks.map((block) => ({
    id: block.id,
    start: block.start,
    end: block.end,
    title: block.text,
    resourceIds: block.resource ? [block.resource] : [],
    backgroundColor: block.color,
    textColor: '#ffffff',
  }))
}

onMounted(() => {
  if (!host.value) return
  calendar = createCalendar(host.value, [ResourceTimeline], {
    view: 'resourceTimelineDay',
    date: props.date,
    headerToolbar: { start: '', center: '', end: '' },
    locale: 'es-MX',
    slotLabelFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    eventTimeFormat: { hour: '2-digit', minute: '2-digit', hour12: false },
    slotMinTime: minutesToSlotTime(props.hourRange.startMinutes),
    slotMaxTime: minutesToSlotTime(props.hourRange.endMinutes),
    slotDuration: '01:00',
    slotWidth: computeSlotWidth(),
    resources: props.rows.map((row) => ({ id: row.id, title: row.name })),
    events: toEvents(props.blocks),
    editable: false,
    eventClick: (info) => emit('select', String(info.event.id)),
    // Tooltip nativo con el texto completo: la tarjeta lo recorta si la
    // cita es corta.
    eventDidMount: (info) => {
      info.el.title = String(info.event.title)
    },
  })
  // Recalcular el ancho de hora si cambia el tamaño de la ventana.
  resizeObserver = new ResizeObserver(() =>
    calendar?.setOption('slotWidth', computeSlotWidth()),
  )
  resizeObserver.observe(host.value)
})

watch(
  () => props.date,
  (date) => calendar?.setOption('date', date),
)
watch(
  () => props.hourRange,
  (range) => {
    calendar?.setOption('slotMinTime', minutesToSlotTime(range.startMinutes))
    calendar?.setOption('slotMaxTime', minutesToSlotTime(range.endMinutes))
    calendar?.setOption('slotWidth', computeSlotWidth())
  },
)
watch(
  () => props.rows,
  (rows) =>
    calendar?.setOption(
      'resources',
      rows.map((row) => ({ id: row.id, title: row.name })),
    ),
)
watch(
  () => props.blocks,
  (blocks) => calendar?.setOption('events', toEvents(blocks)),
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  if (calendar) void destroyCalendar(calendar)
  calendar = null
})
</script>

<template>
  <div ref="host" class="ec-host" />
</template>

<style scoped lang="scss">
// EventCalendar pinta su propio DOM (no es Vue), por eso los estilos
// llegan con :deep(). Las variables --ec-* son su mecanismo oficial de
// tema; aquí se enlazan a la paleta de Vuetify (plugins/vuetify.ts) para
// no repetir colores a mano.
.ec-host :deep(.ec) {
  --ec-sidebar-width: 170px;
  --ec-border-color: rgba(var(--v-border-color), 0.3);
  --ec-bg-color: rgb(var(--v-theme-surface));
  --ec-text-color: rgb(var(--v-theme-on-surface));
  // Un solo día visible: pintarlo como "hoy" tiñe toda la grilla.
  --ec-today-bg-color: transparent;
  --ec-highlight-color: rgba(var(--v-theme-primary), 0.08);
  font-family: inherit;
}

// Una sola línea con "…": si el texto envolviera, una cita de una hora
// (~100 px de ancho) crecería en alto y deformaría la fila del empleado.
// El texto completo va en el tooltip (eventDidMount).
.ec-host :deep(.ec-event-title) {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.8rem;
  line-height: 1.2;
}

// Las divisiones de columna (una por hora) las dibuja EventCalendar con
// degradados de fondo que se REPITEN. El reset global de Vuetify pone
// `background-repeat: no-repeat` a todos los elementos, así que sin esto
// solo se veía la primera línea. Cada valor va en el mismo orden que las
// capas de `background-image` de EventCalendar: la capa 2 y la 4 son las
// líneas de las horas (se repiten en horizontal); las demás son rellenos.
.ec-host :deep(.ec-body .ec-day) {
  background-repeat: no-repeat, repeat-x, no-repeat, repeat-x;
}

// Encabezado de horas: capa 1 = relleno, capa 2 = líneas.
.ec-host :deep(.ec-slots) {
  background-repeat: no-repeat, repeat-x;
}
</style>
