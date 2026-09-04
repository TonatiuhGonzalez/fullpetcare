<script setup lang="ts">
// Alta y edición de un servicio del catálogo (tarea 3.16). Solo owner
// llega a ver el botón que abre esto (CatalogPage) — la política RLS
// (services_insert/services_update) es quien de verdad lo exige, este
// componente solo evita mostrar un formulario que fallaría.
import { computed, ref, watch } from 'vue'

import * as servicesService from '@/services/services'
import type { Service, ServiceKind } from '@/services/services'
import { pesosToCents } from '@/lib/money'

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
const isActive = ref(true)

const saving = ref(false)
const errorMessage = ref<string | null>(null)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const s = props.service
    name.value = s?.name ?? ''
    durationMinutes.value = s?.duration_minutes ?? null
    priceInPesos.value = s ? s.price_cents / 100 : null
    isActive.value = s?.is_active ?? true
    errorMessage.value = null
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  if (durationMinutes.value == null || priceInPesos.value == null) return

  saving.value = true
  errorMessage.value = null
  try {
    const payload = {
      name: name.value,
      duration_minutes: durationMinutes.value,
      price_cents: pesosToCents(priceInPesos.value),
      is_active: isActive.value,
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

          <v-checkbox
            v-if="isEditing"
            v-model="isActive"
            label="Activo (se ofrece para agendar)"
            density="compact"
          />

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
