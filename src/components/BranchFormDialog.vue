<script setup lang="ts">
// Alta y edición de una sucursal (tarea #1959). Solo el dueño llega a ver el
// botón que abre esto; la política RLS de branches es quien de verdad lo
// exige. Valida con lib/branchSettings.ts y guarda con services/branches.ts.
import { computed, ref, watch } from 'vue'

import {
  BRANCH_TIMEZONES,
  WEEKDAYS,
  branchFormProblems,
  defaultHoursForm,
  formToHours,
  hoursToForm,
  type BranchFormField,
  type HoursForm,
} from '@/lib/branchSettings'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  branch?: Branch | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [branch: Branch]
}>()

const isEditing = computed(() => props.branch != null)

const name = ref('')
const address = ref('')
const postalCode = ref('')
const phone = ref('')
const timezone = ref<string>('America/Mexico_City')
const hours = ref<HoursForm>(defaultHoursForm())

const saving = ref(false)
const errorMessage = ref<string | null>(null)
// Los errores de forma se muestran solo DESPUÉS del primer intento de guardar.
const showValidation = ref(false)

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    const b = props.branch
    name.value = b?.name ?? ''
    address.value = b?.address ?? ''
    postalCode.value = b?.postal_code ?? ''
    phone.value = b?.phone ?? ''
    timezone.value = b?.timezone ?? 'America/Mexico_City'
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- opening_hours es un jsonb genérico (Json) en los tipos generados; misma nota que NewAppointmentDialog.vue.
    hours.value = b ? hoursToForm(b.opening_hours as any) : defaultHoursForm()
    errorMessage.value = null
    showValidation.value = false
  },
)

const problems = computed(() =>
  branchFormProblems({
    name: name.value,
    address: address.value,
    postalCode: postalCode.value,
    phone: phone.value,
    timezone: timezone.value,
    hours: hours.value,
  }),
)

function messageFor(field: BranchFormField): string | undefined {
  if (!showValidation.value) return undefined
  return problems.value.find((p) => p.field === field)?.message
}

const hoursProblems = computed(() =>
  showValidation.value ? problems.value.filter((p) => p.field === 'hours') : [],
)

function close(): void {
  emit('update:modelValue', false)
}

// Un campo vacío se guarda como null, no como texto vacío.
function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

async function handleSubmit(): Promise<void> {
  showValidation.value = true
  if (problems.value.length > 0) return

  saving.value = true
  errorMessage.value = null
  try {
    const payload = {
      name: name.value,
      address: emptyToNull(address.value),
      postalCode: emptyToNull(postalCode.value),
      phone: emptyToNull(phone.value),
      timezone: timezone.value,
      openingHours: formToHours(hours.value),
    }
    const saved = props.branch
      ? await branchesService.update(props.branch.id, payload)
      : await branchesService.create(props.tenantId, payload)

    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar la sucursal. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    scrollable
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isEditing ? 'Editar sucursal' : 'Nueva sucursal' }}</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-text-field v-model="name" label="Nombre" :error-messages="messageFor('name')" />
          <v-text-field v-model="address" label="Dirección (opcional)" />

          <v-row dense>
            <v-col cols="12" sm="4">
              <v-text-field
                v-model="postalCode"
                label="Código postal"
                inputmode="numeric"
                :error-messages="messageFor('postalCode')"
              />
            </v-col>
            <v-col cols="12" sm="8">
              <v-text-field
                v-model="phone"
                label="Teléfono"
                inputmode="tel"
                :error-messages="messageFor('phone')"
              />
            </v-col>
          </v-row>

          <v-select
            v-model="timezone"
            :items="[...BRANCH_TIMEZONES]"
            label="Zona horaria"
            hint="Las citas se muestran con la hora de esta zona."
            persistent-hint
            :error-messages="messageFor('timezone')"
            class="mb-4"
          />

          <div class="text-subtitle-2 mb-1">Horario de atención</div>
          <v-row v-for="day in WEEKDAYS" :key="day.key" dense align="center">
            <v-col cols="12" sm="4">
              <v-switch
                v-model="hours[day.key].isOpen"
                :label="day.label"
                color="primary"
                density="compact"
                hide-details
              />
            </v-col>
            <template v-if="hours[day.key].isOpen">
              <v-col cols="6" sm="4">
                <v-text-field
                  v-model="hours[day.key].opensAt"
                  type="time"
                  label="Abre"
                  density="compact"
                  hide-details
                />
              </v-col>
              <v-col cols="6" sm="4">
                <v-text-field
                  v-model="hours[day.key].closesAt"
                  type="time"
                  label="Cierra"
                  density="compact"
                  hide-details
                />
              </v-col>
            </template>
            <v-col v-else cols="12" sm="8" class="text-medium-emphasis text-body-2">Cerrado</v-col>
          </v-row>

          <v-alert
            v-for="problem in hoursProblems"
            :key="problem.message"
            type="error"
            density="compact"
            variant="tonal"
            class="mt-2"
          >
            {{ problem.message }}
          </v-alert>

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mt-3">
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
