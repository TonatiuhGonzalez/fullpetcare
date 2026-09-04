<script setup lang="ts">
// Ficha de estética de una cita (tarea 4.13). Componente "tonto" a
// medias: no tiene estado global, pero sí llama directo a
// services/records.ts para guardar (mismo patrón que ServiceFormDialog)
// — quien de verdad decide si el guardado se vale es la política RLS de
// grooming_records (owner o el groomer ASIGNADO a esta cita), no este
// formulario.
import { ref, watch } from 'vue'

import * as recordsService from '@/services/records'
import type { GroomingRecord } from '@/services/records'

const props = withDefaults(
  defineProps<{
    tenantId: string
    appointmentId: string
    petId: string
    initialRecord?: GroomingRecord | null
    submitLabel?: string
  }>(),
  { submitLabel: 'Guardar y completar cita' },
)

const emit = defineEmits<{ saved: [record: GroomingRecord] }>()

const cutStyle = ref('')
const bladeUsed = ref('')
const shampooUsed = ref('')
const behaviorNotes = ref('')
const groomerNotes = ref('')
const conditionObservations = ref('')

const saving = ref(false)
const errorMessage = ref<string | null>(null)

// Si la cita ya tenía una ficha guardada (se reabrió para corregir algo
// antes de completarla), se prellenan los campos con lo que ya había.
watch(
  () => props.initialRecord,
  (record) => {
    cutStyle.value = record?.cut_style ?? ''
    bladeUsed.value = record?.blade_used ?? ''
    shampooUsed.value = record?.shampoo_used ?? ''
    behaviorNotes.value = record?.behavior_notes ?? ''
    groomerNotes.value = record?.groomer_notes ?? ''
    conditionObservations.value = record?.condition_observations ?? ''
  },
  { immediate: true },
)

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  try {
    const record = await recordsService.saveGroomingRecord({
      tenantId: props.tenantId,
      appointmentId: props.appointmentId,
      petId: props.petId,
      cutStyle: cutStyle.value || null,
      bladeUsed: bladeUsed.value || null,
      shampooUsed: shampooUsed.value || null,
      behaviorNotes: behaviorNotes.value || null,
      groomerNotes: groomerNotes.value || null,
      conditionObservations: conditionObservations.value || null,
    })
    emit('saved', record)
  } catch {
    errorMessage.value = 'No se pudo guardar la ficha de estética. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <v-form @submit.prevent="handleSubmit">
    <v-row dense>
      <v-col cols="12" sm="6">
        <v-text-field v-model="cutStyle" label="Estilo de corte" density="compact" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model="bladeUsed" label="Navaja / número usado" density="compact" />
      </v-col>
      <v-col cols="12" sm="6">
        <v-text-field v-model="shampooUsed" label="Shampoo usado" density="compact" />
      </v-col>
    </v-row>

    <v-textarea v-model="behaviorNotes" label="Comportamiento durante el servicio" rows="2" auto-grow density="compact" />
    <v-textarea v-model="conditionObservations" label="Observaciones de la piel/pelaje" rows="2" auto-grow density="compact" />
    <v-textarea v-model="groomerNotes" label="Notas del groomer" rows="2" auto-grow density="compact" />

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-2">
      {{ errorMessage }}
    </v-alert>

    <v-btn color="primary" type="submit" :loading="saving">{{ submitLabel }}</v-btn>
  </v-form>
</template>
