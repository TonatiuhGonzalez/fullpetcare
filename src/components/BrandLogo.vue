<script setup lang="ts">
// Logo de FullPetCare, opción "Dos mitades" (PLAN.md D20): dos círculos que se cruzan,
// estética (naranja) y veterinaria (azul), y el cruce en el verde de marca. Es un SVG
// propio, sin imágenes ni dependencias. Los colores salen del tema activo, así que
// se adapta solo a claro y oscuro.
import { computed, useId } from 'vue'

import { darkPalette } from '@/lib/palette'

const props = withDefaults(
  defineProps<{
    // Alto del isotipo en píxeles (el texto se escala con él).
    size?: number
    // Muestra la palabra "FullPetCare" junto al isotipo.
    showWordmark?: boolean
    // Fuerza los colores del modo oscuro, para ponerlo sobre un fondo oscuro fijo
    // (p. ej. el panel de marca del login) sea cual sea el tema.
    onDark?: boolean
  }>(),
  { size: 32, showWordmark: true, onDark: false },
)

// Cada logo en pantalla necesita su propio id de recorte: si dos logos compartieran
// id, el navegador usaría el recorte del primero para todos.
const clipId = `brand-clip-${useId()}`

const colors = computed(() =>
  props.onDark
    ? {
        grooming: darkPalette.grooming,
        veterinary: darkPalette.veterinary,
        overlap: darkPalette.primary,
        text: '#FFFFFF',
      }
    : {
        grooming: 'rgb(var(--v-theme-grooming))',
        veterinary: 'rgb(var(--v-theme-veterinary))',
        overlap: 'rgb(var(--v-theme-primary))',
        text: 'rgb(var(--v-theme-on-background))',
      },
)
</script>

<template>
  <span class="brand-logo" role="img" aria-label="FullPetCare">
    <!-- 48×32: el ancho de dos círculos de 32 que se cruzan 16. -->
    <svg
      :height="size"
      :width="size * 1.5"
      viewBox="8 16 48 32"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath :id="clipId"><circle cx="40" cy="32" r="16" /></clipPath>
      </defs>
      <circle cx="24" cy="32" r="16" :fill="colors.grooming" />
      <circle cx="40" cy="32" r="16" :fill="colors.veterinary" />
      <circle
        cx="24"
        cy="32"
        r="16"
        :fill="colors.overlap"
        :clip-path="`url(#${clipId})`"
      />
    </svg>
    <span
      v-if="showWordmark"
      class="brand-logo__word"
      :style="{ fontSize: `${size * 0.75}px`, color: colors.text }"
      aria-hidden="true"
    >
      <b>Full</b>PetCare
    </span>
  </span>
</template>

<style scoped lang="scss">
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: 0.5em;
  line-height: 1;

  &__word {
    letter-spacing: -0.02em;
    font-weight: 400;
    white-space: nowrap;

    b {
      font-weight: 700;
    }
  }
}
</style>
