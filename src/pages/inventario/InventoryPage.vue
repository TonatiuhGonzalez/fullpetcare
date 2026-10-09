<script setup lang="ts">
// Pantalla de Inventario (tarea 11.9): productos del negocio con su existencia
// en la sucursal activa. La ve quien tenga "inventory:view" (router y menú);
// editar, registrar compras y ajustes pide "inventory:edit". Los permisos
// reales los aplica RLS; esto solo evita mostrar botones que fallarían.
import { computed, onMounted, ref, watch } from 'vue'

import { STOCK_STATUS_LABEL, type StockStatus } from '@/lib/inventory'
import { formatMXN } from '@/lib/money'
import type { Product } from '@/services/products'
import { useInventoryStore, type InventoryRow } from '@/stores/inventory'
import { useSessionStore } from '@/stores/session'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import ProductCategoriesDialog from '@/components/ProductCategoriesDialog.vue'
import ProductFormDialog from '@/components/ProductFormDialog.vue'
import StockMovementDialog from '@/components/StockMovementDialog.vue'

const session = useSessionStore()
const inventory = useInventoryStore()

const canEdit = computed(() => session.canEdit('inventory'))
const search = ref('')
const errorMessage = ref<string | null>(null)

const statusColor: Record<StockStatus, string> = {
  ok: 'success',
  low: 'warning',
  out: 'error',
}

const visibleRows = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (!term) return inventory.rows
  return inventory.rows.filter(
    (r) =>
      r.product.name.toLowerCase().includes(term) ||
      r.product.sku?.toLowerCase().includes(term),
  )
})

// "Sin inventario" cuando hay 0 (lo pide la tarea); si no, el número de piezas.
function stockLabel(row: InventoryRow): string {
  return row.status === 'out' ? STOCK_STATUS_LABEL.out : `${row.stock} en existencia`
}

onMounted(() => inventory.load())
// La existencia es por sucursal: al cambiar de sucursal en la barra, se recarga.
watch(
  () => session.activeBranchId,
  () => inventory.load(),
)

const showCategoriesDialog = ref(false)
const showProductDialog = ref(false)
const editingProduct = ref<Product | null>(null)

function openNewProduct(): void {
  editingProduct.value = null
  showProductDialog.value = true
}

function openEditProduct(product: Product): void {
  editingProduct.value = product
  showProductDialog.value = true
}

const showMovementDialog = ref(false)
const movementRow = ref<InventoryRow | null>(null)
const movementType = ref<'purchase' | 'adjustment'>('purchase')

function openMovement(row: InventoryRow, type: 'purchase' | 'adjustment'): void {
  movementRow.value = row
  movementType.value = type
  showMovementDialog.value = true
}

const togglingIds = ref<Set<string>>(new Set())

async function handleToggleActive(row: InventoryRow): Promise<void> {
  const id = row.product.id
  togglingIds.value.add(id)
  errorMessage.value = null
  const error = await inventory.setProductActive(id, !row.product.is_active)
  if (error) errorMessage.value = error
  togglingIds.value.delete(id)
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader title="Inventario">
      <template #actions>
        <v-btn
          v-if="canEdit"
          variant="outlined"
          prepend-icon="mdi-shape-outline"
          class="mr-2"
          @click="showCategoriesDialog = true"
        >
          Categorías
        </v-btn>
        <v-btn
          v-if="canEdit"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openNewProduct"
        >
          Nuevo producto
        </v-btn>
      </template>
    </PageHeader>

    <v-alert
      v-if="inventory.errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ inventory.errorMessage }}
    </v-alert>
    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>
    <v-alert
      v-if="inventory.alertRows.length > 0"
      type="warning"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ inventory.alertRows.length }}
      {{ inventory.alertRows.length === 1 ? 'producto necesita' : 'productos necesitan' }}
      atención en esta sucursal (poco inventario o sin inventario).
    </v-alert>

    <v-text-field
      v-model="search"
      label="Buscar por nombre o clave"
      prepend-inner-icon="mdi-magnify"
      clearable
      hide-details
      density="comfortable"
      class="mb-4"
    />

    <v-skeleton-loader
      v-if="inventory.status === 'loading' && inventory.rows.length === 0"
      type="list-item-two-line, list-item-two-line, list-item-two-line, list-item-two-line"
    />

    <v-list v-else lines="two">
      <v-list-item v-for="row in visibleRows" :key="row.product.id">
        <template #title>
          <span :class="{ 'text-medium-emphasis': !row.product.is_active }">
            {{ row.product.name }}
            <v-chip
              v-if="!row.product.is_active"
              size="x-small"
              class="ml-2"
              variant="tonal"
            >
              inactivo
            </v-chip>
          </span>
        </template>
        <template #subtitle>
          {{ formatMXN(row.product.price_cents) }}
          <template v-if="row.product.sku"> · {{ row.product.sku }}</template>
        </template>
        <template #append>
          <v-chip
            :color="statusColor[row.status]"
            size="small"
            variant="tonal"
            class="mr-1"
          >
            {{ stockLabel(row) }}
          </v-chip>
          <v-menu v-if="canEdit">
            <template #activator="{ props: menuProps }">
              <v-btn
                v-bind="menuProps"
                icon="mdi-dots-vertical"
                variant="text"
                size="small"
                :aria-label="`Acciones de ${row.product.name}`"
              />
            </template>
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-package-down"
                title="Entrada de compra"
                @click="openMovement(row, 'purchase')"
              />
              <v-list-item
                prepend-icon="mdi-tune-vertical"
                title="Ajustar inventario"
                @click="openMovement(row, 'adjustment')"
              />
              <v-list-item
                prepend-icon="mdi-pencil"
                title="Editar producto"
                @click="openEditProduct(row.product)"
              />
              <v-list-item
                :prepend-icon="
                  row.product.is_active ? 'mdi-eye-off-outline' : 'mdi-eye-outline'
                "
                :title="row.product.is_active ? 'Desactivar' : 'Activar'"
                :disabled="togglingIds.has(row.product.id)"
                @click="handleToggleActive(row)"
              />
            </v-list>
          </v-menu>
        </template>
      </v-list-item>

      <v-list-item v-if="visibleRows.length === 0">
        <EmptyState
          illustration="products"
          :title="search ? 'Sin resultados' : 'Todavía no hay productos'"
          :message="
            search
              ? 'No hay productos que coincidan con la búsqueda.'
              : 'Los productos que des de alta aparecerán aquí.'
          "
        />
      </v-list-item>
    </v-list>

    <ProductCategoriesDialog v-model="showCategoriesDialog" />
    <ProductFormDialog v-model="showProductDialog" :product="editingProduct" />
    <StockMovementDialog
      v-model="showMovementDialog"
      :row="movementRow"
      :type="movementType"
    />
  </v-container>
</template>
