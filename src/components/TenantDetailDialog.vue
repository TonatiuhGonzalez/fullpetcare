<script setup lang="ts">
// Detalle de una empresa para el superadmin (fase 10): un solo diálogo con
// pestañas (Datos / Métricas / Notas / Bitácora), mismo criterio que
// EmployeeFormDialog.vue. Las pestañas Métricas y Bitácora cargan sus datos
// SOLO cuando se abren: la mayoría de las veces el superadmin abre el
// detalle para una sola cosa y no hace falta pedir todo.
//
// Componente tonto: no decide permisos (solo un superadmin llega aquí y la
// base revalida cada acción) y habla con services/platform.ts, nunca con
// supabase.ts (CLAUDE.md §4). Cuando algo cambia emite `changed` para que
// la lista recargue.
import { computed, ref, watch } from 'vue'

import * as platformService from '@/services/platform'
import type { PlatformAuditEntry, PlatformTenant, TenantMetrics } from '@/services/platform'
import {
  describeAuditEntry,
  formatPlanExpiry,
  formatPlatformDate,
  formatPlatformDateTime,
  tenantStatusColor,
  tenantStatusLabel,
  type TenantStatus,
} from '@/lib/platform'
import TemporaryPasswordDialog from '@/components/TemporaryPasswordDialog.vue'
import TenantStatusDialog from '@/components/TenantStatusDialog.vue'

const props = defineProps<{
  modelValue: boolean
  tenant: PlatformTenant | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

type TabName = 'datos' | 'metricas' | 'notas' | 'bitacora'
const TABS: { name: TabName; label: string }[] = [
  { name: 'datos', label: 'Datos' },
  { name: 'metricas', label: 'Métricas' },
  { name: 'notas', label: 'Notas' },
  { name: 'bitacora', label: 'Bitácora' },
]
const tab = ref<TabName>('datos')

// ---------------------------------------------------------------------------
// Apertura: todo empieza limpio, para no mostrar datos de la empresa anterior
// ---------------------------------------------------------------------------
const actionError = ref<string | null>(null)
const notes = ref('')
const metrics = ref<TenantMetrics | null>(null)
const audit = ref<PlatformAuditEntry[]>([])
const actorNames = ref<Map<string, string>>(new Map())

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    tab.value = 'datos'
    actionError.value = null
    notes.value = props.tenant?.internalNotes ?? ''
    metrics.value = null
    metricsError.value = null
    audit.value = []
    auditError.value = null
    notesError.value = null
  },
)

watch(tab, (name) => {
  if (!props.modelValue) return
  if (name === 'metricas') loadMetrics()
  if (name === 'bitacora') loadAudit()
})

function close(): void {
  emit('update:modelValue', false)
}

// ---------------------------------------------------------------------------
// Métricas
// ---------------------------------------------------------------------------
const metricsLoading = ref(false)
const metricsError = ref<string | null>(null)

async function loadMetrics(): Promise<void> {
  if (!props.tenant) return
  metricsLoading.value = true
  metricsError.value = null
  try {
    metrics.value = await platformService.getTenantMetrics(props.tenant.id)
  } catch (e) {
    metricsError.value = e instanceof Error ? e.message : 'No se pudieron cargar las métricas.'
  } finally {
    metricsLoading.value = false
  }
}

const metricCards = computed(() => {
  const m = metrics.value
  if (!m) return []
  return [
    { label: 'Sucursales', value: String(m.branches), icon: 'mdi-store' },
    { label: 'Empleados activos', value: String(m.activeEmployees), icon: 'mdi-account-group' },
    { label: 'Clientes', value: String(m.customers), icon: 'mdi-account-multiple' },
    { label: 'Mascotas', value: String(m.pets), icon: 'mdi-paw' },
    { label: 'Citas este mes', value: String(m.appointmentsThisMonth), icon: 'mdi-calendar-month' },
    {
      label: 'Último acceso',
      value: m.lastAccessAt ? formatPlatformDateTime(m.lastAccessAt) : 'Nadie ha entrado',
      icon: 'mdi-login',
    },
  ]
})

// ---------------------------------------------------------------------------
// Notas
// ---------------------------------------------------------------------------
const notesSaving = ref(false)
const notesError = ref<string | null>(null)
const notesDirty = computed(() => notes.value.trim() !== (props.tenant?.internalNotes ?? ''))

