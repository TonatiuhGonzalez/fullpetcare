<script setup lang="ts">
// Tarjeta de producto del punto de venta (fase 13, 13G): un toque suma una pieza al ticket.
// La usan las dos filas de la pantalla (productos de la categoría abierta o de la búsqueda, y
// últimos vendidos). Es "tonta": recibe el producto y cuántas piezas lleva ya el ticket.
import { formatMXN } from '@/lib/money'
import type { SellableProduct } from '@/services/checkout'

defineProps<{
  product: SellableProduct
  /** Piezas de este producto que ya lleva el ticket. */
  inTicket: number
}>()

const emit = defineEmits<{ select: [product: SellableProduct] }>()
</script>

<template>
  <v-card
    variant="outlined"
    class="pos-tile pa-2"
    :class="{ 'pos-tile--maxed': inTicket >= product.stock }"
    role="button"
    tabindex="0"
    :aria-label="`Agregar ${product.name}`"
    @click="emit('select', product)"
    @keydown.enter.prevent="emit('select', product)"
    @keydown.space.prevent="emit('select', product)"
  >
    <div class="pos-tile-name text-body-2 font-weight-medium">{{ product.name }}</div>
    <div class="d-flex align-center mt-1">
      <span class="text-subtitle-1 font-weight-bold text-primary">
        {{ formatMXN(product.priceCents) }}
      </span>
      <v-spacer />
      <v-chip v-if="inTicket" size="x-small" color="primary" variant="flat">
        {{ inTicket }} en ticket
      </v-chip>
    </div>
  </v-card>
</template>

<style scoped lang="scss">
.pos-tile {
  cursor: pointer;
  transition: background-color 0.15s;

  &:hover,
  &:focus-visible {
    background-color: rgba(var(--v-theme-primary), 0.08);
  }

  // Ya no se puede agregar más: se atenúa, pero sigue tocable para que avise por qué.
  &--maxed {
    opacity: 0.55;
  }
}

.pos-tile-name {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  overflow: hidden;
  min-height: 2.6em;
}
</style>
