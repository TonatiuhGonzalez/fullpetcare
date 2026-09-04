<script setup lang="ts">
// Componente tonto (CLAUDE.md §4): recibe la lista de huecos YA
// calculada (lib/availability.ts#computeAvailableSlots, fuera de este
// componente) y solo la pinta — no sabe nada de citas, empleados, ni
// Supabase. Extraído de NewAppointmentPage.vue (tarea 3.18) para poder
// probarlo aislado (tarea 3.20, uno de los pocos tests de componente del
// proyecto — CLAUDE.md §9).
import type { AvailableSlot } from '@/lib/availability'

defineProps<{
  slots: AvailableSlot[]
  modelValue: AvailableSlot | null
}>()

defineEmits<{
  'update:modelValue': [value: AvailableSlot | null]
}>()
</script>

<template>
  <p v-if="slots.length === 0" class="text-medium-emphasis">
    No hay huecos disponibles ese día para este empleado.
  </p>
  <v-chip-group
    v-else
    :model-value="modelValue"
    column
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <v-chip v-for="slot in slots" :key="slot.startsAt" :value="slot" filter>
      {{ slot.startsAt }}
    </v-chip>
  </v-chip-group>
</template>
