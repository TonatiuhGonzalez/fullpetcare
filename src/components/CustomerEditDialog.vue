<script setup lang="ts">
// Modal de cliente de la pantalla de Clientes (fase 14, tarea 14.4): va directo
// a la edición, sin vista previa. Sirve para editar (con `customerId`) y para
// dar de alta (sin él). El título es el nombre del cliente; abajo, en orden:
// mascotas (tarjetas), nombre, apellido, teléfono, correo, notas y "Requiere
// factura" con sus datos fiscales.
//
// No reemplaza a CustomerFormDialog: ese lo sigue usando el punto de venta para
// pedir los datos de la factura (fase 13, modo `invoice-required`).
import { computed, ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import { buildCustomerPayload } from '@/lib/customerForm'
import { speciesLabel } from '@/lib/petLabels'
import { isValidPhone, isValidPostalCode, isValidRFC } from '@/lib/validation'
import PetFormDialog from '@/components/PetFormDialog.vue'
import PetDetailDialog from '@/components/PetDetailDialog.vue'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  /** null para dar de alta un cliente nuevo. */
  customerId: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  /** Se guardó el cliente: el listado debe recargar sus filas. */
  saved: [customer: Customer]
  /** Cambió algo de sus mascotas (alta o edición) sin guardar el cliente. */
  changed: []
}>()

const isNew = computed(() => props.customerId === null)

const customer = ref<Customer | null>(null)
const pets = ref<Pet[]>([])
const loading = ref(false)
const saving = ref(false)
const errorMessage = ref<string | null>(null)

const firstName = ref('')
const lastName = ref('')
const phone = ref('')
const email = ref('')
const notes = ref('')
const requiresInvoice = ref(false)
const rfc = ref('')
const legalName = ref('')
const taxRegimeCode = ref('')
const cfdiUse = ref('')
const postalCode = ref('')

const showNewPet = ref(false)
const showPetDialog = ref(false)
const selectedPetId = ref<string | null>(null)

function fillForm(c: Customer | null): void {
  firstName.value = c?.first_name ?? ''
  lastName.value = c?.last_name ?? ''
  phone.value = c?.phone ?? ''
  email.value = c?.email ?? ''
  notes.value = c?.notes ?? ''
  requiresInvoice.value = c?.requires_invoice ?? false
  rfc.value = c?.rfc ?? ''
  legalName.value = c?.legal_name ?? ''
  taxRegimeCode.value = c?.tax_regime_code ?? ''
  cfdiUse.value = c?.cfdi_use ?? ''
  postalCode.value = c?.postal_code ?? ''
}

async function loadPets(id: string): Promise<void> {
  pets.value = await petsService.listByCustomer(props.tenantId, id)
}

