<script setup lang="ts">
// Gráfica de peso (tarea 6.5), sin librería (CLAUDE.md §11/D11: es la
// única gráfica del proyecto, no justifica una dependencia). Un `<svg>`
// con un `viewBox` fijo: cada peso se normaliza a una posición (x, y)
// dentro de ese lienzo, y `currentColor` deja que el trazo tome el color
// de texto de Vuetify (clase `text-primary`) en vez de un color fijo.
import { computed } from 'vue'
import type { PetWeight } from '@/services/pets'

const props = defineProps<{ weights: PetWeight[] }>()

const WIDTH = 320
const HEIGHT = 120
const PADDING = 20

const points = computed(() => {
  // listWeights() ordena del más reciente al más viejo — se invierte
  // para dibujar de izquierda (más viejo) a derecha (más reciente), como
  // se lee una línea de tiempo.
  const chronological = [...props.weights].reverse()
  if (chronological.length === 0) return []

  const values = chronological.map((w) => w.weight_grams)
  const minValue = Math.min(...values)
  // Si solo hay una medición, o varias idénticas, el rango sería 0 y
  // dividir entre eso daría NaN — con `|| 1` se dibuja una línea plana
  // en vez de reventar.
  const range = Math.max(...values) - minValue || 1

  return chronological.map((weight, index) => ({
    x:
      chronological.length === 1
        ? WIDTH / 2
        : PADDING + (index / (chronological.length - 1)) * (WIDTH - PADDING * 2),
    y: HEIGHT - PADDING - ((weight.weight_grams - minValue) / range) * (HEIGHT - PADDING * 2),
    weightGrams: weight.weight_grams,
  }))
})

const polylinePoints = computed(() => points.value.map((p) => `${p.x},${p.y}`).join(' '))
</script>

<template>
  <v-card variant="outlined" class="pa-3">
    <p class="text-subtitle-1 mb-2">Peso</p>
    <p v-if="points.length === 0" class="text-medium-emphasis">Sin registros de peso todavía.</p>
    <svg
      v-else
      :viewBox="`0 0 ${WIDTH} ${HEIGHT}`"
      width="100%"
      :height="HEIGHT"
      class="text-primary"
      role="img"
      aria-label="Gráfica de peso a través del tiempo"
    >
      <polyline :points="polylinePoints" fill="none" stroke="currentColor" stroke-width="2" />
      <circle v-for="(point, index) in points" :key="index" :cx="point.x" :cy="point.y" r="3" fill="currentColor">
        <title>{{ (point.weightGrams / 1000).toFixed(1) }} kg</title>
      </circle>
    </svg>
  </v-card>
</template>
