<script setup lang="ts">
// Lista de empleados (fase 9, CLAUDE.md §6.7). Mismo molde que
// CustomersPage.vue: tabla completa cargada de una vez y paginada del
// lado del cliente (v-data-table de fábrica) — alcanza de sobra para el
// tamaño de un demo (CLAUDE.md §11).
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { computed, onMounted, ref, watch } from 'vue'

import * as employeesService from '@/services/employees'
import type { Employee } from '@/services/employees'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import { roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'
import { employeeActionsFor } from '@/lib/employeeActions'
import type { EmployeeActionSet } from '@/lib/employeeActions'
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import EmployeeFormDialog from '@/components/EmployeeFormDialog.vue'
import TemporaryPasswordDialog from '@/components/TemporaryPasswordDialog.vue'
import PageHeader from '@/components/PageHeader.vue'
import IconButton from '@/components/IconButton.vue'

const session = useSessionStore()

const employees = ref<Employee[]>([])
const branches = ref<Branch[]>([])
const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)
const showFormDialog = ref(false)
const editingEmployee = ref<Employee | null>(null)

// Headers en negritas (`headerProps`), como Clientes (fase 14). La columna de
// acciones solo existe para quien puede editar empleados (la base lo revalida).
const headerProps = { class: 'font-weight-bold' }
const headers = computed(() => [
  { title: 'Nombre', key: 'fullName', headerProps },
  { title: 'Rol', key: 'roleLabel', headerProps },
  { title: 'Sucursales', key: 'branchNames', headerProps },
  ...(session.canEdit('employees')
    ? [
        {
          title: 'Acciones',
          key: 'actions',
          sortable: false,
          align: 'center' as const,
          // Tres íconos de 40 px y el switch, más el relleno de la celda: con menos ancho (o sin
          // `text-no-wrap`) el último ícono bajaba a una segunda fila.
          width: 220,
          cellProps: { class: 'text-no-wrap' },
          headerProps,
        },
      ]
    : []),
])

const branchNameById = computed<Map<string, string>>(() => {
  const pairs: Array<[string, string]> = []
  for (const branch of branches.value) {
    pairs.push([branch.id, branch.name])
  }
  return new Map(pairs)
})

interface EmployeeRow extends Employee {
  roleLabel: string
  branchNames: string
  actions: EmployeeActionSet
}

