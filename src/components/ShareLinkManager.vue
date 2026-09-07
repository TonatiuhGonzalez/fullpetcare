<script setup lang="ts">
// Generar y administrar links públicos de una mascota (tarea 7.14).
// Componente "tonto" en el sentido de CLAUDE.md §4 (no importa
// supabase.ts), pero SÍ importa services/shareLinks.ts directo — mismo
// patrón que CustomerFormDialog.vue con services/customers.ts: un
// componente de una sola pantalla no necesita un store aparte para esto.
import { computed, onMounted, ref } from 'vue'

import * as shareLinksService from '@/services/shareLinks'
import type { ShareLink } from '@/services/shareLinks'
import { formatDate } from '@/lib/datetime'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{ tenantId: string; petId: string }>()

const session = useSessionStore()

const links = ref<ShareLink[]>([])
const generating = ref(false)
const errorMessage = ref<string | null>(null)
// El token en claro SOLO vive aquí, en memoria, mientras dura esta
// visita a la página — nunca se guarda (services/shareLinks.ts ya
// explica por qué). Si la página se recarga, se pierde, y no hay forma
// de volver a verlo: hay que generar uno nuevo.
const newToken = ref<string | null>(null)
const copied = ref(false)

const publicUrl = computed(() =>
  newToken.value ? `${window.location.origin}/c/${newToken.value}` : null,
)

// Un link no tiene sucursal propia (igual que una vacunación, fase 6) —
// se muestra en la de la sesión activa, mismo criterio que
// PetDetailPage.vue usa para el resto de la ficha.
const displayTimezone = computed(() => session.activeBranch?.timezone ?? 'America/Mexico_City')

async function load(): Promise<void> {
  links.value = await shareLinksService.listByPet(props.tenantId, props.petId)
}

onMounted(load)

function isActive(link: ShareLink): boolean {
  return !link.revoked_at && new Date(link.expires_at) > new Date()
}

function linkStatusLabel(link: ShareLink): string {
  if (link.revoked_at) return 'Revocado'
  if (new Date(link.expires_at) <= new Date()) return 'Vencido'
  return 'Activo'
}

async function handleGenerate(): Promise<void> {
  if (!session.user) return
  generating.value = true
  errorMessage.value = null
  copied.value = false
  try {
    const { token } = await shareLinksService.createForPet(
      props.tenantId,
      props.petId,
      session.user.id,
    )
    newToken.value = token
    await load()
  } catch {
    errorMessage.value = 'No se pudo generar el link. Revisa tu conexión.'
  } finally {
    generating.value = false
  }
}

async function handleCopy(): Promise<void> {
  if (!publicUrl.value) return
  await navigator.clipboard.writeText(publicUrl.value)
  copied.value = true
}

async function handleRevoke(id: string): Promise<void> {
  errorMessage.value = null
  try {
    await shareLinksService.revoke(id)
    await load()
  } catch {
    errorMessage.value = 'No se pudo revocar el link. Revisa tu conexión.'
  }
}
</script>

<template>
  <v-card class="pa-4">
    <p class="text-subtitle-1 mb-2">Compartir con el cliente</p>

    <v-alert v-if="errorMessage" type="error" density="compact" variant="tonal" class="mb-3">
      {{ errorMessage }}
    </v-alert>

    <div v-if="newToken" class="mb-3">
      <v-alert type="success" density="compact" variant="tonal" class="mb-2">
        Copia este link ahora — por seguridad, no se vuelve a mostrar.
      </v-alert>
      <v-text-field :model-value="publicUrl" readonly density="compact" variant="outlined" hide-details>
        <template #append-inner>
          <v-btn size="small" variant="text" @click="handleCopy">
            {{ copied ? 'Copiado' : 'Copiar' }}
          </v-btn>
        </template>
      </v-text-field>
    </div>

    <v-btn
      color="primary"
      variant="tonal"
      prepend-icon="mdi-share-variant"
      :loading="generating"
      @click="handleGenerate"
    >
      Generar link
    </v-btn>

    <v-list v-if="links.length > 0" density="compact" class="mt-3">
      <v-list-item v-for="link in links" :key="link.id">
        <template #title>{{ link.token_prefix }}…</template>
        <template #subtitle>
          {{ linkStatusLabel(link) }} · vence {{ formatDate(link.expires_at, displayTimezone) }}
        </template>
        <template #append>
          <v-btn
            v-if="isActive(link)"
            size="small"
            variant="text"
            color="error"
            @click="handleRevoke(link.id)"
          >
            Revocar
          </v-btn>
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
