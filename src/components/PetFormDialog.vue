<script setup lang="ts">
// Alta y edición de mascota, con foto y preferencias de corte (tarea
// 2.19). Mismo patrón que CustomerFormDialog.vue.
//
// Si recibe `customerId`, el dueño ya está decidido (se abrió desde la
// ficha del cliente). Si no, muestra un selector para elegirlo entre los
// clientes ya registrados (se abrió desde la pestaña Mascotas).
import { computed, ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import PetSpeciesFields from '@/components/PetSpeciesFields.vue'
import { usePetCatalog } from '@/composables/usePetCatalog'
import type { Database } from '@/types/database'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'

type PetSpecies = Database['public']['Enums']['pet_species']
type PetSex = Database['public']['Enums']['pet_sex']

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  customerId?: string
  pet?: Pet | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [pet: Pet]
}>()

const isEditing = computed(() => props.pet != null)

const sexOptions: Array<{ value: PetSex | null; title: string }> = [
  { value: null, title: 'No especificado' },
  { value: 'male', title: 'Macho' },
  { value: 'female', title: 'Hembra' },
]

const name = ref('')
const species = ref<PetSpecies>('dog')
const breed = ref('')
const speciesId = ref<string | null>(null)
const breedId = ref<string | null>(null)
const birthDateIsEstimated = ref(false)
const { catalog, today, loadError, ensureLoaded } = usePetCatalog()
const sex = ref<PetSex | null>(null)
const birthDate = ref('')
const isSterilized = ref(false)
const groomingNotes = ref('')
const medicalAlerts = ref('')
const photoFile = ref<File | null>(null)

const needsOwnerPicker = computed(() => !props.customerId)
const ownerId = ref<string | null>(null)
const customers = ref<Customer[]>([])
const ownerOptions = computed(() =>
  customers.value.map((c) => ({ value: c.id, title: `${c.first_name} ${c.last_name}` })),
)

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
    speciesId.value = p?.species_id ?? null
    breedId.value = p?.breed_id ?? null
    birthDateIsEstimated.value = p?.birth_date_is_estimated ?? false
    ensureLoaded(props.tenantId)
    isSterilized.value = p?.is_sterilized ?? false
    groomingNotes.value = p?.grooming_notes ?? ''
    medicalAlerts.value = p?.medical_alerts ?? ''
    photoFile.value = null
    ownerId.value = null
    errorMessage.value = null
    if (needsOwnerPicker.value) loadCustomers()
  },
)

async function loadCustomers(): Promise<void> {
  try {
    customers.value = await customersService.list(props.tenantId)
  } catch {
    errorMessage.value = 'No se pudo cargar la lista de clientes. Revisa tu conexión.'
  }
}

function close(): void {
  emit('update:modelValue', false)
}

const formRef = ref<FormHandle | null>(null)

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return
  const owner = props.customerId ?? ownerId.value
  if (!props.pet && !owner) {
    errorMessage.value = 'Elige al dueño de la mascota.'
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    const payload = {
      name: name.value,
      species: species.value,
      breed: breed.value || null,
      sex: sex.value,
      birth_date: birthDate.value || null,
      birth_date_is_estimated: !!birthDate.value && birthDateIsEstimated.value,
      species_id: speciesId.value,
      breed_id: breedId.value,
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
      : await petsService.create({
          ...payload,
          tenant_id: props.tenantId,
          customer_id: owner as string,
        })

    if (photoFile.value) {
      const photoPath = await petsService.uploadPhoto(
        props.tenantId,
        saved.id,
        photoFile.value,
      )
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
        <v-form ref="formRef" @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre*" :rules="[required]" />

          <v-autocomplete
            v-if="needsOwnerPicker && !isEditing"
            v-model="ownerId"
            :items="ownerOptions"
            label="Dueño*"
            :rules="[required]"
            no-data-text="No hay clientes. Primero da de alta al dueño en la pestaña Clientes."
          />

          <PetSpeciesFields
            v-model:species-id="speciesId"
            v-model:breed-id="breedId"
            v-model:breed-text="breed"
            v-model:legacy-species="species"
            v-model:birth-date="birthDate"
            v-model:birth-date-is-estimated="birthDateIsEstimated"
            :groups="catalog.groups"
            :species="catalog.species"
            :breeds="catalog.breeds"
            :today="today"
            :require-species="!isEditing || !!pet?.species_id"
          />
          <v-alert v-if="loadError" type="warning" density="compact" variant="tonal" class="mb-2">
            {{ loadError }}
          </v-alert>
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-select v-model="sex" :items="sexOptions" label="Sexo" />
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

          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            variant="tonal"
            class="mb-2"
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
