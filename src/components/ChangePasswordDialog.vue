<script setup lang="ts">
// "Cambiar contraseña" de la persona con sesión abierta. Lo usan los dos
// marcos (AppLayout y SuperadminLayout), así que sirve a cualquier rol.
// Valida la forma con lib/validation.ts, llama a services/auth.ts y avisa al
// padre por `changed` (para que muestre la confirmación); aquí no se guarda
// nada.
import { computed, ref, watch } from 'vue'

import { passwordChangeProblems, type PasswordChangeField } from '@/lib/validation'
import { changePassword, InvalidCurrentPasswordError } from '@/services/auth'

const props = defineProps<{
  modelValue: boolean
  /** Correo de la sesión: hace falta para verificar la contraseña actual. */
  email: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  changed: []
}>()

const current = ref('')
const next = ref('')
const confirm = ref('')
const showPasswords = ref(false)

const saving = ref(false)
const errorMessage = ref<string | null>(null)
// El servidor puede decir "la actual no es correcta": se pinta en SU campo.
const currentServerError = ref<string | null>(null)
// Los errores de forma se muestran solo DESPUÉS del primer intento: "Escribe
// tu contraseña" en un formulario recién abierto sería ruido.
const showValidation = ref(false)

const problems = computed(() =>
  passwordChangeProblems({ current: current.value, next: next.value, confirm: confirm.value }),
)

function errorsFor(field: PasswordChangeField): string[] {
  if (field === 'current' && currentServerError.value) return [currentServerError.value]
  const message = showValidation.value ? problems.value[field] : undefined
  return message ? [message] : []
}

// Se limpia cada vez que se abre: si no, la contraseña de la vez anterior
// seguiría escrita en el formulario.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    current.value = ''
    next.value = ''
    confirm.value = ''
    showPasswords.value = false
    errorMessage.value = null
    currentServerError.value = null
    showValidation.value = false
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  currentServerError.value = null
  showValidation.value = true
  if (Object.keys(problems.value).length > 0) return

  saving.value = true
  try {
    await changePassword(props.email, current.value, next.value)
    emit('changed')
    close()
  } catch (e) {
    if (e instanceof InvalidCurrentPasswordError) {
      currentServerError.value = 'La contraseña actual no es correcta.'
    } else if (e instanceof Error && 'code' in e && e.code === 'same_password') {
      errorMessage.value = 'La contraseña nueva debe ser distinta de la actual.'
    } else if (e instanceof Error && 'code' in e && e.code === 'weak_password') {
      errorMessage.value = 'La contraseña nueva es muy fácil de adivinar. Prueba con otra.'
    } else {
      errorMessage.value = 'No se pudo cambiar la contraseña. Revisa tu conexión.'
    }
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="440"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Cambiar contraseña</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field
            v-model="current"
            label="Contraseña actual *"
            :type="showPasswords ? 'text' : 'password'"
            autocomplete="current-password"
            :error-messages="errorsFor('current')"
          />
          <v-text-field
            v-model="next"
            label="Contraseña nueva *"
            :type="showPasswords ? 'text' : 'password'"
            autocomplete="new-password"
            hint="Al menos 8 caracteres."
            persistent-hint
            class="mb-2"
            :error-messages="errorsFor('next')"
          />
          <v-text-field
            v-model="confirm"
            label="Repite la contraseña nueva *"
            :type="showPasswords ? 'text' : 'password'"
            autocomplete="new-password"
            :error-messages="errorsFor('confirm')"
          />
          <v-checkbox v-model="showPasswords" label="Mostrar contraseñas" density="compact" />
          <p class="text-body-2 text-medium-emphasis">
            Al cambiarla se cerrará tu sesión en los demás navegadores y equipos.
          </p>
          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-2"
          >
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Cambiar contraseña</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
