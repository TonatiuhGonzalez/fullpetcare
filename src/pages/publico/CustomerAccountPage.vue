<script setup lang="ts">
// Cuenta del dueño de la mascota (fase 16B, PLAN.md D31): entra con un código que le llega al
// correo, ve sus mascotas y, de cada una, cartilla, historial y bitácora de hospitalización.
// Todo viene de la Edge Function `customer-account`; aquí solo se presenta.
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { formatDate, formatDateOnly } from '@/lib/datetime'
import { speciesLabel } from '@/lib/petLabels'
import { formatMXN } from '@/lib/money'
import { useCustomerAccountStore } from '@/stores/customerAccount'

const store = useCustomerAccountStore()
const route = useRoute()
const router = useRouter()

// El link de la mascota (si viene de "Guardar en mi cuenta") para vincularla al entrar.
const linkToken = computed(() =>
  typeof route.query.link === 'string' ? route.query.link : null,
)
const petId = computed(() =>
  typeof route.query.pet === 'string' ? route.query.pet : null,
)

const email = ref('')
const code = ref('')
const codeSent = ref(false)
const busy = ref(false)
const confirmingDelete = ref(false)

async function sendCode(): Promise<void> {
  if (!email.value.trim()) return
  busy.value = true
  codeSent.value = await store.sendCode(email.value, linkToken.value)
  busy.value = false
}

async function signIn(): Promise<void> {
  busy.value = true
  const ok = await store.signIn(email.value, code.value, linkToken.value)
  busy.value = false
  if (ok) {
    // Se quita el link de la dirección: ya cumplió su función.
    await router.replace({ query: petId.value ? { pet: petId.value } : {} })
    await refresh()
  }
}

async function refresh(): Promise<void> {
  await store.loadBusinesses()
  if (petId.value) await store.loadPetDetail(petId.value)
}

async function openPet(id: string): Promise<void> {
  await router.replace({ query: { pet: id } })
  await store.loadPetDetail(id)
}

async function back(): Promise<void> {
  store.detail = null
  await router.replace({ query: {} })
}

async function signOut(): Promise<void> {
  await store.signOut()
  codeSent.value = false
  code.value = ''
}

async function removeAccount(): Promise<void> {
  if (await store.deleteMyAccount()) {
    confirmingDelete.value = false
    codeSent.value = false
  }
}

onMounted(async () => {
  await store.restore()
  if (store.isSignedIn) {
    if (linkToken.value) {
      // Ya hay sesión y llegó con un link: se vincula sin pedir otro código.
      const { claimLink } = await import('@/services/customerAccount')
      try {
        await claimLink(linkToken.value)
      } catch {
        store.errorMessage = 'Este link no es válido o ya venció.'
      }
      await router.replace({ query: {} })
    }
    await refresh()
  }
})
</script>

