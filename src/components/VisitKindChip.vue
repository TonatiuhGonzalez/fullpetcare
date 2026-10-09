<script setup lang="ts">
// Etiqueta del tipo de visita (Estética / Veterinaria) con su color e ícono (PLAN.md D20).
// Una sola pieza para toda la app, así el tipo se ve igual en la agenda, el detalle de
// una cita, el historial y Inicio. Lleva texto e ícono además del color.
import { computed } from 'vue'

import { visitKindInfo, type VisitKind } from '@/lib/visitKind'

const props = withDefaults(defineProps<{ kind: VisitKind; size?: string }>(), {
  size: 'small',
})
const info = computed(() => visitKindInfo(props.kind))
</script>

<template>
  <v-chip :size="size" variant="flat" :color="info.color" :prepend-icon="info.icon">
    {{ info.label }}
  </v-chip>
</template>
