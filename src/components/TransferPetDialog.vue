<script setup lang="ts">
// Transferir una mascota a otro cliente (fase 31, PLAN.md D30 punto 8). Explica qué cambia
// y qué no antes de confirmar: la transferencia no se puede deshacer sola (se haría con otra
// transferencia) y revoca los links compartidos.
import { computed, ref, watch } from 'vue'

import { familyErrorMessage } from '@/lib/family'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  pet: Pet | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  transferred: [newCustomerId: string]
}>()

const customers = ref<Customer[]>([])
const newCustomerId = ref<string | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

// El dueño actual no se ofrece: la base lo rechazaría.
const items = computed(() =>
  customers.value
    .filter((c) => c.id !== props.pet?.customer_id)
    .map((c) => ({ title: `${c.first_name} ${c.last_name}`.trim(), value: c.id })),
)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    newCustomerId.value = null
    errorMessage.value = null
    try {
      customers.value = await customersService.list(props.tenantId)
    } catch {
      errorMessage.value = 'No se pudo cargar la lista de clientes. Revisa tu conexión.'
    }
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (!props.pet || !newCustomerId.value) return
  saving.value = true
  errorMessage.value = null
  try {
    await petsService.transfer(props.pet.id, newCustomerId.value)
    emit('transferred', newCustomerId.value)
    close()
  } catch (error) {
    errorMessage.value = familyErrorMessage(
      error,
      'No se pudo transferir la mascota. Revisa tu conexión.',
    )
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
    <v-card v-if="pet">
      <v-card-title>Transferir a {{ pet.name }}</v-card-title>
      <v-card-text>
        <v-autocomplete
          v-model="newCustomerId"
          :items="items"
          label="Nuevo dueño*"
          variant="outlined"
          density="comfortable"
          no-data-text="No hay otros clientes. Da de alta al nuevo dueño primero."
          class="mb-4"
        />
        <v-alert type="info" variant="tonal" density="compact">
          <ul class="pl-4">
            <li>Sus <strong>citas programadas</strong> pasan al nuevo dueño.</li>
            <li>
              Las <strong>ventas</strong> y las citas ya atendidas se quedan con el dueño
              anterior.
            </li>
            <li>
              El nuevo dueño ve su cartilla, medicamentos y expediente, pero no los
              montos.
            </li>
            <li>El dueño anterior solo conserva lo ocurrido mientras fue su mascota.</li>
            <li>Los <strong>links compartidos</strong> de la mascota se revocan.</li>
          </ul>
        </v-alert>
        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mt-3"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="!newCustomerId"
          @click="handleSubmit"
        >
          Transferir
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
