<script setup lang="ts" generic="T extends Record<string, any>">
// Tabla que en pantallas chicas (< 960 px: celular y tablet vertical) se vuelve una lista de
// tarjetas (fase 26, PLAN.md D29). En pantallas grandes es un `v-data-table` tal cual: recibe
// los mismos atributos (`headers`, `loading`, `items-per-page`, `row-props`...), los mismos
// eventos y las mismas ranuras (`item.<columna>`, `no-data`), así que una página cambia
// `<v-data-table>` por `<ResponsiveTable>` y nada más.
//
// La tarjeta se arma SOLA a partir de los `headers` y reutiliza las ranuras `item.<columna>` de
// la tabla (la misma celda, el mismo chip, el mismo botón), para que tarjeta y tabla no puedan
// decir cosas distintas:
//   - la primera columna es el título de la tarjeta,
//   - el resto es "etiqueta: valor",
//   - la columna `actions` va abajo, alineada a la derecha.
// Un header con `cardHidden: true` no sale en la tarjeta.
//
// Un dato vacío (nulo o texto vacío) sale como "—" cuando la página no trae su propia ranura.
import { computed, useAttrs } from 'vue'
import { useDisplay } from 'vuetify'

defineOptions({ inheritAttrs: false })

interface CardHeader {
  title?: string
  key?: string
  cardHidden?: boolean
}

const props = withDefaults(
  defineProps<{
    items: T[]
    // true si tocar la tarjeta hace algo (en la tabla es el click en la fila): emite `click:item`.
    clickable?: boolean
    // Tarjetas por página; si la página pasa `items-per-page` (>0) se usa ese.
    cardsPerPage?: number
  }>(),
  { clickable: false, cardsPerPage: 10 },
)

const emit = defineEmits<{ 'click:item': [item: T] }>()

const attrs = useAttrs()
// smAndDown = ancho < 960 px: el mismo corte que ya usan Configuración y el menú lateral.
const { smAndDown } = useDisplay()

const headers = computed(() => (attrs.headers as CardHeader[] | undefined) ?? [])
const cardHeaders = computed(() =>
  headers.value.filter((h) => h.key && h.key !== 'actions' && !h.cardHidden),
)
const titleHeader = computed(() => cardHeaders.value[0] ?? null)
const detailHeaders = computed(() => cardHeaders.value.slice(1))
const hasActions = computed(() => headers.value.some((h) => h.key === 'actions'))

const perPage = computed(() => {
  const given = Number(attrs['items-per-page'] ?? attrs.itemsPerPage)
  return Number.isFinite(given) && given > 0 ? given : props.cardsPerPage
})
const isLoading = computed(() => !!attrs.loading)
const noDataText = computed(() => String(attrs['no-data-text'] ?? 'Sin resultados.'))

// `row-props` de la tabla (por ejemplo, atenuar lo inactivo): de ahí se toma solo la clase.
function cardClass(item: T, index: number): string | undefined {
  const rowProps = attrs['row-props'] ?? attrs.rowProps
  const resolved =
    typeof rowProps === 'function'
      ? (rowProps as (data: { item: T; index: number }) => Record<string, unknown>)({ item, index })
      : (rowProps as Record<string, unknown> | undefined)
  const cls = resolved?.class
  return typeof cls === 'string' ? cls : undefined
}

function display(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value)
}

function onCardClick(item: T): void {
  if (props.clickable) emit('click:item', item)
}
</script>

<template>
  <v-data-iterator
    v-if="smAndDown"
    :items="items"
    :items-per-page="perPage"
    class="responsive-table"
  >
    <template #default="{ items: pageItems }">
      <v-progress-linear v-if="isLoading" indeterminate class="mb-2" />
      <v-card
        v-for="(entry, index) in pageItems"
        :key="index"
        variant="outlined"
        :class="['responsive-table__card', cardClass(entry.raw, index), { 'cursor-pointer': clickable }]"
        :ripple="clickable"
        @click="onCardClick(entry.raw)"
      >
        <div v-if="titleHeader" class="responsive-table__title">
          <slot
            :name="`item.${titleHeader.key}`"
            :item="entry.raw"
            :value="entry.raw[titleHeader.key as string]"
          >
            {{ display(entry.raw[titleHeader.key as string]) }}
          </slot>
        </div>

        <dl v-if="detailHeaders.length" class="responsive-table__details">
          <div v-for="header in detailHeaders" :key="header.key" class="responsive-table__row">
            <dt>{{ header.title }}</dt>
            <dd>
              <slot
                :name="`item.${header.key}`"
                :item="entry.raw"
                :value="entry.raw[header.key as string]"
              >
                {{ display(entry.raw[header.key as string]) }}
              </slot>
            </dd>
          </div>
        </dl>

        <div v-if="hasActions" class="responsive-table__actions">
          <slot name="item.actions" :item="entry.raw" :value="undefined" />
        </div>
      </v-card>
    </template>

    <!-- v-data-iterator no pinta la ranura por defecto cuando no hay filas: el vacío va aquí. -->
    <template #no-data>
      <div class="responsive-table__empty">
        <slot name="no-data">{{ noDataText }}</slot>
      </div>
    </template>

    <template #footer="{ page, pageCount, setPage }">
      <v-pagination
        v-if="pageCount > 1"
        :model-value="page"
        :length="pageCount"
        :total-visible="3"
        density="comfortable"
        class="mt-2"
        @update:model-value="setPage"
      />
    </template>
  </v-data-iterator>

  <v-data-table v-else v-bind="attrs" :items="items">
    <!-- Se reenvían todas las ranuras de la página a la tabla. -->
    <template v-for="(_, name) in $slots" #[name]="slotProps" :key="name">
      <slot :name="name" v-bind="slotProps ?? {}" />
    </template>
  </v-data-table>
</template>

<style scoped lang="scss">
.responsive-table__card {
  padding: 12px 16px;
  margin-bottom: 12px;
}

.responsive-table__title {
  font-weight: 600;
  overflow-wrap: anywhere;
}

.responsive-table__details {
  margin: 8px 0 0;
}

.responsive-table__row {
  display: flex;
  gap: 12px;
  align-items: baseline;
  padding: 2px 0;

  dt {
    flex: 0 0 38%;
    max-width: 38%;
    font-size: 0.75rem;
    color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  }

  dd {
    flex: 1;
    min-width: 0;
    margin: 0;
    overflow-wrap: anywhere;
  }
}

.responsive-table__actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));

  // En la tabla la celda de acciones va centrada; en la tarjeta, a la derecha.
  :deep(> .d-flex) {
    justify-content: flex-end !important;
  }
}

.responsive-table__empty {
  padding: 16px 0;
  text-align: center;
}
</style>
