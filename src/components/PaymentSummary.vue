<script setup lang="ts">
// Resumen del pago en curso: lo pagado, lo que falta y, si se pagó de más en efectivo, el
// CAMBIO que se le devuelve al cliente. Si el exceso no vino en efectivo (tarjeta,
// transferencia) no se puede devolver y se avisa: el botón de cobrar queda deshabilitado
// (`cart.isFullyPaid`). Lo usan el punto de venta y el cobro de una cita.
import { formatMXN } from '@/lib/money'
import { useCartStore } from '@/stores/cart'

const cart = useCartStore()
</script>

<template>
  <div class="mb-3">
    <p class="text-body-2 mb-1">
      Pagado: {{ formatMXN(cart.paidCents) }} · Falta:
      {{ formatMXN(cart.remainingCents) }}
    </p>

    <div
      v-if="cart.changeCents > 0"
      class="d-flex align-center justify-space-between rounded px-3 py-2 bg-success"
      role="status"
    >
      <span class="text-subtitle-1">Cambio a devolver</span>
      <span class="text-h5 font-weight-bold">{{ formatMXN(cart.changeCents) }}</span>
    </div>

    <v-alert
      v-if="cart.unpayableExcessCents > 0"
      type="error"
      density="compact"
      variant="tonal"
      class="mt-2"
    >
      Se pagó de más {{ formatMXN(cart.unpayableExcessCents) }} que no es efectivo y no se
      puede devolver. Baja ese pago o quítalo.
    </v-alert>
  </div>
</template>
