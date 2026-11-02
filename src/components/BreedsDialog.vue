<script setup lang="ts">
// Razas de una especie (fase 27, tarea 27.9): ver, agregar, editar y ocultar. Cada raza lleva
// su nombre y variantes de búsqueda separadas por coma ("xolo, perro pelón mexicano").
import { computed, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import { aliasesToText, isDuplicateName, parseAliases } from '@/lib/speciesCatalog'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'
import * as breedsService from '@/services/breeds'
import type { Breed } from '@/services/breeds'
import type { Species } from '@/services/species'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  species: Species | null
  breeds: Breed[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  // Algo cambió: la pantalla recarga el catálogo.
  changed: []
}>()

const editing = ref<Breed | null>(null)
const name = ref('')
const aliases = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const formRef = ref<FormHandle | null>(null)
const filter = ref('')

const speciesBreeds = computed(() =>
  props.breeds
    .filter((b) => b.species_id === props.species?.id)
    .filter(
      (b) =>
        filter.value.trim() === '' ||
        b.name.toLowerCase().includes(filter.value.trim().toLowerCase()),
    ),
)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    resetForm()
    filter.value = ''
  },
)

function resetForm(): void {
  editing.value = null
  name.value = ''
  aliases.value = ''
  errorMessage.value = null
}

function startEdit(breed: Breed): void {
  editing.value = breed
  name.value = breed.name
  aliases.value = aliasesToText(breed.search_aliases)
  errorMessage.value = null
}

const nameRules = [
  required,
  () =>
    !isDuplicateName(
      props.breeds.filter((b) => b.species_id === props.species?.id),
      name.value,
      editing.value?.id,
    ) || 'Ya hay una raza con este nombre en esta especie.',
]

async function save(): Promise<void> {
  if (!props.species) return
  if (!(await isFormValid(formRef.value))) return
  saving.value = true
  errorMessage.value = null
  try {
    const input = {
      name: name.value,
      species_id: props.species.id,
      search_aliases: parseAliases(aliases.value),
    }
    if (editing.value) await breedsService.update(editing.value.id, input)
    else await breedsService.create(props.tenantId, input)
    resetForm()
    emit('changed')
  } catch {
    errorMessage.value = 'No se pudo guardar la raza. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

async function hide(breed: Breed): Promise<void> {
  errorMessage.value = null
  try {
    await breedsService.hide(breed.id)
    if (editing.value?.id === breed.id) resetForm()
    emit('changed')
  } catch {
    errorMessage.value = 'No se pudo ocultar la raza. Revisa tu conexión.'
  }
}

function close(): void {
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Razas de {{ species?.name }}</v-card-title>
      <v-card-text>
        <v-form ref="formRef" class="mb-4" @submit.prevent="save">
          <v-text-field v-model="name" label="Raza*" :rules="nameRules" />
          <v-text-field
            v-model="aliases"
            label="Otras formas de escribirla"
            hint="Separadas por coma. Por ejemplo: xolo, perro pelón mexicano"
            persistent-hint
          />
          <div class="d-flex justify-end mt-3 ga-2">
            <v-btn v-if="editing" variant="text" @click="resetForm"
              >Cancelar edición</v-btn
            >
            <v-btn color="primary" :loading="saving" @click="save">
              {{ editing ? 'Guardar cambios' : 'Agregar raza' }}
            </v-btn>
          </div>
        </v-form>

        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-3"
        >
          {{ errorMessage }}
        </v-alert>

        <v-divider class="mb-3" />
        <v-text-field
          v-model="filter"
          label="Buscar en la lista"
          prepend-inner-icon="mdi-magnify"
          density="compact"
          hide-details
          clearable
          class="mb-2"
        />
        <v-list density="compact">
          <v-list-item v-for="breed in speciesBreeds" :key="breed.id" :title="breed.name">
            <template #subtitle>
              <span v-if="breed.search_aliases.length">{{
                aliasesToText(breed.search_aliases)
              }}</span>
            </template>
            <template #append>
              <IconButton
                icon="mdi-pencil"
                color="primary"
                variant="text"
                size="small"
                :aria-label="`Editar ${breed.name}`"
                @click="startEdit(breed)"
              />
              <IconButton
                icon="mdi-eye-off-outline"
                variant="text"
                size="small"
                :aria-label="`Ocultar ${breed.name}`"
                @click="hide(breed)"
              />
            </template>
          </v-list-item>
          <v-list-item v-if="speciesBreeds.length === 0" title="Sin razas todavía" />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cerrar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
