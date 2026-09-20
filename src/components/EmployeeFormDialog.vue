<script setup lang="ts">
// Alta y edición de empleado (fase 9, CLAUDE.md §6.7). Un solo diálogo
// con pestañas en vez de pasos — mismo criterio que ya se pidió para
// agendar una cita (colapsar un flujo de varias pantallas en un solo
// diálogo). Componente tonto: no decide permisos (session.canEdit() ya
// gatea el botón que lo abre en EmployeesPage.vue) ni importa
// supabase.ts directo — habla con services/employees.ts y
// services/employeeDocuments.ts (CLAUDE.md §4).
import { computed, ref, watch } from 'vue'

import * as employeesService from '@/services/employees'
import type { Employee } from '@/services/employees'
import * as employeeDocumentsService from '@/services/employeeDocuments'
import type { EmployeeDocument, EmployeeDocumentType } from '@/services/employeeDocuments'
import type { Branch } from '@/services/branches'
import type { MemberRole } from '@/services/memberships'
import { roleLabel } from '@/lib/roles'
import { isValidCURP, isValidEmail, isValidRFC } from '@/lib/validation'

const props = defineProps<{
  modelValue: boolean
  tenantId: string
  employee?: Employee | null
  branches: Branch[]
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const isEditing = computed(() => props.employee != null)

const ALL_ROLES: MemberRole[] = ['owner', 'receptionist', 'groomer', 'vet']
const roleOptions = ALL_ROLES.map((value) => ({ value, title: roleLabel(value) }))

const DOCUMENT_TYPES: EmployeeDocumentType[] = ['voter_id', 'address_proof', 'employment_contract']
const DOCUMENT_LABELS: Record<EmployeeDocumentType, string> = {
  voter_id: 'Credencial de elector (INE)',
  address_proof: 'Comprobante de domicilio',
  employment_contract: 'Contrato firmado',
}

type TabName = 'personal' | 'acceso' | 'documentos'
const TAB_LABELS: Record<TabName, string> = {
  personal: 'Datos personales',
  acceso: 'Acceso',
  documentos: 'Documentos',
}

const TAB_NAMES: TabName[] = ['personal', 'acceso', 'documentos']

const tab = ref<TabName>('personal')

const fullName = ref('')
const birthDate = ref('')
const curp = ref('')
const rfc = ref('')
const voterIdNumber = ref('')

const email = ref('')
const role = ref<MemberRole>('receptionist')
const branchIds = ref<string[]>([])
const isActive = ref(true)

const documentFiles = ref<Record<EmployeeDocumentType, File | null>>({
  voter_id: null,
  address_proof: null,
  employment_contract: null,
})
const documentUrls = ref<Partial<Record<EmployeeDocumentType, string>>>({})

const saving = ref(false)
const errorMessage = ref<string | null>(null)

interface Problem {
  tab: TabName
  field: 'fullName' | 'curp' | 'rfc' | 'email'
  message: string
}

// Se muestran los errores solo DESPUÉS del primer intento de guardar: mostrar
// "Escribe el nombre" en un formulario recién abierto sería ruido.
const showValidation = ref(false)

// Todo lo que impide guardar, con la pestaña donde vive. Se valida a mano (no
// con :rules de Vuetify) porque v-window solo monta la pestaña visible: los
// campos de las otras pestañas no existen todavía y v-form no los vería —
// justo el caso "algo me falta pero no sé dónde".
const problems = computed<Problem[]>(() => {
  const list: Problem[] = []
  if (fullName.value.trim() === '') {
    list.push({ tab: 'personal', field: 'fullName', message: 'Escribe el nombre completo.' })
  }
  if (curp.value.trim() !== '' && !isValidCURP(curp.value)) {
    list.push({
      tab: 'personal',
      field: 'curp',
      message: 'La CURP debe tener 18 caracteres (ej. GOMJ850312HDFRRL09).',
    })
  }
  if (rfc.value.trim() !== '' && !isValidRFC(rfc.value)) {
    list.push({
      tab: 'personal',
      field: 'rfc',
      message: 'El RFC debe tener 12 o 13 caracteres (ej. RUCS850312AB1).',
    })
  }
  // El correo solo se pide al dar de alta: es lo que usa la invitación.
  if (!isEditing.value) {
    if (email.value.trim() === '') {
      list.push({
        tab: 'acceso',
        field: 'email',
        message: 'Escribe el correo al que se enviará la invitación.',
      })
    } else if (!isValidEmail(email.value)) {
      list.push({
        tab: 'acceso',
        field: 'email',
        message: 'El correo no parece válido (ej. nombre@negocio.mx).',
      })
    }
  }
  return list
})

function fieldErrors(field: Problem['field']): string[] {
  if (!showValidation.value) return []
  return problems.value.filter((p) => p.field === field).map((p) => p.message)
}

function tabHasProblems(name: TabName): boolean {
  return showValidation.value && problems.value.some((p) => p.tab === name)
}

/** Trae las URLs firmadas de los documentos YA subidos, para el enlace "ver actual" de cada tipo. */
async function loadExistingDocumentUrls(existing: EmployeeDocument[]): Promise<void> {
  const urls: Partial<Record<EmployeeDocumentType, string>> = {}
  for (const doc of existing) {
    const url = await employeeDocumentsService.getSignedUrl(doc.storage_path)
    if (url) urls[doc.document_type] = url
  }
  documentUrls.value = urls
}

// Rellena el formulario cuando se abre (para editar) o lo limpia (para
// dar de alta) — mismo patrón que CustomerFormDialog.vue/PetFormDialog.vue.
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return
    tab.value = 'personal'
    errorMessage.value = null
    showValidation.value = false
    documentFiles.value = { voter_id: null, address_proof: null, employment_contract: null }
    documentUrls.value = {}

    const e = props.employee
    fullName.value = e?.fullName ?? ''
    birthDate.value = e?.birthDate ?? ''
    curp.value = e?.curp ?? ''
    rfc.value = e?.rfc ?? ''
    voterIdNumber.value = e?.voterIdNumber ?? ''
    email.value = ''
    role.value = e?.role ?? 'receptionist'
    branchIds.value = e?.branchIds ?? []
    isActive.value = e?.isActive ?? true

    if (!e) return
    try {
      const existing = await employeeDocumentsService.listByMembership(e.membershipId)
      await loadExistingDocumentUrls(existing)
    } catch {
      // Si no se pueden traer los documentos existentes, el resto del
      // formulario sigue siendo usable — no bloquea la edición por esto.
    }
  },
)

