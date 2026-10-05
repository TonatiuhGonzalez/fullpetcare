<script setup lang="ts">
// Pestaña "Mascotas" de Clientes: tabla de todas las mascotas del negocio
// con su especie y su dueño, buscador propio y alta de mascota. Igual que
// la pestaña de clientes, trae todo y filtra en el navegador (CLAUDE.md
// §11, "simple sobre elegante"): son decenas de registros por tenant.
import { computed, onMounted, ref } from 'vue'

import * as customersService from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import { matchesPetSearch } from '@/lib/petSearch'
import { speciesLabel } from '@/lib/petLabels'
import { useSessionStore } from '@/stores/session'
import PetDetailDialog from '@/components/PetDetailDialog.vue'
import PetFormDialog from '@/components/PetFormDialog.vue'

const session = useSessionStore()

const pets = ref<Pet[]>([])
const ownerNames = ref<Record<string, string>>({})
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')
const showFormDialog = ref(false)
const showDetailDialog = ref(false)
const selectedPetId = ref<string | null>(null)

const headers = [
  { title: 'Nombre', key: 'name' },
  { title: 'Especie', key: 'speciesName' },
  { title: 'Dueño', key: 'ownerName' },
]

const rows = computed(() =>
  pets.value
    .map((pet) => ({
      ...pet,
      speciesName: speciesLabel(pet.species),
      ownerName: ownerNames.value[pet.customer_id] ?? '',
    }))
    .filter((row) => matchesPetSearch(row, row.ownerName, searchTerm.value)),
)

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [petList, customerList] = await Promise.all([
      petsService.list(session.activeTenantId),
      customersService.list(session.activeTenantId),
    ])
    pets.value = petList
    ownerNames.value = Object.fromEntries(
      customerList.map((c) => [c.id, `${c.first_name} ${c.last_name}`]),
    )
  } catch {
    errorMessage.value = 'No se pudo cargar la lista de mascotas. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// El botón "Nueva mascota" vive en el encabezado de la página (junto al
// de "Nuevo cliente"), así que la página lo dispara a través de este método.
function openNewPet(): void {
  showFormDialog.value = true
}
defineExpose({ openNewPet })

function handleRowClick(_event: Event, { item }: { item: Pet }): void {
  selectedPetId.value = item.id
  showDetailDialog.value = true
}
</script>

<template>
  <div>
    <v-text-field
      v-model="searchTerm"
      label="Buscar por nombre, especie o dueño"
      prepend-inner-icon="mdi-magnify"
      density="compact"
      variant="outlined"
      hide-details
      clearable
      class="mb-4"
      style="max-width: 420px"
    />

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      no-data-text="No hay mascotas que coincidan con la búsqueda."
      loading-text="Cargando mascotas…"
      @click:row="handleRowClick"
    >
      <template #[`item.name`]="{ item }">
        <span class="font-weight-medium">{{ item.name }}</span>
      </template>
    </v-data-table>

    <PetDetailDialog v-model="showDetailDialog" :pet-id="selectedPetId" @changed="load" />
    <PetFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      @saved="load"
    />
  </div>
</template>
