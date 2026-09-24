<script setup lang="ts">
// Alta de una empresa (fase 10): crea el negocio, su primera sucursal y su
// dueño con una contraseña temporal. Componente tonto: valida la FORMA de
// los datos y llama a services/platform.ts; la contraseña que devuelve se
// entrega al padre por el evento `created` (que la muestra una sola vez en
// TemporaryPasswordDialog) y aquí no se guarda.
import { computed, ref, watch } from 'vue'

import * as platformService from '@/services/platform'
import { isValidEmail, isValidPhone } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  created: [result: { tenantName: string; ownerEmail: string; temporaryPassword: string }]
}>()

const tenantName = ref('')
const branchName = ref('')
const ownerFullName = ref('')
const ownerEmail = ref('')
const ownerPhone = ref('')

const saving = ref(false)
const errorMessage = ref<string | null>(null)
// Los errores se muestran solo DESPUÉS del primer intento de guardar:
// "Escribe el nombre" en un formulario recién abierto sería ruido.
const showValidation = ref(false)

type Field = 'tenantName' | 'branchName' | 'ownerFullName' | 'ownerEmail' | 'ownerPhone'

const problems = computed<Partial<Record<Field, string>>>(() => {
  const list: Partial<Record<Field, string>> = {}
  if (tenantName.value.trim() === '') list.tenantName = 'Escribe el nombre de la empresa.'
  if (branchName.value.trim() === '') list.branchName = 'Escribe el nombre de la primera sucursal.'
  if (ownerFullName.value.trim() === '') list.ownerFullName = 'Escribe el nombre del dueño.'
  if (ownerEmail.value.trim() === '') {
    list.ownerEmail = 'Escribe el correo del dueño.'
  } else if (!isValidEmail(ownerEmail.value)) {
    list.ownerEmail = 'El correo no parece válido (ej. nombre@negocio.mx).'
  }
  // El teléfono es opcional; si se escribe, debe tener forma de teléfono.
  if (ownerPhone.value.trim() !== '' && !isValidPhone(ownerPhone.value)) {
    list.ownerPhone = 'El teléfono debe tener 10 dígitos.'
  }
  return list
})

function errorsFor(field: Field): string[] {
  const message = showValidation.value ? problems.value[field] : undefined
  return message ? [message] : []
}

// Se limpia cada vez que se abre: sin esto, los datos de la última alta
// (incluido el correo del dueño anterior) aparecerían en la siguiente.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    tenantName.value = ''
    branchName.value = ''
    ownerFullName.value = ''
    ownerEmail.value = ''
    ownerPhone.value = ''
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
  if (Object.keys(problems.value).length > 0) return

  saving.value = true
  try {
    const result = await platformService.createTenant({
      tenantName: tenantName.value.trim(),
      branchName: branchName.value.trim(),
      ownerFullName: ownerFullName.value.trim(),
      ownerEmail: ownerEmail.value.trim(),
      ownerPhone: ownerPhone.value.trim() || null,
    })
    emit('created', {
      tenantName: tenantName.value.trim(),
      ownerEmail: ownerEmail.value.trim().toLowerCase(),
      temporaryPassword: result.temporaryPassword,
    })
    close()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : 'No se pudo dar de alta la empresa. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Nueva empresa</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field
            v-model="tenantName"
            label="Nombre de la empresa *"
            :error-messages="errorsFor('tenantName')"
          />
          <v-text-field
            v-model="branchName"
            label="Nombre de la primera sucursal *"
            :error-messages="errorsFor('branchName')"
          />

          <div class="text-subtitle-2 mt-2 mb-2">Dueño</div>
          <v-text-field
            v-model="ownerFullName"
            label="Nombre completo *"
            :error-messages="errorsFor('ownerFullName')"
          />
          <v-text-field
            v-model="ownerEmail"
            label="Correo *"
            type="email"
            :error-messages="errorsFor('ownerEmail')"
            hint="Con este correo iniciará sesión. Se le generará una contraseña temporal."
            persistent-hint
            class="mb-2"
          />
          <v-text-field
            v-model="ownerPhone"
            label="Teléfono"
            type="tel"
            :error-messages="errorsFor('ownerPhone')"
          />

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mt-2">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Dar de alta</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
