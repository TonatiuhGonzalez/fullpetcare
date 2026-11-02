<script setup lang="ts">
// Alta y edición de un paquete de cirugía del catálogo (fase 32, PLAN.md D30 punto 9). Solo
// dueño y veterinario llegan a la pantalla que lo abre; la regla real vive en la RPC.
import { ref, watch } from 'vue'

import SurgeryLinesEditor from '@/components/SurgeryLinesEditor.vue'
import { surgeryLinesProblem, type SurgeryLineDraft } from '@/lib/surgery'
import type { Product } from '@/services/products'
import * as surgeriesService from '@/services/surgeries'
import type { SurgeryPackageWithItems } from '@/services/surgeries'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  pkg: SurgeryPackageWithItems | null
  products: Product[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const name = ref('')
const notes = ref('')
const lines = ref<SurgeryLineDraft[]>([])
const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    errorMessage.value = null
    name.value = props.pkg?.name ?? ''
    notes.value = props.pkg?.notes ?? ''
    lines.value = (props.pkg?.items ?? []).map((item) => ({
      key: item.id,
      kind: item.kind,
      productId: item.product_id,
      description: item.description,
      quantity: item.quantity,
      unitPriceCents: item.unit_price_cents,
      taxRateBp: item.tax_rate_bp,
      isBillable: true,
      unit: item.unit === 'unit' ? 'unit' : 'package',
    }))
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (name.value.trim() === '') {
    errorMessage.value = 'Escribe el nombre de la cirugía.'
    return
  }
  const problem = surgeryLinesProblem(lines.value)
  if (problem) {
    errorMessage.value = problem
    return
  }
  saving.value = true
  errorMessage.value = null
  try {
    await surgeriesService.savePackage(
      props.tenantId,
      props.pkg?.id ?? null,
      name.value,
      notes.value.trim() || null,
      lines.value,
    )
    emit('saved')
    close()
  } catch (error) {
    errorMessage.value = surgeriesService.errorMessage(error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="760"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ pkg ? 'Editar cirugía' : 'Nueva cirugía' }}</v-card-title>
      <v-card-text>
        <v-text-field
          v-model="name"
          label="Nombre*"
          variant="outlined"
          density="comfortable"
        />
        <v-textarea
          v-model="notes"
          label="Notas"
          rows="2"
          auto-grow
          variant="outlined"
          density="comfortable"
          class="mb-2"
        />
        <p class="text-subtitle-2 mb-2">Renglones</p>
        <SurgeryLinesEditor v-model="lines" :products="products" />
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
