<script setup lang="ts">
// Lista de clientes con búsqueda y paginación simple (tarea 2.16). La
// paginación es la que trae Vuetify de fábrica en v-data-table (del
// lado del cliente, sobre lo que ya se cargó) — no hace falta construir
// paginación propia: con el volumen de datos de un demo (decenas de
// clientes por tenant), traer todo de una vez y paginar en el navegador
// es simple y suficientemente rápido (CLAUDE.md §11, "simple sobre
// elegante").
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import { useSessionStore } from '@/stores/session'
import CustomerEditDialog from '@/components/CustomerEditDialog.vue'
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import PageHeader from '@/components/PageHeader.vue'
import { isFrontDesk } from '@/lib/roles'
import PetsPanel from './PetsPanel.vue'

const session = useSessionStore()
const router = useRouter()
const route = useRoute()

// La pestaña vive en la URL (?tab=mascotas) para que, al recargar la
// página, se conserve la misma pestaña.
const tab = ref<'clientes' | 'mascotas'>(
  route.query.tab === 'mascotas' ? 'mascotas' : 'clientes',
)
watch(tab, (value) => {
  router.replace({ query: value === 'mascotas' ? { tab: value } : {} })
})

const customers = ref<Customer[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')
const showFormDialog = ref(false)
const petsPanel = ref<InstanceType<typeof PetsPanel> | null>(null)
const editingCustomerId = ref<string | null>(null)
const customerToDelete = ref<Customer | null>(null)
const showDeleteConfirm = ref(false)
const deleting = ref(false)

// Headers en negritas (`headerProps`). La columna de acciones solo existe para
// dueño y recepción (el borrado también lo revalida la base).
const headerProps = { class: 'font-weight-bold' }
const headers = computed(() => [
  { title: 'Nombre', key: 'fullName', headerProps },
  { title: 'Teléfono', key: 'phone', headerProps },
  { title: 'Correo', key: 'email', headerProps },
  ...(isFrontDesk(session.role)
    ? [
        {
          title: 'Acciones',
          key: 'actions',
          sortable: false,
          align: 'center' as const,
          width: 140,
          headerProps,
        },
      ]
    : []),
])

// La tabla necesita "fullName" como columna, pero el servicio devuelve
// first_name/last_name por separado (así vive en la base) — se arma
// aquí, solo para mostrar.
const rows = ref<Array<Customer & { fullName: string }>>([])
watch(customers, (list) => {
  rows.value = list.map((c) => ({ ...c, fullName: `${c.first_name} ${c.last_name}` }))
})

async function load(): Promise<void> {
  if (!session.activeTenantId) return
  loading.value = true
  errorMessage.value = null
  try {
    customers.value =
      searchTerm.value.trim() === ''
        ? await customersService.list(session.activeTenantId)
        : await customersService.search(session.activeTenantId, searchTerm.value)
  } catch {
    errorMessage.value = 'No se pudo cargar la lista de clientes. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

// Sin debounce a propósito: con pocos clientes por tenant, cada tecleo
// dispara una consulta instantánea — un debounce es una optimización
// que no hace falta al tamaño de un demo (se agrega si algún día duele
// de verdad, CLAUDE.md §11).
watch(searchTerm, load)
onMounted(load)

function openNewCustomer(): void {
  editingCustomerId.value = null
  showFormDialog.value = true
}

function openEditCustomer(customer: Customer): void {
  editingCustomerId.value = customer.id
  showFormDialog.value = true
}

function askDelete(customer: Customer): void {
  customerToDelete.value = customer
  showDeleteConfirm.value = true
}

async function confirmDelete(): Promise<void> {
  if (!customerToDelete.value) return
  deleting.value = true
  errorMessage.value = null
  try {
    await customersService.softDelete(customerToDelete.value.id)
    showDeleteConfirm.value = false
    await load()
  } catch {
    showDeleteConfirm.value = false
    errorMessage.value = 'No se pudo eliminar el cliente. Revisa tu conexión.'
  } finally {
    deleting.value = false
  }
}

function handleSaved(): void {
  load()
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader title="Clientes">
      <template #actions>
        <v-btn
          v-if="tab === 'clientes'"
          color="primary"
          prepend-icon="mdi-plus"
          @click="openNewCustomer"
        >
          Nuevo cliente
        </v-btn>
        <v-btn
          v-else
          color="primary"
          prepend-icon="mdi-plus"
          @click="petsPanel?.openNewPet()"
        >
          Nueva mascota
        </v-btn>
      </template>
    </PageHeader>

    <v-tabs v-model="tab" class="mb-4">
      <v-tab value="clientes">Clientes</v-tab>
      <v-tab value="mascotas">Mascotas</v-tab>
    </v-tabs>

    <PetsPanel v-if="tab === 'mascotas'" ref="petsPanel" />

    <template v-else>
      <v-text-field
        v-model="searchTerm"
        label="Buscar por nombre, teléfono o correo"
        prepend-inner-icon="mdi-magnify"
        density="compact"
        variant="outlined"
        clearable
        class="mb-4"
        style="max-width: 420px"
      />

      <v-alert
        v-if="errorMessage"
        type="error"
        density="compact"
        variant="tonal"
        class="mb-4"
      >
        {{ errorMessage }}
      </v-alert>

      <v-data-table
        :headers="headers"
        :items="rows"
        :loading="loading"
        no-data-text="No hay clientes que coincidan con la búsqueda."
        loading-text="Cargando clientes…"
      >
        <!-- Sintaxis de corchetes en vez de "#item.fullName": el "." en un
           nombre de slot corto se interpreta como si fuera un modificador
           de directiva (que v-slot no soporta), así que hay que pasar el
           nombre completo como una expresión dinámica. -->
        <template #[`item.fullName`]="{ item }">
          <span class="font-weight-medium">{{ item.fullName }}</span>
        </template>
        <template #[`item.actions`]="{ item }">
          <v-btn
            icon="mdi-pencil"
            color="primary"
            variant="text"
            size="small"
            aria-label="Editar cliente"
            @click="openEditCustomer(item)"
          />
          <v-btn
            icon="mdi-delete"
            color="error"
            variant="text"
            size="small"
            aria-label="Eliminar cliente"
            @click="askDelete(item)"
          />
        </template>
      </v-data-table>
    </template>

    <CustomerEditDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="editingCustomerId"
      @saved="handleSaved"
    />
    <ConfirmDeleteDialog
      v-model="showDeleteConfirm"
      title="Eliminar cliente"
      :message="`¿Seguro que quieres eliminar a ${customerToDelete?.first_name ?? ''} ${customerToDelete?.last_name ?? ''}? También se eliminarán sus mascotas y sus citas programadas. Su historial de atenciones, sus ventas y su expediente se conservan.`"
      :loading="deleting"
      @confirm="confirmDelete"
    />
  </v-container>
</template>