async function load(id: string): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    const [found, foundPets] = await Promise.all([
      customersService.getById(props.tenantId, id),
      petsService.listByCustomer(props.tenantId, id),
    ])
    customer.value = found
    pets.value = foundPets
    fillForm(found)
  } catch {
    errorMessage.value = 'No se pudo cargar el cliente. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

// Se carga (o se limpia) cada vez que el diálogo se abre: el mismo componente
// sirve para varios clientes sin volver a crearse.
watch(
  () => [props.modelValue, props.customerId] as const,
  ([open, id]) => {
    if (!open) return
    customer.value = null
    pets.value = []
    errorMessage.value = null
    fillForm(null)
    if (id) load(id)
  },
  { immediate: true },
)

const title = computed(() =>
  customer.value
    ? `${customer.value.first_name} ${customer.value.last_name}`
    : isNew.value
      ? 'Nuevo cliente'
      : 'Cliente',
)

const phoneRules = [(v: string) => v === '' || isValidPhone(v) || 'Debe tener 10 dígitos']
const rfcRules = [(v: string) => v === '' || isValidRFC(v) || 'RFC con formato inválido']
const postalCodeRules = [
  (v: string) => v === '' || isValidPostalCode(v) || 'Debe tener 5 dígitos',
]

function close(): void {
  emit('update:modelValue', false)
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  if (!firstName.value.trim() || !lastName.value.trim()) {
    errorMessage.value = 'Faltan el nombre y el apellido.'
    return
  }
  saving.value = true
  try {
    const payload = buildCustomerPayload({
      firstName: firstName.value,
      lastName: lastName.value,
      phone: phone.value,
      email: email.value,
      notes: notes.value,
      requiresInvoice: requiresInvoice.value,
      rfc: rfc.value,
      legalName: legalName.value,
      taxRegimeCode: taxRegimeCode.value,
      cfdiUse: cfdiUse.value,
      postalCode: postalCode.value,
    })
    const saved = props.customerId
      ? await customersService.update(props.customerId, payload)
      : await customersService.create({ ...payload, tenant_id: props.tenantId })
    emit('saved', saved)
    close()
  } catch {
    errorMessage.value = 'No se pudo guardar el cliente. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}

function openPet(petId: string): void {
  selectedPetId.value = petId
  showPetDialog.value = true
}

async function handlePetSaved(): Promise<void> {
  if (props.customerId) await loadPets(props.customerId)
  emit('changed')
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
      <v-card-title class="d-flex align-center">
        <span>{{ title }}</span>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" aria-label="Cerrar" @click="close" />
      </v-card-title>

      <v-card-text>
        <v-progress-circular v-if="loading" indeterminate color="primary" />

        <template v-else>
          <!-- Mascotas: solo con el cliente ya guardado, porque cada mascota
               necesita el id de su dueño. -->
          <template v-if="!isNew">
            <div class="d-flex align-center mb-4">
              <h2 class="text-h6">Mascotas</h2>
              <v-spacer />
              <v-btn color="primary" prepend-icon="mdi-plus" @click="showNewPet = true">
                Nueva mascota
              </v-btn>
            </div>

            <v-row v-if="pets.length > 0" class="mb-2">
              <v-col v-for="pet in pets" :key="pet.id" cols="12" sm="6">
                <v-card class="pa-4" variant="outlined" link @click="openPet(pet.id)">
                  <div class="d-flex align-center">
                    <v-avatar color="primary" class="mr-3">
                      <v-icon :icon="pet.species === 'cat' ? 'mdi-cat' : 'mdi-dog'" />
                    </v-avatar>
                    <div>
                      <div class="font-weight-medium">{{ pet.name }}</div>
                      <div class="text-caption text-medium-emphasis">
                        {{ speciesLabel(pet.species)
                        }}<span v-if="pet.breed"> · {{ pet.breed }}</span>
                      </div>
                    </div>
                  </div>
                </v-card>
              </v-col>
            </v-row>
            <p v-else class="text-medium-emphasis mb-2">
              Este cliente todavía no tiene mascotas registradas.
            </p>
          </template>

          <v-form class="mt-4" @submit.prevent="handleSubmit">
            <v-row dense>
              <v-col cols="6">
                <v-text-field v-model="firstName" label="Nombre" required />
              </v-col>
              <v-col cols="6">
                <v-text-field v-model="lastName" label="Apellido" required />
              </v-col>
            </v-row>

            <v-text-field v-model="phone" label="Teléfono" :rules="phoneRules" />
            <v-text-field v-model="email" label="Correo" type="email" />
            <v-textarea v-model="notes" label="Notas" rows="2" auto-grow />

            <v-checkbox
              v-model="requiresInvoice"
              label="Requiere factura"
              density="compact"
            />

            <v-expand-transition>
              <div v-if="requiresInvoice">
                <v-text-field v-model="rfc" label="RFC" :rules="rfcRules" />
                <v-text-field v-model="legalName" label="Razón social" />
                <v-row dense>
                  <v-col cols="6">
                    <v-text-field
                      v-model="taxRegimeCode"
                      label="Régimen fiscal (código SAT)"
                    />
                  </v-col>
                  <v-col cols="6">
                    <v-text-field v-model="cfdiUse" label="Uso de CFDI (código SAT)" />
                  </v-col>
                </v-row>
                <v-text-field
                  v-model="postalCode"
                  label="Código postal fiscal"
                  :rules="postalCodeRules"
                />
              </div>
            </v-expand-transition>

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
        </template>
      </v-card-text>

      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">Cancelar</v-btn>
        <v-btn
          color="primary"
          :loading="saving"
          :disabled="loading"
          @click="handleSubmit"
        >
          Guardar
        </v-btn>
      </v-card-actions>
    </v-card>

    <PetFormDialog
      v-if="customerId"
      v-model="showNewPet"
      :tenant-id="tenantId"
      :customer-id="customerId"
      @saved="handlePetSaved"
    />
    <PetDetailDialog
      v-model="showPetDialog"
      :pet-id="selectedPetId"
      @changed="handlePetSaved"
    />
  </v-dialog>
</template>