function close(): void {
  emit('update:modelValue', false)
}

async function uploadPendingDocuments(membershipId: string): Promise<void> {
  for (const type of DOCUMENT_TYPES) {
    const file = documentFiles.value[type]
    if (file) {
      await employeeDocumentsService.upload(props.tenantId, membershipId, type, file)
    }
  }
}

async function handleSubmit(): Promise<void> {
  errorMessage.value = null
  showValidation.value = true
  if (problems.value.length > 0) {
    // Salta a la pestaña del primer problema: sin esto, un dato faltante
    // en "Acceso" mientras se está viendo "Datos personales" no se ve.
    tab.value = problems.value[0].tab
    return
  }

  saving.value = true
  try {
    const personalData = {
      birthDate: birthDate.value || null,
      curp: curp.value || null,
      rfc: rfc.value || null,
      voterIdNumber: voterIdNumber.value || null,
    }
    // El dueño ve todas las sucursales del tenant por rol, sin filas en
    // membership_branches (CLAUDE.md §6.1) — no tiene caso mandar una
    // selección que de todos modos se ignora del lado del servidor.
    const selectedBranchIds = role.value === 'owner' ? [] : branchIds.value

    let membershipId: string
    if (isEditing.value && props.employee) {
      membershipId = props.employee.membershipId
      await employeesService.update(props.tenantId, membershipId, props.employee.userId, {
        fullName: fullName.value,
        role: role.value,
        isActive: isActive.value,
        branchIds: selectedBranchIds,
        ...personalData,
      })
    } else {
      const created = await employeesService.inviteAndCreate({
        tenantId: props.tenantId,
        email: email.value,
        fullName: fullName.value,
        role: role.value,
        branchIds: selectedBranchIds,
        ...personalData,
      })
      membershipId = created.membershipId
    }

    await uploadPendingDocuments(membershipId)

    emit('saved')
    close()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : 'No se pudo guardar el empleado. Revisa tu conexión.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>{{ isEditing ? 'Editar empleado' : 'Nuevo empleado' }}</v-card-title>

      <v-tabs v-model="tab" class="mb-2">
        <!-- Una pestaña con datos faltantes se pinta en rojo con un
             ícono, para que se vea DÓNDE está el problema aunque se esté
             mirando otra. -->
        <v-tab
          v-for="name in TAB_NAMES"
          :key="name"
          :value="name"
          :color="tabHasProblems(name) ? 'error' : undefined"
          :prepend-icon="tabHasProblems(name) ? 'mdi-alert-circle' : undefined"
        >
          {{ TAB_LABELS[name] }}
        </v-tab>
      </v-tabs>

      <v-card-text>
        <v-form @submit.prevent="handleSubmit">
          <v-window v-model="tab">
            <v-window-item value="personal">
              <v-text-field
                v-model="fullName"
                label="Nombre completo *"
                :error-messages="fieldErrors('fullName')"
              />
              <v-text-field v-model="birthDate" label="Fecha de nacimiento" type="date" />
              <v-text-field v-model="curp" label="CURP" :error-messages="fieldErrors('curp')" />
              <v-text-field v-model="rfc" label="RFC" :error-messages="fieldErrors('rfc')" />
              <v-text-field v-model="voterIdNumber" label="Clave de elector (INE)" />
            </v-window-item>

            <v-window-item value="acceso">
              <!-- El correo solo se pide al DAR DE ALTA: es lo que usa
                   invite-employee para invitar a la persona. Cambiar el
                   correo de alguien que ya tiene cuenta es un flujo
                   distinto (fuera de alcance de esta fase). -->
              <v-text-field
                v-if="!isEditing"
                v-model="email"
                label="Correo *"
                type="email"
                :error-messages="fieldErrors('email')"
                hint="Se le mandará una invitación a este correo para que cree su contraseña."
                persistent-hint
                class="mb-4"
              />

              <v-select v-model="role" :items="roleOptions" label="Rol" class="mb-2" />

              <v-select
                v-if="role !== 'owner'"
                v-model="branchIds"
                :items="branches"
                item-title="name"
                item-value="id"
                label="Sucursales"
                multiple
                chips
                closable-chips
              />
              <p v-else class="text-body-2 text-medium-emphasis">
                El dueño tiene acceso a todas las sucursales del negocio.
              </p>

              <v-switch
                v-if="isEditing"
                v-model="isActive"
                label="Acceso activo"
                color="success"
                density="compact"
                class="mt-2"
              />
            </v-window-item>

            <v-window-item value="documentos">
              <div v-for="type in DOCUMENT_TYPES" :key="type" class="mb-3">
                <v-file-input
                  v-model="documentFiles[type]"
                  :label="DOCUMENT_LABELS[type]"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  prepend-icon="mdi-file-document-outline"
                  density="compact"
                />
                <a
                  v-if="documentUrls[type]"
                  :href="documentUrls[type]"
                  target="_blank"
                  rel="noopener"
                  class="text-caption"
                >
                  Ver documento actual
                </a>
              </div>
            </v-window-item>
          </v-window>

          <!-- Resumen de TODO lo que falta, con su pestaña: los mensajes
               por campo solo se ven en la pestaña abierta. -->
          <v-alert
            v-if="showValidation && problems.length > 0"
            type="warning"
            density="compact"
            variant="tonal"
            class="mt-2"
            title="Falta completar o corregir:"
          >
            <ul class="pl-4">
              <li v-for="problem in problems" :key="problem.field">
                <strong>{{ TAB_LABELS[problem.tab] }}:</strong> {{ problem.message }}
              </li>
            </ul>
          </v-alert>

          <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mt-2">
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
