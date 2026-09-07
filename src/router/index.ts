import { createRouter, createWebHistory } from 'vue-router'

import { isFrontDesk } from '@/lib/roles'
import { useSessionStore } from '@/stores/session'

// Vue Router deja "meta" tipado vacío por defecto — esto le agrega la
// propiedad que usan las rutas de abajo (clientes, citas/nueva), para
// que el guard al final del archivo tenga tipos reales.
declare module 'vue-router' {
  interface RouteMeta {
    /** true si la ruta es tarea de recepción (owner/receptionist) — groomer/vet se redirigen a la agenda. */
    requiresFrontDesk?: boolean
  }
}

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
          // Solo owner/receptionist agendan (CLAUDE.md §6.1) — el backend
          // ya lo rechaza (create_appointment()), pero sin este guard un
          // groomer/vet podría llegar al formulario completo y solo
          // enterarse del rechazo hasta darle "Agendar".
          meta: { requiresFrontDesk: true },
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
          path: 'citas/:id/cobrar',
          name: 'cita-cobrar',
          component: () => import('@/pages/agenda/CheckoutPage.vue'),
          props: true,
        },
        {
          path: 'clientes',
          name: 'clientes',
          component: () => import('@/pages/clientes/CustomersPage.vue'),
          // El listado completo de clientes es tarea de recepción
          // (CLAUDE.md §6.1) — groomer/vet ven al cliente dueño de la
          // mascota que atienden (customers sigue siendo legible para
          // ellos vía RLS), pero no un directorio del negocio completo.
          meta: { requiresFrontDesk: true },
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
    // Vista pública (tarea 7.12): NO va dentro de /app — no exige sesión
    // y usa su propio layout, sin nada de la navegación interna (el
    // guard de abajo solo revisa rutas que empiecen con "/app").
    {
      path: '/c/:token',
      component: () => import('@/layouts/PublicLayout.vue'),
      children: [
        {
          path: '',
          name: 'mascota-publica',
          component: () => import('@/pages/publico/PublicPetPage.vue'),
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

  // Rutas marcadas "requiresFrontDesk" (arriba: clientes, citas/nueva) —
  // groomer/vet no las necesitan y el backend ya las rechaza; se manda a
  // la agenda en vez de dejar ver un formulario/listado que de todos
  // modos no va a poder usar.
  if (to.meta.requiresFrontDesk && !isFrontDesk(session.role)) {
    return { path: '/app/agenda' }
  }

  return true
})
