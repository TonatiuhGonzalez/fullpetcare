<script setup lang="ts">
// Sección "Cuenta" de la configuración (tarea #1959). Aquí viven, sin cambiar
// su funcionamiento, los dos botones que antes estaban en la barra: cambiar la
// contraseña (todos los roles) y cancelar la cuenta (solo el dueño).
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

import CancelAccountDialog from '@/components/CancelAccountDialog.vue'
import ChangePasswordDialog from '@/components/ChangePasswordDialog.vue'
import PageHeader from '@/components/PageHeader.vue'
import { initialsOf } from '@/lib/initials'
import { LOGO_ACCEPT, logoFileProblem } from '@/lib/tenantLogo'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const businessName = computed(() => session.activeMembership?.tenantName ?? '')

// Imagen de la empresa (fase 26): solo el dueño la sube, cambia o quita. Se muestra en el
// selector de negocio del menú, en lugar de las iniciales.
const fileInput = ref<HTMLInputElement | null>(null)
const logoSaving = ref(false)
const logoError = ref<string | null>(null)
const logoNotice = ref<string | null>(null)
const logoShowNotice = ref(false)
// Si la URL firmada falla al cargar (caducó, archivo borrado), se vuelve a las iniciales.
const logoBroken = ref(false)
const hasLogo = computed(() => !!session.activeMembership?.logoPath)

function pickLogo(): void {
  fileInput.value?.click()
}

async function handleLogoChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  // Se vacía el input para poder elegir el mismo archivo otra vez después de un error.
  input.value = ''
  if (!file) return

  logoError.value = logoFileProblem(file)
  if (logoError.value) return

  logoSaving.value = true
  try {
    await session.changeLogo(file)
    logoBroken.value = false
    logoNotice.value = 'Imagen actualizada.'
    logoShowNotice.value = true
  } catch {
    logoError.value = 'No se pudo guardar la imagen. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    logoSaving.value = false
  }
}

async function handleLogoRemove(): Promise<void> {
  logoError.value = null
  logoSaving.value = true
  try {
    await session.removeLogo()
    logoNotice.value = 'Imagen quitada.'
    logoShowNotice.value = true
  } catch {
    logoError.value = 'No se pudo quitar la imagen. Revisa tu conexión e inténtalo de nuevo.'
  } finally {
    logoSaving.value = false
  }
}

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

    <v-list lines="two" class="border rounded account-list">
      <v-list-item
        v-if="session.role === 'owner'"
        title="Imagen de la empresa"
        subtitle="Se muestra junto al nombre del negocio en el menú. JPG, PNG o WebP, hasta 2 MB."
      >
        <template #prepend>
          <v-avatar rounded="lg" size="40" color="primary">
            <v-img
              v-if="session.activeLogoUrl && !logoBroken"
              :src="session.activeLogoUrl"
              :alt="`Imagen de ${businessName}`"
              @error="logoBroken = true"
            />
            <span v-else class="text-subtitle-1 font-weight-bold">{{ initialsOf(businessName) }}</span>
          </v-avatar>
        </template>
        <template #append>
          <input
            ref="fileInput"
            type="file"
            :accept="LOGO_ACCEPT"
            class="d-none"
            aria-label="Elegir imagen de la empresa"
            @change="handleLogoChosen"
          />
          <v-btn variant="text" :loading="logoSaving" @click="pickLogo">
            {{ hasLogo ? 'Cambiar' : 'Subir' }}
          </v-btn>
          <v-btn
            v-if="hasLogo"
            variant="text"
            color="error"
            :disabled="logoSaving"
            @click="handleLogoRemove"
          >
            Quitar
          </v-btn>
        </template>
      </v-list-item>

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

    <v-alert v-if="logoError" type="error" variant="tonal" density="compact" class="mt-4">
      {{ logoError }}
    </v-alert>

    <v-snackbar v-model="logoShowNotice" color="success" :timeout="3000">
      {{ logoNotice }}
    </v-snackbar>

    <v-snackbar v-model="passwordChangedNotice" color="success" :timeout="4000">
      Contraseña actualizada.
    </v-snackbar>
  </div>
</template>

<style scoped lang="scss">
// En pantallas angostas el título y la descripción se cortaban con "…" y el botón quedaba
// pegado al texto: se deja que el texto baje de línea.
.account-list :deep(.v-list-item-title) {
  white-space: normal;
}

.account-list :deep(.v-list-item-subtitle) {
  display: block;
  white-space: normal;
  -webkit-line-clamp: unset;
}
</style>

