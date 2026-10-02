<script setup lang="ts">
// Cierre de caja (tarea 12.11). Dos pasos: (1) capturar el efectivo CONTADO, sin
// ver cuánto se esperaba, para que contar sea honesto; (2) ya cerrada, mostrar el
// resultado (esperado, contado y diferencia) con el comprobante. El esperado lo
// calcula la base al cerrar; la pantalla no lo muestra antes del conteo.
import { ref, watch } from 'vue'

import CashClosingReceipt from '@/components/CashClosingReceipt.vue'
import { checkCountedCash } from '@/lib/cashRegister'
import type { CashOverview } from '@/services/cashRegister'
import { useCashRegisterStore, type ClosedResult } from '@/stores/cashRegister'

const props = defineProps<{
  modelValue: boolean
  branchName: string
  timezone: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

const cashRegister = useCashRegisterStore()

const counted = ref('')
const note = ref('')
const saving = ref(false)
const errorMessage = ref<string | null>(null)
const result = ref<ClosedResult | null>(null)
const receiptOverview = ref<CashOverview | null>(null)
// El primer clic pide confirmar: cerrar no se puede deshacer.
const confirming = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    counted.value = ''
    note.value = ''
    errorMessage.value = null
    result.value = null
    receiptOverview.value = null
    confirming.value = false
  },
)

function handleContinue(): void {
  errorMessage.value = checkCountedCash(counted.value).error
  confirming.value = errorMessage.value === null
}

async function handleClose(): Promise<void> {
  saving.value = true
  errorMessage.value = null
  const outcome = await cashRegister.close(counted.value, note.value)
  if (outcome.closed === null) {
    errorMessage.value = outcome.error
    confirming.value = false
  } else {
    result.value = outcome.closed
    // El resumen del turno ya cerrado, para el comprobante (si falla, sale sin él).
    receiptOverview.value = await cashRegister.fetchOverview(outcome.closed.session.id)
  }
  saving.value = false
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    :persistent="saving"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <!-- Paso 2: ya cerrada -->
      <template v-if="result">
        <v-card-title>Caja cerrada</v-card-title>
        <v-card-text>
          <CashClosingReceipt
            :session="result.session"
            :overview="receiptOverview"
            :branch-name="branchName"
            :timezone="timezone"
            :names="cashRegister.names"
          />
          <p class="text-body-2 text-medium-emphasis mt-3">
            La <strong>diferencia</strong> es lo que contaste menos lo que el sistema
            esperaba. Si sobra o falta, revisa si faltó registrar un retiro, un gasto o un
            ingreso; el corte cerrado ya no se puede modificar.
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" @click="emit('update:modelValue', false)">Listo</v-btn>
        </v-card-actions>
      </template>

      <!-- Paso 1: conteo -->
      <template v-else>
        <v-card-title>Cerrar caja</v-card-title>
        <v-card-text>
          <v-alert
            v-if="errorMessage"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-3"
          >
            {{ errorMessage }}
          </v-alert>
          <p class="text-body-2 mb-3">
            Cuenta el efectivo que hay en la caja (billetes y monedas) y escribe el total.
            El sistema te dirá si cuadra <strong>después</strong> de cerrar.
          </p>
          <v-text-field
            v-model="counted"
            label="Efectivo contado"
            prefix="$"
            inputmode="decimal"
            autofocus
            :disabled="confirming || saving"
          />
          <v-textarea
            v-model="note"
            label="Nota (opcional)"
            rows="2"
            auto-grow
            :disabled="confirming || saving"
          />
          <v-alert v-if="confirming" type="warning" variant="tonal" density="compact">
            Vas a cerrar la caja con el efectivo contado que escribiste. Un corte cerrado
            no se puede modificar. ¿Confirmas?
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="saving"
            @click="confirming ? (confirming = false) : emit('update:modelValue', false)"
          >
            {{ confirming ? 'Corregir conteo' : 'Cancelar' }}
          </v-btn>
          <v-btn v-if="!confirming" color="primary" @click="handleContinue"
            >Continuar</v-btn
          >
          <v-btn v-else color="error" :loading="saving" @click="handleClose"
            >Cerrar caja</v-btn
          >
        </v-card-actions>
      </template>
    </v-card>
  </v-dialog>
</template>
