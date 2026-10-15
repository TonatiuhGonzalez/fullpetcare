<script setup lang="ts">
// Alta y edición de un proveedor (fase 29B, tarea 29.3). Solo quien tiene "inventory:edit"
// ve el botón que lo abre; la política RLS de `suppliers` es quien de verdad lo exige.
import { computed, ref, watch } from 'vue'

import {
  isDuplicateSupplier,
  SUPPLIER_TYPE_OPTIONS,
  supplierProblems,
  type SupplierType,
} from '@/lib/suppliers'
import { isFormValid, required } from '@/lib/validation'
import type { FormHandle } from '@/lib/validation'
import type { Supplier } from '@/services/suppliers'
import { useSuppliersStore } from '@/stores/suppliers'

const props = defineProps<{
  modelValue: boolean
  supplier?: Supplier | null
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const suppliers = useSuppliersStore()

const name = ref('')
const supplierType = ref<SupplierType>('other')
const contactName = ref('')
const phone = ref('')
const email = ref('')
const notes = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const formRef = ref<FormHandle | null>(null)

const isEditing = computed(() => props.supplier != null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const s = props.supplier
    name.value = s?.name ?? ''
    supplierType.value = s?.supplier_type ?? 'other'
    contactName.value = s?.contact_name ?? ''
    phone.value = s?.phone ?? ''
    email.value = s?.email ?? ''
    notes.value = s?.notes ?? ''
    errorMessage.value = null
  },
)

const nameRules = [
  required,
  () =>
    !isDuplicateSupplier(suppliers.suppliers, name.value, props.supplier?.id) ||
    'Ya hay un proveedor con este nombre.',
]
// Teléfono y correo son opcionales: solo se valida la forma si se escribieron.
const phoneRules = [
  () =>
    supplierProblems({ phone: phone.value }).find((p) => p.startsWith('El teléfono')) ??
    true,
]
const emailRules = [
  () =>
    supplierProblems({ email: email.value }).find((p) => p.startsWith('El correo')) ??
    true,
]

function close(): void {
  emit('update:modelValue', false)
}

function clean(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function handleSubmit(): Promise<void> {
  if (!(await isFormValid(formRef.value))) return
  saving.value = true
  errorMessage.value = null
  const error = await suppliers.save(
    {
      name: name.value,
      supplier_type: supplierType.value,
      contact_name: clean(contactName.value),
      phone: clean(phone.value),
      email: clean(email.value),
      notes: clean(notes.value),
    },
    props.supplier?.id,
  )
  saving.value = false
  if (error) {
    errorMessage.value = error
    return
  }
  close()
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{
        isEditing ? 'Editar proveedor' : 'Nuevo proveedor'
      }}</v-card-title>
      <v-card-text>
        <v-form ref="formRef" @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre*" :rules="nameRules" />
          <v-select v-model="supplierType" :items="SUPPLIER_TYPE_OPTIONS" label="Tipo" />
          <v-text-field v-model="contactName" label="Persona de contacto" />
          <v-row dense>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="phone"
                label="Teléfono"
                inputmode="tel"
                :rules="phoneRules"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-text-field
                v-model="email"
                label="Correo"
                type="email"
                :rules="emailRules"
              />
            </v-col>
          </v-row>
          <v-textarea v-model="notes" label="Notas" rows="2" auto-grow />

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
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
