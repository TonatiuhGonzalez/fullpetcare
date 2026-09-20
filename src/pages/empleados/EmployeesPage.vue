<script setup lang="ts">
// Lista de empleados (fase 9, CLAUDE.md §6.7). Mismo molde que
// CustomersPage.vue: tabla completa cargada de una vez y paginada del
// lado del cliente (v-data-table de fábrica) — alcanza de sobra para el
// tamaño de un demo (CLAUDE.md §11).
import { computed, onMounted, ref } from 'vue'

import * as employeesService from '@/services/employees'
import type { Employee } from '@/services/employees'
import * as branchesService from '@/services/branches'
import type { Branch } from '@/services/branches'
import { roleLabel } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'
import EmployeeFormDialog from '@/components/EmployeeFormDialog.vue'

const session = useSessionStore()

const employees = ref<Employee[]>([])
const branches = ref<Branch[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const showFormDialog = ref(false)
const editingEmployee = ref<Employee | null>(null)

const headers = [
  { title: 'Nombre', key: 'fullName' },
  { title: 'Rol', key: 'roleLabel' },
  { title: 'Sucursales', key: 'branchNames' },
  { title: 'Acceso', key: 'statusLabel' },
]

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
  statusLabel: string
}

// Anotar el tipo de retorno a mano evita que TypeScript intente inferir
// el tipo combinado (spread de Employee + tres campos nuevos) desde cero
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
    statusLabel: employee.isActive ? 'Activo' : 'Desactivado',
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

function handleRowClick(_event: Event, { item }: { item: Employee }): void {
  editingEmployee.value = employees.value.find((e) => e.membershipId === item.membershipId) ?? null
  showFormDialog.value = true
}

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Empleados</h1>
      <v-spacer />
      <v-btn
        v-if="session.canEdit('employees')"
        color="primary"
        prepend-icon="mdi-plus"
        @click="openNewEmployee"
      >
        Nuevo empleado
      </v-btn>
    </div>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      no-data-text="Todavía no hay empleados registrados."
      loading-text="Cargando empleados…"
      @click:row="handleRowClick"
    >
      <template #[`item.statusLabel`]="{ item }">
        <v-chip :color="item.isActive ? 'success' : 'default'" size="small" variant="tonal">
          {{ item.statusLabel }}
        </v-chip>
      </template>
    </v-data-table>

    <EmployeeFormDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :employee="editingEmployee"
      :branches="branches"
      @saved="handleSaved"
    />
  </v-container>
</template>
