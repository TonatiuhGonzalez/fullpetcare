<script setup lang="ts">
// Sección "Cuenta" de la configuración (tarea #1959). Aquí viven, sin cambiar
// su funcionamiento, los dos botones que antes estaban en la barra: cambiar la
// contraseña (todos los roles) y cancelar la cuenta (solo el dueño).
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import CancelAccountDialog from '@/components/CancelAccountDialog.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import PageHeader from '@/components/PageHeader.vue'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const businessName = computed(() => session.activeMembership?.tenantName ?? '')

const showChangePassword = ref(false)
const passwordChangedNotice = ref(false)

// Cancelar la cuenta: solo el dueño.
const showCancel = ref(false)
const cancelSaving = ref(false)
const cancelError = ref<string | null>(null)

async function handleCancelAccount(comment: string): Promise<void> {
  cancelSaving.value = true
  cancelError.value = null
  try {
    await session.cancelActiveTenant(comment || null)
    showCancel.value = false
    await router.push('/login')
  } catch {
    cancelError.value = 'No se pudo cancelar la cuenta. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    cancelSaving.value = false
  }
}
</script>

<template>
  <div>
    <PageHeader title="Cuenta" />

    <v-list lines="two" class="border rounded">
      <v-list-item
        prepend-icon="mdi-lock-reset"
        title="Cambiar contraseña"
        subtitle="Cierra tus demás sesiones al cambiarla."
      >
        <template #append>
          <v-btn variant="text" @click="showChangePassword = true">Cambiar</v-btn>
        </template>
      </v-list-item>

      <v-list-item
        v-if="session.role === 'owner'"
        prepend-icon="mdi-account-cancel-outline"
        title="Cancelar mi cuenta"
        subtitle="Da de baja tu negocio. Solo el equipo de la plataforma puede reactivarlo."
      >
        <template #append>
          <v-btn variant="text" color="error" @click="showCancel = true">Cancelar cuenta</v-btn>
        </template>
      </v-list-item>
    </v-list>

    <ChangePasswordDialog
      v-model="showChangePassword"
      :email="session.user?.email ?? ''"
      @changed="passwordChangedNotice = true"
    />

    <CancelAccountDialog
      v-model="showCancel"
      :tenant-name="businessName"
      :saving="cancelSaving"
      :error-message="cancelError"
      @confirm="handleCancelAccount"
    />

    <v-snackbar v-model="passwordChangedNotice" color="success" :timeout="4000">
      Contraseña actualizada.
    </v-snackbar>
  </div>
</template>
