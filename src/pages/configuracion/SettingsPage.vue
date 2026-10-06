<script setup lang="ts">
// Marco de la vista de configuración (tarea #1959): menú vertical que clasifica
// la configuración y, junto a él, la sección elegida (ruta hija). "Empresa y
// sucursales" es solo del dueño; "Cuenta" la ven todos.
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()
</script>

<template>
  <!-- El menú vive en el margen izquierdo del contenedor, fuera de su ancho por
       defecto. .settings-page es la referencia (100cqw) para medir ese margen. -->
  <div class="settings-page">
    <v-container class="settings-container pa-4">
      <nav class="settings-rail">
        <v-list nav density="comfortable" class="settings-menu border rounded">
          <v-list-item
            v-if="session.role === 'owner'"
            to="/app/configuracion/sucursales"
            prepend-icon="mdi-store-cog-outline"
            title="Empresa y sucursales"
          />
          <v-list-item
            v-if="session.role === 'owner'"
            to="/app/configuracion/facturacion"
            prepend-icon="mdi-file-certificate-outline"
            title="Facturación"
          />
          <v-list-item
            to="/app/configuracion/cuenta"
            prepend-icon="mdi-account-cog-outline"
            title="Cuenta"
          />
        </v-list>
      </nav>
      <router-view />
    </v-container>
  </div>
</template>

<style scoped lang="scss">
// Móvil (< md): el menú va arriba, a todo el ancho, en el flujo normal.
.settings-rail {
  margin-bottom: 16px;
}

.settings-page {
  container-type: inline-size;
}

// Escritorio (>= md): el menú sale del flujo y se coloca en el margen izquierdo.
@media (min-width: 960px) {
  .settings-container {
    position: relative;
  }

  .settings-rail {
    // m = margen libre a cada lado del contenedor. 100cqw = ancho de
    // .settings-page y 100% = ancho del contenedor (el bloque contenedor del
    // elemento absoluto).
    --margin: calc((100cqw - 100%) / 2);

    position: absolute;
    top: 0;
    bottom: 0;
    margin: 0;
    // Con margen de sobra (>= 248 px) el menú mide 240 px y queda pegado al
    // contenido; con menos, se encoge al margen, con un mínimo de 56 px (íconos).
    left: max(calc(-1 * var(--margin)), -248px);
    width: max(56px, min(240px, var(--margin)));
    // Permite preguntar por el ancho del margen en @container (abajo).
    container-type: inline-size;
    container-name: rail;
    z-index: 5;
  }

  // Fijo al hacer scroll: se pega justo debajo de la barra superior.
  .settings-menu {
    position: sticky;
    top: 72px;
    width: 100%;
    overflow: hidden;
    transition: width 0.15s ease;

    // Con margen angosto, al pasar el mouse se despliega a 240 px sobre el contenido.
    &:hover {
      width: 240px;
      box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
    }
  }

  // Margen angosto y sin mouse encima: solo íconos.
  @container rail (max-width: 239px) {
    .settings-menu:not(:hover) :deep(.v-list-item-title) {
      display: none;
    }
  }
}
</style>
