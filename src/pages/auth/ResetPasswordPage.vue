<script setup lang="ts">
// Destino del enlace del correo "Olvidé mi contraseña". Al abrirlo,
// supabase-js crea una sesión de recuperación; el guard del router espera a
// que termine antes de llegar aquí, así que `session.isAuthenticated` ya dice
// si el enlace sirvió. Sin sesión = enlace vencido, ya usado o inventado.
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import { passwordResetProblems } from '@/lib/validation'
import { setNewPassword } from '@/services/auth'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const next = ref('')
const confirm = ref('')
const showPasswords = ref(false)
const saving = ref(false)
const showValidation = ref(false)
const errorMessage = ref<string | null>(null)

const problems = computed(() =>
  passwordResetProblems({ next: next.value, confirm: confirm.value }),
)

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  showValidation.value = true
  if (Object.keys(problems.value).length > 0) return

  saving.value = true
  try {
    await setNewPassword(next.value)
  } catch {
    errorMessage.value =
      'No se pudo guardar la contraseña. Revisa tu conexión e inténtalo de nuevo.'
    saving.value = false
    return
  }
  try {
    // La contraseña ya cambió (y con ello se apaga la marca de contraseña
    // temporal): se recarga la cuenta y se entra a la app.
    await session.completePasswordChange()
    await router.replace('/app/agenda')
  } catch {
    errorMessage.value =
      'Tu contraseña se cambió, pero no se pudo cargar tu cuenta. Vuelve a iniciar sesión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-main class="d-flex align-center justify-center" style="min-height: 100vh">
    <v-card max-width="420" width="100%" class="pa-6 mx-4" elevation="2">
      <div class="text-center mb-6">
        <v-icon icon="mdi-lock-reset" size="40" color="primary" class="mb-2" />
        <h1 class="text-h5">Elige tu nueva contraseña</h1>
      </div>

      <template v-if="!session.isAuthenticated">
        <v-alert type="warning" variant="tonal" density="compact" class="mb-4">
          El enlace ya no es válido: venció o ya se usó. Pide uno nuevo.
        </v-alert>
        <v-btn color="primary" block to="/recuperar-contrasena">Pedir otro enlace</v-btn>
      </template>

      <v-form v-else @submit.prevent="handleSubmit">
        <v-text-field
          v-model="next"
          label="Contraseña nueva"
          :type="showPasswords ? 'text' : 'password'"
          :append-inner-icon="showPasswords ? 'mdi-eye-off' : 'mdi-eye'"
          :aria-label="showPasswords ? 'Ocultar contraseñas' : 'Mostrar contraseñas'"
          autocomplete="new-password"
          :error-messages="showValidation && problems.next ? [problems.next] : []"
          class="mb-2"
          @click:append-inner="showPasswords = !showPasswords"
        />
        <v-text-field
          v-model="confirm"
          label="Confirma la contraseña"
          :type="showPasswords ? 'text' : 'password'"
          autocomplete="new-password"
          :error-messages="showValidation && problems.confirm ? [problems.confirm] : []"
          class="mb-2"
        />
        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
          {{ errorMessage }}
        </v-alert>
        <v-btn type="submit" color="primary" block size="large" :loading="saving">
          Guardar contraseña
        </v-btn>
      </v-form>
    </v-card>
  </v-main>
</template>
