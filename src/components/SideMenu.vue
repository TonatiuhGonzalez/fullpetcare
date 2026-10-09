<script setup lang="ts">
// Menú lateral de navegación, compartido por AppLayout (negocio) y
// SuperadminLayout (plataforma). Es "tonto": recibe las opciones ya
// filtradas por rol/permiso desde el layout y solo las pinta.
//
// Dos modos según el ancho de pantalla:
//  - Escritorio: fijo a la izquierda; el botón de abajo lo alterna entre
//    expandido y "riel" (columna angosta solo con íconos). Siempre arranca
//    expandido (el estado no se guarda).
//  - Móvil: oculto; el botón de hamburguesa del layout lo abre como cajón
//    sobre el contenido (v-model "open").
//
// Las opciones pueden traer una sección (`group`, p. ej. "Operación"): se dibujan
// agrupadas bajo su título. Arriba del menú hay un espacio (`#header`) para el
// selector de negocio y sucursal; recibe `rail` para adaptarse al modo angosto.
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import { groupMenuItems } from '@/lib/menuGroups'

export interface SideMenuItem {
  title: string
  icon: string
  to: string
  group?: string
}

const props = defineProps<{ items: SideMenuItem[] }>()
const groups = computed(() => groupMenuItems(props.items))

const open = defineModel<boolean>('open', { default: false })

// smAndDown (< 960 px) coincide con la clase "d-md-none" de la hamburguesa en los
// layouts; el "mobile" por defecto de Vuetify corta en 1280 px y no cuadraría.
const { smAndDown: mobile } = useDisplay()
const rail = ref(false)
// En escritorio el cajón siempre se muestra: se le pasa true en vez de "open".
// Vuetify no activa un cajón "permanent" si arranca con model-value false.
</script>

<template>
  <v-navigation-drawer
    :model-value="mobile ? open : true"
    :permanent="!mobile"
    :temporary="mobile"
    :rail="!mobile && rail"
    @update:model-value="open = $event"
  >
    <template #prepend>
      <div class="side-menu__header">
        <slot name="header" :rail="!mobile && rail" />
      </div>
    </template>

    <v-list nav density="comfortable" class="side-menu__list">
      <template v-for="(group, index) in groups" :key="group.title ?? 'sin-seccion'">
        <!-- Título de sección. En modo riel no cabe: se cambia por una línea
             (y la primera sección no necesita ninguna). -->
        <template v-if="group.title">
          <template v-if="!mobile && rail">
            <v-divider v-if="index > 0" class="my-2" />
          </template>
          <v-list-subheader v-else class="side-menu__group">
            {{ group.title }}
          </v-list-subheader>
        </template>

        <!-- "title" también va en el tooltip nativo: en modo riel solo se ve el
             ícono y sin esto no se sabría a qué vista lleva. -->
        <v-list-item
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          :prepend-icon="item.icon"
          :title="item.title"
          :aria-label="item.title"
          color="primary"
          rounded="lg"
          class="side-menu__item"
          @click="open = false"
        />
      </template>
    </v-list>

    <template v-if="!mobile" #append>
      <v-list nav density="comfortable">
        <v-list-item
          :prepend-icon="rail ? 'mdi-chevron-right' : 'mdi-chevron-left'"
          :title="rail ? 'Expandir menú' : 'Colapsar menú'"
          @click="rail = !rail"
        />
      </v-list>
    </template>
  </v-navigation-drawer>
</template>

<style scoped lang="scss">
.side-menu {
  &__header {
    padding: 8px 8px 0;
  }

  // Sección activa: barra de color de marca a la izquierda y título más grueso, para que
  // no dependa solo del tinte de fondo (que en modo oscuro es muy sutil).
  &__item.v-list-item--active {
    box-shadow: inset 3px 0 0 rgb(var(--v-theme-primary));
    font-weight: 600;
  }

  &__group {
    min-height: 32px;
    font-size: 0.6875rem;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
}
</style>
