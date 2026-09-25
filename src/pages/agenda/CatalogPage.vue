<script setup lang="ts">
// Catálogo de servicios, separado en pestañas Estética / Veterinaria
// (tarea 3.16).
import { onMounted, ref, watch } from 'vue'

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
const kindLabels: Record<ServiceKind, string> = { grooming: 'Estética', veterinary: 'Veterinaria' }

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    services.value = await servicesService.listByKind(session.activeTenantId, activeKind.value)
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

async function handleToggleActive(service: Service, value: boolean | null): Promise<void> {
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
      <v-btn v-if="isOwner()" color="primary" prepend-icon="mdi-plus" @click="openNewService">
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

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <!-- Skeleton con la forma de las filas (título + subtítulo), para que la
         lista no "salte" al terminar de cargar. -->
    <v-skeleton-loader
      v-if="loading"
      type="list-item-two-line, list-item-two-line, list-item-two-line, list-item-two-line"
    />

    <v-list v-else lines="two">
      <v-list-item v-for="service in services" :key="service.id">
        <template #title>
          <span :class="{ 'text-medium-emphasis': !service.is_active }">
            {{ service.name }}
            <v-chip v-if="!service.is_active" size="x-small" class="ml-2" variant="tonal">
              inactivo
            </v-chip>
          </span>
        </template>
        <template #subtitle>
          {{ service.duration_minutes }} min · {{ formatMXN(service.price_cents) }}
        </template>
        <template v-if="isOwner()" #append>
          <v-btn icon="mdi-pencil" variant="text" size="small" @click="openEditService(service)" />
          <v-switch
            :model-value="service.is_active"
            :loading="togglingIds.has(service.id)"
            :disabled="togglingIds.has(service.id)"
            :aria-label="service.is_active ? 'Desactivar servicio' : 'Activar servicio'"
            color="primary"
            density="compact"
            hide-details
            @update:model-value="handleToggleActive(service, $event)"
          />
        </template>
      </v-list-item>

      <v-list-item v-if="services.length === 0">
        <template #title>No hay servicios en esta categoría todavía.</template>
      </v-list-item>
    </v-list>

    <ServiceFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :kind="activeKind"
      :service="editingService"
      @saved="handleSaved"
    />
  </v-container>
</template>
