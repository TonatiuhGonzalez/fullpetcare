<script setup lang="ts">
// Tablero de hospitalización (fase 33, PLAN.md D30 punto 10): las mascotas hospitalizadas hoy
// en la sucursal activa, con su espacio, sus días y lo que va costando, y las estancias dadas
// de alta que faltan por cobrar. Lo ven dueño, recepción y veterinario; el groomer no.
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import AdmitPetDialog from '@/components/AdmitPetDialog.vue'
import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import PageSkeleton from '@/components/PageSkeleton.vue'
import { useFirstLoad } from '@/composables/useFirstLoad'
import { formatDate } from '@/lib/datetime'
import { stayCharge, type DayRule, type RateMode } from '@/lib/hospitalization'
import { formatMXN } from '@/lib/money'
import { speciesIcon } from '@/lib/customerPets'
import * as hospitalService from '@/services/hospitalization'
import type {
  HospitalSettings,
  HospitalSpace,
  StayListItem,
} from '@/services/hospitalization'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const router = useRouter()

const open = ref<StayListItem[]>([])
const pending = ref<StayListItem[]>([])
const spaces = ref<HospitalSpace[]>([])
const settings = ref<HospitalSettings | null>(null)
const loading = ref(false)
const { isFirstLoad, showSkeleton } = useFirstLoad(loading)
const errorMessage = ref<string | null>(null)
const showAdmit = ref(false)

const timezone = computed(() => session.activeBranch?.timezone ?? 'America/Mexico_City')
const hasSpaces = computed(() => spaces.value.some((s) => s.is_active))

async function load(): Promise<void> {
  const tenantId = session.activeTenantId
  const branchId = session.activeBranchId
  if (!tenantId || !branchId) return
  loading.value = true
  errorMessage.value = null
  try {
    ;[open.value, pending.value, spaces.value, settings.value] = await Promise.all([
      hospitalService.listOpen(tenantId, branchId),
      hospitalService.listPendingBilling(tenantId, branchId),
      hospitalService.listSpaces(tenantId, branchId),
      hospitalService.getSettings(tenantId),
    ])
  } catch {
    errorMessage.value = 'No se pudo cargar la hospitalización. Revisa tu conexión.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
// Cambiar de sucursal cambia qué mascotas y espacios se ven.
watch(() => session.activeBranchId, load)

function costSoFar(stay: StayListItem): { days: number; amountCents: number } {
  return stayCharge(
    {
      rateMode: stay.rate_mode as RateMode,
      rateCents: stay.rate_cents,
      dayRule: stay.day_rule as DayRule,
    },
    new Date(stay.admitted_at),
    new Date(),
    timezone.value,
  )
}

function openStay(id: string): void {
  router.push({ name: 'hospitalizacion-estancia', params: { id } })
}

function handleAdmitted(stayId: string): void {
  openStay(stayId)
}
</script>

<template>
  <v-container class="py-6">
    <PageHeader
      title="Hospitalización"
      subtitle="Mascotas hospitalizadas hoy en esta sucursal."
    >
      <template #actions>
        <v-btn
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="!hasSpaces"
          @click="showAdmit = true"
        >
          Ingresar mascota
        </v-btn>
      </template>
    </PageHeader>

    <v-alert
      v-if="errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ errorMessage }}
    </v-alert>

    <v-alert
      v-if="!isFirstLoad && !hasSpaces"
      type="info"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      Esta sucursal todavía no tiene espacios.
      <template v-if="session.role === 'owner'">
        Créalos en
        <router-link to="/app/configuracion/hospitalizacion"
          >Configuración → Hospitalización</router-link
        >.
      </template>
      <template v-else>Pídele al dueño que los cree en Configuración.</template>
    </v-alert>

    <PageSkeleton v-if="isFirstLoad && showSkeleton" :blocks="2" />

    <template v-else-if="!isFirstLoad">
      <EmptyState
        v-if="open.length === 0"
        compact
        illustration="customers"
        title="Sin mascotas hospitalizadas"
        message="Cuando ingreses una mascota aparecerá aquí con su espacio y lo que va costando."
      />

      <v-row v-else>
        <v-col v-for="stay in open" :key="stay.id" cols="12" sm="6" md="4">
          <v-card
            variant="outlined"
            class="pa-4 h-100 hospital-card"
            role="button"
            tabindex="0"
            :data-testid="`stay-${stay.id}`"
            @click="openStay(stay.id)"
            @keydown.enter.prevent="openStay(stay.id)"
          >
            <div class="d-flex align-center ga-3 mb-2">
              <v-avatar color="primary" size="40">
                <v-icon :icon="speciesIcon(stay.petSpecies)" />
              </v-avatar>
              <div class="flex-grow-1 text-truncate">
                <div class="text-subtitle-1 font-weight-bold text-truncate">
                  {{ stay.petName }}
                </div>
                <div class="text-caption text-medium-emphasis text-truncate">
                  {{ stay.ownerName }}
                </div>
              </div>
            </div>
            <v-chip
              size="small"
              variant="tonal"
              prepend-icon="mdi-home-variant-outline"
              class="mb-2"
            >
              {{ stay.spaceName }}
            </v-chip>
            <div class="text-body-2">
              Ingresó {{ formatDate(stay.admitted_at, timezone) }}
            </div>
            <div class="text-body-2 text-medium-emphasis">
              {{ costSoFar(stay).days }}
              {{ costSoFar(stay).days === 1 ? 'día' : 'días' }} · va en
              {{ formatMXN(costSoFar(stay).amountCents) }}
            </div>
            <p v-if="stay.reason" class="text-caption mt-2 mb-0 text-truncate">
              {{ stay.reason }}
            </p>
          </v-card>
        </v-col>
      </v-row>

      <template v-if="pending.length > 0">
        <h2 class="text-subtitle-1 font-weight-bold mt-6 mb-2">Por cobrar</h2>
        <v-list density="compact" class="border rounded">
          <v-list-item
            v-for="stay in pending"
            :key="stay.id"
            :title="`${stay.petName} · ${stay.ownerName}`"
            :subtitle="`Alta: ${stay.discharged_at ? formatDate(stay.discharged_at, timezone) : ''}`"
            @click="openStay(stay.id)"
          >
            <template #append>
              <v-chip size="small" color="warning" variant="tonal">Por cobrar</v-chip>
            </template>
          </v-list-item>
        </v-list>
      </template>
    </template>

    <AdmitPetDialog
      v-model="showAdmit"
      :tenant-id="session.activeTenantId ?? ''"
      :branch-id="session.activeBranchId ?? ''"
      :spaces="spaces"
      :settings="settings"
      @admitted="handleAdmitted"
    />
  </v-container>
</template>

<style scoped lang="scss">
.hospital-card {
  cursor: pointer;
}
</style>
