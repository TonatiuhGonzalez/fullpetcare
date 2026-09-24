<script setup lang="ts">
// Lista de empresas registradas (fase 10). Mismo molde que
// EmployeesPage.vue: se carga la lista completa de una vez y se filtra y
// pagina del lado del cliente (v-data-table de fábrica) — alcanza de sobra
// para las decenas de empresas de un demo (CLAUDE.md §11).
import { computed, onMounted, ref } from 'vue'

import * as platformService from '@/services/platform'
import type { PlatformTenant } from '@/services/platform'
import {
  filterTenants,
  formatPlanExpiry,
  formatPlatformDate,
  tenantStatusColor,
  tenantStatusLabel,
  type TenantStatus,
} from '@/lib/platform'
import TemporaryPasswordDialog from '@/components/TemporaryPasswordDialog.vue'
import TenantDetailDialog from '@/components/TenantDetailDialog.vue'
import TenantFormDialog from '@/components/TenantFormDialog.vue'

const tenants = ref<PlatformTenant[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const search = ref('')
const statusFilter = ref<TenantStatus | null>(null)
const statusOptions: { title: string; value: TenantStatus | null }[] = [
  { title: 'Todos los estados', value: null },
  { title: 'Activas', value: 'active' },
  { title: 'Suspendidas', value: 'suspended' },
  { title: 'De baja', value: 'closed' },
]

const headers = [
  { title: 'Empresa', key: 'name' },
  { title: 'Dueño', key: 'ownerLabel' },
  { title: 'Plan', key: 'plan' },
  { title: 'Vigencia', key: 'expiryLabel' },
  { title: 'Alta', key: 'createdLabel' },
  { title: 'Estado', key: 'statusLabel' },
]

interface TenantRow extends PlatformTenant {
  ownerLabel: string
  expiryLabel: string
  createdLabel: string
  statusLabel: string
}

// Tipo de retorno anotado a mano: mismo motivo que EmployeesPage.vue (evita
// "Type instantiation is excessively deep" con v-data-table).
const rows = computed<TenantRow[]>(() =>
  filterTenants(tenants.value, search.value, statusFilter.value).map((tenant) => ({
    ...tenant,
    ownerLabel: tenant.ownerName ?? 'Sin dueño',
    expiryLabel: formatPlanExpiry(tenant.planExpiresAt),
    createdLabel: formatPlatformDate(tenant.createdAt),
    statusLabel: tenantStatusLabel(tenant.status),
  })),
)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    tenants.value = await platformService.listTenants()
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : 'No se pudo cargar la lista de empresas.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// --- Detalle ----------------------------------------------------------------
// Se guarda el ID (no el objeto) y la empresa se busca en la lista cada vez:
// así, cuando el detalle emite `changed` y la lista recarga, el diálogo abierto
// muestra el estado ya actualizado sin cerrarse ni reabrirse.
const selectedTenantId = ref<string | null>(null)
const showDetail = ref(false)
const selectedTenant = computed(
  () => tenants.value.find((t) => t.id === selectedTenantId.value) ?? null,
)

function handleRowClick(_event: Event, { item }: { item: PlatformTenant }): void {
  selectedTenantId.value = item.id
  showDetail.value = true
}

// --- Alta -------------------------------------------------------------------
const showForm = ref(false)
const revealed = ref<{ tenantName: string; email: string; password: string } | null>(null)
const passwordDialogOpen = ref(false)

function handleCreated(result: {
  tenantName: string
  ownerEmail: string
  temporaryPassword: string
}): void {
  revealed.value = {
    tenantName: result.tenantName,
    email: result.ownerEmail,
    password: result.temporaryPassword,
  }
  passwordDialogOpen.value = true
  load()
}

function handlePasswordDialogToggle(open: boolean): void {
  passwordDialogOpen.value = open
  // La contraseña deja de existir en memoria al cerrar el diálogo.
  if (!open) revealed.value = null
}
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Empresas</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showForm = true">Nueva empresa</v-btn>
    </div>

    <div class="d-flex flex-wrap ga-4 mb-2">
      <v-text-field
        v-model="search"
        label="Buscar por empresa o dueño"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        clearable
        hide-details
        style="max-width: 320px"
      />
      <v-select
        v-model="statusFilter"
        :items="statusOptions"
        density="compact"
        hide-details
        style="max-width: 220px"
      />
    </div>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="my-4">
      {{ errorMessage }}
    </v-alert>

    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      no-data-text="No hay empresas que coincidan."
      loading-text="Cargando empresas…"
      class="mt-2"
      @click:row="handleRowClick"
    >
      <template #[`item.statusLabel`]="{ item }">
        <v-chip :color="tenantStatusColor(item.status)" size="small" variant="tonal">
          {{ item.statusLabel }}
        </v-chip>
      </template>
    </v-data-table>

    <TenantFormDialog v-model="showForm" @created="handleCreated" />

    <TemporaryPasswordDialog
      :model-value="passwordDialogOpen"
      :title="`Empresa dada de alta: ${revealed?.tenantName ?? ''}`"
      :email="revealed?.email ?? null"
      :password="revealed?.password ?? ''"
      @update:model-value="handlePasswordDialogToggle"
    />

    <TenantDetailDialog v-model="showDetail" :tenant="selectedTenant" @changed="load" />
  </v-container>
</template>
