<script setup lang="ts">
// Alta de un cliente NUEVO con su primera mascota (C1.11, PLAN.md D26). Una mascota
// es obligatoria: un cliente sin mascota no puede agendar ni cobrar nada de lo que
// vende el negocio. Se guarda todo junto con la RPC `create_customer_with_pet`: si
// algo falla (correo repetido, mascota sin nombre), no queda un cliente a medias.
//
// Componente tonto, mismo patrón que CustomerFormDialog.vue: avisa con `saved` y
// quien lo usa decide qué sigue (elegir al cliente en la cita, recargar la tabla...).
// Para EDITAR un cliente ya registrado se siguen usando CustomerEditDialog (con sus
// mascotas) y CustomerFormDialog (datos fiscales del punto de venta).
import { ref, watch } from 'vue'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import type { Pet } from '@/services/pets'
import { buildCustomerPayload } from '@/lib/customerForm'
import { customerSaveErrorMessage, isEmailTakenError } from '@/lib/customerErrors'
import { speciesLabel } from '@/lib/petLabels'
import {
  fiscalReceiverProblems,
  isValidEmail,
  isValidPhone,
  isValidPostalCode,
  isValidRFC,
} from '@/lib/validation'
import type { Database } from '@/types/database'

type PetSpecies = Database['public']['Enums']['pet_species']
type PetSex = Database['public']['Enums']['pet_sex']

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  /** El teléfono es obligatorio (citas y llegadas sin cita: es como se avisa al cliente). */
  phoneRequired?: boolean
  /** Punto de venta con factura: pide y valida los datos fiscales del cliente. */
  invoiceRequired?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: [result: { customer: Customer; pet: Pet }]
}>()

const speciesOptions = (['dog', 'cat', 'other'] as PetSpecies[]).map((value) => ({
  value,
  title: speciesLabel(value),
}))
const sexOptions: Array<{ value: PetSex | null; title: string }> = [
  { value: null, title: 'No especificado' },
  { value: 'male', title: 'Macho' },
  { value: 'female', title: 'Hembra' },
]

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

const petName = ref('')
const petSpecies = ref<PetSpecies>('dog')
const petBreed = ref('')
const petSex = ref<PetSex | null>(null)
const petBirthDate = ref('')
const petSterilized = ref(false)
const petGroomingNotes = ref('')
const petMedicalAlerts = ref('')

const saving = ref(false)
const errorMessage = ref<string | null>(null)
// El correo repetido se marca en el propio campo (además del aviso general).
const emailError = ref<string | null>(null)

// Limpia el formulario cada vez que se abre: el mismo diálogo se reutiliza.
watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    firstName.value = ''
    lastName.value = ''
    phone.value = ''
    email.value = ''
    notes.value = ''
    requiresInvoice.value = props.invoiceRequired ?? false
    rfc.value = ''
    legalName.value = ''
    taxRegimeCode.value = ''
    cfdiUse.value = ''
    postalCode.value = ''
    petName.value = ''
    petSpecies.value = 'dog'
    petBreed.value = ''
    petSex.value = null
    petBirthDate.value = ''
    petSterilized.value = false
    petGroomingNotes.value = ''
    petMedicalAlerts.value = ''
    errorMessage.value = null
    emailError.value = null
  },
)

watch(email, () => {
  emailError.value = null
})

const requiredRules = [(v: string) => v.trim() !== '' || 'Obligatorio']
const phoneRules = [
  (v: string) =>
    v === '' ? !props.phoneRequired || 'Obligatorio' : isValidPhone(v) || 'Debe tener 10 dígitos',
]
// Vacío se permite (muchos clientes no dan correo); si hay algo, debe tener forma de correo.
const emailRules = [(v: string) => v.trim() === '' || isValidEmail(v) || 'Correo con formato inválido']
const rfcRules = [(v: string) => v === '' || isValidRFC(v) || 'RFC con formato inválido']
const postalCodeRules = [(v: string) => v === '' || isValidPostalCode(v) || 'Debe tener 5 dígitos']

function close(): void {
  emit('update:modelValue', false)
}

