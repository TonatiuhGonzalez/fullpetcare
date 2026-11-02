<script setup lang="ts">
// Aviso en la página del cliente: "tiene una cuenta vinculada" (fase 16B, PLAN.md D31) y el botón
// para desvincularla (p. ej. si la mascota cambió de dueño o el cliente lo pide).
import { onMounted, ref } from 'vue'

import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import * as accounts from '@/services/customerAccounts'

const props = defineProps<{ tenantId: string; customerId: string; canEdit: boolean }>()

const linked = ref(false)
const confirming = ref(false)
const working = ref(false)
const errorMessage = ref<string | null>(null)

async function load(): Promise<void> {
  try {
    linked.value = await accounts.hasLinkedAccount(props.tenantId, props.customerId)
  } catch {
    // Es un aviso secundario: si no carga, simplemente no se muestra.
    linked.value = false
  }
}

async function unlink(): Promise<void> {
  working.value = true
  errorMessage.value = null
  try {
    await accounts.unlink(props.customerId)
    linked.value = false
    confirming.value = false
  } catch {
    errorMessage.value = 'No se pudo desvincular la cuenta. Intenta de nuevo.'
  } finally {
    working.value = false
  }
}

onMounted(load)
</script>

<template>
  <v-alert
    v-if="linked"
    type="info"
    variant="tonal"
    density="compact"
    icon="mdi-account-check-outline"
    class="mb-4"
  >
    <div class="d-flex align-center flex-wrap ga-2">
      <span class="flex-grow-1">
        Este cliente tiene una cuenta vinculada: ve a sus mascotas desde su teléfono.
      </span>
      <v-btn v-if="canEdit" size="small" variant="text" @click="confirming = true">
        Desvincular
      </v-btn>
    </div>
    <div v-if="errorMessage" class="text-error mt-1">{{ errorMessage }}</div>
  </v-alert>

  <ConfirmDeleteDialog
    v-model="confirming"
    title="¿Desvincular la cuenta?"
    message="El cliente dejará de ver a sus mascotas en su cuenta. Podrá volver a vincularla con un link nuevo."
    :loading="working"
    @confirm="unlink"
  />
</template>
