import { createRouter, createWebHistory } from 'vue-router'

import { isFrontDesk } from '@/lib/roles'
import type { PermissionModule } from '@/lib/permissions'
import { useSessionStore } from '@/stores/session'

// Vue Router deja "meta" tipado vacío por defecto — esto le agrega las
// propiedades que usan las rutas de abajo, para que el guard al final del
// archivo tenga tipos reales.
declare module 'vue-router' {
  interface RouteMeta {
    /** true si la ruta es tarea de recepción (owner/receptionist) — groomer/vet se redirigen a la agenda. */
    requiresFrontDesk?: boolean
    /** Módulo de permisos (fase 9, CLAUDE.md §6.7) que se necesita "ver" para entrar — session.canView() decide, no un rol fijo. */
    requiresPermission?: PermissionModule
    /** true en las rutas del panel de plataforma (fase 10): solo superadmins de plataforma. */
    requiresPlatformAdmin?: boolean
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
      // Pantalla obligatoria tras el primer inicio de sesión con contraseña
      // temporal (ver el guard de abajo).
      path: '/cambiar-contrasena',
      name: 'force-password-change',
      component: () => import('@/pages/auth/ForcePasswordChangePage.vue'),
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
        {
          path: 'empleados',
          name: 'empleados',
          component: () => import('@/pages/empleados/EmployeesPage.vue'),
          // Gestión de empleados (fase 9) — hoy solo el dueño tiene
          // "employees:view" (role_permissions, seed.sql), pero el gateo
          // real es por PERMISO, no por rol: cambiar quién entra aquí es
          // una fila de datos, no una edición de este archivo.
          meta: { requiresPermission: 'employees' },
        },
      ],
    },
    // Panel de superadmin de plataforma (fase 10). Vive fuera de /app: un
    // superadmin no pertenece a ningún negocio, así que no hay negocio ni
    // sucursal activos y AppLayout.vue no aplica. El gateo real es la base
    // (cada RPC revalida is_platform_admin()); este meta solo evita
    // mostrar un panel vacío a quien de todos modos no podría usarlo.
    {
      path: '/superadmin',
      component: () => import('@/layouts/SuperadminLayout.vue'),
      meta: { requiresPlatformAdmin: true },
      children: [
        { path: '', redirect: '/superadmin/empresas' },
        {
          path: 'empresas',
          name: 'superadmin-empresas',
          component: () => import('@/pages/superadmin/TenantsPage.vue'),
        },
        {
          path: 'administradores',
          name: 'superadmin-administradores',
          component: () => import('@/pages/superadmin/AdminsPage.vue'),
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
  const isPlatformRoute = to.matched.some((record) => record.meta.requiresPlatformAdmin)
  const isSelectBusinessRoute = to.path === '/seleccionar-negocio'
  const isForcePasswordRoute = to.path === '/cambiar-contrasena'

  if (
    (isPrivateRoute ||
      isPlatformRoute ||
      isSelectBusinessRoute ||
      isForcePasswordRoute) &&
    !session.isAuthenticated
  ) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }

  // Contraseña temporal: hasta cambiarla, la única pantalla permitida es la
  // de cambio (y la vista pública /c/:token, que no usa sesión). Va antes de
  // los demás gateos porque para esta persona aún no se cargaron ni negocios
  // ni rol de plataforma. Quien ya la cambió y entra a mano a esa pantalla
  // se manda a su casa.
  if (session.isAuthenticated && !to.path.startsWith('/c/')) {
    if (session.mustChangePassword && !isForcePasswordRoute) {
      return { path: '/cambiar-contrasena' }
    }
    if (!session.mustChangePassword && isForcePasswordRoute) {
      return { path: '/app/agenda' }
    }
  }

  // Panel de plataforma (fase 10): quien no es superadmin no tiene nada que
  // hacer aquí — se le manda a su agenda, igual que con los demás gateos.
  if (isPlatformRoute && !session.isPlatformAdmin) {
    return { path: '/app/agenda' }
  }

  // Un superadmin que no pertenece a ningún negocio no tiene "agenda" ni
  // negocio que elegir: su casa es el panel de plataforma. (Sin esto, tras
  // iniciar sesión — que manda a /app/agenda por default — vería la
  // pantalla de selección de negocio vacía, o una agenda sin negocio.)
  const isPlatformOnlyUser = session.isPlatformAdmin && session.memberships.length === 0
  if (isPrivateRoute && isPlatformOnlyUser) {
    return { path: '/superadmin' }
  }

  if (isPrivateRoute && session.needsBusinessSelection) {
    return { path: '/seleccionar-negocio' }
  }

  if (to.path === '/login' && session.isAuthenticated) {
    if (isPlatformOnlyUser) return { path: '/superadmin' }
    return session.needsBusinessSelection
      ? { path: '/seleccionar-negocio' }
      : { path: '/app/agenda' }
  }

  // Rutas marcadas "requiresFrontDesk" (arriba: clientes) — groomer/vet
  // no las necesitan y el backend ya las rechaza; se manda a la agenda en
  // vez de dejar ver un listado que de todos modos no va a poder usar.
  // (Agendar una cita ya no es una ruta aparte — es el dialog
  // NewAppointmentDialog.vue, cuyo botón de apertura en AgendaPage.vue ya
  // trae su propio "v-if=isFrontDesk(...)".)
  if (to.meta.requiresFrontDesk && !isFrontDesk(session.role)) {
    return { path: '/app/agenda' }
  }

  // Mismo criterio que "requiresFrontDesk", pero consultando el permiso
  // configurable (fase 9) en vez de un rol fijo — el backend (RLS +
  // app.has_permission()) ya rechazaría la lectura de todos modos; esto
  // solo evita mostrar una pantalla vacía a quien de todos modos no va a
  // poder ver nada en ella.
  if (to.meta.requiresPermission && !session.canView(to.meta.requiresPermission)) {
    return { path: '/app/agenda' }
  }

  return true
})
