<script setup lang="ts">
// Pantalla de Inventario (tarea 11.9): productos del negocio con su existencia
// en la sucursal activa. La ve quien tenga "inventory:view" (router y menú);
// editar, registrar compras y ajustes pide "inventory:edit". Los permisos
// reales los aplica RLS; esto solo evita mostrar botones que fallarían.
import { computed, onMounted, ref, watch } from 'vue'

import {
  buildInventoryTableRows,
  compareOptionalText,
  NO_CATEGORY_LABEL,
  STOCK_STATUS_LABEL,
  type InventoryTableRow,
  type StockStatus,
} from '@/lib/inventory'
import { formatMXN } from '@/lib/money'
import * as productsService from '@/services/products'
import type { Product } from '@/services/products'
import { useInventoryStore, type InventoryRow } from '@/stores/inventory'
import { useSessionStore } from '@/stores/session'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import ResponsiveTable from '@/components/ResponsiveTable.vue'
import ProductCategoriesDialog from '@/components/ProductCategoriesDialog.vue'
import ProductFormDialog from '@/components/ProductFormDialog.vue'
import StockMovementDialog from '@/components/StockMovementDialog.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { useServerSearch } from '@/composables/useServerSearch'
import IconButton from '@/components/IconButton.vue'

const session = useSessionStore()
const inventory = useInventoryStore()

const canEdit = computed(() => session.canEdit('inventory'))
const search = ref('')
const errorMessage = ref<string | null>(null)

// Primera carga = silueta con retraso; recargas (guardar un movimiento, cambiar de sucursal) =
// filas conservadas y barra fina (PLAN.md D22).
const loading = computed(() => inventory.status === 'loading')
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)

const statusColor: Record<StockStatus, string> = {
  ok: 'success',
  low: 'warning',
  out: 'error',
}

// La coincidencia (sin acentos, ñ aparte) la decide la base con `search_products` (C1.20);
// aquí solo se cruza con las filas ya cargadas, que traen la existencia y la categoría.
const productSearch = useServerSearch(search, (term) =>
  productsService.search(session.activeTenantId ?? '', term),
)
const visibleRows = computed(() => {
  if (search.value.trim() === '') return inventory.rows
  const found = productSearch.result.value
  if (!found) return []
  const ids = new Set(found.map((p) => p.id))
  return inventory.rows.filter((r) => ids.has(r.product.id))
})

// Filas planas de la tabla (cada columna ordenable es un campo propio, lib/inventory.ts).
const tableRows = computed(() =>
  buildInventoryTableRows(visibleRows.value, inventory.categories),
)

// Headers en negritas (`headerProps`, como Clientes). Todas las columnas de datos se
// ordenan; el orden de texto ignora acentos y manda los vacíos al final (sin clave /
// sin categoría). Precio y existencia ordenan por su número, no por el texto
// formateado. Acciones solo existe con permiso de edición, igual que el menú de la fila.
const headerProps = { class: 'font-weight-bold' }
const headers = computed(() => [
  { title: 'Nombre', key: 'name', sort: compareOptionalText, headerProps },
  { title: 'Clave', key: 'sku', sort: compareOptionalText, headerProps },
  { title: 'Categoría', key: 'categoryName', sort: compareOptionalText, headerProps },
  { title: 'Precio', key: 'priceCents', headerProps },
  { title: 'Existencia', key: 'stock', headerProps },
  ...(canEdit.value
    ? [
        {
          title: 'Acciones',
          key: 'actions',
          sortable: false,
          align: 'center' as const,
          width: 130,
          cellProps: { class: 'inventory-actions' },
          headerProps,
        },
      ]
    : []),
])

// -1 es "Todos" para v-data-table (mismo patrón que el catálogo de servicios).
const itemsPerPageOptions = [
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'Todos' },
]

// Un producto inactivo se atenúa completo, menos sus acciones.
function rowProps({ item }: { item: InventoryTableRow<InventoryRow> }): Record<string, unknown> {
  return item.isActive ? {} : { class: 'inventory-row--inactive' }
}

