<script setup lang="ts">
// Alta y edición de cliente (tarea 2.17). Componente tonto: recibe el
// cliente a editar (o nada, para alta) por prop, y avisa con un evento
// cuando se guardó — no decide qué pasa después (eso lo hace quien lo
// use: CustomersPage o CustomerDetailPage). No importa supabase.ts
// directo, habla con services/customers.ts (CLAUDE.md §4).
import { computed, ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import { isValidPhone, isValidPostalCode, isValidRFC } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  customer?: Customer | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [customer: Customer]
}>()

const isEditing = computed(() => props.customer != null)

const firstName = ref('')
const lastName = ref('')
const phone = ref('')
const email = ref('')
const notes = ref('')
const requiresInvoice = ref(false)
const rfc = ref('')
const legalName = ref('')
const taxRegimeCode = ref('')
const cfdiUse = ref('')
const postalCode = ref('')

const saving = ref(false)
const errorMessage = ref<string | null>(null)

// Rellena el formulario cuando se abre (para editar) o lo limpia (para
// dar de alta) — se dispara con el diálogo, no con el montaje del
// componente, porque el mismo diálogo se reutiliza para varios clientes
// sin volver a crearse.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const c = props.customer
    firstName.value = c?.first_name ?? ''
    lastName.value = c?.last_name ?? ''
    phone.value = c?.phone ?? ''
    email.value = c?.email ?? ''
    notes.value = c?.notes ?? ''
    requiresInvoice.value = c?.requires_invoice ?? false
    rfc.value = c?.rfc ?? ''
    legalName.value = c?.legal_name ?? ''
    taxRegimeCode.value = c?.tax_regime_code ?? ''
    cfdiUse.value = c?.cfdi_use ?? ''
    postalCode.value = c?.postal_code ?? ''
    errorMessage.value = null
  },
)

const phoneRules = [(v: string) => v === '' || isValidPhone(v) || 'Debe tener 10 dígitos']
const rfcRules = [(v: string) => v === '' || isValidRFC(v) || 'RFC con formato inválido']
const postalCodeRules = [
  (v: string) => v === '' || isValidPostalCode(v) || 'Debe tener 5 dígitos',
]

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  try {
    const payload = {
      first_name: firstName.value,
      last_name: lastName.value,
      phone: phone.value || null,
      email: email.value || null,
      notes: notes.value || null,
      requires_invoice: requiresInvoice.value,
      rfc: requiresInvoice.value ? rfc.value || null : null,
      legal_name: requiresInvoice.value ? legalName.value || null : null,
      tax_regime_code: requiresInvoice.value ? taxRegimeCode.value || null : null,
      cfdi_use: requiresInvoice.value ? cfdiUse.value || null : null,
      postal_code: requiresInvoice.value ? postalCode.value || null : null,
    }

    const saved = props.customer
      ? await customersService.update(props.customer.id, payload)
      : await customersService.create({ ...payload, tenant_id: props.tenantId })

    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar el cliente. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isEditing ? 'Editar cliente' : 'Nuevo cliente' }}</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-row dense>
            <v-col cols="6">
              <v-text-field v-model="firstName" label="Nombre" required />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="lastName" label="Apellido" required />
            </v-col>
          </v-row>

          <v-text-field v-model="phone" label="Teléfono" :rules="phoneRules" />
          <v-text-field v-model="email" label="Correo" type="email" />
          <v-textarea v-model="notes" label="Notas" rows="2" auto-grow />

          <v-checkbox v-model="requiresInvoice" label="Requiere factura" density="compact" />

          <!-- Sección fiscal colapsada: solo aparece si de verdad hace
               falta, para no pedirle RFC a un cliente que nunca va a
               facturar (CLAUDE.md §8.4). -->
          <v-expand-transition>
            <div v-if="requiresInvoice">
              <v-text-field v-model="rfc" label="RFC" :rules="rfcRules" />
              <v-text-field v-model="legalName" label="Razón social" />
              <v-row dense>
                <v-col cols="6">
                  <v-text-field v-model="taxRegimeCode" label="Régimen fiscal (código SAT)" />
                </v-col>
                <v-col cols="6">
                  <v-text-field v-model="cfdiUse" label="Uso de CFDI (código SAT)" />
                </v-col>
              </v-row>
              <v-text-field
                v-model="postalCode"
                label="Código postal fiscal"
                :rules="postalCodeRules"
              />
            </div>
          </v-expand-transition>

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-2">
            {{ errorMessage }}
          </v-alert>
        </v-form>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
