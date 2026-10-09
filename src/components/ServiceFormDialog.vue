<script setup lang="ts">
// Alta y edición de un servicio del catálogo (tarea 3.16). Solo owner
// llega a ver el botón que abre esto (CatalogPage) — la política RLS
// (services_insert/services_update) es quien de verdad lo exige, este
// componente solo evita mostrar un formulario que fallaría.
import { computed, ref, watch } from 'vue'

import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import { pesosToCents } from '@/lib/money'
import { isValidSatProductCode, isValidSatUnitCode } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  kind: ServiceKind
  service?: Service | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [service: Service]
}>()

const isEditing = computed(() => props.service != null)

const name = ref('')
const durationMinutes = ref<number | null>(null)
const priceInPesos = ref<number | null>(null)
// Claves del SAT (CFDI). Se sugieren las de la base; el negocio las cambia
// con su contador. Tarea 11.2.
const satProductCode = ref('70122000')
const satUnitCode = ref('E48')

const satProductRules = [
  (v: string) => isValidSatProductCode(v) || 'Deben ser 8 dígitos, por ejemplo 70122000.',
]
const satUnitRules = [
  (v: string) => isValidSatUnitCode(v) || 'Deben ser 2 o 3 caracteres, por ejemplo E48.',
]

const saving = ref(false)
// Servicio eliminado con el mismo nombre y tipo: si existe, antes de guardar se
// pide confirmar que se reactiva en lugar de crear uno nuevo.
const deletedMatch = ref<Service | null>(null)
const showRestoreConfirm = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const s = props.service
    name.value = s?.name ?? ''
    durationMinutes.value = s?.duration_minutes ?? null
    priceInPesos.value = s ? s.price_cents / 100 : null
    satProductCode.value = s?.sat_product_code ?? '70122000'
    satUnitCode.value = s?.sat_unit_code ?? 'E48'
    errorMessage.value = null
  },
)

// Confirmó la reactivación: se reutiliza el registro eliminado con lo capturado.
async function confirmRestore(): Promise<void> {
  if (!deletedMatch.value || durationMinutes.value == null || priceInPesos.value == null)
    return

  saving.value = true
  errorMessage.value = null
  try {
    const restored = await servicesService.restore(deletedMatch.value.id, {
      name: name.value.trim(),
      duration_minutes: durationMinutes.value,
      price_cents: pesosToCents(priceInPesos.value),
      sat_product_code: satProductCode.value.trim(),
      sat_unit_code: satUnitCode.value.trim().toUpperCase(),
      tax_rate_bp: 1600,
    })
    showRestoreConfirm.value = false
    emit('saved', restored)
    close()
  } catch {
    showRestoreConfirm.value = false
    errorMessage.value = 'No se pudo reactivar el servicio. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (durationMinutes.value == null || priceInPesos.value == null) return
  if (
    !isValidSatProductCode(satProductCode.value) ||
    !isValidSatUnitCode(satUnitCode.value)
  )
    return

  saving.value = true
  errorMessage.value = null
  try {
    const payload = {
      name: name.value,
      duration_minutes: durationMinutes.value,
      price_cents: pesosToCents(priceInPesos.value),
      sat_product_code: satProductCode.value.trim(),
      sat_unit_code: satUnitCode.value.trim().toUpperCase(),
    }

    if (!props.service) {
      const existing = await servicesService.findDeletedByName(
        props.tenantId,
        props.kind,
        name.value,
      )
      if (existing) {
        deletedMatch.value = existing
        showRestoreConfirm.value = true
        return
      }
    }

    const saved = props.service
      ? await servicesService.update(props.service.id, payload)
      : await servicesService.create({
          ...payload,
          tenant_id: props.tenantId,
          kind: props.kind,
          // 16% es el IVA estándar en México — el valor de partida más
          // común; se puede ajustar aquí mismo si un servicio específico
          // fuera distinto.
          tax_rate_bp: 1600,
        })

    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar el servicio. Revisa tu conexión.'
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
      <v-card-title>{{ isEditing ? 'Editar servicio' : 'Nuevo servicio' }}</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre" required />

          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model.number="durationMinutes"
                label="Duración (minutos)"
                type="number"
                min="1"
                required
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model.number="priceInPesos"
                label="Precio (MXN, con IVA)"
                type="number"
                min="0"
                step="0.01"
                required
              />
            </v-col>
          </v-row>

          <v-row dense>
            <v-col cols="6">
              <v-text-field
                v-model="satProductCode"
                label="Clave de producto (SAT)"
                :rules="satProductRules"
                maxlength="8"
                inputmode="numeric"
                hint="Para facturar. Confírmala con tu contador."
                persistent-hint
              />
            </v-col>
            <v-col cols="6">
              <v-text-field
                v-model="satUnitCode"
                label="Clave de unidad (SAT)"
                :rules="satUnitRules"
                maxlength="3"
                hint="E48 = unidad de servicio."
                persistent-hint
              />
            </v-col>
          </v-row>

          <v-alert
            v-if="errorMessage"
            type="error"
            density="compact"
            variant="tonal"
            class="mb-2"
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

    <v-dialog v-model="showRestoreConfirm" max-width="420">
      <v-card>
        <v-card-title>Este servicio ya existía</v-card-title>
        <v-card-text>
          Ya hubo un servicio llamado «{{ deletedMatch?.name }}» en esta categoría y fue
          eliminado. Si continúas, se va a reactivar con los datos que acabas de capturar.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="saving" @click="showRestoreConfirm = false">
            Cancelar
          </v-btn>
          <v-btn color="primary" :loading="saving" @click="confirmRestore"
            >Reactivar</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>
