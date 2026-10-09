<script setup lang="ts">
// Estado vacío con ilustración (PLAN.md D20): cuando una lista, tabla o bloque no tiene
// nada que mostrar, en lugar de una línea de texto gris se pone un dibujo, un título y,
// si ayuda, una frase. Las ilustraciones son SVG propios: llevan el motivo de los dos
// círculos del logo (estética y veterinaria) y toman sus colores del tema activo, así
// que se ven bien en claro y en oscuro. Son decorativas (aria-hidden): el mensaje
// importante es el título.
import { computed } from 'vue'

export type EmptyIllustration = 'calendar' | 'customers' | 'products' | 'sales'

const props = withDefaults(
  defineProps<{
    illustration: EmptyIllustration
    title: string
    message?: string
    // Versión chica, para dentro de una tarjeta o una celda de tabla.
    compact?: boolean
  }>(),
  { compact: false },
)

const width = computed(() => (props.compact ? 104 : 148))
</script>

<template>
  <div :class="['empty-state', { 'empty-state--compact': compact }]">
    <svg
      :width="width"
      :height="width * 0.75"
      viewBox="0 0 160 120"
      aria-hidden="true"
      focusable="false"
      class="empty-state__art"
    >
      <!-- Fondo: los dos círculos del logo, muy tenues. -->
      <circle cx="62" cy="60" r="46" fill="rgb(var(--v-theme-grooming))" opacity="0.14" />
      <circle
        cx="98"
        cy="60"
        r="46"
        fill="rgb(var(--v-theme-veterinary))"
        opacity="0.14"
      />

      <g
        class="empty-state__line"
        fill="rgb(var(--v-theme-surface))"
        stroke-width="2.5"
        stroke-linejoin="round"
        stroke-linecap="round"
      >
        <!-- Calendario -->
        <template v-if="illustration === 'calendar'">
          <rect x="46" y="30" width="68" height="58" rx="8" />
          <path d="M46 47 H114" fill="none" />
          <path d="M62 24 V36 M98 24 V36" fill="none" />
          <rect
            x="57"
            y="56"
            width="8"
            height="8"
            rx="2"
            class="empty-state__soft"
            stroke="none"
          />
          <rect
            x="76"
            y="56"
            width="8"
            height="8"
            rx="2"
            class="empty-state__soft"
            stroke="none"
          />
          <rect
            x="95"
            y="56"
            width="8"
            height="8"
            rx="2"
            fill="rgb(var(--v-theme-primary))"
            stroke="none"
          />
          <rect
            x="57"
            y="70"
            width="8"
            height="8"
            rx="2"
            class="empty-state__soft"
            stroke="none"
          />
          <rect
            x="76"
            y="70"
            width="8"
            height="8"
            rx="2"
            class="empty-state__soft"
            stroke="none"
          />
        </template>

        <!-- Clientes -->
        <template v-else-if="illustration === 'customers'">
          <circle cx="100" cy="46" r="11" />
          <path d="M80 92 a20 20 0 0 1 40 0 Z" />
          <circle cx="66" cy="52" r="13" fill="rgb(var(--v-theme-primary))" />
          <path d="M40 96 a26 26 0 0 1 52 0 Z" />
        </template>

        <!-- Productos -->
        <template v-else-if="illustration === 'products'">
          <rect x="48" y="52" width="64" height="38" rx="4" />
          <path d="M42 52 L118 52 L110 36 L50 36 Z" />
          <path d="M80 36 V90" fill="none" />
          <circle
            cx="98"
            cy="71"
            r="6"
            fill="rgb(var(--v-theme-primary))"
            stroke="none"
          />
        </template>

        <!-- Ventas -->
        <template v-else>
          <path
            d="M54 28 H106 V94 L99.5 88 L93 94 L86.5 88 L80 94 L73.5 88 L67 94 L60.5 88 L54 94 Z"
          />
          <path d="M64 42 H96 M64 54 H86 M64 66 H96" fill="none" />
          <circle
            cx="108"
            cy="78"
            r="12"
            fill="rgb(var(--v-theme-primary))"
            stroke="none"
          />
          <circle
            cx="108"
            cy="78"
            r="6"
            fill="none"
            stroke="rgb(var(--v-theme-on-primary))"
            stroke-width="2"
          />
        </template>
      </g>
    </svg>

    <p class="empty-state__title">{{ title }}</p>
    <p v-if="message" class="empty-state__message">{{ message }}</p>
    <div v-if="$slots.default" class="empty-state__actions"><slot /></div>
  </div>
</template>

<style scoped lang="scss">
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
  text-align: center;

  &--compact {
    padding: 12px 8px;
  }

  &__art {
    margin-bottom: 8px;
  }

  // Trazo del dibujo: el color de texto del tema, atenuado.
  &__line {
    stroke: rgb(var(--v-theme-on-surface));
    stroke-opacity: 0.55;
  }

  &__soft {
    fill: rgb(var(--v-theme-on-surface));
    fill-opacity: 0.2;
  }

  &__title {
    font-size: 1rem;
    font-weight: 700;
  }

  &--compact &__title {
    font-size: 0.9375rem;
  }

  &__message {
    max-width: 320px;
    margin-top: 4px;
    font-size: 0.875rem;
    opacity: 0.7;
  }

  &__actions {
    margin-top: 12px;
  }
}
</style>
