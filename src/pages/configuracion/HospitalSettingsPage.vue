<script setup lang="ts">
// Configuración de la hospitalización (fase 33, PLAN.md D30 punto 10). Solo el dueño: cómo se
// cuentan los días (natural o 24 horas), las tarifas por defecto y los espacios (jaulas) de la
// sucursal activa, cada uno con su tarifa propia si la tiene (tarifa por tipo de espacio).
import { computed, onMounted, ref, watch } from 'vue'

import IconButton from '@/components/IconButton.vue'
import PageHeader from '@/components/PageHeader.vue'
import { DAY_RULE_OPTIONS, type DayRule } from '@/lib/hospitalization'
import { formatMXN, pesosToCents } from '@/lib/money'
import * as hospitalService from '@/services/hospitalization'
import type { HospitalSpace } from '@/services/hospitalization'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const dayRule = ref<DayRule>('natural')
const dailyRate = ref<number | null>(null)
const stayRate = ref<number | null>(null)
const spaces = ref<HospitalSpace[]>([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const savedNotice = ref(false)

// Espacio en edición (o nuevo).
const editing = ref<HospitalSpace | null>(null)
const showForm = ref(false)
const spaceName = ref('')
const spaceType = ref('')
const spaceDaily = ref<number | null>(null)
const spaceStay = ref<number | null>(null)
const spaceError = ref<string | null>(null)

const dayRuleHint = computed(
  () => DAY_RULE_OPTIONS.find((o) => o.value === dayRule.value)?.hint,
)

function toCents(value: number | null): number | null {
  return value === null || (value as unknown) === '' ? null : pesosToCents(Number(value))
}

async function load(): Promise<void> {
  const tenantId = session.activeTenantId
  const branchId = session.activeBranchId
  if (!tenantId || !branchId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [settings, list] = await Promise.all([
      hospitalService.getSettings(tenantId),
      hospitalService.listSpaces(tenantId, branchId),
    ])
    dayRule.value = (settings?.day_rule as DayRule | undefined) ?? 'natural'
    dailyRate.value =
      settings?.default_daily_rate_cents != null
        ? settings.default_daily_rate_cents / 100
        : null
    stayRate.value =
      settings?.default_stay_rate_cents != null
        ? settings.default_stay_rate_cents / 100
        : null
    spaces.value = list
  } catch {
    errorMessage.value = 'No se pudo cargar la configuración. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
watch(() => session.activeBranchId, load)

async function saveSettings(): Promise<void> {
  if (!session.activeTenantId) return
  saving.value = true
  errorMessage.value = null
  savedNotice.value = false
  try {
    await hospitalService.saveSettings(session.activeTenantId, {
      dayRule: dayRule.value,
      defaultDailyRateCents: toCents(dailyRate.value),
      defaultStayRateCents: toCents(stayRate.value),
    })
    savedNotice.value = true
  } catch {
    errorMessage.value = 'No se pudo guardar la configuración. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

function openNew(): void {
  editing.value = null
  spaceName.value = ''
  spaceType.value = ''
  spaceDaily.value = null
  spaceStay.value = null
  spaceError.value = null
  showForm.value = true
}

function openEdit(space: HospitalSpace): void {
  editing.value = space
  spaceName.value = space.name
  spaceType.value = space.space_type ?? ''
  spaceDaily.value = space.daily_rate_cents != null ? space.daily_rate_cents / 100 : null
  spaceStay.value = space.stay_rate_cents != null ? space.stay_rate_cents / 100 : null
  spaceError.value = null
  showForm.value = true
}

async function saveSpace(): Promise<void> {
  if (spaceName.value.trim() === '') {
    spaceError.value = 'Escribe el nombre del espacio.'
    return
  }
  const tenantId = session.activeTenantId
  const branchId = session.activeBranchId
  if (!tenantId || !branchId) return
  const input = {
    name: spaceName.value,
    spaceType: spaceType.value.trim() || null,
    dailyRateCents: toCents(spaceDaily.value),
    stayRateCents: toCents(spaceStay.value),
  }
  saving.value = true
  spaceError.value = null
  try {
    if (editing.value) await hospitalService.updateSpace(editing.value.id, input)
    else await hospitalService.createSpace(tenantId, branchId, input)
    showForm.value = false
    await load()
  } catch (error) {
    // 23505 = nombre repetido en la sucursal.
    spaceError.value =
      error && typeof error === 'object' && (error as { code?: string }).code === '23505'
        ? 'Ya hay un espacio con ese nombre en esta sucursal.'
        : 'No se pudo guardar el espacio. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

async function toggleSpace(space: HospitalSpace, value: boolean | null): Promise<void> {
  try {
    await hospitalService.setSpaceActive(space.id, value === true)
    space.is_active = value === true
  } catch {
    errorMessage.value = 'No se pudo actualizar el espacio. Revisa tu conexión.'
  }
}
</script>

<template>
  <div>
    <PageHeader
      title="Hospitalización"
      subtitle="Cómo se cuentan los días, las tarifas y los espacios de esta sucursal."
    />

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
      v-if="savedNotice"
      type="success"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      Configuración guardada.
    </v-alert>

    <v-card variant="outlined" class="pa-4 mb-6">
      <h2 class="text-subtitle-1 font-weight-bold mb-3">Reglas del negocio</h2>
      <v-select
        v-model="dayRule"
        :items="DAY_RULE_OPTIONS"
        label="¿Cómo se cuenta un día?"
        :hint="dayRuleHint"
        persistent-hint
        variant="outlined"
        density="comfortable"
        class="mb-3"
      />
      <v-row dense>
        <v-col cols="12" sm="6">
          <v-text-field
            v-model.number="dailyRate"
            label="Tarifa por día por defecto (MXN)"
            type="number"
            min="0"
            step="0.01"
            variant="outlined"
            density="comfortable"
            hint="Cada espacio puede tener la suya."
            persistent-hint
          />
        </v-col>
        <v-col cols="12" sm="6">
          <v-text-field
            v-model.number="stayRate"
            label="Monto por estancia por defecto (MXN)"
            type="number"
            min="0"
            step="0.01"
            variant="outlined"
            density="comfortable"
            hint="Para cobrar un monto único por estancia."
            persistent-hint
          />
        </v-col>
      </v-row>
      <div class="d-flex justify-end mt-2">
        <v-btn color="primary" :loading="saving" @click="saveSettings">Guardar</v-btn>
      </div>
    </v-card>

    <div class="d-flex align-center mb-2">
      <h2 class="text-subtitle-1 font-weight-bold">
        Espacios de {{ session.activeBranch?.name }}
      </h2>
      <v-spacer />
      <v-btn color="primary" variant="tonal" prepend-icon="mdi-plus" @click="openNew">
        Nuevo espacio
      </v-btn>
    </div>

    <p v-if="!loading && spaces.length === 0" class="text-body-2 text-medium-emphasis">
      Aún no hay espacios en esta sucursal.
    </p>
    <v-list v-else density="compact" class="border rounded">
      <v-list-item v-for="space in spaces" :key="space.id">
        <template #title>{{ space.name }}</template>
        <template #subtitle>
          {{ space.space_type ?? 'Sin tipo' }} ·
          {{
            space.daily_rate_cents != null
              ? `${formatMXN(space.daily_rate_cents)} por día`
              : 'tarifa del negocio'
          }}
        </template>
        <template #append>
          <IconButton
            icon="mdi-pencil"
            color="primary"
            variant="text"
            size="small"
            :aria-label="`Editar ${space.name}`"
            @click="openEdit(space)"
          />
          <v-switch
            :model-value="space.is_active"
            color="primary"
            density="compact"
            hide-details
            :aria-label="space.is_active ? 'Desactivar espacio' : 'Activar espacio'"
            @update:model-value="(value) => toggleSpace(space, value)"
          />
        </template>
      </v-list-item>
    </v-list>

    <v-dialog v-model="showForm" max-width="460">
      <v-card>
        <v-card-title>{{ editing ? 'Editar espacio' : 'Nuevo espacio' }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="spaceName"
            label="Nombre*"
            variant="outlined"
            density="comfortable"
          />
          <v-text-field
            v-model="spaceType"
            label="Tipo"
            hint="Por ejemplo: jaula chica, jaula grande, aislamiento."
            persistent-hint
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model.number="spaceDaily"
                label="Por día (MXN)"
                type="number"
                min="0"
                step="0.01"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="spaceStay"
                label="Por estancia (MXN)"
                type="number"
                min="0"
                step="0.01"
                variant="outlined"
                density="comfortable"
              />
            </v-col>
          </v-row>
          <p class="text-caption text-medium-emphasis">
            Si lo dejas vacío, se usa la tarifa del negocio.
          </p>
          <v-alert
            v-if="spaceError"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-2"
          >
            {{ spaceError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="showForm = false">Cancelar</v-btn>
          <v-btn color="primary" :loading="saving" @click="saveSpace">Guardar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