async function saveNotes(): Promise<void> {
  if (!props.tenant) return
  notesSaving.value = true
  notesError.value = null
  try {
    await platformService.updateTenantNotes(props.tenant.id, notes.value)
    emit('changed')
  } catch (e) {
    notesError.value = e instanceof Error ? e.message : 'No se pudieron guardar las notas.'
  } finally {
    notesSaving.value = false
  }
}

// ---------------------------------------------------------------------------
// Bitácora
// ---------------------------------------------------------------------------
const auditLoading = ref(false)
const auditError = ref<string | null>(null)

async function loadAudit(): Promise<void> {
  if (!props.tenant) return
  auditLoading.value = true
  auditError.value = null
  try {
    audit.value = await platformService.listAuditLog(props.tenant.id)
    // Los nombres de quienes actuaron: si no se pueden traer, la bitácora
    // sigue siendo legible (con "Un superadmin"), no se bloquea por esto.
    try {
      const admins = await platformService.listAdmins()
      actorNames.value = new Map(admins.map((a) => [a.userId, a.fullName ?? a.email]))
    } catch {
      actorNames.value = new Map()
    }
  } catch (e) {
    auditError.value = e instanceof Error ? e.message : 'No se pudo cargar la bitácora.'
  } finally {
    auditLoading.value = false
  }
}

// Sin actor = un proceso sin sesión de usuario (una semilla, un script) — no
// es un error: se llama "Sistema". Un actor que ya no está en la lista es un
// superadmin al que se le quitó el acceso después.
function actorLabel(entry: PlatformAuditEntry): string {
  if (entry.actorUserId === null) return 'Sistema'
  return actorNames.value.get(entry.actorUserId) ?? 'Un superadmin anterior'
}

// ---------------------------------------------------------------------------
// Estado (suspender / dar de baja / reactivar)
// ---------------------------------------------------------------------------
const statusDialogOpen = ref(false)
const statusTarget = ref<Exclude<TenantStatus, 'active'>>('suspended')
const statusSaving = ref(false)
const statusError = ref<string | null>(null)
const statusReasons = ref<platformService.CancellationReason[]>([])

const otherStatuses = computed<TenantStatus[]>(() =>
  (['active', 'suspended', 'closed'] as TenantStatus[]).filter((s) => s !== props.tenant?.status),
)

const STATUS_BUTTON: Record<TenantStatus, { label: string; icon: string; color: string }> = {
  active: { label: 'Reactivar', icon: 'mdi-check-circle-outline', color: 'success' },
  suspended: { label: 'Suspender', icon: 'mdi-pause-circle-outline', color: 'warning' },
  closed: { label: 'Dar de baja', icon: 'mdi-close-circle-outline', color: 'error' },
}

async function requestStatusChange(target: TenantStatus): Promise<void> {
  if (!props.tenant) return
  actionError.value = null
  if (target === 'active') {
    // Reactivar no pide motivo.
    try {
      await platformService.setTenantStatus(props.tenant.id, 'active', null, null)
      emit('changed')
    } catch (e) {
      actionError.value = e instanceof Error ? e.message : 'No se pudo reactivar la empresa.'
    }
    return
  }
  statusTarget.value = target
  statusError.value = null
  try {
    // Solo se ofrecen los motivos activos: desactivar uno es "ya no se usa".
    statusReasons.value = (await platformService.listReasons()).filter((r) => r.isActive)
  } catch (e) {
    actionError.value =
      e instanceof Error ? e.message : 'No se pudieron cargar los motivos.'
    return
  }
  statusDialogOpen.value = true
}

async function confirmStatusChange(
  publicReasonId: string,
  comment: string,
): Promise<void> {
  if (!props.tenant) return
  statusSaving.value = true
  statusError.value = null
  try {
    await platformService.setTenantStatus(
      props.tenant.id,
      statusTarget.value,
      publicReasonId,
      comment || null,
    )
    statusDialogOpen.value = false
    emit('changed')
  } catch (e) {
    statusError.value = e instanceof Error ? e.message : 'No se pudo cambiar el estado.'
  } finally {
    statusSaving.value = false
  }
}

// ---------------------------------------------------------------------------
// Restablecer contraseña del dueño
// ---------------------------------------------------------------------------
const confirmResetOpen = ref(false)
const resetting = ref(false)
const resetError = ref<string | null>(null)
// La contraseña vive aquí solo mientras el diálogo de "una sola vez" está
// abierto; se borra al cerrarlo.
const revealed = ref<{ email: string; password: string; warning: string | null } | null>(null)
const passwordDialogOpen = ref(false)

