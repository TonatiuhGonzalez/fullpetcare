<script setup lang="ts">
// Catálogo de servicios, separado en pestañas Estética / Veterinaria
// (tarea 3.16).
import { computed, onMounted, ref, watch } from 'vue'

import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import { formatMXN } from '@/lib/money'
import { visibleServiceKinds } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'
import ServiceFormDialog from '@/components/ServiceFormDialog.vue'

const session = useSessionStore()

// groomer solo ve Estética, vet solo Veterinaria (UAT: no necesitan
// precios de servicios que nunca dan) — owner/receptionist ven las dos,
// como antes.
const visibleKinds = visibleServiceKinds(session.role)
const activeKind = ref<ServiceKind>(visibleKinds[0])
const services = ref<Service[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showFormDialog = ref(false)
const editingService = ref<Service | null>(null)

const isOwner = () => session.role === 'owner'

// Anchos fijos (la tabla usa `table-layout: fixed`, ver estilos): Nombre toma
// el resto y se corta con "…" si es largo, así nada cambia de tamaño.
const headers = computed(() => [
  { title: 'Nombre', key: 'name', sortable: false, align: 'center' as const },
  {
    title: 'Duración',
    key: 'duration_minutes',
    sortable: false,
    align: 'center' as const,
    width: 120,
  },
  {
    title: 'Costo',
    key: 'price_cents',
    sortable: false,
    align: 'center' as const,
    width: 140,
  },
  ...(isOwner()
    ? [
        {
          title: 'Acciones',
          key: 'actions',
          sortable: false,
          align: 'center' as const,
          width: 140,
          cellProps: { class: 'service-actions' },
        },
      ]
    : []),
])

// Un servicio inactivo se atenúa completo (menos sus acciones, para que el
// switch siga claro).
function rowProps({ item }: { item: Service }): Record<string, unknown> {
  return item.is_active ? {} : { class: 'service-row--inactive' }
}
// -1 es "Todos" para v-data-table.
const itemsPerPageOptions = [
  { value: 10, title: '10' },
  { value: 25, title: '25' },
  { value: 50, title: '50' },
  { value: 100, title: '100' },
  { value: -1, title: 'Todos' },
]
const kindLabels: Record<ServiceKind, string> = {
  grooming: 'Estética',
  veterinary: 'Veterinaria',
}

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    services.value = await servicesService.listByKind(
      session.activeTenantId,
      activeKind.value,
    )
  } catch {
    errorMessage.value = 'No se pudo cargar el catálogo. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

watch(activeKind, load)
onMounted(load)

function openNewService(): void {
  editingService.value = null
  showFormDialog.value = true
}

function openEditService(service: Service): void {
  editingService.value = service
  showFormDialog.value = true
}

// Ids de los servicios con un cambio de estado en curso: su switch muestra
// el loader y queda deshabilitado (evita doble clic) mientras se guarda.
// No se usa `loading` de la tabla para esto: solo se carga esa fila.
const togglingIds = ref<Set<string>>(new Set())

async function handleToggleActive(
  service: Service,
  value: boolean | null,
): Promise<void> {
  const isActive = value === true
  togglingIds.value.add(service.id)
  errorMessage.value = null
  try {
    await servicesService.setActive(service.id, isActive)
    // Solo se actualiza esta fila en memoria, sin volver a pedir la lista.
    service.is_active = isActive
  } catch {
    // El switch sigue mostrando `service.is_active`, que no cambió: queda
    // en su valor anterior.
    errorMessage.value = `No se pudo ${isActive ? 'activar' : 'desactivar'} el servicio. Revisa tu conexión.`
  } finally {
    togglingIds.value.delete(service.id)
  }
}

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Catálogo de servicios</h1>
      <v-spacer />
      <v-btn
        v-if="isOwner()"
        color="primary"
        prepend-icon="mdi-plus"
        @click="openNewService"
      >
        Nuevo servicio
      </v-btn>
    </div>

    <!-- Solo las pestañas visibles para el rol (arriba: visibleServiceKinds) —
         con una sola, v-tabs igual funciona bien, solo no deja nada que
         cambiar. -->
    <v-tabs v-model="activeKind" class="mb-4">
      <v-tab v-for="kind in visibleKinds" :key="kind" :value="kind">
        {{ kindLabels[kind] }}
      </v-tab>
    </v-tabs>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <!-- Tabla paginada. Sin `items-per-page` explícito arranca en 10; "Todos"
         es -1 en Vuetify. La columna de acciones solo existe para el dueño. -->
    <v-data-table
      :headers="headers"
      :items="services"
      :loading="loading"
      :row-props="rowProps"
      class="services-table"
      :items-per-page="10"
      :items-per-page-options="itemsPerPageOptions"
      items-per-page-text="Elementos por página"
      no-data-text="No hay servicios en esta categoría todavía."
      loading-text="Cargando servicios..."
    >
      <template #headers="{ columns }">
        <tr>
          <th
            v-for="column in columns"
            :key="column.key"
            class="font-weight-bold text-center"
          >
            {{ column.title }}
          </th>
        </tr>
      </template>
      <template #[`item.name`]="{ item }">
        <div class="service-name" :title="item.name">{{ item.name }}</div>
      </template>
      <template #[`item.duration_minutes`]="{ item }"
        >{{ item.duration_minutes }} min</template
      >
      <template #[`item.price_cents`]="{ item }">{{
        formatMXN(item.price_cents)
      }}</template>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex align-center justify-center">
          <v-btn
            icon="mdi-pencil"
            color="primary"
            variant="text"
            size="small"
            @click="openEditService(item)"
          />
          <v-switch
            class="service-switch"
            :model-value="item.is_active"
            :loading="togglingIds.has(item.id)"
            :disabled="togglingIds.has(item.id)"
            :aria-label="item.is_active ? 'Desactivar servicio' : 'Activar servicio'"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="handleToggleActive(item, $event)"
          />
        </div>
      </template>
    </v-data-table>

    <ServiceFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :kind="activeKind"
      :service="editingService"
      @saved="handleSaved"
    />
  </v-container>
</template>

<style scoped lang="scss">
.services-table :deep(table) {
  table-layout: fixed;
}

.service-switch {
  margin-left: 5px;
}

.service-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.services-table :deep(.service-row--inactive td:not(.service-actions)) {
  opacity: 0.5;
}
</style>
