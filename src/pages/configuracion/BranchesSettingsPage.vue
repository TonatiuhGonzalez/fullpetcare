<script setup lang="ts">
// Sección "Empresa y sucursales" de la configuración (tarea #1959). Solo el
// dueño llega aquí (router + política RLS de branches). Muestra los datos de la
// empresa (solo lectura) y administra las sucursales: alta, edición y
// habilitar/deshabilitar.
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'

import BranchFormDialog from '@/components/BranchFormDialog.vue'
import CardSkeleton from '@/components/CardSkeleton.vue'
import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { BRANCH_TIMEZONES } from '@/lib/branchSettings'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import * as companyService from '@/services/company'
import type { Company } from '@/services/company'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
// En pantallas chicas (< 960 px) cada sucursal es una tarjeta con sus botones debajo (fase 26).
const { smAndDown } = useDisplay()

const company = ref<Company | null>(null)
const branches = ref<Branch[]>([])
const loading = ref(false)
// Primera carga = silueta; recargas (tras guardar o habilitar) = filas conservadas y barra fina (D22).
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)

const showForm = ref(false)
const editingBranch = ref<Branch | null>(null)

const togglingId = ref<string | null>(null)
// Sucursal que se quiere deshabilitar y está esperando confirmación.
const branchToDisable = ref<Branch | null>(null)
const showDisableConfirm = ref(false)
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

// Habilitar es inmediato; deshabilitar pide confirmación (el interruptor sigue
// mostrando `is_active`, que no cambia hasta confirmar).
function handleSwitch(branch: Branch, value: boolean | null): void {
  if (value) {
    void toggleActive(branch)
    return
  }
  branchToDisable.value = branch
  showDisableConfirm.value = true
}

async function confirmDisable(): Promise<void> {
  const branch = branchToDisable.value
  if (!branch) return
  await toggleActive(branch)
  showDisableConfirm.value = false
  branchToDisable.value = null
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
    <PageHeader title="Empresa y sucursales" />

    <v-alert v-if="errorMessage" type="error" variant="tonal" density="compact" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <CardSkeleton v-if="isFirstLoad && showSkeleton" class="mb-6" :lines="4" />
    <v-card v-else-if="!isFirstLoad" class="mb-6" variant="outlined">
      <v-card-title class="text-subtitle-1">Datos de la empresa</v-card-title>
      <v-card-text>
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

    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="3" :rows="3" />
    <v-progress-linear v-else-if="!isFirstLoad && loading" indeterminate />
    <!-- Pantallas chicas: una tarjeta por sucursal, con los botones debajo. -->
    <div v-if="!isFirstLoad && smAndDown">
      <v-card
        v-for="branch in branches"
        :key="branch.id"
        variant="outlined"
        class="pa-4 mb-3"
      >
        <div
          class="d-flex align-start justify-space-between ga-2"
          :class="{ 'branch--inactive': !branch.is_active }"
        >
          <div class="font-weight-medium" style="overflow-wrap: anywhere">{{ branch.name }}</div>
          <v-chip
            size="x-small"
            :color="branch.is_active ? 'success' : undefined"
            variant="tonal"
          >
            {{ branch.is_active ? 'Habilitada' : 'Deshabilitada' }}
          </v-chip>
        </div>
        <div
          class="text-body-2 text-medium-emphasis mt-1"
          :class="{ 'branch--inactive': !branch.is_active }"
        >
          {{ branch.address || 'Sin dirección' }}
        </div>
        <div class="d-flex align-center justify-end ga-1 mt-3">
          <IconButton
            icon="mdi-pencil"
            aria-label="Editar sucursal"
            color="primary"
            variant="text"
            size="small"
            :disabled="togglingId === branch.id"
            @click="openEdit(branch)"
          />
          <v-tooltip
            :text="branch.is_active ? 'Deshabilitar sucursal' : 'Habilitar sucursal'"
            location="top"
          >
            <template #activator="{ props: tooltipProps }">
              <v-switch
                v-bind="tooltipProps"
                :model-value="branch.is_active"
                :loading="togglingId === branch.id"
                :disabled="togglingId === branch.id"
                :aria-label="branch.is_active ? 'Deshabilitar sucursal' : 'Habilitar sucursal'"
                color="primary"
                density="compact"
                hide-details
                @update:model-value="handleSwitch(branch, $event)"
              />
            </template>
          </v-tooltip>
        </div>
      </v-card>
      <p v-if="!loading && branches.length === 0" class="text-medium-emphasis">
        Aún no hay sucursales.
      </p>
    </div>
    <v-list v-else-if="!isFirstLoad" lines="two" class="border rounded">
      <v-list-item v-for="branch in branches" :key="branch.id">
        <v-list-item-title :class="{ 'branch--inactive': !branch.is_active }">
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
        <v-list-item-subtitle :class="{ 'branch--inactive': !branch.is_active }">
          {{ branch.address || 'Sin dirección' }}
        </v-list-item-subtitle>

        <template #append>
          <IconButton
            icon="mdi-pencil"
            aria-label="Editar sucursal"
            color="primary"
            variant="text"
            size="small"
            :disabled="togglingId === branch.id"
            @click="openEdit(branch)"
          />
          <v-tooltip
            :text="branch.is_active ? 'Deshabilitar sucursal' : 'Habilitar sucursal'"
            location="top"
          >
            <template #activator="{ props: tooltipProps }">
              <v-switch
                v-bind="tooltipProps"
                :model-value="branch.is_active"
                :loading="togglingId === branch.id"
                :disabled="togglingId === branch.id"
                :aria-label="branch.is_active ? 'Deshabilitar sucursal' : 'Habilitar sucursal'"
                color="primary"
                density="compact"
                hide-details
                @update:model-value="handleSwitch(branch, $event)"
              />
            </template>
          </v-tooltip>
        </template>
      </v-list-item>
      <v-list-item v-if="!loading && branches.length === 0">
        <v-list-item-title class="text-medium-emphasis">Aún no hay sucursales.</v-list-item-title>
      </v-list-item>
    </v-list>

    <v-dialog v-model="showDisableConfirm" max-width="420">
      <v-card>
        <v-card-title>Deshabilitar sucursal</v-card-title>
        <v-card-text>
          ¿Seguro que quieres deshabilitar «{{ branchToDisable?.name }}»? Dejará de ofrecerse
          para agendar y cobrar. Puedes habilitarla de nuevo cuando quieras.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="togglingId !== null"
            @click="showDisableConfirm = false"
          >
            Cancelar
          </v-btn>
          <v-btn color="error" :loading="togglingId !== null" @click="confirmDisable">
            Confirmar
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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

<style scoped lang="scss">
// Sucursal deshabilitada: se atenúa su texto; el interruptor queda a plena
// intensidad para poder volver a habilitarla.
.branch--inactive {
  opacity: 0.5;
}
</style>
