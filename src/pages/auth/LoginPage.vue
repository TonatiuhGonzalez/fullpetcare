<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const submitting = ref(false)

async function handleSubmit(): Promise<void> {
  submitting.value = true
  try {
    await session.login(email.value, password.value)
    // Si el guard del router mandó aquí por intentar entrar a una ruta
    // privada (?redirect=/app/...), se vuelve a esa. Si no, a /app/agenda
    // — el guard decide desde ahí si hace falta elegir negocio primero.
    const redirectTo =
      typeof route.query.redirect === 'string' ? route.query.redirect : '/app/agenda'
    await router.push(redirectTo)
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
  </v-main>
</template>
