<script setup lang="ts">
// Lista de clientes con búsqueda y paginación simple (tarea 2.16). La
// paginación es la que trae Vuetify de fábrica en v-data-table (del
// lado del cliente, sobre lo que ya se cargó) — no hace falta construir
// paginación propia: con el volumen de datos de un demo (decenas de
// clientes por tenant), traer todo de una vez y paginar en el navegador
// es simple y suficientemente rápido (CLAUDE.md §11, "simple sobre
// elegante").
import TableSkeleton from '@/components/TableSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import * as customersService from '@/services/customers'
import type { Customer } from '@/services/customers'
import * as petsService from '@/services/pets'
import type { Pet } from '@/services/pets'
import { groupPetsByCustomer, speciesIcon, splitVisiblePets } from '@/lib/customerPets'
import { useSessionStore } from '@/stores/session'
import CustomerEditDialog from '@/components/CustomerEditDialog.vue'
import CustomerWithPetDialog from '@/components/CustomerWithPetDialog.vue'
import ConfirmDeleteDialog from '@/components/ConfirmDeleteDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import { isFrontDesk } from '@/lib/roles'
import IconButton from '@/components/IconButton.vue'

const session = useSessionStore()
const router = useRouter()

const customers = ref<Customer[]>([])
const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)
const searchTerm = ref('')
const showFormDialog = ref(false)
// Todas las mascotas del negocio, traídas en UNA consulta y repartidas por cliente
// (C1.15): la columna "Mascotas" no hace una consulta por fila.
const petsByCustomer = ref<Map<string, Pet[]>>(new Map())
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
  { title: 'Mascotas', key: 'petCount', headerProps },
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
// "petCount" solo sirve para que la columna Mascotas se pueda ordenar.
const rows = computed(() =>
  customers.value.map((c) => ({
    ...c,
    fullName: `${c.first_name} ${c.last_name}`,
    pets: petsByCustomer.value.get(c.id) ?? [],
    petCount: petsByCustomer.value.get(c.id)?.length ?? 0,
  })),
)

// `withPets` es false al teclear en el buscador: las mascotas no cambian con la
// búsqueda, así que no se vuelven a pedir en cada tecleo.
async function load(withPets = true): Promise<void> {
  if (!session.activeTenantId) return
  const tenantId = session.activeTenantId
  loading.value = true
  errorMessage.value = null
  try {
    const customersRequest =
      searchTerm.value.trim() === ''
        ? customersService.list(tenantId)
        : customersService.search(tenantId, searchTerm.value)
    const [found, pets] = await Promise.all([
      customersRequest,
      withPets ? petsService.list(tenantId) : Promise.resolve(null),
    ])
    customers.value = found
    if (pets) petsByCustomer.value = groupPetsByCustomer(pets)
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
watch(searchTerm, () => load(false))
onMounted(() => load())

// Alta: siempre con su primera mascota (C1.11). Al guardar se abre la página del cliente
// para completar lo demás (más mascotas, cartilla).
const showNewCustomerDialog = ref(false)

function openNewCustomer(): void {
  showNewCustomerDialog.value = true
}

function handleCustomerCreated(result: { customer: Customer }): void {
  load()
  router.push({ name: 'cliente', params: { id: result.customer.id } })
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

// La fila entera abre la página del cliente (C1.15, revierte la decisión 2 de la
// fase 14). Los botones de acción detienen el clic para no disparar esta navegación.
function openCustomerPage(customerId: string): void {
  router.push({ name: 'cliente', params: { id: customerId } })
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader title="Clientes">
      <template #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="openNewCustomer">
          Nuevo cliente
        </v-btn>
      </template>
    </PageHeader>

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

    <TableSkeleton v-if="isFirstLoad && showSkeleton" :columns="headers.length" />
    <v-data-table
      v-else-if="!isFirstLoad"
      :headers="headers"
      :items="rows"
      :loading="loading"
      loading-text="Cargando clientes…"
      hover
      :row-props="{ class: 'customer-row' }"
      @click:row="(_event: Event, { item }: { item: { id: string } }) => openCustomerPage(item.id)"
    >
      <template #no-data>
        <EmptyState
          compact
          illustration="customers"
          :title="searchTerm.trim() ? 'Sin resultados' : 'Aún no hay clientes'"
          :message="
            searchTerm.trim()
              ? 'No hay clientes que coincidan con la búsqueda.'
              : 'Los clientes que des de alta aparecerán aquí.'
          "
        />
      </template>

      <!-- Sintaxis de corchetes en vez de "#item.fullName": el "." en un
           nombre de slot corto se interpreta como si fuera un modificador
           de directiva (que v-slot no soporta), así que hay que pasar el
           nombre completo como una expresión dinámica. -->
      <!-- El nombre es un enlace real: la fila se abre con el mouse, pero el
           teclado y los lectores de pantalla llegan por aquí. -->
      <template #[`item.fullName`]="{ item }">
        <router-link
          :to="{ name: 'cliente', params: { id: item.id } }"
          class="customer-link font-weight-medium"
          @click.stop
        >
          {{ item.fullName }}
        </router-link>
      </template>
      <template #[`item.petCount`]="{ item }">
        <div class="d-flex flex-wrap ga-1 py-1">
          <v-chip
            v-for="pet in splitVisiblePets(item.pets).visible"
            :key="pet.id"
            :prepend-icon="speciesIcon(pet.species)"
            size="small"
            variant="tonal"
          >
            {{ pet.name }}
          </v-chip>
          <v-chip
            v-if="splitVisiblePets(item.pets).hiddenCount > 0"
            size="small"
            variant="outlined"
          >
            +{{ splitVisiblePets(item.pets).hiddenCount }} más
          </v-chip>
          <span v-if="item.pets.length === 0" class="text-medium-emphasis">—</span>
        </div>
      </template>
      <template #[`item.actions`]="{ item }">
        <IconButton
          icon="mdi-pencil"
          color="primary"
          variant="text"
          size="small"
          aria-label="Editar cliente"
          @click.stop="openEditCustomer(item)"
        />
        <IconButton
          icon="mdi-delete"
          color="error"
          variant="text"
          size="small"
          aria-label="Eliminar cliente"
          @click.stop="askDelete(item)"
        />
      </template>
    </v-data-table>

    <CustomerEditDialog
      v-model="showFormDialog"
      :tenant-id="session.activeTenantId ?? ''"
      :customer-id="editingCustomerId"
      @saved="handleSaved"
      @changed="handleSaved"
    />
    <CustomerWithPetDialog
      v-model="showNewCustomerDialog"
      :tenant-id="session.activeTenantId ?? ''"
      @saved="handleCustomerCreated"
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

<style scoped lang="scss">
:deep(.customer-row) {
  cursor: pointer;
}

.customer-link {
  color: inherit;
  text-decoration: none;

  &:hover,
  &:focus-visible {
    text-decoration: underline;
  }
}
</style>
