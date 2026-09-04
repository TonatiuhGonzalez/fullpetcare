<script setup lang="ts">
// Catálogo de servicios, separado en pestañas Estética / Veterinaria
// (tarea 3.16).
import { onMounted, ref, watch } from 'vue'

import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import { formatMXN } from '@/lib/money'
import { useSessionStore } from '@/stores/session'
import ServiceFormDialog from '@/components/ServiceFormDialog.vue'

const session = useSessionStore()

const activeKind = ref<ServiceKind>('grooming')
const services = ref<Service[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showFormDialog = ref(false)
const editingService = ref<Service | null>(null)

const isOwner = () => session.role === 'owner'

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

async function handleDeactivate(service: Service): Promise<void> {
  try {
    await servicesService.deactivate(service.id)
    await load()
  } catch {
    errorMessage.value = 'No se pudo desactivar el servicio. Revisa tu conexión.'
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

    <v-tabs v-model="activeKind" class="mb-4">
      <v-tab value="grooming">Estética</v-tab>
      <v-tab value="veterinary">Veterinaria</v-tab>
    </v-tabs>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-progress-circular v-if="loading" indeterminate color="primary" />

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
          <v-btn
            v-if="service.is_active"
            icon="mdi-eye-off"
            variant="text"
            size="small"
            title="Desactivar"
            @click="handleDeactivate(service)"
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
