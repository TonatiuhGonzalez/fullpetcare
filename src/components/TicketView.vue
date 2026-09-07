<script setup lang="ts">
// Ticket imprimible de una venta ya cobrada (tarea 5.15). Componente
// "tonto" (CLAUDE.md §4): solo recibe el ticket ya armado por
// services/checkout.ts#charge()/getTicket() — no habla con Supabase.
import { formatDate, formatTime } from '@/lib/datetime'
import { formatMXN } from '@/lib/money'
import type { Ticket } from '@/services/checkout'

const props = defineProps<{ ticket: Ticket }>()

const methodLabels: Record<string, string> = {
  cash: 'Efectivo',
  card: 'Tarjeta',
  transfer_spei: 'Transferencia',
  openpay: 'Openpay',
}

function print(): void {
  window.print()
}
</script>

<template>
  <div>
    <div class="ticket-print pa-4">
      <div class="text-center mb-3">
        <h2 class="text-h6">{{ props.ticket.branchName }}</h2>
        <p class="text-body-2 text-medium-emphasis">
          Ticket #{{ props.ticket.sale.folio }} ·
          {{ formatDate(props.ticket.sale.paid_at ?? props.ticket.sale.created_at, props.ticket.branchTimezone) }}
          {{ formatTime(props.ticket.sale.paid_at ?? props.ticket.sale.created_at, props.ticket.branchTimezone) }}
        </p>
      </div>

      <p class="mb-2"><strong>Cliente:</strong> {{ props.ticket.customerName }}</p>

      <v-divider class="mb-2" />

      <div
        v-for="item in props.ticket.items"
        :key="item.id"
        class="d-flex justify-space-between text-body-2 mb-1"
      >
        <span>{{ item.description }} {{ item.quantity > 1 ? `× ${item.quantity}` : '' }}</span>
        <span>{{ formatMXN(item.line_total_cents) }}</span>
      </div>

      <v-divider class="my-2" />

      <div class="d-flex justify-space-between text-body-2">
        <span>Subtotal</span>
        <span>{{ formatMXN(props.ticket.sale.subtotal_cents) }}</span>
      </div>
      <div class="d-flex justify-space-between text-body-2">
        <span>IVA</span>
        <span>{{ formatMXN(props.ticket.sale.tax_cents) }}</span>
      </div>
      <div v-if="props.ticket.sale.discount_cents > 0" class="d-flex justify-space-between text-body-2">
        <span>Descuento</span>
        <span>-{{ formatMXN(props.ticket.sale.discount_cents) }}</span>
      </div>
      <div class="d-flex justify-space-between text-subtitle-1 font-weight-bold mt-1">
        <span>Total</span>
        <span>{{ formatMXN(props.ticket.sale.total_cents) }}</span>
      </div>

      <v-divider class="my-2" />

      <p class="text-subtitle-2 mb-1">Pago</p>
      <div
        v-for="payment in props.ticket.payments"
        :key="payment.id"
        class="d-flex justify-space-between text-body-2"
      >
        <span>
          {{ methodLabels[payment.method] ?? payment.method }}
          <span v-if="payment.reference" class="text-medium-emphasis"> ({{ payment.reference }})</span>
        </span>
        <span>{{ formatMXN(payment.amount_cents) }}</span>
      </div>
    </div>

    <div class="d-flex justify-center mt-4 no-print">
      <v-btn color="primary" prepend-icon="mdi-printer" @click="print">Imprimir</v-btn>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ticket-print {
  max-width: 360px;
  margin: 0 auto;
  font-family: 'Courier New', monospace;
}
</style>

<!--
  Sin "scoped" a propósito: @media print necesita ocultar TODO lo demás en
  la página (barra de navegación, botones del carrito) cuando se imprime,
  no solo lo de este componente — algo que el aislamiento de "scoped" no
  puede alcanzar (solo le pone un atributo a los elementos de ESTE
  archivo, nunca a <body> ni a componentes hermanos).
-->
<style lang="scss">
@media print {
  body * {
    visibility: hidden;
  }
  .ticket-print,
  .ticket-print * {
    visibility: visible;
  }
  .ticket-print {
    position: fixed;
    inset: 0;
  }
  .no-print {
    display: none;
  }
}
</style>
