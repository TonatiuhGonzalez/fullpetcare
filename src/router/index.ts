import { createRouter, createWebHistory } from 'vue-router'

import { finishNavigation, startNavigation } from '@/composables/useNavigationProgress'
import { showAppUpdateNotice } from '@/composables/useAppUpdateNotice'
import { isChunkLoadError } from '@/lib/chunkError'
import { isFrontDesk } from '@/lib/roles'
import type { PermissionModule } from '@/lib/permissions'
import type { MemberRole } from '@/services/memberships'
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
    /** true si solo el dueño del negocio entra (configuración de empresa y sucursales, tarea #1959). */
    requiresOwner?: boolean
    /** Roles que entran a la ruta (catálogo de vacunas, fase 26: dueño y veterinario). */
    requiresRoles?: MemberRole[]
  }
}

/** Rutas de la vista pública del cliente: sin sesión y sin gateos del personal. */
function isPublicPath(path: string): boolean {
  return path === '/c' || path.startsWith('/c/')
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/app/inicio' },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/pages/auth/LoginPage.vue'),
    },
    {
      // Recuperación por correo (tarea #1907): se pide el enlace…
      path: '/recuperar-contrasena',
      name: 'forgot-password',
      component: () => import('@/pages/auth/ForgotPasswordPage.vue'),
    },
    {
      // …y el enlace del correo regresa aquí, ya con sesión de recuperación.
      path: '/restablecer-contrasena',
      name: 'reset-password',
      component: () => import('@/pages/auth/ResetPasswordPage.vue'),
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
          path: 'inicio',
          name: 'inicio',
          component: () => import('@/pages/inicio/HomePage.vue'),
        },
        {
          path: 'agenda',
          name: 'agenda',
          component: () => import('@/pages/agenda/AgendaPage.vue'),
        },
        {
          path: 'servicios',
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
          // Receta de una consulta, lista para imprimir (fase 28, PLAN.md D30).
          path: 'citas/:id/receta',
          name: 'cita-receta',
          component: () => import('@/pages/agenda/PrescriptionPrintPage.vue'),
          props: true,
          meta: { requiresRoles: ['owner', 'vet'] },
        },
        {
          path: 'citas/:id/cobrar',
          name: 'cita-cobrar',
          component: () => import('@/pages/agenda/CheckoutPage.vue'),
          props: true,
        },
        {
          // Detalle de una venta cobrada y su factura (tarea 11.19): gateado por
          // el permiso 'invoicing', igual que inventario.
          path: 'ventas/:id',
          name: 'venta-detalle',
          component: () => import('@/pages/ventas/SaleDetailPage.vue'),
          props: true,
          meta: { requiresPermission: 'invoicing' },
        },
        {
          // Venta de mostrador (tareas 11.11 y 13.4): punto de venta de productos
          // sin cita ni cliente. Se abre desde el botón flotante de AppLayout.
          // Cobrar es de recepción/dueño.
          path: 'venta-mostrador',
          name: 'venta-mostrador',
          component: () => import('@/pages/ventas/PointOfSalePage.vue'),
          meta: { requiresFrontDesk: true },
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
          // Página de un cliente (C1.16): sus mascotas, la ficha de la elegida y su
          // cartilla. Misma regla que el listado: solo dueño y recepción.
          path: 'clientes/:id',
          name: 'cliente',
          component: () => import('@/pages/clientes/CustomerPage.vue'),
          meta: { requiresFrontDesk: true },
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
        {
          // Inventario (tarea 11.9): gateado por PERMISO, igual que empleados.
          // Cambiar quién entra es una fila de role_permissions, no código.
          path: 'inventario',
          name: 'inventario',
          component: () => import('@/pages/inventario/InventoryPage.vue'),
          meta: { requiresPermission: 'inventory' },
        },
        {
          // Proveedores (fase 29B, PLAN.md D30): catálogo de a quién se le compra. Mismo
          // permiso que Inventario (`inventory`): quien administra el inventario lo ve.
          path: 'proveedores',
          name: 'proveedores',
          component: () => import('@/pages/proveedores/SuppliersPage.vue'),
          meta: { requiresPermission: 'inventory' },
        },
        {
          // Hospitalización (fase 33, PLAN.md D30): tablero y ficha de cada estancia. Dueño,
          // recepción y veterinario; el groomer no. La base lo impone con RLS y las RPC.
          path: 'hospitalizacion',
          name: 'hospitalizacion',
          component: () => import('@/pages/hospitalizacion/HospitalizationPage.vue'),
          meta: { requiresRoles: ['owner', 'receptionist', 'vet'] },
        },
        {
          path: 'hospitalizacion/:id',
          name: 'hospitalizacion-estancia',
          component: () => import('@/pages/hospitalizacion/HospitalStayPage.vue'),
          props: true,
          meta: { requiresRoles: ['owner', 'receptionist', 'vet'] },
        },
        {
          // Cobro rápido (fase 30, PLAN.md D30): cobrar un servicio y/o productos sin cita y sin
          // registrar al cliente. Solo dueño y recepción, como la venta de mostrador.
          path: 'cobro-rapido',
          name: 'cobro-rapido',
          component: () => import('@/pages/ventas/QuickSalePage.vue'),
          meta: { requiresRoles: ['owner', 'receptionist'] },
        },
        {
          // Reportes (tarea 12.12): gateado por PERMISO; por defecto solo el dueño.
          path: 'reportes',
          name: 'reportes',
          component: () => import('@/pages/reportes/ReportsPage.vue'),
          meta: { requiresPermission: 'reports' },
        },
        {
          // Caja (tarea 12.11): gateada por PERMISO, igual que inventario.
          path: 'caja',
          name: 'caja',
          component: () => import('@/pages/caja/CashRegisterPage.vue'),
          meta: { requiresPermission: 'cash_register' },
        },
        {
          // Configuración (tarea #1959): la ven todos los roles, pero cada
          // sección se gatea aparte. "Empresa y sucursales" es solo del dueño
          // (política RLS de branches); "Cuenta" es de cualquiera.
          path: 'configuracion',
          component: () => import('@/pages/configuracion/SettingsPage.vue'),
          children: [
            {
              path: '',
              // Cada quien aterriza en la primera sección que puede ver.
              redirect: () => {
                const role = useSessionStore().role
                if (role === 'owner') return '/app/configuracion/sucursales'
                if (role === 'vet') return '/app/configuracion/vacunas'
                return '/app/configuracion/cuenta'
              },
            },
            {
              path: 'sucursales',
              name: 'configuracion-sucursales',
              component: () => import('@/pages/configuracion/BranchesSettingsPage.vue'),
              meta: { requiresOwner: true },
            },
            {
              path: 'facturacion',
              name: 'configuracion-facturacion',
              component: () => import('@/pages/configuracion/FiscalSettingsPage.vue'),
              meta: { requiresOwner: true },
            },
            {
              path: 'vacunas',
              name: 'configuracion-vacunas',
              component: () => import('@/pages/configuracion/VaccinesSettingsPage.vue'),
              meta: { requiresRoles: ['owner', 'vet'] },
            },
            {
              // Hospitalización (fase 33, PLAN.md D30): reglas de días, tarifas y espacios. Dueño.
              path: 'hospitalizacion',
              name: 'configuracion-hospitalizacion',
              component: () => import('@/pages/configuracion/HospitalSettingsPage.vue'),
              meta: { requiresOwner: true },
            },
            {
              // Catálogo de cirugías (fase 32, PLAN.md D30): paquetes de renglones con su precio.
              path: 'cirugias',
              name: 'configuracion-cirugias',
              component: () => import('@/pages/configuracion/SurgeriesSettingsPage.vue'),
              meta: { requiresRoles: ['owner', 'vet'] },
            },
            {
              // Especies y razas (fase 27, PLAN.md D30): catálogo editable por dueño y veterinario.
              path: 'especies',
              name: 'configuracion-especies',
              component: () => import('@/pages/configuracion/SpeciesSettingsPage.vue'),
              meta: { requiresRoles: ['owner', 'vet'] },
            },
            {
              path: 'cuenta',
              name: 'configuracion-cuenta',
              component: () => import('@/pages/configuracion/AccountSettingsPage.vue'),
            },
          ],
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
          path: 'motivos',
          name: 'superadmin-motivos',
          component: () => import('@/pages/superadmin/ReasonsPage.vue'),
        },
        {
          path: 'planes',
          name: 'superadmin-planes',
          component: () => import('@/pages/superadmin/PlansPage.vue'),
        },
        {
          path: 'reportes',
          name: 'superadmin-reportes',
          component: () => import('@/pages/superadmin/FeedbackPage.vue'),
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
    // Inicio de la app instalada (fase 16A, PLAN.md D21): el manifiesto abre aquí. Sin token en
    // la dirección, lleva a la última mascota consultada en este teléfono.
    {
      path: '/c',
      component: () => import('@/layouts/PublicLayout.vue'),
      children: [
        {
          path: '',
          name: 'cliente-inicio',
          component: () => import('@/pages/publico/ClientHomePage.vue'),
        },
      ],
    },
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

// Barra de progreso de navegación (PLAN.md D22). Este guard se registra PRIMERO para
// que la barra arranque antes de cualquier espera (la sesión, la descarga de la
// pantalla). Se apaga en `afterEach`, que Vue Router llama también cuando la
// navegación se cancela o se redirige, y en `onError` si falla la descarga.
router.beforeEach(() => {
  startNavigation()
})
router.afterEach(() => {
  finishNavigation()
})
router.onError((error) => {
  finishNavigation()
  // Tras un despliegue, la pantalla pedida ya no existe en el servidor: se avisa en
  // lugar de dejar el clic sin respuesta (PLAN.md D22). Otros errores no tocan esto.
  if (isChunkLoadError(error)) showAppUpdateNotice()
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
  if (session.isAuthenticated && !isPublicPath(to.path)) {
    if (session.mustChangePassword && !isForcePasswordRoute) {
      return { path: '/cambiar-contrasena' }
    }
    if (!session.mustChangePassword && isForcePasswordRoute) {
      return { path: '/app/inicio' }
    }
  }

  // Todos sus negocios están suspendidos, dados de baja o vencidos: no hay
  // nada que mostrarle salvo el aviso, que vive en /login (LoginPage abre el
  // diálogo solo). Se le deja ahí, y la vista pública /c/:token no se toca.
  if (session.isBlockedOnly && !isPublicPath(to.path)) {
    return to.path === '/login' ? true : { path: '/login' }
  }

  // Panel de plataforma (fase 10): quien no es superadmin no tiene nada que
  // hacer aquí — se le manda a Inicio, igual que con los demás gateos.
  if (isPlatformRoute && !session.isPlatformAdmin) {
    return { path: '/app/inicio' }
  }

  // Un superadmin que no pertenece a ningún negocio no tiene "agenda" ni
  // negocio que elegir: su casa es el panel de plataforma. (Sin esto, tras
  // iniciar sesión — que manda a /app/inicio por default — vería la
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
      : { path: '/app/inicio' }
  }

  // Rutas marcadas "requiresFrontDesk" (arriba: clientes) — groomer/vet
  // no las necesitan y el backend ya las rechaza; se manda a la agenda en
  // vez de dejar ver un listado que de todos modos no va a poder usar.
  // (Agendar una cita ya no es una ruta aparte — es el dialog
  // NewAppointmentDialog.vue, cuyo botón de apertura en AgendaPage.vue ya
  // trae su propio "v-if=isFrontDesk(...)".)
  if (to.meta.requiresFrontDesk && !isFrontDesk(session.role)) {
    return { path: '/app/inicio' }
  }

  // Mismo criterio que "requiresFrontDesk", pero consultando el permiso
  // configurable (fase 9) en vez de un rol fijo — el backend (RLS +
  // app.has_permission()) ya rechazaría la lectura de todos modos; esto
  // solo evita mostrar una pantalla vacía a quien de todos modos no va a
  // poder ver nada en ella.
  if (to.meta.requiresPermission && !session.canView(to.meta.requiresPermission)) {
    return { path: '/app/inicio' }
  }

  // Secciones por rol (catálogo de vacunas: dueño y veterinario). Mismo criterio que la de
  // abajo: la política RLS ya rechazaría la escritura, esto evita una pantalla inútil.
  if (
    to.matched.some(
      (record) => record.meta.requiresRoles && !record.meta.requiresRoles.includes(session.role!),
    )
  ) {
    return { path: '/app/configuracion/cuenta' }
  }

  // Secciones solo del dueño (configuración de sucursales): quien no lo es
  // cae en "Cuenta", que sí puede ver. La política RLS de branches ya le
  // negaría escribir; esto solo evita una pantalla que no podría usar.
  if (
    to.matched.some((record) => record.meta.requiresOwner) &&
    session.role !== 'owner'
  ) {
    return { path: '/app/configuracion/cuenta' }
  }

  return true
})
