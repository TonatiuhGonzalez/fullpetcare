<script setup lang="ts">
// Ficha de veterinaria de una cita (tarea 4.14). Mismo criterio que
// GroomingRecordForm: llama directo a services/records.ts, la política
// RLS de medical_records (owner o el vet ASIGNADO) es quien de verdad
// decide si el guardado se vale.
//
// El peso NO es parte de medical_records — vive en su propia tabla
// `pet_weights` (CLAUDE.md §6.2: es un historial de hechos, no un campo
// que se sobreescribe). Por eso, si se captura un peso aquí, se guarda
// con una llamada aparte a `addWeight()` ligada a esta cita.
import { ref, watch } from 'vue'

import * as recordsService from '@/services/records'
import type { MedicalRecord } from '@/services/records'

const props = withDefaults(
  defineProps<{
    tenantId: string
    appointmentId: string
    petId: string
    initialRecord?: MedicalRecord | null
    submitLabel?: string
  }>(),
  { submitLabel: 'Guardar y completar cita' },
)

const emit = defineEmits<{ saved: [record: MedicalRecord] }>()

const reason = ref('')
const history = ref('')
const examination = ref('')
const diagnosis = ref('')
const treatment = ref('')
const indications = ref('')
const temperatureC = ref<number | null>(null)
const nextVisitDate = ref('')
// El peso, a diferencia de los demás campos, NUNCA se prellena con un
// valor previo: cada vez que se guarda con un valor aquí se crea una
// medición NUEVA (no hay "editar el peso de la última vez"), así que
// reabrir la ficha para corregir un diagnóstico no debe duplicar sola
// una pesada que ya se había registrado.
const weightKg = ref<number | null>(null)

const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.initialRecord,
  (record) => {
    reason.value = record?.reason ?? ''
    history.value = record?.history ?? ''
    examination.value = record?.examination ?? ''
    diagnosis.value = record?.diagnosis ?? ''
    treatment.value = record?.treatment ?? ''
    indications.value = record?.indications ?? ''
    temperatureC.value = record?.temperature_deci_c != null ? record.temperature_deci_c / 10 : null
    nextVisitDate.value = record?.next_visit_date ?? ''
  },
  { immediate: true },
)

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  try {
    const record = await recordsService.saveMedicalRecord({
      tenantId: props.tenantId,
      appointmentId: props.appointmentId,
      petId: props.petId,
      reason: reason.value || null,
      history: history.value || null,
      examination: examination.value || null,
      diagnosis: diagnosis.value || null,
      treatment: treatment.value || null,
      indications: indications.value || null,
      // Décimas de grado (CLAUDE.md §6.2): 38.5 °C se guarda como 385.
      temperatureDeciC: temperatureC.value != null ? Math.round(temperatureC.value * 10) : null,
      nextVisitDate: nextVisitDate.value || null,
    })

    if (weightKg.value != null) {
      // Gramos enteros (CLAUDE.md §6.2): 12.4 kg se guarda como 12400.
      await recordsService.addWeight(
        props.tenantId,
        props.petId,
        Math.round(weightKg.value * 1000),
        props.appointmentId,
      )
    }

    emit('saved', record)
  } catch {
    errorMessage.value = 'No se pudo guardar la ficha médica. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-form @submit.prevent="handleSubmit">
    <v-textarea v-model="reason" label="Motivo de la consulta" rows="2" auto-grow density="compact" />
    <v-textarea v-model="history" label="Historia / antecedentes" rows="2" auto-grow density="compact" />
    <v-textarea v-model="examination" label="Exploración física" rows="2" auto-grow density="compact" />

    <v-row dense>
      <v-col cols="6" sm="4">
        <v-text-field
          v-model.number="weightKg"
          label="Peso (kg)"
          type="number"
          min="0"
          step="0.1"
          density="compact"
        />
      </v-col>
      <v-col cols="6" sm="4">
        <v-text-field
          v-model.number="temperatureC"
          label="Temperatura (°C)"
          type="number"
          min="0"
          step="0.1"
          density="compact"
        />
      </v-col>
      <v-col cols="12" sm="4">
        <v-text-field v-model="nextVisitDate" label="Próxima visita" type="date" density="compact" />
      </v-col>
    </v-row>

    <v-textarea v-model="diagnosis" label="Diagnóstico" rows="2" auto-grow density="compact" />
    <v-textarea v-model="treatment" label="Tratamiento" rows="2" auto-grow density="compact" />
    <v-textarea v-model="indications" label="Indicaciones para el dueño" rows="2" auto-grow density="compact" />

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-2">
      {{ errorMessage }}
    </v-alert>

    <v-btn color="primary" type="submit" :loading="saving">{{ submitLabel }}</v-btn>
  </v-form>
</template>
