<script setup lang="ts">
// Crear o corregir la familia de un cliente (fase 31, PLAN.md D30 punto 7): nombre, miembros y
// titular. El titular es el único que verá montos en la cuenta del cliente; los demás
// miembros tienen acceso básico. Un cliente pertenece a una sola familia: si alguno ya está
// en otra, la base lo rechaza y dice en cuál.
import { computed, ref, watch } from 'vue'

import { familyErrorMessage, familyProblem } from '@/lib/family'
import { required } from '@/lib/validation'
import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as familiesService from '@/services/families'
import type { FamilyWithMembers } from '@/services/families'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  /** El cliente desde cuya página se abre: siempre forma parte de la familia. */
  customerId: string
  family: FamilyWithMembers | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const customers = ref<Customer[]>([])
const name = ref('')
const memberIds = ref<string[]>([])
const holderId = ref<string | null>(null)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const memberItems = computed(() =>
  customers.value.map((c) => ({
    title: `${c.first_name} ${c.last_name}`.trim(),
    value: c.id,
  })),
)
const holderItems = computed(() =>
  memberItems.value.filter((m) => memberIds.value.includes(m.value)),
)

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    errorMessage.value = null
    name.value = props.family?.family.name ?? ''
    memberIds.value = props.family
      ? props.family.members.map((m) => m.customerId)
      : [props.customerId]
    holderId.value =
      props.family?.members.find((m) => m.isHolder)?.customerId ?? props.customerId
    try {
      customers.value = await customersService.list(props.tenantId)
    } catch {
      errorMessage.value = 'No se pudo cargar la lista de clientes. Revisa tu conexión.'
    }
  },
)

// Si el titular sale de los miembros, se reasigna al primero que quede.
watch(memberIds, (ids) => {
  if (holderId.value === null || !ids.includes(holderId.value))
    holderId.value = ids[0] ?? null
})

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  const problem = familyProblem({
    name: name.value,
    memberIds: memberIds.value,
    holderId: holderId.value,
  })
  if (problem) {
    errorMessage.value = problem
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    await familiesService.save(props.tenantId, props.family?.family.id ?? null, {
      name: name.value.trim(),
      holderCustomerId: holderId.value as string,
      memberCustomerIds: memberIds.value,
    })
    emit('saved')
    close()
  } catch (error) {
    errorMessage.value = familyErrorMessage(
      error,
      'No se pudo guardar la familia. Revisa tu conexión.',
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
    <v-card>
      <v-card-title>{{ family ? 'Editar familia' : 'Nueva familia' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Nombre de la familia*"
          :rules="[required]"
          hint="Por ejemplo: Familia Pérez."
          persistent-hint
          class="mb-3"
        />
        <v-autocomplete
          v-model="memberIds"
          :items="memberItems"
          label="Miembros*"
          multiple
          chips
          closable-chips
          variant="outlined"
          density="comfortable"
          hint="Un cliente solo puede estar en una familia."
          persistent-hint
          class="mb-3"
        />
        <v-select
          v-model="holderId"
          :items="holderItems"
          label="Titular*"
          hint="Es quien ve los montos. Los demás miembros solo ven a la mascota, su cartilla, sus citas y la bitácora."
          persistent-hint
        />
        <v-alert
          v-if="errorMessage"
          type="error"
          density="compact"
          variant="tonal"
          class="mt-4"
        >
          {{ errorMessage }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn color="primary" :loading="saving" @click="handleSubmit">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
