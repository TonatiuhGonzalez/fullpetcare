<script setup lang="ts">
// Botón de solo ícono con tooltip (C1.19, PLAN.md D26 punto 7). Es un `v-btn` normal:
// recibe los mismos atributos y eventos, y el texto que muestra el tooltip es el mismo
// `aria-label` que ya necesita el lector de pantalla (o el `title`, que se convierte en
// `aria-label` para no mostrar dos globos). Úsalo en lugar de `<v-btn icon="mdi-…">`.
//
// Solo con puntero: en pantallas táctiles (`hover: none`) no hay tooltip, porque un toque
// largo lo dejaría pegado sobre el contenido. Con teclado (foco) sí aparece.
import { computed, mergeProps, useAttrs } from 'vue'

// Los atributos se aplican al `v-btn` interno, no al contenedor del tooltip.
defineOptions({ inheritAttrs: false })

const attrs = useAttrs()

const label = computed<string | undefined>(() => {
  const text = attrs['aria-label'] ?? attrs.title
  return typeof text === 'string' && text.trim() !== '' ? text : undefined
})

// Sin `title` nativo: el tooltip ya dice lo mismo y el del navegador duplicaría el globo.
const buttonAttrs = computed(() => {
  const rest = Object.fromEntries(Object.entries(attrs).filter(([key]) => key !== 'title'))
  return label.value ? { ...rest, 'aria-label': label.value } : rest
})

// Se decide una vez al montar; un dispositivo no cambia de puntero a táctil en pleno uso.
const canHover =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches
</script>

<template>
  <v-tooltip v-if="label && canHover" :text="label" location="top">
    <template #activator="{ props: activatorProps }">
      <v-btn v-bind="mergeProps(buttonAttrs, activatorProps)">
        <!-- El slot solo se pasa si hay contenido: un slot vacío le gana al ícono de la
             prop `icon` y el botón se vería en blanco. -->
        <template v-if="$slots.default" #default><slot /></template>
      </v-btn>
    </template>
  </v-tooltip>
  <v-btn v-else v-bind="buttonAttrs">
    <template v-if="$slots.default" #default><slot /></template>
  </v-btn>
</template>
