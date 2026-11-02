<script setup lang="ts">
// Catálogo de proveedores (fase 29B, PLAN.md D30 punto 4). Solo catálogo: contacto, tipo y
// notas, con los productos que surte cada uno. Mismos permisos que Inventario.
import { computed, onMounted, ref } from 'vue'

import EmptyState from '@/components/EmptyState.vue'
import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import SupplierFormDialog from '@/components/SupplierFormDialog.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { supplierTypeLabel } from '@/lib/suppliers'
import type { Supplier } from '@/services/suppliers'
import { useSessionStore } from '@/stores/session'
import { useSuppliersStore } from '@/stores/suppliers'

const session = useSessionStore()
const store = useSuppliersStore()

const loading = computed(() => store.status === 'loading')
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)

const canEdit = computed(() => session.canEdit('inventory'))

const showForm = ref(false)
const editing = ref<Supplier | null>(null)
const togglingIds = ref<Set<string>>(new Set())

const headerProps = { class: 'font-weight-bold' }
const headers = computed(() => [
  { title: 'Nombre', key: 'name', headerProps },
  { title: 'Tipo', key: 'type', sortable: false, headerProps },
  { title: 'Contacto', key: 'contact_name', headerProps },
  { title: 'Teléfono', key: 'phone', headerProps },
  { title: 'Correo', key: 'email', headerProps },
  { title: 'Productos', key: 'products', sortable: false, headerProps },
  ...(canEdit.value
    ? [
        {
          title: 'Acciones',
          key: 'actions',
          sortable: false,
          align: 'center' as const,
          headerProps,
        },
      ]
    : []),
])

const rows = computed(() =>
  store.suppliers.map((s) => ({
    ...s,
    type: supplierTypeLabel(s.supplier_type),
    products: store.productCountOf(s.id),
  })),
)

onMounted(() => store.load())

function openNew(): void {
  editing.value = null
  showForm.value = true
}

function openEdit(supplier: Supplier): void {
  editing.value = supplier
  showForm.value = true
}

async function handleToggle(supplier: Supplier, value: boolean | null): Promise<void> {
  togglingIds.value.add(supplier.id)
  errorMessage.value = null
  const error = await store.setActive(supplier.id, value === true)
  if (error) errorMessage.value = error
  togglingIds.value.delete(supplier.id)
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader
      title="Proveedores"
      subtitle="A quién se le compra cada insumo: contacto y tipo de proveedor."
    >
      <template v-if="canEdit" #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openNew"
          >Nuevo proveedor</v-btn
        >
      </template>
    </PageHeader>

    <v-alert
      v-if="errorMessage || store.errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage ?? store.errorMessage }}
    </v-alert>

    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="headers.length" />
    <ResponsiveTable
      v-else-if="!isFirstLoad"
      :headers="headers"
      :items="rows"
      :loading="loading"
      :items-per-page="10"
      items-per-page-text="Elementos por página"
      loading-text="Cargando proveedores…"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="products"
          title="Aún no hay proveedores"
          message="Agrega el primero y asígnalo a los productos que te surte."
        />
      </template>
      <template #[`item.contact_name`]="{ item }">{{
        item.contact_name ?? '—'
      }}</template>
      <template #[`item.phone`]="{ item }">{{ item.phone ?? '—' }}</template>
      <template #[`item.email`]="{ item }">{{ item.email ?? '—' }}</template>
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
          <v-tooltip
            :text="item.is_active ? 'Desactivar proveedor' : 'Activar proveedor'"
          >
            <template #activator="{ props: tooltipProps }">
              <v-switch
                v-bind="tooltipProps"
                :model-value="item.is_active"
                :loading="togglingIds.has(item.id)"
                :disabled="togglingIds.has(item.id)"
                color="primary"
                density="compact"
                hide-details
                :aria-label="
                  item.is_active ? 'Desactivar proveedor' : 'Activar proveedor'
                "
                @update:model-value="(value) => handleToggle(item, value)"
              />
            </template>
          </v-tooltip>
        </div>
      </template>
    </ResponsiveTable>

    <SupplierFormDialog v-model="showForm" :supplier="editing" />
  </v-container>
</template>
