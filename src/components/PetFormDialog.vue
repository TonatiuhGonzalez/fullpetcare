<script setup lang="ts">
// Alta y edición de mascota, con foto y preferencias de corte (tarea
// 2.19). Mismo patrón que CustomerFormDialog.vue.
import { computed, ref, watch } from 'vue'

import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import { speciesLabel } from '@/lib/petLabels'
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']
type PetSex = Database['public']['Enums']['pet_sex']

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  customerId: string
  pet?: Pet | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [pet: Pet]
}>()

const isEditing = computed(() => props.pet != null)

const speciesOptions = (['dog', 'cat', 'other'] as PetSpecies[]).map((value) => ({
  value,
  title: speciesLabel(value),
}))
const sexOptions: Array<{ value: PetSex | null; title: string }> = [
  { value: null, title: 'No especificado' },
  { value: 'male', title: 'Macho' },
  { value: 'female', title: 'Hembra' },
]

const name = ref('')
const species = ref<PetSpecies>('dog')
const breed = ref('')
const sex = ref<PetSex | null>(null)
const birthDate = ref('')
const isSterilized = ref(false)
const groomingNotes = ref('')
const medicalAlerts = ref('')
const photoFile = ref<File | null>(null)

const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const p = props.pet
    name.value = p?.name ?? ''
    species.value = p?.species ?? 'dog'
    breed.value = p?.breed ?? ''
    sex.value = p?.sex ?? null
    birthDate.value = p?.birth_date ?? ''
    isSterilized.value = p?.is_sterilized ?? false
    groomingNotes.value = p?.grooming_notes ?? ''
    medicalAlerts.value = p?.medical_alerts ?? ''
    photoFile.value = null
    errorMessage.value = null
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  try {
    const payload = {
      name: name.value,
      species: species.value,
      breed: breed.value || null,
      sex: sex.value,
      birth_date: birthDate.value || null,
      is_sterilized: isSterilized.value,
      grooming_notes: groomingNotes.value || null,
      medical_alerts: medicalAlerts.value || null,
    }

    // Primero se guardan los datos básicos — la foto necesita el id de
    // la mascota para armar su ruta en Storage (tenantId/petId/foto.ext),
    // así que en una alta nueva no hay forma de subirla ANTES de que la
    // fila exista.
    let saved = props.pet
      ? await petsService.update(props.pet.id, payload)
      : await petsService.create({ ...payload, tenant_id: props.tenantId, customer_id: props.customerId })

    if (photoFile.value) {
      const photoPath = await petsService.uploadPhoto(props.tenantId, saved.id, photoFile.value)
      saved = await petsService.update(saved.id, { photo_path: photoPath })
    }

    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar la mascota. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isEditing ? 'Editar mascota' : 'Nueva mascota' }}</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre" required />

          <v-row dense>
            <v-col cols="6">
              <v-select v-model="species" :items="speciesOptions" label="Especie" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="breed" label="Raza" />
            </v-col>
          </v-row>

          <v-row dense>
            <v-col cols="6">
              <v-select v-model="sex" :items="sexOptions" label="Sexo" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="birthDate" label="Fecha de nacimiento" type="date" />
            </v-col>
          </v-row>

          <v-checkbox v-model="isSterilized" label="Esterilizado(a)" density="compact" />

          <v-textarea
            v-model="groomingNotes"
            label="Preferencias de corte"
            rows="2"
            auto-grow
          />
          <v-textarea
            v-model="medicalAlerts"
            label="Alertas médicas"
            rows="2"
            auto-grow
          />

          <v-file-input
            v-model="photoFile"
            label="Foto"
            accept="image/jpeg,image/png,image/webp"
            prepend-icon="mdi-camera"
          />

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-2">
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
