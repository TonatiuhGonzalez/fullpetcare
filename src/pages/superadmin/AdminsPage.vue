<script setup lang="ts">
// Superadmins de plataforma (fase 10): lista, alta y baja. Todos tienen los
// mismos permisos (decisión de la fase). La base impide quitar al último.
import { computed, onMounted, ref } from 'vue'

import * as platformService from '@/services/platform'
import type { PlatformAdminUser } from '@/services/platform'
import { formatPlatformDate } from '@/lib/platform'
import { useSessionStore } from '@/stores/session'
import AdminFormDialog from '@/components/AdminFormDialog.vue'
import TemporaryPasswordDialog from '@/components/TemporaryPasswordDialog.vue'

const session = useSessionStore()

const admins = ref<PlatformAdminUser[]>([])
const loading = ref(false)
const errorMessage = ref<string | null>(null)

const headers = [
  { title: 'Nombre', key: 'displayName' },
  { title: 'Correo', key: 'email' },
  { title: 'Desde', key: 'since' },
  { title: '', key: 'actions', sortable: false, align: 'end' as const },
]

interface AdminRow extends PlatformAdminUser {
  displayName: string
  since: string
  isMe: boolean
}

// Tipo de retorno anotado a mano: mismo motivo que EmployeesPage.vue (evita
// "Type instantiation is excessively deep" con v-data-table).
const rows = computed<AdminRow[]>(() =>
  admins.value.map((admin) => ({
    ...admin,
    displayName: admin.fullName ?? '—',
    since: formatPlatformDate(admin.createdAt),
    isMe: admin.userId === session.user?.id,
  })),
)

async function load(): Promise<void> {
  loading.value = true
  errorMessage.value = null
  try {
    admins.value = await platformService.listAdmins()
  } catch (e) {
    errorMessage.value =
      e instanceof Error ? e.message : 'No se pudo cargar la lista de superadmins.'
  } finally {
    loading.value = false
  }
}

onMounted(load)

// --- Alta -------------------------------------------------------------------
const showFormDialog = ref(false)
const revealed = ref<{ email: string; password: string } | null>(null)
const passwordDialogOpen = ref(false)

function handleCreated(result: { email: string; temporaryPassword: string }): void {
  revealed.value = { email: result.email, password: result.temporaryPassword }
  passwordDialogOpen.value = true
  load()
}

function handlePasswordDialogToggle(open: boolean): void {
  passwordDialogOpen.value = open
  // La contraseña deja de existir en memoria al cerrar el diálogo.
  if (!open) revealed.value = null
}

// --- Baja -------------------------------------------------------------------
const adminToRemove = ref<AdminRow | null>(null)
const confirmRemoveOpen = ref(false)
const removing = ref(false)
const removeError = ref<string | null>(null)

function askRemove(admin: AdminRow): void {
  adminToRemove.value = admin
  removeError.value = null
  confirmRemoveOpen.value = true
}

async function confirmRemove(): Promise<void> {
  if (!adminToRemove.value) return
  removing.value = true
  removeError.value = null
  try {
    await platformService.removeAdmin(adminToRemove.value.userId)
    confirmRemoveOpen.value = false
    await load()
  } catch (e) {
    // Aquí llega, en español, "No se puede quitar al único superadmin."
    removeError.value = e instanceof Error ? e.message : 'No se pudo quitar al superadmin.'
  } finally {
    removing.value = false
  }
}
</script>

<template>
  <v-container class="py-6">
    <div class="d-flex align-center mb-4">
      <h1 class="text-h5">Superadmins</h1>
      <v-spacer />
      <v-btn color="primary" prepend-icon="mdi-plus" @click="showFormDialog = true">
        Agregar superadmin
      </v-btn>
    </div>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-4">
      {{ errorMessage }}
    </v-alert>

    <v-data-table
      :headers="headers"
      :items="rows"
      :loading="loading"
      no-data-text="No hay superadmins registrados."
      loading-text="Cargando superadmins…"
    >
      <template #[`item.displayName`]="{ item }">
        {{ item.displayName }}
        <v-chip v-if="item.isMe" size="x-small" class="ml-2" variant="tonal">Tú</v-chip>
      </template>
      <template #[`item.actions`]="{ item }">
        <v-btn
          icon="mdi-account-remove-outline"
          variant="text"
          size="small"
          title="Quitar superadmin"
          @click="askRemove(item)"
        />
      </template>
    </v-data-table>

    <AdminFormDialog v-model="showFormDialog" @created="handleCreated" />

    <TemporaryPasswordDialog
      :model-value="passwordDialogOpen"
      title="Superadmin agregado"
      :email="revealed?.email ?? null"
      :password="revealed?.password ?? ''"
      @update:model-value="handlePasswordDialogToggle"
    />

    <v-dialog v-model="confirmRemoveOpen" max-width="440">
      <v-card>
        <v-card-title>Quitar superadmin</v-card-title>
        <v-card-text>
          <p>
            <strong>{{ adminToRemove?.displayName }}</strong> ({{ adminToRemove?.email }}) dejará
            de poder administrar la plataforma.
          </p>
          <v-alert v-if="removeError" type="error" density="compact" variant="tonal" class="mt-3">
            {{ removeError }}
          </v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="removing" @click="confirmRemoveOpen = false">
            Cancelar
          </v-btn>
          <v-btn color="error" :loading="removing" @click="confirmRemove">Quitar</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-container>
</template>
