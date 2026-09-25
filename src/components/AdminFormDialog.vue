<script setup lang="ts">
// Alta de un superadmin de plataforma (fase 10). Igual que TenantFormDialog:
// valida la forma, llama a services/platform.ts y entrega la contraseña
// temporal al padre por `created` — aquí no se guarda.
import { computed, ref, watch } from 'vue'

import * as platformService from '@/services/platform'
import { isValidEmail } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [result: { email: string; temporaryPassword: string }]
}>()

const fullName = ref('')
const email = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const showValidation = ref(false)

const nameError = computed(() =>
  showValidation.value && fullName.value.trim() === '' ? ['Escribe el nombre completo.'] : [],
)
const emailError = computed(() => {
  if (!showValidation.value) return []
  if (email.value.trim() === '') return ['Escribe el correo.']
  if (!isValidEmail(email.value)) return ['El correo no parece válido (ej. nombre@fullpetcare.mx).']
  return []
})

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    fullName.value = ''
    email.value = ''
    errorMessage.value = null
    showValidation.value = false
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  showValidation.value = true
  if (nameError.value.length > 0 || emailError.value.length > 0) return

  saving.value = true
  try {
    const result = await platformService.addAdmin({
      fullName: fullName.value.trim(),
      email: email.value.trim(),
    })
    emit('created', {
      email: email.value.trim().toLowerCase(),
      temporaryPassword: result.temporaryPassword,
    })
    close()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : 'No se pudo agregar al superadmin. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Agregar superadmin</v-card-title>

      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">
          Un superadmin puede administrar todas las empresas de la plataforma. Se le generará una
          contraseña temporal.
        </p>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field v-model="fullName" label="Nombre completo *" :error-messages="nameError" />
          <v-text-field
            v-model="email"
            label="Correo *"
            type="email"
            :error-messages="emailError"
          />
          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Agregar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