// Anotar el tipo de retorno a mano evita que TypeScript intente inferir
// el tipo combinado (spread de Employee + campos nuevos) desde cero
// en cada uso — sin esto, `vue-tsc` truena con "Type instantiation is
// excessively deep" al combinarlo con los tipos genéricos de v-data-table.
const rows = computed<EmployeeRow[]>(() =>
  employees.value.map((employee) => ({
    ...employee,
    roleLabel: roleLabel(employee.role),
    branchNames:
      employee.role === 'owner'
        ? 'Todas'
        : employee.branchIds.map((id) => branchNameById.value.get(id) ?? '').join(', '),
    actions: employeeActionsFor(employee, employees.value, session.user?.id ?? null),
  })),
)

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    const [employeeList, branchList] = await Promise.all([
      employeesService.list(session.activeTenantId),
      branchesService.listByTenant(session.activeTenantId),
    ])
    employees.value = employeeList
    branches.value = branchList
  } catch {
    errorMessage.value = 'No se pudo cargar la lista de empleados. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

function openNewEmployee(): void {
  editingEmployee.value = null
  showFormDialog.value = true
}

// La fila ya no abre el formulario: se edita con su ícono (C1.18).
function openEdit(item: Employee): void {
  editingEmployee.value = employees.value.find((e) => e.membershipId === item.membershipId) ?? null
  showFormDialog.value = true
}

// Acciones de la columna "Acciones" (C1.18). Las destructivas pasan primero
// por una confirmación; reactivar no (no quita nada).
type PendingKind = 'deactivate' | 'delete' | 'reset-password'
const pending = ref<{ kind: PendingKind; employee: Employee } | null>(null)
const showConfirm = ref(false)
// membershipId de la fila con una acción en curso: deshabilita todos los
// botones (sin doble clic) y pone el estado de carga en el que se presionó.
const busyId = ref<string | null>(null)
const busyKind = ref<PendingKind | 'activate' | null>(null)
const actionError = ref<string | null>(null)
const snackbar = ref({ show: false, text: '' })

// La contraseña temporal vive solo mientras el diálogo está abierto: se
// borra al cerrarlo, igual que en el superadmin (§7.5). No se guarda en
// ningún store ni en localStorage.
const resetResult = ref<{ email: string; password: string } | null>(null)
const showPassword = ref(false)
watch(showPassword, (open) => {
  if (!open) resetResult.value = null
})

const confirmCopy = computed(() => {
  const name = pending.value?.employee.fullName ?? ''
  switch (pending.value?.kind) {
    case 'delete':
      return {
        title: 'Eliminar empleado',
        message: `¿Seguro que quieres eliminar a ${name}? Perderá el acceso al negocio. Su historial de lo que atendió (citas, ventas y expedientes) se conserva.`,
      }
    case 'deactivate':
      return {
        title: 'Desactivar acceso',
        message: `¿Desactivar el acceso de ${name}? No podrá entrar al negocio hasta que lo vuelvas a activar. Su historial se conserva.`,
      }
    case 'reset-password':
      return {
        title: 'Restablecer contraseña',
        message: `Se cerrarán las sesiones abiertas de ${name} y se generará una contraseña nueva, que verás una sola vez. Tendrá que cambiarla al entrar.`,
      }
    default:
      return { title: '', message: '' }
  }
})

function askAction(kind: PendingKind, item: Employee): void {
  const employee = employees.value.find((e) => e.membershipId === item.membershipId)
  if (!employee || busyId.value) return
  pending.value = { kind, employee }
  showConfirm.value = true
}

async function runAction(kind: PendingKind | 'activate', employee: Employee): Promise<void> {
  if (!session.activeTenantId || busyId.value) return
  busyId.value = employee.membershipId
  busyKind.value = kind
  actionError.value = null
  try {
    if (kind === 'delete') {
      await employeesService.remove(employee.membershipId)
      snackbar.value = { show: true, text: `${employee.fullName} fue eliminado.` }
    } else if (kind === 'deactivate' || kind === 'activate') {
      await employeesService.setActive(employee.membershipId, kind === 'activate')
      snackbar.value = {
        show: true,
        text:
          kind === 'activate'
            ? `${employee.fullName} ya tiene acceso otra vez.`
            : `${employee.fullName} fue desactivado.`,
      }
    } else {
      const result = await employeesService.resetPassword(
        session.activeTenantId,
        employee.membershipId,
      )
      resetResult.value = { email: result.employeeEmail, password: result.temporaryPassword }
      showPassword.value = true
    }
    await load()
  } catch (e) {
    actionError.value = e instanceof Error ? e.message : 'No se pudo completar la acción.'
  } finally {
    busyId.value = null
    busyKind.value = null
  }
}

async function confirmPending(): Promise<void> {
  const current = pending.value
  if (!current) return
  await runAction(current.kind, current.employee)
  showConfirm.value = false
  pending.value = null
}

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader title="Empleados">
      <template #actions>
        <v-btn
          v-if="session.canEdit('employees')"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openNewEmployee"
        >
          Nuevo empleado
        </v-btn>
      </template>
    </PageHeader>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-if="actionError"
      type="error"
      density="compact"
      variant="tonal"
      closable
      class="mb-4"
      @click:close="actionError = null"
    >
      {{ actionError }}
    </v-alert>

    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="headers.length" />
    <v-data-table
      v-else-if="!isFirstLoad"
      :headers="headers"
      :items="rows"
      :loading="loading"
      no-data-text="Todavía no hay empleados registrados."
      loading-text="Cargando empleados…"
>
      <template #[`item.actions`]="{ item }">
        <div class="d-flex align-center justify-center">
          <IconButton
            icon="mdi-pencil"
            color="primary"
            variant="text"
            size="small"
            :disabled="busyId !== null"
            :aria-label="`Editar a ${item.fullName}`"
            @click.stop="openEdit(item)"
          />
          <IconButton
            v-if="item.actions.canResetPassword"
            icon="mdi-lock-reset"
            variant="text"
            size="small"
            :loading="busyId === item.membershipId && busyKind === 'reset-password'"
            :disabled="busyId !== null"
            :aria-label="`Restablecer la contraseña de ${item.fullName}`"
            @click.stop="askAction('reset-password', item)"
          />
          <IconButton
            v-if="item.actions.canDelete"
            icon="mdi-delete"
            color="error"
            variant="text"
            size="small"
            :loading="busyId === item.membershipId && busyKind === 'delete'"
            :disabled="busyId !== null"
            :aria-label="`Eliminar a ${item.fullName}`"
            @click.stop="askAction('delete', item)"
          />
          <v-tooltip
            v-if="item.actions.toggleActive"
            :text="
              item.isActive
                ? `Desactivar el acceso de ${item.fullName}`
                : `Activar el acceso de ${item.fullName}`
            "
            location="top"
          >
            <template #activator="{ props: tooltipProps }">
              <v-switch
                v-bind="tooltipProps"
                class="ml-1"
                :model-value="item.isActive"
                :loading="
                  busyId === item.membershipId &&
                  (busyKind === 'deactivate' || busyKind === 'activate')
                "
                :disabled="busyId !== null"
                :aria-label="
                  item.isActive
                    ? `Desactivar el acceso de ${item.fullName}`
                    : `Activar el acceso de ${item.fullName}`
                "
                color="primary"
                density="compact"
                hide-details
                @click.stop
                @update:model-value="
                  item.isActive ? askAction('deactivate', item) : runAction('activate', item)
                "
              />
            </template>
          </v-tooltip>
        </div>
      </template>
    </v-data-table>

    <ConfirmDeleteDialog
      v-model="showConfirm"
      :title="confirmCopy.title"
      :message="confirmCopy.message"
      :loading="busyId !== null"
      @confirm="confirmPending"
    />
    <TemporaryPasswordDialog
      v-model="showPassword"
      title="Contraseña temporal: deberá cambiarla al entrar"
      :email="resetResult?.email ?? null"
      :password="resetResult?.password ?? ''"
    />
    <v-snackbar v-model="snackbar.show" color="success" timeout="4000">{{
      snackbar.text
    }}</v-snackbar>

    <EmployeeFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :employee="editingEmployee"
      :branches="branches"
      @saved="handleSaved"
    />
  </v-container>
</template>
