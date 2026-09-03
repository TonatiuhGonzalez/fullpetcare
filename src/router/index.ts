import { createRouter, createWebHistory } from 'vue-router'

// El guard de sesión real (exigir login + tenant activo en /app/*) se agrega
// en la tarea 1.31, cuando exista useSessionStore. Por ahora solo hay una
// ruta de aterrizaje para confirmar que el router y Vuetify funcionan juntos.
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('@/pages/HomePage.vue'),
    },
  ],
})
