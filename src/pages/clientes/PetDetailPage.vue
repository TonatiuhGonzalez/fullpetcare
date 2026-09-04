<script setup lang="ts">
// Ficha de mascota PROVISIONAL (tarea 2.20): foto, datos y peso actual.
// "Provisional" porque el historial completo de visitas (mezclando
// estética y veterinaria) llega hasta que existan citas de verdad —
// eso es harina de otra fase (CLAUDE.md §1, punto 6 del alcance de v1).
import { computed, onMounted, ref } from 'vue'

import * as petsService from '@/services/pets'
import type { Pet, PetWeight } from '@/services/pets'
import { sexLabel, speciesLabel } from '@/lib/petLabels'
import { useSessionStore } from '@/stores/session'
import PetFormDialog from '@/components/PetFormDialog.vue'

const props = defineProps<{ id: string }>()

const session = useSessionStore()

const pet = ref<Pet | null>(null)
const weights = ref<PetWeight[]>([])
const photoUrl = ref<string | null>(null)
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const showEditPet = ref(false)

const currentWeightKg = computed(() => {
  const latest = weights.value[0]
  if (!latest) return null
  return (latest.weight_grams / 1000).toFixed(1)
})

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [foundPet, history] = await Promise.all([
      petsService.getById(session.activeTenantId, props.id),
      petsService.listWeights(session.activeTenantId, props.id),
    ])
    pet.value = foundPet
    weights.value = history
    photoUrl.value = foundPet?.photo_path
      ? await petsService.getPhotoUrl(foundPet.photo_path)
      : null
  } catch {
    errorMessage.value = 'No se pudo cargar la mascota. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <v-btn
      v-if="pet"
      variant="text"
      prepend-icon="mdi-arrow-left"
      class="mb-2"
      :to="`/app/clientes/${pet.customer_id}`"
    >
      Volver al cliente
    </v-btn>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-progress-circular v-if="loading && !pet" indeterminate color="primary" />

    <v-card v-else-if="pet" class="pa-4">
      <div class="d-flex align-start">
        <v-avatar size="96" class="mr-4" color="primary">
          <v-img v-if="photoUrl" :src="photoUrl" :alt="pet.name" cover />
          <v-icon v-else :icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'" size="48" />
        </v-avatar>

        <div class="flex-grow-1">
          <div class="d-flex align-center">
            <h1 class="text-h5">{{ pet.name }}</h1>
            <v-spacer />
            <v-btn variant="text" prepend-icon="mdi-pencil" @click="showEditPet = true">
              Editar
            </v-btn>
          </div>

          <p class="mb-1">
            {{ speciesLabel(pet.species) }}<span v-if="pet.breed"> · {{ pet.breed }}</span> ·
            {{ sexLabel(pet.sex) }}
          </p>
          <p v-if="pet.birth_date" class="mb-1 text-body-2 text-medium-emphasis">
            Nació: {{ pet.birth_date }}
          </p>
          <p class="mb-1 text-body-2">
            {{ pet.is_sterilized ? 'Esterilizado(a)' : 'No esterilizado(a)' }}
          </p>
          <p class="mb-1">
            <strong>Peso actual:</strong>
            {{ currentWeightKg ? `${currentWeightKg} kg` : 'Sin registros todavía' }}
          </p>

          <v-alert
            v-if="pet.medical_alerts"
            type="warning"
            density="compact"
            variant="tonal"
            class="mt-2"
          >
            {{ pet.medical_alerts }}
          </v-alert>
          <p v-if="pet.grooming_notes" class="text-body-2 text-medium-emphasis mt-2">
            <strong>Preferencias de corte:</strong> {{ pet.grooming_notes }}
          </p>
        </div>
      </div>
    </v-card>

    <PetFormDialog
      v-if="pet"
      v-model="showEditPet"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="pet.customer_id"
      :pet="pet"
      @saved="handleSaved"
    />
  </v-container>
</template>
