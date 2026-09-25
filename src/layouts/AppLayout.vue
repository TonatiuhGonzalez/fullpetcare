<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import CancelAccountDialog from '@/components/CancelAccountDialog.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import { noticeSeverity, noticeText } from '@/lib/tenantNotices'
import { isFrontDesk, roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const businessName = computed(() => session.activeMembership?.tenantName ?? '')
// "Patitas Felices - Sucursal Centro" — la sucursal activa va pegada al
// nombre del negocio en el título (pedido explícito, antes solo se veía
// más a la derecha de la barra, lejos del nombre). Mientras no haya
// sucursal elegida (p. ej. el instante entre login y que
// resolveActiveBranch() corra) se muestra solo el nombre del negocio.
const titleLabel = computed(() =>
  session.activeBranch ? `${businessName.value} - ${session.activeBranch.name}` : businessName.value,
)
const userLabel = computed(() => session.profile?.fullName ?? session.user?.email ?? '')

// Banner de vigencia / gracia / solo lectura del negocio activo (tarea #1905).
const banner = computed(() => {
  const n = session.activeNotice
  if (!n) return null
  return {
    text: noticeText(
      n,
      session.activeMembership?.tenantTimezone ?? 'America/Mexico_City',
    ),
    severity: noticeSeverity(n.notice),
    // Solo el dueño puede regularizar el pago.
    canPay: n.role === 'owner',
  }
})
// MOCK: aún no hay pasarela de pago (CLAUDE.md §1).
const showPayMock = ref(false)

// Cancelar la cuenta: solo el dueño.
const showCancel = ref(false)
const cancelSaving = ref(false)
const cancelError = ref<string | null>(null)

async function handleCancelAccount(comment: string): Promise<void> {
  cancelSaving.value = true
  cancelError.value = null
  try {
    await session.cancelActiveTenant(comment || null)
    showCancel.value = false
    await router.push('/login')
  } catch {
    cancelError.value =
      'No se pudo cancelar la cuenta. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    cancelSaving.value = false
  }
}

const showChangePassword = ref(false)
const passwordChangedNotice = ref(false)

async function handleLogout(): Promise<void> {
  // "finally": aunque el servidor no responda, la sesión local ya se
  // limpió en session.logout() — hay que salir de la pantalla igual.
  try {
    await session.logout()
  } finally {
    router.push('/login')
  }
}

function handleBranchChange(branchId: unknown): void {
  if (typeof branchId === 'string') session.selectBranch(branchId)
}
</script>

<template>
  <v-app-bar color="primary" density="comfortable">
    <v-app-bar-title>
      <v-icon icon="mdi-paw" class="mr-2" />
      {{ titleLabel }}
    </v-app-bar-title>

    <!-- Navegación mínima: solo hay dos áreas construidas hasta ahora
         (agenda y clientes). Un v-navigation-drawer completo se agrega
         cuando haya suficientes secciones para justificarlo.

         "Clientes" solo para owner/receptionist (isFrontDesk) — groomer/
         vet no tienen el listado completo (router/index.ts ya redirige
         si llegan por URL directa; esto es solo para no mostrar un link
         a algo a lo que de todos modos no pueden entrar). -->
    <v-btn to="/app/agenda" variant="text" class="mr-1">Agenda</v-btn>
    <v-btn v-if="isFrontDesk(session.role)" to="/app/clientes" variant="text" class="mr-1">
      Clientes
    </v-btn>
    <v-btn to="/app/catalogo" variant="text" class="mr-1">Catálogo</v-btn>
    <!-- "Empleados" (fase 9): gateado por PERMISO, no por rol fijo — hoy
         solo el dueño tiene "employees:view" (role_permissions,
         sembrado en seed.sql), pero a futuro un negocio podría dárselo a
         otro rol sin tocar este archivo (CLAUDE.md §6.7). -->
    <v-btn v-if="session.canView('employees')" to="/app/empleados" variant="text" class="mr-4">
      Empleados
    </v-btn>

    <!-- El selector de sucursal solo tiene sentido si hay más de una que
         elegir — con una sola, el título de arriba ya la muestra
         ("Patitas Felices - Sucursal Centro"), así que no hace falta
         repetirla aquí. -->
    <v-select
      v-if="session.activeBranches.length > 1"
      :model-value="session.activeBranchId"
      :items="session.activeBranches"
      item-title="name"
      item-value="id"
      density="compact"
      variant="solo"
      hide-details
      style="max-width: 220px"
      class="mr-4"
      @update:model-value="handleBranchChange"
    />

    <v-chip class="mr-4" size="small" variant="tonal">{{
      roleLabel(session.role)
    }}</v-chip>
    <span class="mr-2 text-body-2">{{ userLabel }}</span>
    <v-btn
      icon="mdi-lock-reset"
      variant="text"
      title="Cambiar contraseña"
      @click="showChangePassword = true"
    />
    <v-btn
      v-if="session.role === 'owner'"
      icon="mdi-account-cancel-outline"
      variant="text"
      title="Cancelar mi cuenta"
      @click="showCancel = true"
    />
    <v-btn icon="mdi-logout" variant="text" title="Salir" @click="handleLogout" />
  </v-app-bar>

  <CancelAccountDialog
    v-model="showCancel"
    :tenant-name="businessName"
    :saving="cancelSaving"
    :error-message="cancelError"
    @confirm="handleCancelAccount"
  />

  <v-snackbar v-model="showPayMock" :timeout="4000">
    El pago en línea estará disponible pronto.
  </v-snackbar>

  <ChangePasswordDialog
    v-model="showChangePassword"
    :email="session.user?.email ?? ''"
    @changed="passwordChangedNotice = true"
  />

  <v-snackbar v-model="passwordChangedNotice" color="success" :timeout="4000">
    Contraseña actualizada.
  </v-snackbar>

  <v-main>
    <v-alert
      v-if="banner"
      :type="banner.severity"
      variant="tonal"
      density="compact"
      rounded="0"
      class="ma-0"
    >
      {{ banner.text }}
      <template v-if="banner.canPay" #append>
        <v-btn size="small" variant="flat" color="primary" @click="showPayMock = true">
          Pagar ahora
        </v-btn>
      </template>
    </v-alert>
    <router-view />
  </v-main>
</template>
