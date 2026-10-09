<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import BrandLogo from '@/components/BrandLogo.vue'
import FeedbackDialog from '@/components/FeedbackDialog.vue'
import SideMenu, { type SideMenuItem } from '@/components/SideMenu.vue'
import UserMenu from '@/components/UserMenu.vue'
import { noticeSeverity, noticeText } from '@/lib/tenantNotices'
import { isFrontDesk, roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()
// En teléfono la barra no alcanza para el nombre junto al logo: solo el isotipo.
const { xs } = useDisplay()

const businessName = computed(() => session.activeMembership?.tenantName ?? '')
// "Patitas Felices - Sucursal Centro" — la sucursal activa va pegada al
// nombre del negocio en el título (pedido explícito, antes solo se veía
// más a la derecha de la barra, lejos del nombre). Mientras no haya
// sucursal elegida (p. ej. el instante entre login y que
// resolveActiveBranch() corra) se muestra solo el nombre del negocio.
const titleLabel = computed(() =>
  session.activeBranch
    ? `${businessName.value} - ${session.activeBranch.name}`
    : businessName.value,
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

// Opciones del menú lateral. "Clientes" solo para owner/receptionist
// (isFrontDesk) — groomer/vet no tienen el listado completo (router/index.ts
// ya redirige si llegan por URL directa; esto es solo para no mostrar un
// link a algo a lo que de todos modos no pueden entrar).
// "Empleados" (fase 9): gateado por PERMISO, no por rol fijo — hoy solo el
// dueño tiene "employees:view" (role_permissions, sembrado en seed.sql),
// pero a futuro un negocio podría dárselo a otro rol sin tocar este archivo
// (CLAUDE.md §6.7).
const menuOpen = ref(false)
const menuItems = computed<SideMenuItem[]>(() => [
  { title: 'Agenda', icon: 'mdi-calendar-month-outline', to: '/app/agenda' },
  ...(isFrontDesk(session.role)
    ? [{ title: 'Clientes', icon: 'mdi-account-group-outline', to: '/app/clientes' }]
    : []),
  { title: 'Servicios', icon: 'mdi-clipboard-list-outline', to: '/app/servicios' },
  ...(session.canView('inventory')
    ? [{ title: 'Inventario', icon: 'mdi-package-variant-closed', to: '/app/inventario' }]
    : []),
  ...(session.canView('cash_register')
    ? [{ title: 'Caja', icon: 'mdi-cash-multiple', to: '/app/caja' }]
    : []),
  ...(session.canView('reports')
    ? [{ title: 'Reportes', icon: 'mdi-chart-bar', to: '/app/reportes' }]
    : []),
  ...(session.canView('employees')
    ? [{ title: 'Empleados', icon: 'mdi-badge-account-outline', to: '/app/empleados' }]
    : []),
])

// Botón flotante de venta de mostrador (fase 13, tarea 13.3). Reemplaza la entrada
// del menú: se ve desde cualquier pantalla de la app, pero solo dueño y recepción
// cobran (misma regla que la ruta, `requiresFrontDesk`). En la propia pantalla de
// venta se oculta: ahí taparía el botón de cobrar y no lleva a ningún lado.
const route = useRoute()
const showPosButton = computed(
  () => isFrontDesk(session.role) && route.name !== 'venta-mostrador',
)

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
  <v-app-bar color="surface" density="comfortable" flat border="b">
    <!-- Hamburguesa: solo en pantallas angostas, donde el menú lateral está
         oculto y se abre como cajón. -->
    <v-app-bar-nav-icon class="d-md-none" @click="menuOpen = !menuOpen" />
    <router-link
      to="/app/agenda"
      class="brand-link ml-2 mr-4"
      aria-label="FullPetCare, ir a la agenda"
    >
      <BrandLogo :size="28" :show-wordmark="!xs" />
    </router-link>
    <!-- Negocio y sucursal activos. Provisional: la tarea 15.9 los pasa a un
         selector en el menú lateral. -->
    <span
      v-if="titleLabel"
      class="d-none d-md-inline text-body-2 text-medium-emphasis border-s ps-4"
    >
      {{ titleLabel }}
    </span>
    <v-spacer />

    <!-- El selector de sucursal solo tiene sentido si hay más de una que
         elegir — con una sola, la etiqueta de arriba ya la muestra. -->
    <v-select
      v-if="session.activeBranches.length > 1"
      :model-value="session.activeBranchId"
      :items="session.activeBranches"
      item-title="name"
      item-value="id"
      density="compact"
      variant="outlined"
      hide-details
      style="max-width: 220px"
      class="mr-2"
      @update:model-value="handleBranchChange"
    />

    <!-- Ayuda: aquí vive "Reportar error o sugerencia", que antes ocupaba un
         botón grande en la barra. -->
    <v-menu location="bottom end">
      <template #activator="{ props: helpProps }">
        <v-btn
          v-bind="helpProps"
          icon="mdi-help-circle-outline"
          variant="text"
          aria-label="Ayuda"
          title="Ayuda"
        />
      </template>
      <v-list density="comfortable">
        <v-list-item
          prepend-icon="mdi-message-alert-outline"
          title="Reportar error o sugerencia"
          @click="showFeedback = true"
        />
      </v-list>
    </v-menu>

    <UserMenu
      :name="userLabel"
      :role-label="roleLabel(session.role)"
      :email="session.user?.email"
      settings-to="/app/configuracion"
      @logout="handleLogout"
    />
  </v-app-bar>

  <SideMenu v-model:open="menuOpen" :items="menuItems" />

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

  <!-- d-none d-md-flex: solo escritorio; en móvil se oculta (mismo corte md que el menú lateral). -->
  <v-btn
    v-if="showPosButton"
    class="d-none d-md-flex ma-6"
    icon="mdi-cash-register"
    color="primary"
    size="large"
    position="fixed"
    location="bottom right"
    elevation="6"
    aria-label="Venta de mostrador"
    title="Venta de mostrador"
    to="/app/venta-mostrador"
  />
</template>

<style scoped lang="scss">
.brand-link {
  display: inline-flex;
  color: inherit;
  text-decoration: none;
}
</style>
