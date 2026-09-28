<script setup lang="ts">
// Pantalla obligatoria: una persona con contraseña temporal (dueño o superadmin
// recién dado de alta, o dueño con contraseña restablecida) no puede usar nada
// más hasta cambiarla. El guard del router la manda aquí; reutiliza
// ChangePasswordDialog en modo `required` (sin "Cancelar"; solo "Salir").
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const open = ref(true)
const errorMessage = ref<string | null>(null)

async function handleChanged(): Promise<void> {
  errorMessage.value = null
  try {
    // La contraseña ya cambió: se recarga el profile (la marca ya vale false)
    // y con ello negocios y rol. El guard decide a dónde va cada quien.
    await session.completePasswordChange()
    await router.replace('/app/agenda')
  } catch {
    errorMessage.value =
      'Tu contraseña se cambió, pero no se pudo cargar tu cuenta. Vuelve a iniciar sesión.'
    open.value = false
  }
}

async function handleLeave(): Promise<void> {
  try {
    await session.logout()
  } finally {
    await router.replace('/login')
  }
}
</script>

<template>
  <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
    <v-card max-width="420" width="100%" class="pa-6 mx-4" elevation="2">
      <div class="text-center">
        <v-icon icon="mdi-lock-reset" size="40" color="primary" class="mb-2" />
        <h1 class="text-h5">Cambia tu contraseña</h1>
        <p class="text-body-2 text-medium-emphasis mt-2">
          Entraste con una contraseña temporal. Por seguridad, elige una propia para
          continuar.
        </p>
      </div>

      <v-alert
        v-if="errorMessage"
        type="error"
        density="compact"
        variant="tonal"
        class="mt-4"
      >
        {{ errorMessage }}
      </v-alert>
      <v-btn v-if="!open" block class="mt-4" color="primary" @click="handleLeave">
        Volver a iniciar sesión
      </v-btn>
    </v-card>

    <ChangePasswordDialog
      v-model="open"
      :email="session.user?.email ?? ''"
      required
      @changed="handleChanged"
      @leave="handleLeave"
    />
  </v-main>
</template>
