<script setup lang="ts">
// Vista de dueño/recepción (rediseño 2026-09-08, pedido explícito): un
// solo día, FILAS = empleados, COLUMNAS = horas de ese día. Envuelve
// DayPilotScheduler de @daypilot/daypilot-lite-vue — CLAUDE.md §3:
// dependencia agregada a propósito para tener un componente de
// calendario/scheduler de verdad, en vez del grid hecho a mano de la
// versión anterior.
//
// Se configura con UN SOLO objeto `:config` (en vez de props sueltas por
// atributo) — verificado a mano en el navegador: props sueltas como
// `:height` o `:event-height` no llegaban de forma confiable al control
// real, mientras que pasarlas todas dentro de `config` sí. DayPilot
// documenta ambas formas como válidas; esta es la que de verdad funciona
// con la versión instalada.
//
// Componente "tonto" (CLAUDE.md §4): recibe los bloques YA calculados
// (hora local de la sucursal, texto, color) — no sabe nada de citas ni de
// Supabase.
//
// Nota sobre "Lite": el feature-matrix de DayPilot marca el Scheduler
// como "soporte parcial" en la edición gratuita — en concreto, no hay
// forma de OCULTAR del todo las horas fuera del horario de la sucursal
// (esa función sí existe en Pro). Aquí se muestran las 24 horas del día
// y se MARCAN visualmente las horas de negocio con un color de fondo
// explícito en onBeforeCellRender (cellsMarkBusiness por sí solo casi no
// se nota con el tema por default).
import { computed } from 'vue'
import { DayPilot, DayPilotScheduler } from '@daypilot/daypilot-lite-vue'

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

// Alto fijo por fila: el default de DayPilot (35px) no alcanza para dos
// líneas de nombre de empleado y las filas se encimaban (verificado a
// mano). HEADER_PX es la franja del encabezado de horas arriba.
const ROW_HEIGHT_PX = 60
const HEADER_PX = 40

const config = computed<DayPilot.SchedulerConfig>(() => ({
  scale: 'Hour',
  days: 1,
  startDate: props.date,
  businessBeginsHour: Math.floor(props.hourRange.startMinutes / 60),
  businessEndsHour: Math.ceil(props.hourRange.endMinutes / 60),
  cellsMarkBusiness: true,
  rowHeaderWidth: 170,
  cellWidth: 72,
  eventHeight: 44,
  rowMarginTop: 8,
  rowMarginBottom: 8,
  height: Math.max(props.rows.length, 1) * ROW_HEIGHT_PX + HEADER_PX,
  heightSpec: 'Fixed',
  resources: props.rows.map((row) => ({ id: row.id, name: row.name })),
  events: props.blocks.map((block) => ({
    id: block.id,
    start: block.start,
    end: block.end,
    text: block.text,
    resource: block.resource,
    backColor: block.color,
    fontColor: '#ffffff',
    borderColor: 'transparent',
  })),
  onEventClick: (args) => emit('select', String(args.e.id())),
  onBeforeCellRender: (args) => {
    if (!args.cell.properties.business) {
      args.cell.properties.backColor = '#f0f0f0'
    }
  },
}))
</script>

<template>
  <DayPilotScheduler :config="config" />
</template>