function openResetConfirm(): void {
  resetError.value = null
  confirmResetOpen.value = true
}

async function confirmReset(): Promise<void> {
  if (!props.tenant) return
  resetting.value = true
  resetError.value = null
  try {
    const result = await platformService.resetOwnerPassword(props.tenant.id)
    confirmResetOpen.value = false
    revealed.value = {
      email: result.ownerEmail,
      password: result.temporaryPassword,
      // La contraseña YA cambió aunque esto falle: se avisa, no se oculta.
      warning: !result.sessionsRevoked
        ? 'La contraseña cambió, pero no se pudieron cerrar las sesiones que el dueño tenía abiertas.'
        : !result.mustChangeEnforced
          ? 'La contraseña cambió, pero no se pudo exigir que el dueño la cambie al entrar.'
          : null,
    }
    passwordDialogOpen.value = true
    emit('changed')
  } catch (e) {
    resetError.value =
      e instanceof Error ? e.message : 'No se pudo restablecer la contraseña. Revisa tu conexión.'
  } finally {
    resetting.value = false
  }
}

function handlePasswordDialogToggle(open: boolean): void {
  passwordDialogOpen.value = open
  if (!open) revealed.value = null
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card v-if="tenant">
      <v-card-title class="d-flex align-center">
        <span class="mr-3">{{ tenant.name }}</span>
        <v-chip :color="tenantStatusColor(tenant.status)" size="small" variant="tonal">
          {{ tenantStatusLabel(tenant.status) }}
        </v-chip>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" title="Cerrar" @click="close" />
      </v-card-title>

      <v-tabs v-model="tab">
        <v-tab v-for="t in TABS" :key="t.name" :value="t.name">{{ t.label }}</v-tab>
      </v-tabs>

      <v-card-text style="min-height: 420px">
        <v-window v-model="tab">
          <!-- ============================ Datos ============================ -->
          <v-window-item value="datos">
            <v-row dense>
              <v-col cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Dueño</div>
                <div>{{ tenant.ownerName ?? 'Sin dueño asignado' }}</div>
              </v-col>
              <v-col cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Correo</div>
                <div>{{ tenant.ownerEmail ?? '—' }}</div>
              </v-col>
              <v-col cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Teléfono</div>
                <div>{{ tenant.ownerPhone ?? '—' }}</div>
              </v-col>
              <v-col cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Fecha de alta</div>
                <div>{{ formatPlatformDate(tenant.createdAt) }}</div>
              </v-col>
              <v-col cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Plan</div>
                <div>{{ tenant.plan }}</div>
              </v-col>
              <v-col cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Vigencia</div>
                <div>{{ formatPlanExpiry(tenant.planExpiresAt) }}</div>
              </v-col>
              <v-col v-if="tenant.publicReason" cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">
                  Motivo público (lo ve el cliente)
                </div>
                <div>{{ tenant.publicReason }}</div>
              </v-col>
              <v-col v-if="tenant.statusReason" cols="12" sm="6">
                <div class="text-caption text-medium-emphasis">Comentarios internos</div>
                <div>{{ tenant.statusReason }}</div>
              </v-col>
            </v-row>

            <v-divider class="my-4" />

            <div class="text-subtitle-2 mb-2">Estado de la empresa</div>
            <div class="d-flex flex-wrap ga-2 mb-4">
              <v-btn
                v-for="status in otherStatuses"
                :key="status"
                :color="STATUS_BUTTON[status].color"
                :prepend-icon="STATUS_BUTTON[status].icon"
                variant="tonal"
                @click="requestStatusChange(status)"
              >
                {{ STATUS_BUTTON[status].label }}
              </v-btn>
            </div>

            <div class="text-subtitle-2 mb-2">Acceso del dueño</div>
            <v-btn
              prepend-icon="mdi-lock-reset"
              variant="tonal"
              :disabled="!tenant.ownerUserId"
              @click="openResetConfirm"
            >
              Restablecer contraseña
            </v-btn>
            <div v-if="!tenant.ownerUserId" class="text-caption text-medium-emphasis mt-1">
              Esta empresa no tiene un dueño activo.
            </div>

            <v-alert
              v-if="actionError"
              type="error"
              density="compact"
              variant="tonal"
              class="mt-4"
            >
              {{ actionError }}
            </v-alert>
          </v-window-item>

          <!-- ============================ Métricas ============================ -->
          <v-window-item value="metricas">
            <v-progress-linear v-if="metricsLoading" indeterminate class="mb-4" />
            <v-alert v-if="metricsError" type="error" density="compact" variant="tonal">
              {{ metricsError }}
            </v-alert>
            <v-row v-if="metrics" dense>
              <v-col v-for="card in metricCards" :key="card.label" cols="12" sm="6" md="4">
                <v-card variant="tonal">
                  <v-card-text>
                    <div class="d-flex align-center text-caption text-medium-emphasis mb-1">
                      <v-icon :icon="card.icon" size="small" class="mr-1" />
                      {{ card.label }}
                    </div>
                    <div class="text-h6">{{ card.value }}</div>
                  </v-card-text>
                </v-card>
              </v-col>
            </v-row>
            <p v-if="metrics" class="text-caption text-medium-emphasis mt-3">
              Solo conteos: el panel de plataforma nunca muestra clientes, mascotas ni expedientes.
            </p>
          </v-window-item>

          <!-- ============================ Notas ============================ -->
          <v-window-item value="notas">
            <p class="text-body-2 text-medium-emphasis mb-3">
              Notas internas de la plataforma. La empresa no las puede ver.
            </p>
            <v-textarea
              v-model="notes"
              label="Notas"
              rows="6"
              auto-grow
              placeholder="Ej. Cliente piloto, acordó pagar en octubre…"
            />
            <v-alert v-if="notesError" type="error" density="compact" variant="tonal" class="mb-3">
              {{ notesError }}
            </v-alert>
            <v-btn color="primary" :loading="notesSaving" :disabled="!notesDirty" @click="saveNotes">
              Guardar notas
            </v-btn>
          </v-window-item>

          <!-- ============================ Bitácora ============================ -->
          <v-window-item value="bitacora">
            <v-progress-linear v-if="auditLoading" indeterminate class="mb-4" />
            <v-alert v-if="auditError" type="error" density="compact" variant="tonal">
              {{ auditError }}
            </v-alert>
            <p
              v-if="!auditLoading && !auditError && audit.length === 0"
              class="text-body-2 text-medium-emphasis"
            >
              Todavía no hay acciones registradas para esta empresa.
            </p>
            <v-list v-if="audit.length > 0" lines="two" density="compact">
              <v-list-item v-for="entry in audit" :key="entry.id">
                <!-- `text-wrap`: por default el título de un v-list-item se
                     corta con "…" en una sola línea, y aquí las frases (con el
                     motivo de una suspensión) pueden ser largas. -->
                <v-list-item-title class="text-wrap">
                  <div v-for="sentence in describeAuditEntry(entry)" :key="sentence">
                    {{ sentence }}
                  </div>
                </v-list-item-title>
                <v-list-item-subtitle class="text-wrap mt-1">
                  {{ actorLabel(entry) }} · {{ formatPlatformDateTime(entry.changedAt) }}
                </v-list-item-subtitle>
              </v-list-item>
            </v-list>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>

  <TenantStatusDialog
    v-if="tenant"
    v-model="statusDialogOpen"
    :tenant-name="tenant.name"
    :target-status="statusTarget"
    :reasons="statusReasons"
    :saving="statusSaving"
    :error-message="statusError"
    @confirm="confirmStatusChange"
  />

  <v-dialog v-model="confirmResetOpen" max-width="460">
    <v-card>
      <v-card-title>Restablecer contraseña</v-card-title>
      <v-card-text>
        <p class="mb-2">
          Se generará una contraseña temporal nueva para
          <strong>{{ tenant?.ownerName ?? 'el dueño' }}</strong> ({{ tenant?.ownerEmail }}).
        </p>
        <p class="text-body-2 text-medium-emphasis">
          La contraseña actual dejará de funcionar y se cerrarán las sesiones que tenga abiertas.
        </p>
        <v-alert v-if="resetError" type="error" density="compact" variant="tonal" class="mt-3">
          {{ resetError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="resetting" @click="confirmResetOpen = false">
          Cancelar
        </v-btn>
        <v-btn color="primary" :loading="resetting" @click="confirmReset">Restablecer</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <TemporaryPasswordDialog
    :model-value="passwordDialogOpen"
    title="Contraseña restablecida"
    :email="revealed?.email ?? null"
    :password="revealed?.password ?? ''"
    :warning="revealed?.warning ?? null"
    @update:model-value="handlePasswordDialogToggle"
  />
</template>
