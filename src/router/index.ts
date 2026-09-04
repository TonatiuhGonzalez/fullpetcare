import { createRouter, createWebHistory } from 'vue-router'

import { useSessionStore } from '@/stores/session'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/app/agenda' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/auth/LoginPage.vue'),
    },
    {
      path: '/seleccionar-negocio',
      name: 'select-business',
      component: () => import('@/pages/auth/SelectBusinessPage.vue'),
    },
    {
      path: '/app',
      component: () => import('@/layouts/AppLayout.vue'),
      children: [
        {
          path: 'agenda',
          name: 'agenda',
          component: () => import('@/pages/agenda/AgendaPage.vue'),
        },
        {
          path: 'catalogo',
          name: 'catalogo',
          component: () => import('@/pages/agenda/CatalogPage.vue'),
        },
        {
          path: 'citas/nueva',
          name: 'cita-nueva',
          component: () => import('@/pages/agenda/NewAppointmentPage.vue'),
        },
        {
          path: 'citas/:id',
          name: 'cita-detalle',
          component: () => import('@/pages/agenda/AppointmentDetailPage.vue'),
          props: true,
        },
        {
          path: 'citas/:id/atender',
          name: 'cita-atender',
          component: () => import('@/pages/agenda/AttendPage.vue'),
          props: true,
        },
        {
          path: 'clientes',
          name: 'clientes',
          component: () => import('@/pages/clientes/CustomersPage.vue'),
        },
        {
          path: 'clientes/:id',
          name: 'cliente-detalle',
          component: () => import('@/pages/clientes/CustomerDetailPage.vue'),
          props: true,
        },
        {
          path: 'mascotas/:id',
          name: 'mascota-detalle',
          component: () => import('@/pages/clientes/PetDetailPage.vue'),
          props: true,
        },
      ],
    },
  ],
})

// Guard de sesión: corre ANTES de cada navegación, para las tres rutas
// privadas (/app/*, /seleccionar-negocio) y para /login al revés (si ya
// hay sesión, no tiene caso volver a mostrarlo).
//
// "beforeEach" puede ser async: Vue Router espera a que la promesa
// resuelva antes de decidir si la navegación sigue, se cancela, o se
// redirige — por eso se puede hacer "await ensureInitialized()" aquí
// mismo, que es justo lo que hace falta al recargar la página (F5): sin
// esto, una recarga en /app/agenda mandaría a /login por un instante
// mientras supabase-js todavía está restaurando la sesión guardada.
router.beforeEach(async (to) => {
  const session = useSessionStore()
  await session.ensureInitialized()

  const isPrivateRoute = to.path.startsWith('/app')
  const isSelectBusinessRoute = to.path === '/seleccionar-negocio'

  if ((isPrivateRoute || isSelectBusinessRoute) && !session.isAuthenticated) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  if (isPrivateRoute && session.needsBusinessSelection) {
    return { path: '/seleccionar-negocio' }
  }

  if (to.path === '/login' && session.isAuthenticated) {
    return session.needsBusinessSelection
      ? { path: '/seleccionar-negocio' }
      : { path: '/app/agenda' }
  }

  return true
})
