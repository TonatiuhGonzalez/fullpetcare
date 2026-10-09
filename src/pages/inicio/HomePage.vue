<script setup lang="ts">
// Inicio (fase 15, PLAN.md D20 punto 8): la pantalla de entrada. Resume el día de la
// sucursal activa y da accesos rápidos a lo que más se hace. Cada bloque aparece solo
// si el rol o el permiso de la persona lo permite:
//   - Todos: citas de hoy (groomer y vet solo ven las suyas, lo decide la base).
//   - Dueño y recepción: accesos rápidos y "por cobrar".
//   - Con permiso Caja: estado de la caja. Con permiso Reportes: ventas de hoy.
import { computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'

import EmptyState from '@/components/EmptyState.vue'
import PageHeader from '@/components/PageHeader.vue'
import VisitKindChip from '@/components/VisitKindChip.vue'
import { formatTime, formatWeekdayDate } from '@/lib/datetime'
import { formatMXN } from '@/lib/money'
import { isFrontDesk } from '@/lib/roles'
import { useHomeStore } from '@/stores/home'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
const home = useHomeStore()
const router = useRouter()

const timezone = computed(() => session.activeBranch?.timezone ?? 'America/Mexico_City')
const frontDesk = computed(() => isFrontDesk(session.role))
const showCash = computed(() => session.canView('cash_register'))
const showSales = computed(() => session.canView('reports'))

const firstName = computed(() => (session.profile?.fullName ?? '').split(/\s+/)[0] ?? '')
const subtitle = computed(() => {
  const date = formatWeekdayDate(new Date(), timezone.value)
  return firstName.value ? `Hola, ${firstName.value} · ${date}` : date
})

const loading = computed(() => home.status === 'idle' || home.status === 'loading')

onMounted(() => home.load())
// Cambiar de sucursal desde el menú lateral cambia de qué sucursal es el resumen.
watch(
  () => session.activeBranchId,
  () => home.load(),
)

// Los diálogos de agendar viven en la Agenda: se va allí pidiéndole que abra el que toca.
function goToAgenda(action: 'nueva-cita' | 'llegada-sin-cita'): void {
  router.push({ name: 'agenda', query: { accion: action } })
}

// "Cobrar" y "Atender" sirven al mismo rol que ya podía hacerlo desde la Agenda.
const pendingShown = computed(() => home.pending.slice(0, 5))
</script>

<template>
  <v-container class="py-6">
    <PageHeader title="Inicio" :subtitle="subtitle">
      <template v-if="frontDesk" #actions>
        <v-btn color="primary" prepend-icon="mdi-plus" @click="goToAgenda('nueva-cita')">
          Nueva cita
        </v-btn>
        <v-btn
          variant="outlined"
          color="primary"
          prepend-icon="mdi-walk"
          @click="goToAgenda('llegada-sin-cita')"
        >
          Llegada sin cita
        </v-btn>
        <v-btn
          variant="outlined"
          color="primary"
          prepend-icon="mdi-cash-register"
          to="/app/venta-mostrador"
        >
          Venta de mostrador
        </v-btn>
      </template>
    </PageHeader>

    <v-alert
      v-if="home.errorMessage"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-4"
    >
      {{ home.errorMessage }}
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-row v-else-if="home.status === 'ready'">
      <!-- Citas de hoy: para todos los roles. -->
      <v-col cols="12" md="6">
        <v-card class="h-100">
          <v-card-text>
            <h2 class="text-subtitle-1 font-weight-bold mb-3">Citas de hoy</h2>

            <div v-if="home.summary.total > 0" class="d-flex align-baseline ga-3 mb-2">
              <span class="text-h3 font-weight-bold tabular" data-testid="today-total">
                {{ home.summary.total }}
              </span>
              <span class="text-body-2 text-medium-emphasis">
                {{ home.summary.total === 1 ? 'cita' : 'citas' }}
              </span>
            </div>

            <!-- Mismos colores de estado que la Agenda: en curso ámbar, atendida (por
                 cobrar) verde, cobrada verde azulado. -->
            <div v-if="home.summary.total > 0" class="d-flex flex-wrap ga-2 mb-3">
              <v-chip size="small" variant="tonal">
                {{ home.summary.scheduled }}
                {{ home.summary.scheduled === 1 ? 'agendada' : 'agendadas' }}
              </v-chip>
              <v-chip
                v-if="home.summary.inProgress > 0"
                size="small"
                variant="tonal"
                color="warning"
              >
                {{ home.summary.inProgress }} en curso
              </v-chip>
              <v-chip
                v-if="frontDesk && home.summary.awaitingPayment > 0"
                size="small"
                variant="tonal"
                color="success"
              >
                {{ home.summary.awaitingPayment }} por cobrar
              </v-chip>
              <v-chip
                v-if="home.summary.paid > 0"
                size="small"
                variant="tonal"
                color="primary"
              >
                {{ home.summary.paid }}
                {{ home.summary.paid === 1 ? 'cobrada' : 'cobradas' }}
              </v-chip>
            </div>

            <EmptyState
              v-if="home.summary.total === 0"
              compact
              illustration="calendar"
              title="No hay citas para hoy"
              message="Las citas del día aparecerán aquí."
            />

            <v-list v-else-if="home.upcoming.length > 0" density="compact" class="pa-0">
              <div class="text-caption text-medium-emphasis mb-1">Lo que sigue</div>
              <v-list-item
                v-for="appointment in home.upcoming"
                :key="appointment.id"
                :to="`/app/citas/${appointment.id}`"
                class="px-0"
              >
                <template #prepend>
                  <span class="text-body-2 font-weight-bold tabular mr-3">
                    {{ formatTime(appointment.starts_at, timezone) }}
                  </span>
                </template>
                <v-list-item-title>{{ appointment.petName }}</v-list-item-title>
                <v-list-item-subtitle>{{
                  appointment.customerName
                }}</v-list-item-subtitle>
                <template #append>
                  <VisitKindChip :kind="appointment.kind" size="x-small" />
                </template>
              </v-list-item>
            </v-list>
            <p v-else class="text-body-2 text-medium-emphasis">
              Ya no quedan citas pendientes por atender hoy.
            </p>
          </v-card-text>
          <v-card-actions>
            <v-btn
              variant="text"
              color="primary"
              to="/app/agenda"
              append-icon="mdi-arrow-right"
            >
              Ver la agenda
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Por cobrar: solo quien cobra. -->
      <v-col v-if="frontDesk" cols="12" md="6">
        <v-card class="h-100">
          <v-card-text>
            <h2 class="text-subtitle-1 font-weight-bold mb-3">Por cobrar</h2>

            <div class="d-flex align-baseline ga-3 mb-1">
              <span class="text-h3 font-weight-bold tabular" data-testid="pending-count">
                {{ home.pending.length }}
              </span>
              <span class="text-body-2 text-medium-emphasis">
                {{ home.pending.length === 1 ? 'cita atendida' : 'citas atendidas' }}
              </span>
            </div>
            <p v-if="home.pending.length > 0" class="text-body-2 mb-3">
              Total estimado:
              <strong class="tabular" data-testid="pending-total">{{
                formatMXN(home.pendingCents)
              }}</strong>
              <span class="text-medium-emphasis">
                (solo servicios; los productos se suman al cobrar)
              </span>
            </p>
            <p v-else class="text-body-2 text-medium-emphasis">
              No hay cobros pendientes de las citas de hoy.
            </p>

            <v-list v-if="pendingShown.length > 0" density="compact" class="pa-0">
              <v-list-item
                v-for="appointment in pendingShown"
                :key="appointment.id"
                class="px-0"
              >
                <v-list-item-title>{{ appointment.petName }}</v-list-item-title>
                <v-list-item-subtitle>{{
                  appointment.customerName
                }}</v-list-item-subtitle>
                <template #append>
                  <v-btn
                    size="small"
                    variant="tonal"
                    color="primary"
                    :to="`/app/citas/${appointment.id}/cobrar`"
                  >
                    Cobrar
                  </v-btn>
                </template>
              </v-list-item>
            </v-list>
            <p v-if="home.pending.length > pendingShown.length" class="text-caption mt-2">
              y {{ home.pending.length - pendingShown.length }} más en la agenda.
            </p>
          </v-card-text>
        </v-card>
      </v-col>

      <!-- Caja: solo con permiso. -->
      <v-col v-if="showCash" cols="12" md="6">
        <v-card class="h-100">
          <v-card-text>
            <h2 class="text-subtitle-1 font-weight-bold mb-3">Caja</h2>

            <p v-if="home.cashFailed" class="text-body-2 text-medium-emphasis">
              No se pudo cargar el estado de la caja.
            </p>
            <template v-else-if="home.cash">
              <v-chip size="small" variant="tonal" color="success" class="mb-3"
                >Abierta</v-chip
              >
              <p class="text-body-2 text-medium-emphasis">
                Desde las {{ formatTime(home.cash.openedAt, timezone) }}. Efectivo
                esperado:
              </p>
              <div class="text-h4 font-weight-bold tabular" data-testid="cash-expected">
                {{ formatMXN(home.cash.expectedCents) }}
              </div>
            </template>
            <template v-else-if="home.cash === null">
              <v-chip size="small" variant="tonal" class="mb-3">Cerrada</v-chip>
              <p class="text-body-2 text-medium-emphasis">
                La caja de esta sucursal está cerrada.
              </p>
            </template>
          </v-card-text>
          <v-card-actions>
            <v-btn
              variant="text"
              color="primary"
              to="/app/caja"
              append-icon="mdi-arrow-right"
            >
              {{ home.cash === null ? 'Abrir caja' : 'Ver caja' }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>

      <!-- Ventas de hoy: solo con permiso de Reportes. -->
      <v-col v-if="showSales" cols="12" md="6">
        <v-card class="h-100">
          <v-card-text>
            <h2 class="text-subtitle-1 font-weight-bold mb-3">Ventas de hoy</h2>

            <p v-if="home.salesFailed" class="text-body-2 text-medium-emphasis">
              No se pudieron cargar las ventas.
            </p>
            <template v-else-if="home.sales">
              <div class="text-h4 font-weight-bold tabular" data-testid="sales-total">
                {{ formatMXN(home.sales.totalCents) }}
              </div>
              <p class="text-body-2 text-medium-emphasis mt-1">
                {{ home.sales.salesCount }}
                {{ home.sales.salesCount === 1 ? 'venta cobrada' : 'ventas cobradas' }}
              </p>
            </template>
          </v-card-text>
          <v-card-actions>
            <v-btn
              variant="text"
              color="primary"
              to="/app/reportes"
              append-icon="mdi-arrow-right"
            >
              Ver reportes
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>
