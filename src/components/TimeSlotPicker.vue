<script setup lang="ts">
// Componente tonto (CLAUDE.md §4): recibe la lista de huecos YA
// calculada (lib/availability.ts, fuera de este componente) y solo la
// pinta — no sabe nada de citas, empleados, ni Supabase. Extraído del
// formulario de agendar (tarea 3.18, hoy NewAppointmentDialog.vue) para
// poder probarlo aislado (tarea 3.20, uno de los pocos tests de
// componente del proyecto — CLAUDE.md §9).
//
// Estados (C1.10, D26 punto 4), de `computeSlotStatuses`:
// - `free` (o sin estado): chip normal.
// - `overlap`: se puede elegir; chip amarillo con ícono de advertencia, y al
//   elegirlo se muestra debajo el aviso del traslape. El aviso solo informa.
// - `past`: se ve pero deshabilitado.
// El color nunca va solo (§5.6): el amarillo lleva ícono y el aviso es texto.
import type { AvailableSlot, SlotWithStatus } from '@/lib/availability'
import { overlapNoticeText } from '@/lib/appointmentErrors'

/** Un hueco; `status` es opcional para quien solo tiene huecos libres. */
type PickerSlot = AvailableSlot & Partial<Pick<SlotWithStatus, 'status' | 'conflict'>>

defineProps<{
  slots: PickerSlot[]
  modelValue: PickerSlot | null
}>()

defineEmits<{
  'update:modelValue': [value: PickerSlot | null]
}>()

function slotTitle(slot: PickerSlot): string | undefined {
  if (slot.status === 'past') return 'Este horario ya pasó'
  if (slot.status === 'overlap') return 'Se traslapa con otra cita del empleado'
  return undefined
}
</script>

<template>
  <p v-if="slots.length === 0" class="text-medium-emphasis">
    No hay huecos disponibles ese día para este empleado.
  </p>
  <div v-else>
    <v-chip-group
      :model-value="modelValue"
      column
      @update:model-value="$emit('update:modelValue', $event)"
    >
      <v-chip
        v-for="slot in slots"
        :key="slot.startsAt"
        :value="slot"
        :disabled="slot.status === 'past'"
        :color="slot.status === 'overlap' ? 'overlap' : undefined"
        :variant="slot.status === 'overlap' ? 'flat' : undefined"
        :prepend-icon="slot.status === 'overlap' ? 'mdi-alert' : undefined"
        :title="slotTitle(slot)"
        filter
      >
        {{ slot.startsAt }}
      </v-chip>
    </v-chip-group>

    <p
      v-if="modelValue?.status === 'overlap' && modelValue.conflict"
      class="overlap-notice text-body-2 mt-2"
      role="status"
    >
      <v-icon icon="mdi-alert" size="small" class="mr-1" />
      {{ overlapNoticeText(modelValue.conflict) }}
    </p>
  </div>
</template>

<style scoped lang="scss">
// El amarillo no tiene contraste como texto sobre fondo claro: va solo como
// acento de borde; el texto conserva el color normal.
.overlap-notice {
  border-left: 4px solid rgb(var(--v-theme-overlap));
  padding-left: 8px;
}
</style>