// Devuelve el primer problema del formulario, o null si se puede guardar.
function firstProblem(): string | null {
  if (!firstName.value.trim() || !lastName.value.trim()) return 'Faltan el nombre y el apellido.'
  if (props.phoneRequired && !isValidPhone(phone.value)) return 'Falta el teléfono (10 dígitos).'
  if (phone.value !== '' && !isValidPhone(phone.value)) return 'El teléfono debe tener 10 dígitos.'
  if (email.value.trim() !== '' && !isValidEmail(email.value)) return 'El correo no tiene un formato válido.'
  if (!petName.value.trim()) return 'Falta el nombre de la mascota.'
  if (props.invoiceRequired) {
    const problems = fiscalReceiverProblems({
      rfc: rfc.value,
      legalName: legalName.value,
      taxRegimeCode: taxRegimeCode.value,
      cfdiUse: cfdiUse.value,
      postalCode: postalCode.value,
    })
    if (problems.length > 0) return problems.join(' ')
  }
  return null
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  const problem = firstProblem()
  if (problem) {
    errorMessage.value = problem
    return
  }
  saving.value = true
  try {
    const customer = buildCustomerPayload({
      firstName: firstName.value.trim(),
      lastName: lastName.value.trim(),
      phone: phone.value,
      email: email.value.trim(),
      notes: notes.value,
      requiresInvoice: requiresInvoice.value,
      rfc: rfc.value,
      legalName: legalName.value,
      taxRegimeCode: taxRegimeCode.value,
      cfdiUse: cfdiUse.value,
      postalCode: postalCode.value,
    })
    const result = await customersService.createWithPet({
      tenantId: props.tenantId,
      customer,
      pet: {
        name: petName.value.trim(),
        species: petSpecies.value,
        breed: petBreed.value.trim() || null,
        sex: petSex.value,
        birth_date: petBirthDate.value || null,
        is_sterilized: petSterilized.value,
        grooming_notes: petGroomingNotes.value.trim() || null,
        medical_alerts: petMedicalAlerts.value.trim() || null,
      },
    })
    emit('saved', result)
    close()
  } catch (e) {
    errorMessage.value = customerSaveErrorMessage(e)
    if (isEmailTakenError(e)) emailError.value = errorMessage.value
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
      <v-card-title>{{
        invoiceRequired ? 'Cliente nuevo para la factura' : 'Cliente nuevo'
      }}</v-card-title>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <p class="text-overline text-medium-emphasis">Cliente</p>
          <v-row dense>
            <v-col cols="6">
              <v-text-field v-model="firstName" label="Nombre" :rules="requiredRules" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="lastName" label="Apellido" :rules="requiredRules" />
            </v-col>
          </v-row>
          <v-text-field
            v-model="phone"
            :label="phoneRequired ? 'Teléfono (10 dígitos)' : 'Teléfono'"
            type="tel"
            :rules="phoneRules"
          />
          <v-text-field
            v-model="email"
            label="Correo (opcional)"
            type="email"
            :rules="emailRules"
            :error-messages="emailError ?? undefined"
          />
          <v-textarea v-model="notes" label="Notas" rows="2" auto-grow />

          <v-checkbox
            v-model="requiresInvoice"
            label="Requiere factura"
            density="compact"
            :disabled="invoiceRequired"
          />
          <v-expand-transition>
            <div v-if="requiresInvoice">
              <v-text-field v-model="rfc" label="RFC" :rules="rfcRules" />
              <v-text-field v-model="legalName" label="Razón social" />
              <v-row dense>
                <v-col cols="6">
                  <v-text-field v-model="taxRegimeCode" label="Régimen fiscal (código SAT)" />
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

          <v-divider class="my-3" />
          <p class="text-overline text-medium-emphasis">Mascota</p>
          <v-text-field v-model="petName" label="Nombre de la mascota" :rules="requiredRules" />
          <v-row dense>
            <v-col cols="6">
              <v-select v-model="petSpecies" :items="speciesOptions" label="Especie" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="petBreed" label="Raza" />
            </v-col>
          </v-row>
          <v-row dense>
            <v-col cols="6">
              <v-select v-model="petSex" :items="sexOptions" label="Sexo" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model="petBirthDate" label="Fecha de nacimiento" type="date" />
            </v-col>
          </v-row>
          <v-checkbox v-model="petSterilized" label="Esterilizado(a)" density="compact" />
          <v-textarea v-model="petGroomingNotes" label="Preferencias de corte" rows="2" auto-grow />
          <v-textarea v-model="petMedicalAlerts" label="Alertas médicas" rows="2" auto-grow />

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
