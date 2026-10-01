<script setup lang="ts">
import { ref } from 'vue'

import { isValidEmail } from '@/lib/validation'
import { requestPasswordReset } from '@/services/auth'

const email = ref('')
const submitting = ref(false)
const sent = ref(false)
const errorMessage = ref<string | null>(null)

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  if (!isValidEmail(email.value)) {
    errorMessage.value = 'Escribe un correo válido.'
    return
  }
  submitting.value = true
  try {
    await requestPasswordReset(email.value)
    // Mismo mensaje exista o no el correo: no se revela qué correos están registrados.
    sent.value = true
  } catch {
    errorMessage.value = 'No se pudo enviar el correo. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
    <v-card max-width="420" width="100%" class="pa-6 mx-4" elevation="2">
      <div class="text-center mb-6">
        <v-icon icon="mdi-lock-reset" size="40" color="primary" class="mb-2" />
        <h1 class="text-h5">Recuperar contraseña</h1>
        <p class="text-body-2 text-medium-emphasis">
          Te enviaremos un enlace para elegir una nueva.
        </p>
      </div>

      <template v-if="sent">
        <v-alert type="success" variant="tonal" density="compact" class="mb-4">
          Si el correo está registrado, recibirás un enlace en unos minutos. Revisa también tu
          carpeta de spam.
        </v-alert>
      </template>

      <v-form v-else @submit.prevent="handleSubmit">
        <v-text-field
          v-model="email"
          label="Correo"
          type="email"
          autocomplete="username"
          required
          class="mb-2"
        />
        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
          {{ errorMessage }}
        </v-alert>
        <v-btn type="submit" color="primary" block size="large" :loading="submitting">
          Enviar enlace
        </v-btn>
      </v-form>

      <div class="text-center mt-4">
        <router-link to="/login" class="text-body-2">Volver a iniciar sesión</router-link>
      </div>
    </v-card>
  </v-main>
</template>
