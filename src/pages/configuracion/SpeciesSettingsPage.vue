<script setup lang="ts">
// Catálogo de especies y razas (fase 27, PLAN.md D30). Lo editan el dueño y el veterinario.
// Lo que se oculta deja de ofrecerse en el formulario de mascota, pero las mascotas que ya
// lo tienen conservan su especie y su raza.
import { computed, onMounted, ref } from 'vue'

import BreedsDialog from '@/components/BreedsDialog.vue'
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import SpeciesFormDialog from '@/components/SpeciesFormDialog.vue'
import SpeciesGroupsDialog from '@/components/SpeciesGroupsDialog.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import * as speciesService from '@/services/species'
import type { Species } from '@/services/species'
import { useSessionStore } from '@/stores/session'
import { useSpeciesCatalogStore } from '@/stores/speciesCatalog'

const session = useSessionStore()
const catalog = useSpeciesCatalogStore()

const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)

const showForm = ref(false)
const editing = ref<Species | null>(null)
const showGroups = ref(false)
const showBreeds = ref(false)
const breedsOf = ref<Species | null>(null)
const toHide = ref<Species | null>(null)
const showHideConfirm = ref(false)
const hiding = ref(false)

const headerProps = { class: 'font-weight-bold' }
const headers = [
  { title: 'Especie', key: 'name', headerProps },
  { title: 'Grupo', key: 'group', sortable: false, headerProps },
  { title: 'Razas', key: 'breeds', sortable: false, headerProps },
  {
    title: 'Acciones',
    key: 'actions',
    sortable: false,
    align: 'center' as const,
    headerProps,
  },
]

const rows = computed(() => {
  const groupName = new Map(catalog.groups.map((g) => [g.id, g.name]))
  return catalog.species.map((s) => ({
    ...s,
    group: groupName.get(s.group_id) ?? '',
    breedCount: catalog.breedsOfSpecies(s.id).length,
  }))
})

async function load(force = false): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    await catalog.load(session.activeTenantId, force)
  } catch {
    errorMessage.value = 'No se pudo cargar el catálogo. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(() => load(true))

function openNew(): void {
  editing.value = null
  showForm.value = true
}

function openEdit(species: Species): void {
  editing.value = species
  showForm.value = true
}

function openBreeds(species: Species): void {
  breedsOf.value = species
  showBreeds.value = true
}

function askHide(species: Species): void {
  toHide.value = species
  showHideConfirm.value = true
}

async function confirmHide(): Promise<void> {
  if (!toHide.value) return
  hiding.value = true
  errorMessage.value = null
  try {
    await speciesService.hide(toHide.value.id)
    showHideConfirm.value = false
    await load(true)
  } catch {
    showHideConfirm.value = false
    errorMessage.value = 'No se pudo ocultar la especie. Revisa tu conexión.'
  } finally {
    hiding.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Especies y razas"
      subtitle="Los grupos, especies y razas que se ofrecen al registrar una mascota."
    >
      <template #actions>
        <v-btn
          variant="outlined"
          prepend-icon="mdi-shape-outline"
          @click="showGroups = true"
        >
          Grupos
        </v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openNew"
          >Nueva especie</v-btn
        >
      </template>
    </PageHeader>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="headers.length" />
    <ResponsiveTable
      v-else-if="!isFirstLoad"
      :headers="headers"
      :items="rows"
      :loading="loading"
      :items-per-page="15"
      items-per-page-text="Elementos por página"
      loading-text="Cargando catálogo…"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="customers"
          title="Aún no hay especies"
          message="Agrega la primera para poder elegirla al registrar una mascota."
        />
      </template>
      <template #[`item.breeds`]="{ item }">
        <span v-if="item.has_breeds">{{ item.breedCount }}</span>
        <span v-else class="text-medium-emphasis">Sin razas</span>
      </template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex align-center justify-center">
          <IconButton
            v-if="item.has_breeds"
            icon="mdi-format-list-bulleted"
            variant="text"
            size="small"
            :aria-label="`Razas de ${item.name}`"
            @click="openBreeds(item)"
          />
          <IconButton
            icon="mdi-pencil"
            color="primary"
            variant="text"
            size="small"
            :aria-label="`Editar ${item.name}`"
            @click="openEdit(item)"
          />
          <IconButton
            icon="mdi-eye-off-outline"
            variant="text"
            size="small"
            :aria-label="`Ocultar ${item.name}`"
            @click="askHide(item)"
          />
        </div>
      </template>
    </ResponsiveTable>

    <SpeciesFormDialog
      v-model="showForm"
      :tenant-id="session.activeTenantId ?? ''"
      :groups="catalog.groups"
      :existing="catalog.species"
      :species="editing"
      @saved="load(true)"
    />

    <SpeciesGroupsDialog
      v-model="showGroups"
      :tenant-id="session.activeTenantId ?? ''"
      :groups="catalog.groups"
      :species="catalog.species"
      @changed="load(true)"
    />

    <BreedsDialog
      v-model="showBreeds"
      :tenant-id="session.activeTenantId ?? ''"
      :species="breedsOf"
      :breeds="catalog.breeds"
      @changed="load(true)"
    />

    <ConfirmDeleteDialog
      v-model="showHideConfirm"
      title="Ocultar especie"
      :message="`¿Ocultar «${toHide?.name ?? ''}»? Dejará de ofrecerse al registrar mascotas. Las mascotas que ya la tienen la conservan.`"
      :loading="hiding"
      @confirm="confirmHide"
    />
  </div>
</template>
