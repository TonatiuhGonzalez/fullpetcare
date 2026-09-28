<script setup lang="ts">
// Cambia el plan y la forma de pago de una empresa (tarea #1906). Las dos
// cosas juntas, en un solo diálogo y una sola llamada a la base
// (platform_set_tenant_plan): elegir el plan sin poder tocar la forma de
// pago obligaría a un segundo paso, y dejaría una ventana rara donde el
// plan ya cambió pero la vigencia sigue siendo la del plan anterior.
//
// La vigencia ya NO se captura aquí: la calcula sola la base a partir de la
// forma de pago (mensual = +1 mes, anual = +1 año, indeterminado = sin
// vencimiento), desde el momento en que se confirma. Este diálogo solo
// explica qué va a pasar; no hay una fecha exacta que mostrar de antemano
// (evita duplicar en el navegador el cálculo que ya hace la base).
//
// Componente tonto: no llama a ningún servicio, solo entrega los datos al
// padre por `confirm` (mismo criterio que TenantStatusDialog.vue).
import { ref, watch } from 'vue'

import { billingPeriodLabel, type BillingPeriod } from '@/lib/platform'
import type { Plan } from '@/services/platform'

const props = defineProps<{
  modelValue: boolean
  tenantName: string
  /** Solo los activos: uno desactivado ya no se ofrece para asignaciones nuevas. */
  plans: Plan[]
  currentPlanId: string | null
  currentBillingPeriod: BillingPeriod
  saving: boolean
  errorMessage: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  confirm: [planId: string, billingPeriod: BillingPeriod]
}>()

const BILLING_PERIOD_OPTIONS: { value: BillingPeriod; title: string; hint: string }[] = [
  { value: 'monthly', title: billingPeriodLabel('monthly'), hint: 'Vence en 1 mes a partir de hoy.' },
  { value: 'yearly', title: billingPeriodLabel('yearly'), hint: 'Vence en 1 año a partir de hoy.' },
  {
    value: 'indefinite',
    title: billingPeriodLabel('indefinite'),
    hint: 'Sin vencimiento. Uso interno: nunca se ofrece al dueño para suscribirse.',
  },
]

const planId = ref<string | null>(null)
const billingPeriod = ref<BillingPeriod>('indefinite')
const showValidation = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      planId.value = props.currentPlanId
      billingPeriod.value = props.currentBillingPeriod
      showValidation.value = false
    }
  },
)

function handleConfirm(): void {
  showValidation.value = true
  if (!planId.value) return
  emit('confirm', planId.value, billingPeriod.value)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="440"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Cambiar plan</v-card-title>

      <v-card-text>
        <p class="mb-4">
          Plan y forma de pago de <strong>{{ tenantName }}</strong
          >. Es solo informativo: por sí solo no limita el acceso del negocio (eso lo
          decide el estado y, si la vigencia vence, el modo solo lectura).
        </p>

        <v-select
          v-model="planId"
          :items="plans"
          item-title="name"
          item-value="id"
          label="Plan *"
          :error-messages="showValidation && !planId ? ['Elige el plan.'] : []"
        />

        <v-select
          v-model="billingPeriod"
          :items="BILLING_PERIOD_OPTIONS"
          item-title="title"
          item-value="value"
          label="Forma de pago *"
        />
        <p class="text-caption text-medium-emphasis mt-1">
          {{ BILLING_PERIOD_OPTIONS.find((o) => o.value === billingPeriod)?.hint }}
        </p>

        <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mt-3">
          {{ errorMessage }}
        </v-alert>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="emit('update:modelValue', false)">
          Cancelar
        </v-btn>
        <v-btn color="primary" :loading="saving" @click="handleConfirm">Guardar</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
