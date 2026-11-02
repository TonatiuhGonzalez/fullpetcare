<script setup lang="ts">
// Alta y edición de una especie del catálogo (fase 27, tarea 27.9). Solo dueño y
// veterinario llegan a la pantalla que lo abre; la regla real es la política RLS.
import { computed, ref, watch } from 'vue'

import { isDuplicateName } from '@/lib/speciesCatalog'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'
import * as speciesService from '@/services/species'
import type { Species, SpeciesGroup } from '@/services/species'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  groups: SpeciesGroup[]
  // Las especies ya cargadas: se usan para avisar de un nombre repetido sin otra consulta.
  existing: Species[]
  species?: Species | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [species: Species]
}>()

const isEditing = computed(() => props.species != null)

const name = ref('')
const groupId = ref<string | null>(null)
const hasBreeds = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const formRef = ref<FormHandle | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    name.value = props.species?.name ?? ''
    groupId.value = props.species?.group_id ?? props.groups[0]?.id ?? null
    hasBreeds.value = props.species?.has_breeds ?? false
    errorMessage.value = null
  },
)

const groupItems = computed(() =>
  props.groups.map((g) => ({ title: g.name, value: g.id })),
)

const nameRules = [
  required,
  () =>
    !isDuplicateName(props.existing, name.value, props.species?.id) ||
    'Ya hay una especie con este nombre.',
]

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return
  saving.value = true
  errorMessage.value = null
  try {
    const input = {
      name: name.value,
      group_id: groupId.value as string,
      has_breeds: hasBreeds.value,
    }
    const saved = props.species
      ? await speciesService.update(props.species.id, input)
      : await speciesService.create(props.tenantId, input)
    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar la especie. Revisa tu conexión.'
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
      <v-card-title>{{ isEditing ? 'Editar especie' : 'Nueva especie' }}</v-card-title>
      <v-card-text>
        <v-form ref="formRef" @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre*" :rules="nameRules" />
          <v-select
            v-model="groupId"
            :items="groupItems"
            label="Grupo*"
            :rules="[required]"
            no-data-text="Primero agrega un grupo."
          />
          <v-switch
            v-model="hasBreeds"
            color="primary"
            label="Lleva razas"
            hint="Actívalo para perros, gatos y otras especies con razas definidas."
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