// "Sin inventario" cuando hay 0 (lo pide la tarea); si no, el número de piezas.
function stockLabel(row: { status: StockStatus; stock: number }): string {
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

async function handleToggleActive(row: InventoryRow, value: boolean | null): Promise<void> {
  const id = row.product.id
  togglingIds.value.add(id)
  errorMessage.value = null
  const error = await inventory.setProductActive(id, value === true)
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

    <!-- Primera carga: silueta con las mismas columnas que la tabla. En recargas la
         tabla conserva sus filas y solo lleva la barra fina (`loading`). -->
    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="headers.length" />
    <ResponsiveTable
      v-else-if="!isFirstLoad"
      :headers="headers"
      :items="tableRows"
      :loading="loading || productSearch.pending.value"
      :row-props="rowProps"
      class="inventory-table"
      :items-per-page="10"
      :items-per-page-options="itemsPerPageOptions"
      items-per-page-text="Elementos por página"
      loading-text="Cargando inventario…"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="products"
          :title="search ? 'Sin resultados' : 'Todavía no hay productos'"
          :message="
            search
              ? 'No hay productos que coincidan con la búsqueda.'
              : 'Los productos que des de alta aparecerán aquí.'
          "
        />
      </template>
      <template #[`item.name`]="{ item }">
        <div class="inventory-name" :title="item.name">{{ item.name }}</div>
      </template>
      <template #[`item.sku`]="{ item }">{{ item.sku ?? '—' }}</template>
      <template #[`item.categoryName`]="{ item }">{{
        item.categoryName ?? NO_CATEGORY_LABEL
      }}</template>
      <template #[`item.priceCents`]="{ item }">{{ formatMXN(item.priceCents) }}</template>
      <template #[`item.stock`]="{ item }">
        <v-chip :color="statusColor[item.status]" size="small" variant="tonal">
          {{ stockLabel(item) }}
        </v-chip>
      </template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex align-center justify-center">
          <v-menu>
            <template #activator="{ props: menuProps }">
              <IconButton
                v-bind="menuProps"
                icon="mdi-dots-vertical"
                variant="text"
                size="small"
                :aria-label="`Acciones de ${item.name}`"
              />
            </template>
            <v-list density="compact">
              <v-list-item
                prepend-icon="mdi-package-down"
                title="Entrada de compra"
                @click="openMovement(item.source, 'purchase')"
              />
              <v-list-item
                prepend-icon="mdi-tune-vertical"
                title="Ajustar inventario"
                @click="openMovement(item.source, 'adjustment')"
              />
              <v-list-item
                prepend-icon="mdi-pencil"
                title="Editar producto"
                @click="openEditProduct(item.source.product)"
              />
            </v-list>
          </v-menu>
          <v-tooltip
            :text="item.isActive ? 'Desactivar producto' : 'Activar producto'"
            location="top"
          >
            <template #activator="{ props: tooltipProps }">
              <v-switch
                v-bind="tooltipProps"
                class="inventory-switch"
                :model-value="item.isActive"
                :loading="togglingIds.has(item.id)"
                :disabled="togglingIds.has(item.id)"
                :aria-label="item.isActive ? 'Desactivar producto' : 'Activar producto'"
                color="primary"
                density="compact"
                hide-details
                @update:model-value="handleToggleActive(item.source, $event)"
              />
            </template>
          </v-tooltip>
        </div>
      </template>
    </ResponsiveTable>

    <ProductCategoriesDialog v-model="showCategoriesDialog" />
    <ProductFormDialog v-model="showProductDialog" :product="editingProduct" />
    <StockMovementDialog
      v-model="showMovementDialog"
      :row="movementRow"
      :type="movementType"
    />
  </v-container>
</template>

<style scoped lang="scss">
// En móvil la tabla se desplaza en horizontal (el contenedor de v-data-table ya tiene
// overflow) en vez de aplastar las columnas.
.inventory-table :deep(table) {
  min-width: 760px;
}

// El nombre puede partirse en dos líneas: en una sola, un nombre largo ensanchaba la tabla más
// que el contenedor (con el menú lateral abierto) y dejaba la columna Acciones fuera de la vista.
.inventory-name {
  max-width: 260px;
  overflow-wrap: anywhere;
}

.inventory-switch {
  margin-left: 5px;
}

.inventory-table :deep(.inventory-row--inactive td:not(.inventory-actions)) {
  opacity: 0.5;
}

// Igual en la tarjeta de pantallas chicas: todo atenuado menos las acciones.
:deep(.responsive-table__card.inventory-row--inactive > :not(.responsive-table__actions)) {
  opacity: 0.5;
}
</style>
