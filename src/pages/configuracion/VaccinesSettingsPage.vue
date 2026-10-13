<script setup lang="ts">
// Catálogo de vacunas (fase 26, PLAN.md D29): la lista que se ofrece al registrar una dosis
// en la cartilla. Lo editan el dueño y el veterinario. Una vacuna que ya se aplicó no se
// borra: se oculta, y las dosis ya registradas conservan su nombre.
import { onMounted, ref } from 'vue'

import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import VaccineFormDialog from '@/components/VaccineFormDialog.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { intervalLabel, vaccineSpeciesLabel } from '@/lib/vaccineCatalog'
import * as vaccinesService from '@/services/vaccines'
import type { Vaccine } from '@/services/vaccines'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const vaccines = ref<Vaccine[]>([])
const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)

const showForm = ref(false)
const editing = ref<Vaccine | null>(null)
const toHide = ref<Vaccine | null>(null)
const showHideConfirm = ref(false)
const hiding = ref(false)

const headerProps = { class: 'font-weight-bold' }
const headers = [
  { title: 'Nombre', key: 'name', headerProps },
  { title: 'Especie', key: 'species', headerProps },
  { title: 'Refuerzo', key: 'default_interval_days', headerProps },
  { title: 'Acciones', key: 'actions', sortable: false, align: 'center' as const, headerProps },
]

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    vaccines.value = await vaccinesService.listAll(session.activeTenantId)
  } catch {
    errorMessage.value = 'No se pudo cargar el catálogo de vacunas. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openNew(): void {
  editing.value = null
  showForm.value = true
}

function openEdit(vaccine: Vaccine): void {
  editing.value = vaccine
  showForm.value = true
}

function askHide(vaccine: Vaccine): void {
  toHide.value = vaccine
  showHideConfirm.value = true
}

async function confirmHide(): Promise<void> {
  if (!toHide.value) return
  hiding.value = true
  errorMessage.value = null
  try {
    await vaccinesService.hide(toHide.value.id)
    showHideConfirm.value = false
    await load()
  } catch {
    showHideConfirm.value = false
    errorMessage.value = 'No se pudo ocultar la vacuna. Revisa tu conexión.'
  } finally {
    hiding.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Vacunas"
      subtitle="Las vacunas que se ofrecen al registrar una dosis en la cartilla."
    >
      <template #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openNew">Nueva vacuna</v-btn>
      </template>
    </PageHeader>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="headers.length" />
    <ResponsiveTable
      v-else-if="!isFirstLoad"
      :headers="headers"
      :items="vaccines"
      :loading="loading"
      :items-per-page="10"
      items-per-page-text="Elementos por página"
      loading-text="Cargando vacunas…"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="products"
          title="Aún no hay vacunas"
          message="Agrega la primera para poder registrarla en la cartilla."
        />
      </template>
      <template #[`item.species`]="{ item }">{{ vaccineSpeciesLabel(item.species) }}</template>
      <template #[`item.default_interval_days`]="{ item }">
        {{ intervalLabel(item.default_interval_days) }}
      </template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex align-center justify-center">
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

    <VaccineFormDialog
      v-model="showForm"
      :tenant-id="session.activeTenantId ?? ''"
      :vaccine="editing"
      :existing="vaccines"
      @saved="load"
    />

    <ConfirmDeleteDialog
      v-model="showHideConfirm"
      title="Ocultar vacuna"
      :message="`¿Ocultar «${toHide?.name ?? ''}»? Dejará de ofrecerse al registrar dosis nuevas. Las dosis ya aplicadas conservan su nombre en la cartilla.`"
      :loading="hiding"
      @confirm="confirmHide"
    />
  </div>
</template>
