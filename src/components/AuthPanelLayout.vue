<script setup lang="ts">
// Marco de las pantallas de acceso (PLAN.md D20): a la izquierda el formulario (el
// contenido que se le pasa), a la derecha un panel de marca con color y una frase.
// En pantallas angostas el panel de marca desaparece y queda solo el formulario.
//
// Hoy lo usa el login; las demás pantallas de auth (olvidé mi contraseña, cambio
// forzado, etc.) pueden adoptarlo envolviendo su contenido igual, cuando se decida.
import BrandLogo from '@/components/BrandLogo.vue'
</script>

<template>
  <div class="auth-layout">
    <section class="auth-layout__form">
      <div class="auth-layout__form-inner">
        <BrandLogo :size="36" class="mb-10" />
        <slot />
      </div>
    </section>

    <!-- Panel de marca: decorativo, por eso aria-hidden. Solo desde md. -->
    <aside class="auth-layout__brand d-none d-md-flex" aria-hidden="true">
      <span class="auth-layout__circle auth-layout__circle--grooming" />
      <span class="auth-layout__circle auth-layout__circle--veterinary" />
      <div class="auth-layout__brand-copy">
        <p class="text-h4 font-weight-bold mb-3">
          Estética y veterinaria, en un solo lugar.
        </p>
        <p class="text-body-1">
          Agenda, expediente, cobro y la cartilla de cada mascota, para tu negocio
          completo.
        </p>
      </div>
    </aside>
  </div>
</template>

<style scoped lang="scss">
// El panel de marca usa colores fijos (no del tema): es una superficie de marca que
// se ve igual en claro y oscuro. Texto blanco sobre estos verdes: 7.9:1 y 6.3:1.
$brand-deep: #0a4d49;
$brand: #0f6b66;

.auth-layout {
  display: grid;
  grid-template-columns: 1fr;
  min-height: 100vh;

  @media (min-width: 960px) {
    grid-template-columns: minmax(420px, 5fr) 6fr;
  }

  &__form {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px 16px;
  }

  &__form-inner {
    width: 100%;
    max-width: 380px;
  }

  &__brand {
    position: relative;
    overflow: hidden;
    align-items: flex-end;
    padding: 64px;
    color: #fff;
    background: linear-gradient(160deg, $brand-deep 0%, $brand 100%);
  }

  // Dos círculos que se cruzan, eco del logo. En blanco translúcido y no en naranja y
  // azul: esos colores mezclados con el verde de fondo salen turbios (olivo).
  &__circle {
    position: absolute;
    width: 460px;
    height: 460px;
    border-radius: 50%;
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.2);

    &--grooming {
      top: -120px;
      right: 120px;
    }

    &--veterinary {
      top: 60px;
      right: -140px;
    }
  }

  &__brand-copy {
    position: relative;
    max-width: 440px;

    p:last-child {
      opacity: 0.88;
    }
  }
}
</style>
