<script setup lang="ts">
// Alta y edición de una vacuna del catálogo (fase 26, tarea 26.12). Solo dueño y veterinario
// llegan a la pantalla que lo abre; la regla real es la política RLS de `vaccines`.
import { computed, ref, watch } from 'vue'

import * as vaccinesService from '@/services/vaccines'
import type { Vaccine } from '@/services/vaccines'
import {
  intervalProblem,
  isDuplicateVaccine,
  vaccineSpeciesLabel,
  type VaccineSpecies,
} from '@/lib/vaccineCatalog'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  vaccine?: Vaccine | null
  // El catálogo ya cargado: se usa para avisar de un nombre repetido sin pedir nada más.
  existing: Vaccine[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [vaccine: Vaccine]
}>()

const isEditing = computed(() => props.vaccine != null)

const name = ref('')
const species = ref<VaccineSpecies>(null)
const intervalDays = ref<number | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const speciesOptions = ([null, 'dog', 'cat', 'other'] as VaccineSpecies[]).map((value) => ({
  value,
  title: vaccineSpeciesLabel(value),
}))

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = props.vaccine?.name ?? ''
    species.value = props.vaccine?.species ?? null
    intervalDays.value = props.vaccine?.default_interval_days ?? null
    errorMessage.value = null
  },
)

const nameRules = [
  required,
  () =>
    !isDuplicateVaccine(
      props.existing,
      { name: name.value, species: species.value },
      props.vaccine?.id,
    ) || 'Ya hay una vacuna con este nombre para esta especie.',
]
const intervalRules = [(v: unknown) => intervalProblem(v) ?? true]

const formRef = ref<FormHandle | null>(null)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return

  saving.value = true
  errorMessage.value = null
  try {
    // El campo numérico vacío llega como '' o null: ambos son "sin refuerzo".
    const rawInterval: unknown = intervalDays.value
    const input = {
      name: name.value,
      species: species.value,
      default_interval_days: rawInterval === null || rawInterval === '' ? null : Number(rawInterval),
    }
    const saved = props.vaccine
      ? await vaccinesService.update(props.vaccine.id, input)
      : await vaccinesService.create(props.tenantId, input)
    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar la vacuna. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isEditing ? 'Editar vacuna' : 'Nueva vacuna' }}</v-card-title>

      <v-card-text>
        <v-form ref="formRef" @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre*" :rules="nameRules" />

          <v-select
            v-model="species"
            :items="speciesOptions"
            item-title="title"
            item-value="value"
            label="Especie"
            hint="'Todas las especies' la ofrece para cualquier mascota."
            persistent-hint
            class="mb-2"
          />

          <v-text-field
            v-model.number="intervalDays"
            label="Refuerzo (días)"
            type="number"
            min="1"
            :rules="intervalRules"
            hint="Cada cuántos días se vuelve a aplicar. Déjalo vacío si es de una sola dosis."
            persistent-hint
          />

          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-4"
          >
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
