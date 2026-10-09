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
import PetEditDialog from '@/components/PetEditDialog.vue'
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import { isFrontDesk } from '@/lib/roles'
import PetFormDialog from '@/components/PetFormDialog.vue'
import EmptyState from '@/components/EmptyState.vue'

const session = useSessionStore()

const pets = ref<Pet[]>([])
const ownerNames = ref<Record<string, string>>({})
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')
const showFormDialog = ref(false)
const editingPetId = ref<string | null>(null)
const showEditDialog = ref(false)
const petToDelete = ref<Pet | null>(null)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

// Headers en negritas; acciones solo para dueño y recepción.
const headerProps = { class: 'font-weight-bold' }
const headers = computed(() => [
  { title: 'Nombre', key: 'name', headerProps },
  { title: 'Especie', key: 'speciesName', headerProps },
  { title: 'Dueño', key: 'ownerName', headerProps },
  ...(isFrontDesk(session.role)
    ? [
        {
          title: 'Acciones',
          key: 'actions',
          sortable: false,
          align: 'center' as const,
          width: 140,
          headerProps,
        },
      ]
    : []),
])

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

function openEditPet(pet: Pet): void {
  editingPetId.value = pet.id
  showEditDialog.value = true
}

function askDelete(pet: Pet): void {
  petToDelete.value = pet
  showDeleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  if (!petToDelete.value) return
  deleting.value = true
  errorMessage.value = null
  try {
    await petsService.softDelete(petToDelete.value.id)
    showDeleteConfirm.value = false
    await load()
  } catch {
    showDeleteConfirm.value = false
    errorMessage.value = 'No se pudo eliminar la mascota. Revisa tu conexión.'
  } finally {
    deleting.value = false
  }
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
      loading-text="Cargando mascotas…"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="customers"
          :title="searchTerm.trim() ? 'Sin resultados' : 'Aún no hay mascotas'"
          :message="
            searchTerm.trim()
              ? 'No hay mascotas que coincidan con la búsqueda.'
              : 'Las mascotas que des de alta aparecerán aquí.'
          "
        />
      </template>

      <template #[`item.name`]="{ item }">
        <span class="font-weight-medium">{{ item.name }}</span>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          icon="mdi-pencil"
          color="primary"
          variant="text"
          size="small"
          aria-label="Editar mascota"
          @click="openEditPet(item)"
        />
        <v-btn
          icon="mdi-delete"
          color="error"
          variant="text"
          size="small"
          aria-label="Eliminar mascota"
          @click="askDelete(item)"
        />
      </template>
    </v-data-table>

    <PetFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      @saved="load"
    />
    <PetEditDialog v-model="showEditDialog" :pet-id="editingPetId" @saved="load" />
    <ConfirmDeleteDialog
      v-model="showDeleteConfirm"
      title="Eliminar mascota"
      :message="`¿Seguro que quieres eliminar a ${petToDelete?.name ?? ''}? También se eliminarán sus citas programadas. Su expediente y su historial de atenciones se conservan.`"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </div>
</template>
