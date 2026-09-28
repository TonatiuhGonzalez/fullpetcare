<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import BlockedTenantDialog from '@/components/BlockedTenantDialog.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const submitting = ref(false)
const showBlocked = ref(false)
const showPayMock = ref(false)

// Recargar la página con todos los negocios bloqueados cae aquí (guard del
// router): el aviso debe volver a mostrarse sin pedir otro login.
onMounted(() => {
  if (session.isBlockedOnly) showBlocked.value = true
})

function goHome(): Promise<unknown> {
  // Si el guard del router mandó aquí por intentar entrar a una ruta
  // privada (?redirect=/app/...), se vuelve a esa. Si no, a /app/agenda
  // — el guard decide desde ahí si hace falta elegir negocio primero.
  const redirectTo =
    typeof route.query.redirect === 'string' ? route.query.redirect : '/app/agenda'
  return router.push(redirectTo)
}

async function closeBlocked(): Promise<void> {
  showBlocked.value = false
  if (session.isBlockedOnly) {
    // Sin negocios activos no hay a dónde ir: se cierra la sesión.
    await session.logout()
    return
  }
  await goHome()
}

async function handleSubmit(): Promise<void> {
  submitting.value = true
  try {
    await session.login(email.value, password.value)
    // Si algún negocio suyo está en solo lectura o dado de baja, primero se le explica por qué.
    if (session.restrictingNotices.length > 0) {
      showBlocked.value = true
      return
    }
    await goHome()
  } catch {
    // El mensaje de error ya queda en session.errorMessage; el <v-alert>
    // de abajo lo muestra. No hace falta hacer nada más aquí.
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
    <v-card max-width="420" width="100%" class="pa-6 mx-4" elevation="2">
      <div class="text-center mb-6">
        <v-icon icon="mdi-paw" size="40" color="primary" class="mb-2" />
        <h1 class="text-h5">FullPetCare</h1>
        <p class="text-body-2 text-medium-emphasis">Inicia sesión para continuar</p>
      </div>

      <v-form @submit.prevent="handleSubmit">
        <v-text-field
          v-model="email"
          label="Correo"
          type="email"
          autocomplete="username"
          required
          class="mb-2"
        />
        <v-text-field
          v-model="password"
          label="Contraseña"
          type="password"
          autocomplete="current-password"
          required
          class="mb-2"
        />

        <v-alert
          v-if="route.query.reason === 'expired' && !session.errorMessage"
          type="info"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          Tu sesión terminó por seguridad. Vuelve a iniciar sesión.
        </v-alert>

        <v-alert
          v-if="session.errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mb-4"
        >
          No se pudo iniciar sesión. Revisa tu correo y contraseña.
        </v-alert>

        <v-btn type="submit" color="primary" block size="large" :loading="submitting">
          Entrar
        </v-btn>
      </v-form>
    </v-card>

    <BlockedTenantDialog
      v-model="showBlocked"
      :notices="session.restrictingNotices"
      :can-continue="session.memberships.length > 0 || session.isPlatformAdmin"
      @close="closeBlocked"
      @pay="showPayMock = true"
    />

    <!-- MOCK: aún no hay pasarela de pago (CLAUDE.md §1). -->
    <v-snackbar v-model="showPayMock" timeout="4000">
      El pago en línea estará disponible pronto.
    </v-snackbar>
  </v-main>
</template>
