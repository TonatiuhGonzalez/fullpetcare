<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import FeedbackDialog from '@/components/FeedbackDialog.vue'
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

const showFeedback = ref(false)
const feedbackSentNotice = ref(false)

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
    <!-- flex: 0 1 auto — por defecto el título ocupa todo el ancho libre y el
         botón de reportes quedaría pegado a la navegación, lejos del nombre.
         El v-spacer de abajo empuja la navegación a la derecha. -->
    <v-app-bar-title style="flex: 0 1 auto">
      <v-icon icon="mdi-paw" class="mr-2" />
      {{ titleLabel }}
    </v-app-bar-title>
    <v-btn
      prepend-icon="mdi-message-alert-outline"
      variant="tonal"
      size="small"
      class="ml-4"
      @click="showFeedback = true"
    >
      Reportar error o sugerencia
    </v-btn>
    <v-spacer />

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
    <!-- Configuración (tarea #1959): reemplaza los botones de cambiar
         contraseña y cancelar cuenta, que ahora viven en su sección "Cuenta". -->
    <v-btn
      to="/app/configuracion"
      icon="mdi-cog-outline"
      variant="text"
      title="Configuración"
    />
    <v-btn icon="mdi-logout" variant="text" title="Salir" @click="handleLogout" />
  </v-app-bar>

  <v-snackbar v-model="showPayMock" :timeout="4000">
    El pago en línea estará disponible pronto.
  </v-snackbar>

  <FeedbackDialog
    v-model="showFeedback"
    :tenant-id="session.activeMembership?.tenantId ?? ''"
    @sent="feedbackSentNotice = true"
  />

  <v-snackbar v-model="feedbackSentNotice" color="success" :timeout="4000">
    ¡Gracias! Recibimos tu comentario.
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
