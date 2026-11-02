<script setup lang="ts">
// Catálogo de cirugías (fase 32, PLAN.md D30 punto 9): paquetes con los consumibles,
// medicamentos y honorarios de cada cirugía y su precio. Lo editan el dueño y el veterinario.
// Al atender una cita se aplica un paquete (y se ajusta renglón por renglón si hace falta).
import { computed, onMounted, ref } from 'vue'

import EmptyState from '@/components/EmptyState.vue'
import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import SurgeryPackageDialog from '@/components/SurgeryPackageDialog.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { formatMXN } from '@/lib/money'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'
import * as surgeriesService from '@/services/surgeries'
import type { SurgeryPackageWithItems } from '@/services/surgeries'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const packages = ref<SurgeryPackageWithItems[]>([])
const products = ref<Product[]>([])
const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)
const showForm = ref(false)
const editing = ref<SurgeryPackageWithItems | null>(null)
const togglingIds = ref<Set<string>>(new Set())

const headerProps = { class: 'font-weight-bold' }
const headers = [
  { title: 'Cirugía', key: 'name', headerProps },
  { title: 'Renglones', key: 'itemCount', sortable: false, headerProps },
  { title: 'Total', key: 'totalCents', headerProps },
  {
    title: 'Acciones',
    key: 'actions',
    sortable: false,
    align: 'center' as const,
    headerProps,
  },
]

const rows = computed(() =>
  packages.value.map((p) => ({
    ...p,
    itemCount: p.items.length,
    totalCents: p.items.reduce((sum, i) => sum + i.unit_price_cents * i.quantity, 0),
  })),
)

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const tenantId = session.activeTenantId
    ;[packages.value, products.value] = await Promise.all([
      surgeriesService.listPackages(tenantId),
      // Quien edita cirugías (dueño o veterinario) puede ver el catálogo de productos.
      productsService.list(tenantId).catch(() => [] as Product[]),
    ])
  } catch {
    errorMessage.value = 'No se pudo cargar el catálogo de cirugías. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openNew(): void {
  editing.value = null
  showForm.value = true
}

function openEdit(pkg: SurgeryPackageWithItems): void {
  editing.value = pkg
  showForm.value = true
}

async function toggle(
  pkg: SurgeryPackageWithItems,
  value: boolean | null,
): Promise<void> {
  togglingIds.value.add(pkg.id)
  errorMessage.value = null
  try {
    await surgeriesService.setPackageActive(pkg.id, value === true)
    pkg.is_active = value === true
  } catch (error) {
    errorMessage.value = surgeriesService.errorMessage(error)
  } finally {
    togglingIds.value.delete(pkg.id)
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Cirugías"
      subtitle="Paquetes con los consumibles, medicamentos y honorarios de cada cirugía."
    >
      <template #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openNew"
          >Nueva cirugía</v-btn
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
      :items-per-page="10"
      items-per-page-text="Elementos por página"
      loading-text="Cargando cirugías…"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="products"
          title="Aún no hay cirugías"
          message="Agrega la primera con sus renglones y su precio."
        />
      </template>
      <template #[`item.totalCents`]="{ item }">{{
        formatMXN(item.totalCents)
      }}</template>
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
          <v-tooltip :text="item.is_active ? 'Desactivar cirugía' : 'Activar cirugía'">
            <template #activator="{ props: tooltipProps }">
              <v-switch
                v-bind="tooltipProps"
                :model-value="item.is_active"
                :disabled="togglingIds.has(item.id)"
                color="primary"
                density="compact"
                hide-details
                :aria-label="item.is_active ? 'Desactivar cirugía' : 'Activar cirugía'"
                @update:model-value="(value) => toggle(item, value)"
              />
            </template>
          </v-tooltip>
        </div>
      </template>
    </ResponsiveTable>

    <SurgeryPackageDialog
      v-model="showForm"
      :tenant-id="session.activeTenantId ?? ''"
      :pkg="editing"
      :products="products"
      @saved="load"
    />
  </div>
</template>
