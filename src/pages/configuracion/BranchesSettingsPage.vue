<script setup lang="ts">
// Sección "Empresa y sucursales" de la configuración (tarea #1959). Solo el
// dueño llega aquí (router + política RLS de branches). Muestra los datos de la
// empresa (solo lectura) y administra las sucursales: alta, edición y
// habilitar/deshabilitar.
import { computed, onMounted, ref } from 'vue'

import BranchFormDialog from '@/components/BranchFormDialog.vue'
import { BRANCH_TIMEZONES } from '@/lib/branchSettings'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import * as companyService from '@/services/company'
import type { Company } from '@/services/company'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const company = ref<Company | null>(null)
const branches = ref<Branch[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const showForm = ref(false)
const editingBranch = ref<Branch | null>(null)

const togglingId = ref<string | null>(null)
const snackbar = ref<{ show: boolean; text: string; color: string }>({
  show: false,
  text: '',
  color: 'success',
})

const tenantId = computed(() => session.activeTenantId ?? '')

// Datos de la empresa que se muestran; los que no se capturaron salen con guion.
const companyRows = computed(() => {
  const c = company.value
  if (!c) return []
  const timezone = BRANCH_TIMEZONES.find((tz) => tz.value === c.timezone)?.title ?? c.timezone
  return [
    { label: 'Nombre', value: c.name },
    { label: 'Razón social', value: c.legal_name },
    { label: 'RFC', value: c.rfc },
    { label: 'Régimen fiscal', value: c.tax_regime_code },
    { label: 'Código postal fiscal', value: c.postal_code },
    { label: 'Uso de CFDI por defecto', value: c.default_cfdi_use },
    { label: 'Zona horaria', value: timezone },
  ].map((row) => ({ ...row, value: row.value || '—' }))
})

async function load(): Promise<void> {
  if (!tenantId.value) return
  loading.value = true
  errorMessage.value = null
  try {
    ;[company.value, branches.value] = await Promise.all([
      companyService.getById(tenantId.value),
      branchesService.listAllByTenant(tenantId.value),
    ])
  } catch {
    errorMessage.value = 'No se pudo cargar la configuración. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openCreate(): void {
  editingBranch.value = null
  showForm.value = true
}

function openEdit(branch: Branch): void {
  editingBranch.value = branch
  showForm.value = true
}

function notify(text: string, color = 'success'): void {
  snackbar.value = { show: true, text, color }
}

// Tras cualquier cambio se recarga la lista de la pantalla y la del store de
// sesión: el selector de sucursal de la barra y la agenda leen de ahí.
async function refreshAll(): Promise<void> {
  await Promise.all([load(), session.loadMemberships()])
}

async function handleSaved(): Promise<void> {
  await refreshAll()
  notify('Sucursal guardada.')
}

async function toggleActive(branch: Branch): Promise<void> {
  togglingId.value = branch.id
  try {
    await branchesService.setActive(branch.id, !branch.is_active)
    await refreshAll()
    notify(branch.is_active ? 'Sucursal deshabilitada.' : 'Sucursal habilitada.')
  } catch (e) {
    // Si la base la bloqueó, su mensaje ya explica por qué (citas, empleados
    // o última sucursal activa); cualquier otro error es de conexión.
    notify(
      e instanceof branchesService.BranchDisableBlockedError
        ? e.message
        : 'No se pudo cambiar el estado de la sucursal. Revisa tu conexión.',
      'error',
    )
  } finally {
    togglingId.value = null
  }
}
</script>

<template>
  <div>
    <h1 class="text-h5 mb-4">Empresa y sucursales</h1>

    <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-card class="mb-6" variant="outlined">
      <v-card-title class="text-subtitle-1">Datos de la empresa</v-card-title>
      <v-card-text>
        <v-progress-linear v-if="loading && !company" indeterminate />
        <v-row dense>
          <v-col v-for="row in companyRows" :key="row.label" cols="12" sm="6">
            <div class="text-caption text-medium-emphasis">{{ row.label }}</div>
            <div>{{ row.value }}</div>
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <div class="d-flex align-center mb-2">
      <h2 class="text-h6">Sucursales</h2>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openCreate">Añadir sucursal</v-btn>
    </div>

    <v-list lines="two" class="border rounded">
      <v-list-item v-for="branch in branches" :key="branch.id">
        <v-list-item-title>
          {{ branch.name }}
          <v-chip
            size="x-small"
            class="ml-2"
            :color="branch.is_active ? 'success' : undefined"
            variant="tonal"
          >
            {{ branch.is_active ? 'Habilitada' : 'Deshabilitada' }}
          </v-chip>
        </v-list-item-title>
        <v-list-item-subtitle>{{ branch.address || 'Sin dirección' }}</v-list-item-subtitle>

        <template #append>
          <v-btn
            variant="text"
            prepend-icon="mdi-pencil-outline"
            :disabled="togglingId === branch.id"
            @click="openEdit(branch)"
          >
            Editar
          </v-btn>
          <v-btn
            variant="text"
            :prepend-icon="branch.is_active ? 'mdi-cancel' : 'mdi-check-circle-outline'"
            :loading="togglingId === branch.id"
            @click="toggleActive(branch)"
          >
            {{ branch.is_active ? 'Deshabilitar' : 'Habilitar' }}
          </v-btn>
        </template>
      </v-list-item>
      <v-list-item v-if="!loading && branches.length === 0">
        <v-list-item-title class="text-medium-emphasis">Aún no hay sucursales.</v-list-item-title>
      </v-list-item>
    </v-list>

    <BranchFormDialog
      v-model="showForm"
      :tenant-id="tenantId"
      :branch="editingBranch"
      @saved="handleSaved"
    />

    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="5000">
      {{ snackbar.text }}
    </v-snackbar>
  </div>
</template>