<template>
  <v-container class="py-4" max-width="480">
    <!-- 1. Acceso por código -->
    <v-card v-if="!store.isSignedIn" class="pa-5">
      <h1 class="text-h6 font-weight-bold mb-1">Mi cuenta</h1>
      <p class="text-body-2 text-medium-emphasis mb-4">
        Escribe tu correo y te enviamos un código para entrar. No necesitas contraseña.
      </p>
      <v-alert v-if="store.errorMessage" type="warning" variant="tonal" class="mb-3">
        {{ store.errorMessage }}
      </v-alert>
      <v-form v-if="!codeSent" @submit.prevent="sendCode">
        <v-text-field
          v-model="email"
          label="Correo*"
          type="email"
          autocomplete="email"
          :rules="[(v: string) => !!v?.trim() || 'Escribe tu correo']"
        />
        <v-btn type="submit" color="primary" block :loading="busy">Enviar código</v-btn>
      </v-form>
      <v-form v-else @submit.prevent="signIn">
        <v-alert type="info" variant="tonal" class="mb-3">
          Si el correo tiene cuenta, te llegó un código de 6 dígitos.
        </v-alert>
        <v-text-field
          v-model="code"
          label="Código*"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
        />
        <v-btn type="submit" color="primary" block :loading="busy">Entrar</v-btn>
        <v-btn variant="text" block class="mt-2" @click="codeSent = false"
          >Cambiar correo</v-btn
        >
      </v-form>
    </v-card>

    <!-- 2. Detalle de una mascota -->
    <template v-else-if="store.detail">
      <v-btn variant="text" prepend-icon="mdi-arrow-left" class="mb-2" @click="back">
        Mis mascotas
      </v-btn>
      <v-card class="pa-4 mb-4">
        <h1 class="text-h5 font-weight-bold">{{ store.detail.pet.name }}</h1>
        <p class="text-body-2 text-medium-emphasis">
          {{ speciesLabel(store.detail.pet.species) }}
          <template v-if="store.detail.pet.breed">
            · {{ store.detail.pet.breed }}</template
          >
          · {{ store.detail.business_name }}
        </p>
      </v-card>

      <v-card v-if="store.detail.upcoming.length" class="pa-4 mb-4">
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Próximas citas</h2>
        <div v-for="(a, i) in store.detail.upcoming" :key="i" class="text-body-2">
          {{ formatDate(a.starts_at, a.branch_timezone) }} · {{ a.branch_name }}
        </div>
      </v-card>

      <v-card class="pa-4 mb-4">
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Cartilla de vacunación</h2>
        <p
          v-if="!store.detail.vaccinations.length"
          class="text-body-2 text-medium-emphasis"
        >
          Aún no hay vacunas registradas.
        </p>
        <div
          v-for="(v, i) in store.detail.vaccinations"
          :key="i"
          class="text-body-2 mb-1"
        >
          <strong>{{ v.vaccine_name }}</strong> · aplicada el
          {{ formatDateOnly(v.applied_at) }}
          <template v-if="v.next_due_date">
            · próxima: {{ formatDateOnly(v.next_due_date) }}
          </template>
        </div>
      </v-card>

      <v-card class="pa-4 mb-4">
        <h2 class="text-subtitle-1 font-weight-bold mb-2">Historial de visitas</h2>
        <p v-if="!store.detail.visits.length" class="text-body-2 text-medium-emphasis">
          Aún no hay visitas registradas.
        </p>
        <div v-for="(v, i) in store.detail.visits" :key="i" class="text-body-2 mb-2">
          <strong>{{ formatDate(v.starts_at, v.branch_timezone) }}</strong>
          · {{ v.kind === 'grooming' ? 'Estética' : 'Veterinaria' }}
          <div v-if="v.detail" class="text-medium-emphasis">{{ v.detail }}</div>
        </div>
      </v-card>

      <v-card v-for="(stay, i) in store.detail.hospital_stays" :key="i" class="pa-4 mb-4">
        <h2 class="text-subtitle-1 font-weight-bold mb-1">Hospitalización</h2>
        <p class="text-body-2 text-medium-emphasis mb-2">
          Ingresó el {{ formatDate(stay.admitted_at, stay.branch_timezone) }}
          <template v-if="stay.discharged_at">
            · alta el {{ formatDate(stay.discharged_at, stay.branch_timezone) }}
          </template>
          <template v-else> · sigue hospitalizada</template>
        </p>
        <p v-if="stay.cost_cents !== null" class="text-body-2 mb-2">
          Costo estimado: {{ formatMXN(stay.cost_cents) }}
        </p>
        <div v-for="(n, j) in stay.notes" :key="j" class="text-body-2 mb-2">
          <strong>{{ formatDate(n.noted_at, stay.branch_timezone) }}</strong>
          <div v-if="n.content">{{ n.content }}</div>
          <div v-if="n.temperature_deci_c !== null" class="text-medium-emphasis">
            Temperatura: {{ (n.temperature_deci_c / 10).toFixed(1) }} °C
          </div>
        </div>
        <div v-if="stay.medications.length" class="text-body-2">
          <strong>Medicamentos</strong>
          <div v-for="(m, j) in stay.medications" :key="j">
            {{ m.name }} · {{ formatDate(m.administered_at, stay.branch_timezone) }}
          </div>
        </div>
      </v-card>
    </template>

    <!-- 3. Mis mascotas -->
    <template v-else>
      <div class="d-flex align-center mb-3">
        <h1 class="text-h6 font-weight-bold flex-grow-1">Mis mascotas</h1>
        <v-btn variant="text" size="small" @click="signOut">Salir</v-btn>
      </div>
      <v-alert v-if="store.errorMessage" type="warning" variant="tonal" class="mb-3">
        {{ store.errorMessage }}
      </v-alert>
      <v-card v-if="!store.loading && !store.businesses.length" class="pa-5 text-center">
        <p class="text-body-2">
          Todavía no tienes mascotas vinculadas. Pídele a tu veterinaria su link de la
          mascota y ábrelo para guardarla aquí.
        </p>
      </v-card>
      <v-card v-for="b in store.businesses" :key="b.tenant_id" class="pa-4 mb-4">
        <h2 class="text-subtitle-1 font-weight-bold mb-2">{{ b.business_name }}</h2>
        <v-list class="pa-0">
          <v-list-item
            v-for="p in b.pets"
            :key="p.id"
            :title="p.name"
            :subtitle="speciesLabel(p.species)"
            @click="openPet(p.id)"
          />
        </v-list>
        <div v-if="b.upcoming.length" class="text-body-2 mt-3">
          <strong>Próxima cita:</strong>
          {{ b.upcoming[0].pet_name }} ·
          {{ formatDate(b.upcoming[0].starts_at, b.upcoming[0].branch_timezone) }}
        </div>
      </v-card>
      <v-btn
        v-if="store.businesses.length || !store.loading"
        variant="text"
        color="error"
        size="small"
        @click="confirmingDelete = true"
      >
        Eliminar mi cuenta
      </v-btn>
    </template>

    <v-dialog v-model="confirmingDelete" max-width="400">
      <v-card class="pa-4">
        <h2 class="text-h6 mb-2">¿Eliminar tu cuenta?</h2>
        <p class="text-body-2 mb-4">
          Dejarás de ver a tus mascotas aquí. El expediente de tu veterinaria no se borra.
        </p>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="confirmingDelete = false">Cancelar</v-btn>
          <v-btn color="error" @click="removeAccount">Eliminar</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </v-container>
</template>
