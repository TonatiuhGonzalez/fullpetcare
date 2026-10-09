<script setup lang="ts">
// Silueta de la agenda mientras llega su primera carga (PLAN.md D22). Dibuja la
// MISMA estructura que el calendario real, para que al llegar las citas nada se mueva:
//  - `timeline`: la vista de recepción y dueño; una fila por empleado y las horas en
//    horizontal (EmployeeDayScheduler).
//  - `week`: la vista de groomer y vet; una columna por día y las horas en vertical
//    (EmployeeWeekCalendar).
// Los bloques grises están en posiciones fijas (no al azar) para que no cambien de un
// render a otro. Combínala con `useDelayedLoading` para que no parpadee.
withDefaults(defineProps<{ variant: 'timeline' | 'week' }>(), {})

const HOURS = 8
// Posición de cada cita falsa: [fila o columna, inicio en horas, duración en horas].
const TIMELINE_BLOCKS: Array<[number, number, number]> = [
  [0, 1, 2],
  [0, 5, 1],
  [1, 0, 1],
  [1, 3, 2],
  [2, 2, 1],
  [2, 6, 1],
  [3, 4, 2],
]
const WEEK_BLOCKS: Array<[number, number, number]> = [
  [0, 1, 2],
  [1, 0, 1],
  [1, 4, 2],
  [2, 2, 1],
  [3, 5, 2],
  [4, 1, 1],
  [5, 3, 2],
]
const TIMELINE_ROWS = 4
const WEEK_DAYS = 7
</script>

<template>
  <div
    class="calendar-skeleton"
    role="status"
    aria-busy="true"
    aria-label="Cargando la agenda"
  >
    <!-- Recepción y dueño: empleados en filas, horas en columnas. -->
    <div
      v-if="variant === 'timeline'"
      class="calendar-skeleton__grid calendar-skeleton__grid--timeline"
      :style="{ '--rows': TIMELINE_ROWS, '--cols': HOURS }"
    >
      <div class="calendar-skeleton__corner" />
      <div v-for="h in HOURS" :key="`h${h}`" class="calendar-skeleton__head">
        <v-skeleton-loader type="text" width="60%" />
      </div>
      <template v-for="r in TIMELINE_ROWS" :key="`r${r}`">
        <div class="calendar-skeleton__label">
          <v-skeleton-loader type="text" />
        </div>
        <div v-for="h in HOURS" :key="`c${r}-${h}`" class="calendar-skeleton__cell" />
      </template>
      <div class="calendar-skeleton__blocks">
        <v-skeleton-loader
          v-for="([row, start, length], i) in TIMELINE_BLOCKS"
          :key="`b${i}`"
          type="image"
          class="calendar-skeleton__block"
          :style="{
            gridRow: row + 2,
            gridColumn: `${start + 2} / span ${length}`,
          }"
        />
      </div>
    </div>

    <!-- Groomer y vet: días en columnas, horas en filas. -->
    <div
      v-else
      class="calendar-skeleton__grid calendar-skeleton__grid--week"
      :style="{ '--rows': HOURS, '--cols': WEEK_DAYS }"
    >
      <div class="calendar-skeleton__corner" />
      <div v-for="d in WEEK_DAYS" :key="`d${d}`" class="calendar-skeleton__head">
        <v-skeleton-loader type="text" width="60%" />
      </div>
      <template v-for="h in HOURS" :key="`h${h}`">
        <div class="calendar-skeleton__label">
          <v-skeleton-loader type="text" />
        </div>
        <div v-for="d in WEEK_DAYS" :key="`c${h}-${d}`" class="calendar-skeleton__cell" />
      </template>
      <div class="calendar-skeleton__blocks">
        <v-skeleton-loader
          v-for="([col, start, length], i) in WEEK_BLOCKS"
          :key="`b${i}`"
          type="image"
          class="calendar-skeleton__block"
          :style="{
            gridColumn: col + 2,
            gridRow: `${start + 2} / span ${length}`,
          }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.calendar-skeleton {
  overflow-x: auto;
  border: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 12px;
}

.calendar-skeleton__grid {
  position: relative;
  display: grid;
  min-width: 560px;
  // Columna de etiquetas + el resto de columnas iguales.
  grid-template-columns: 96px repeat(var(--cols), minmax(0, 1fr));

  :deep(.v-skeleton-loader) {
    background: transparent;
  }
}

.calendar-skeleton__grid--timeline,
.calendar-skeleton__grid--timeline > .calendar-skeleton__blocks {
  grid-template-rows: 40px repeat(var(--rows), 64px);
}

.calendar-skeleton__grid--week,
.calendar-skeleton__grid--week > .calendar-skeleton__blocks {
  grid-template-rows: 40px repeat(var(--rows), 56px);
}

// Capa encima de la cuadrícula con las mismas columnas y filas. Va aparte porque, si
// los bloques fueran hijos directos, CSS Grid saltaría las celdas que ocupan y
// desacomodaría todo lo demás.
.calendar-skeleton__blocks {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: 96px repeat(var(--cols), minmax(0, 1fr));
  pointer-events: none;
}

.calendar-skeleton__head,
.calendar-skeleton__label {
  display: flex;
  align-items: center;
  padding: 0 12px;
}

.calendar-skeleton__cell,
.calendar-skeleton__head,
.calendar-skeleton__label,
.calendar-skeleton__corner {
  border-right: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-bottom: thin solid rgba(var(--v-border-color), var(--v-border-opacity));
}

// Las "citas" falsas: un bloque gris con el radio de las tarjetas, dentro de su celda.
.calendar-skeleton__block {
  margin: 4px;
  min-height: 0;

  :deep(.v-skeleton-loader__image) {
    height: 100%;
    border-radius: 8px;
    background: rgba(var(--v-theme-on-surface), 0.08);
  }
}
</style>
