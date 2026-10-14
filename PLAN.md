# PLAN.md — FullPetCare

Arquitectura y orden de construcción. El detalle operativo está en `TASKS.md`; el
contexto permanente, en `CLAUDE.md`.

---

## Parte 1 — Arquitectura

### 1.1 Vista general

```
                    ┌───────────────────────────────────────────┐
   Navegador        │  App Vue 3 + Vuetify  (Cloudflare Pages)   │
   del personal ───▶│  Rutas privadas: /app/*                   │
                    │  Ruta pública:    /c/:token               │
                    └──────────┬──────────────────┬─────────────┘
                               │ anon key          │ POST token
                               │ + sesión JWT      │
                               ▼                   ▼
                    ┌────────────────────┐  ┌──────────────────────┐
                    │  Supabase PostgREST│  │ Edge Function        │
                    │  (RLS aplicado)    │  │ public-pet-view      │
                    └──────────┬─────────┘  │ (service role)       │
                               │            └──────────┬───────────┘
                               ▼                       │
                    ┌──────────────────────────────────▼───────────┐
                    │  Postgres: tablas + RLS + funciones app.*    │
                    │  Auth (auth.users)   Storage (fotos)         │
                    └──────────────────────────────────────────────┘
```

Dos caminos hacia los datos, deliberadamente distintos:

- **El personal** consulta Postgres directo. Está autenticado, tiene una fila en
  `memberships`, y RLS decide qué ve. El frontend nunca es la autoridad.
- **El público** (dueño de la mascota con su link) **no toca Postgres**. Pasa por una
  Edge Function que valida el token y devuelve un DTO recortado. El rol `anon` no tiene
  permiso sobre ninguna tabla.

### 1.2 Dónde vive la lógica

```
lib/          funciones puras          →  totales, IVA, huecos de agenda, validación
services/     acceso a datos + reglas  →  consultas Supabase, orquestación
stores/       estado de sesión y UI    →  tenant activo, sucursal, carrito
Postgres RPC  transacciones            →  checkout_appointment()
```

Casi todo va en TypeScript, porque es donde el usuario es rápido y donde los tests son
fáciles. Baja a SQL solo lo que **debe ser atómico**: el cobro escribe `sales`,
`sale_items`, `payments`, cambia el estado de la cita y genera folio. Si eso se hace con
cuatro llamadas desde el navegador y la tercera falla, queda una venta huérfana sin
manera limpia de revertirla. Una función SQL lo hace todo o nada.

`checkout_appointment()` es `SECURITY DEFINER` (para poder escribir en varias tablas de
un jalón) y por lo tanto **revalida la membresía adentro**, en la primera línea. Sin esa
revalidación sería una puerta trasera al aislamiento.

### 1.3 Aislamiento multi-tenant

El detalle está en `CLAUDE.md` §7. Resumen: `tenant_id` en cada tabla, RLS activo y
forzado, políticas que llaman a `app.is_member_of()` / `app.role_in()`, que leen
`memberships`. Nada de `tenant_id` en el JWT.

La prueba de que funciona no es leer las políticas: es un test que crea dos tenants, se
conecta como usuario del tenant A, pide una fila del tenant B, y verifica que recibe
cero filas. Ese test existe desde la fase 1, antes de que haya casi nada que proteger.

### 1.4 Rutas

```
/login
/seleccionar-negocio          elegir tenant y sucursal (si hay más de uno)
/app/agenda                   dashboard: agenda del día (crear cita: dialog, no ruta aparte)
/app/citas/:id                detalle
/app/citas/:id/atender        ficha según kind (estética o veterinaria)
/app/citas/:id/cobrar         resumen, pago simulado, ticket
/app/clientes                 lista y búsqueda (pestañas Clientes/Mascotas); la ficha de
                              cliente y la de mascota (historial mezclado + cartilla) son
                              diálogos, sin ruta propia (tarea #1968)
/app/catalogo                 servicios
/c/:token                     PÚBLICA — sin login, solo lectura, layout móvil
```

Todo bajo `/app` pasa por un guard que exige sesión y tenant activo. `/c/:token` usa un
layout propio, sin barra de navegación ni nada del sistema interno: es otra aplicación
que casualmente vive en el mismo bundle.

### 1.5 El tenant activo

Vive en `useSessionStore`: `{ user, memberships[], activeTenantId, activeBranchId,
role }`. Se persiste en `localStorage` para no volver a preguntar en cada recarga, pero
**es solo comodidad de UI**: si alguien lo altera a mano, RLS igual no le deja ver nada
del otro tenant. Ese es justamente el punto de no confiar en el cliente.

Un `owner` con dos sucursales cambia entre ellas con un selector en la barra superior.

---

## Parte 2 — Fases

Cada fase termina con **algo demostrable y desplegado**, no con piezas sueltas. Se
mergea a `main` y queda vivo en internet.

### Fase 1 — La tubería, viva

**Objetivo: validar el pipeline completo antes de acumular una sola línea de negocio.**
Es la fase más importante y la que menos se ve.

Se construye: repo con protección de rama, `.nvmrc`, esqueleto Vue + Vuetify, ESLint,
Vitest, GitHub Actions comentado, Cloudflare Pages conectado, proyectos de Supabase
staging y producción, Supabase local con Docker, primera migración (`tenants`,
`branches`, `profiles`, `memberships`, `membership_branches`), funciones `app.*`,
políticas RLS, semilla con dos tenants y cuatro usuarios, login real, selector de
tenant/sucursal.

Y los tres primeros tests, cada uno explicado:

- uno unitario tonto, para ver el runner en verde;
- uno de store (`session`);
- **el de aislamiento**: usuario del tenant A pide datos del tenant B y recibe cero.

**Demostrable:** una URL pública donde entras con `dueno@patitasfelices.mx`, eliges
sucursal, y ves tu nombre y tu rol. Nada más. Pero cada pieza de infraestructura del
proyecto ya está probada de punta a punta.

_Por qué primero:_ si Cloudflare, las variables de entorno o las migraciones en la nube
tienen un problema, se descubre ahora con 300 líneas de código, no en la fase 5 con
6 000.

### Fase 2 — Clientes y mascotas

Migración de `customers` (con campos CFDI), `pets`, `pet_weights`. Trigger de
`updated_at`, trigger de auditoría, borrado suave, y el trigger que prohíbe el borrado
duro en expediente. Storage para la foto de la mascota, con su política por tenant.
Services y stores de clientes y mascotas. Alta, edición, búsqueda, ficha.

Tests: validación de RFC y teléfono (`lib/validation.ts`), servicios de clientes y
mascotas, RLS de las tres tablas, y que el borrado duro sí truena.

**Demostrable:** dar de alta a "María Fernanda Ruiz" con su french poodle "Canela",
subirle foto, buscarla, editarla.

### Fase 3 — Catálogo y agenda

Migración de `services`, `appointments`, `appointment_services`. `lib/availability.ts`
(función pura: horario de la sucursal + duración del servicio + citas del empleado →
huecos disponibles) y `lib/datetime.ts` (UTC ↔ zona de la sucursal). Dashboard con la
agenda del día y el flujo de crear cita.

Tests: **aquí está el mejor material didáctico del proyecto.** `availability.ts` es una
función pura con bordes jugosos — cita que termina justo cuando empieza otra, servicio
más largo que el horario restante, empleado sin huecos, día cerrado. Se prueban todos.
Más los snapshots de precio y el RLS de las tres tablas.

**Demostrable:** agendar "Baño y corte para Canela, mañana 11:00, con Lupita" y verla
aparecer en la agenda del día correcto, en la hora correcta de esa sucursal.

### Fase 4 — Atender

Migración de `grooming_records`, `medical_records`, `vaccines`, `vaccinations`. Las
políticas donde el rol importa de verdad: el groomer no lee expediente clínico. Pantalla
de atención que bifurca según `appointment.kind`. Registro de peso. Cartilla de
vacunación con cálculo de próxima dosis.

Tests: cálculo de próxima vacuna, transiciones de estado de la cita
(`scheduled → in_progress → completed`, y las que no se valen), y **RLS por rol**: un
`groomer` autenticado consultando `medical_records` recibe cero filas.

**Demostrable:** atender una cita de estética con notas de corte, y una de veterinaria
con diagnóstico, peso y una vacuna aplicada.

### Fase 5 — Cobrar

Migración de `sales`, `sale_items`, `payments`, `invoice_requests`. `lib/money.ts` con
el desglose de IVA hacia atrás. RPC `checkout_appointment()`. Pantalla de cobro con
método simulado y ticket imprimible.

Tests: los de `money.ts` son los que más importan de todo el proyecto (redondeo por
partida, sumas que deben cuadrar al centavo, descuentos), más un test del RPC que
verifica que si algo falla a media transacción **no queda nada escrito**.

**Demostrable:** el flujo completo agendar → atender → cobrar, con ticket.

### Fase 6 — Historial y red de seguridad

Timeline de la mascota mezclando visitas de estética y de veterinaria en una sola línea
de tiempo ordenada. Gráfica simple de peso. Próximas citas y vacunas por vencer.

Y el **único test E2E de Playwright**: login → agendar → atender → cobrar → verificar el
ticket. Corre en CI contra Supabase local.

**Demostrable:** la historia completa de Canela, y un comando que valida el demo entero
en un minuto antes de cada reunión.

### Fase 7 — Vista cliente pública

Migración de `share_links`. Edge Function `public-pet-view`. Generación y revocación de
links desde la ficha de la mascota. Ruta `/c/:token` con layout móvil.

Tests, obligatorios y explícitos: token válido devuelve solo esa mascota; token de otro
tenant no cruza; token revocado, expirado e inexistente fallan igual (misma respuesta,
sin filtrar información); el rol `anon` no puede leer ninguna tabla; la respuesta no
contiene campos fuera de la lista blanca.

**Demostrable:** copiar el link, abrirlo en el celular, y ver la cartilla de vacunación
de Canela con su foto. Es lo que va a vender el producto en las reuniones.

_Por qué al final:_ necesita que exista historial real que mostrar, y es la superficie
más delicada. Se construye cuando el flujo interno ya está firme.

### Fase 9 — Gestión de empleados y permisos por rol

Pedida por el usuario después de v1. Migraciones de `role_permissions`
(`app.has_permission()`, permisos por negocio en vez de un rol hardcodeado — D13),
`employee_details` y `employee_documents` (+ bucket de Storage). Cierra el pendiente
que `memberships`/`membership_branches`/`profiles` dejaron abierto desde la fase 1:
esas tres tablas ganan aquí sus primeras políticas de INSERT/UPDATE. RPC
`create_employee_membership()` (membership + sucursales + ficha, todo o nada, mismo
criterio que `checkout_appointment`). Segunda Edge Function del proyecto,
`invite-employee` — la única pieza que usa `service_role` desde una acción del
frontend, porque `auth.admin.inviteUserByEmail` no tiene otra forma de llamarse.

`EmployeesPage.vue` + `EmployeeFormDialog.vue` (un diálogo con pestañas, no pasos).
"Empleados" en `AppLayout.vue` y la ruta `/app/empleados` se gatean con
`session.canView('employees')` — un permiso de datos, no un `v-if="role === 'owner'"`.

**Demostrable:** el dueño da de alta un empleado nuevo (correo de invitación real),
le asigna rol y sucursales, sube su credencial de elector, y lo edita después.
Cualquier otro rol ni ve la pestaña ni puede entrar por URL directa — y cambiar eso
mañana es una fila en `role_permissions`, no una migración.

### Fase 10 — Superadmin de plataforma

Panel `/superadmin` (misma pantalla de login) para que el equipo de la plataforma
gestione las empresas registradas: darlas de alta, ver su plan, dueño, fecha de alta y
vigencia, suspenderlas o darlas de baja, llevar notas internas, ver métricas de uso y
restablecer la contraseña del dueño. Además, gestionar a los propios superadmins.

**Solo ve datos de la empresa, nunca datos de negocio** (D14). Plan, vigencia y estado
son **informativos**: plan de texto fijo, vigencia indefinida, y suspender es una
etiqueta que no bloquea el acceso — bloquearlo implicaría tocar `app.is_member_of()`,
que usa toda la base, y se decidirá con la gestión real de planes.

- **Esquema:** `platform_admins` (sin `tenant_id`), `tenant_platform_info` (1 a 1 con
  `tenants`, creada por trigger) y `platform_audit_log`. Las tres con RLS de solo lectura
  para superadmins; **ninguna con política de escritura**.
- **RPC** `platform_*` (`SECURITY DEFINER`, revalidan `app.is_platform_admin()` en su
  primera línea): lista de empresas, métricas (solo conteos), estado con motivo, notas,
  alta de empresa (todo o nada), superadmins (nunca deja cero), eventos de bitácora.
- **Edge Function `platform-admin`** (la tercera): una sola con tres acciones. Usa dos
  clientes — con el JWT de quien llama para verificar y llamar las RPC (así la bitácora
  registra al superadmin real), y con `service_role` solo para la API de administración
  de Auth. Genera las contraseñas temporales; se muestran una vez.
- **Frontend:** `services/platform.ts`, `useSessionStore.isPlatformAdmin`, `lib/platform.ts`
  (lógica pura con tests), `SuperadminLayout.vue`, `TenantsPage.vue`, `AdminsPage.vue` y
  cinco diálogos. El detalle de una empresa es un diálogo con pestañas, no una página.
- **Arranque:** `npm run superadmin:create` (el primer superadmin no puede crearse desde
  la interfaz) y un superadmin ficticio + un tercer negocio en `seed.sql`. `demo:reset`
  restaura el estado de plataforma de la semilla y oculta las empresas de una demo.

**Demostrable:** el superadmin entra, ve las empresas con su plan, dueño y estado, da de
alta una nueva (recibe una contraseña temporal que se ve una sola vez), la suspende con
un motivo, anota notas, consulta sus métricas y su bitácora, restablece la contraseña del
dueño (que deja de poder usar la anterior y pierde sus sesiones abiertas) y agrega o
quita otros superadmins. Un dueño normal no entra a `/superadmin` ni por URL directa.

**Trabajo futuro:** forzar el cambio de contraseña en el primer ingreso del dueño, gestión
real de planes y vigencia, y bloqueo de acceso por vencimiento o suspensión.

### Fase 11 — Inventario, venta de productos y facturación (CFDI)

Primera fase de la **etapa de mejoras** (`CLAUDE.md` §1). Dos bloques, en este orden:

1. **Inventario y venta de productos.** `products` y `stock_movements` (bitácora inmutable; la
   existencia es la suma de los movimientos, D15). `sale_items` acepta `item_type = 'product'`
   con migración aditiva, como se dejó previsto en §6.5. El cobro sigue usando el mismo desglose
   de IVA por partida.
2. **Facturación CFDI 4.0** con un PAC externo (D16): `invoice_requests` pasa de "guardar lo que
   pediría el SAT" a timbrar, cancelar y descargar, mediante una cuarta Edge Function
   (`invoicing`). Factura individual primero; factura global al público en general al final.
3. **Insumos en la atención veterinaria:** el veterinario registra los productos usados al
   atender (`appointment_products`); cada línea se cobra al cliente o es de uso interno.

Se hace en ese orden porque el inventario no depende de terceros y el CFDI pide claves SAT por
concepto: si los productos nacen con ellas, no hay que rehacer nada. Detalle de tareas y de las
decisiones (todas resueltas): `TASKS.md` Fase 11.

**Demostrable (cuando termine):** el dueño da de alta productos con existencias por sucursal, registra
una compra, vende un producto junto con un servicio en el mismo ticket (la existencia baja), recibe
aviso de stock bajo, cancela la venta (la existencia regresa), configura los datos fiscales del
negocio, factura la venta en el sandbox del PAC, descarga el PDF y XML y la cancela con motivo.

**Fuera de esta fase:** lotes y caducidades (el lote de una vacuna se sigue capturando a mano),
transferencias entre sucursales, cantidades fraccionarias, envío automático de la factura, y
proveedores/órdenes de compra.

### Fase 12 — Corte de caja y reportes

Segunda fase de la **etapa de mejoras**. Todo se calcula con datos que **ya existen** (ventas, pagos,
partidas, citas): no hay servicio externo ni dependencia nueva. Dos bloques:

1. **Corte de caja** por sucursal: se abre con un fondo inicial, se registran retiros y gastos de
   efectivo, y se cierra contando el dinero. El sistema calcula cuánto efectivo **debería** haber y
   muestra el sobrante o faltante. Un corte cerrado no se edita (D17).
2. **Reportes de ventas** hechos en la base (funciones SQL que agregan, no el navegador): ventas por día,
   por método de pago, por servicio o producto, por empleado y por sucursal, con exportación a CSV.

**Estado: terminada (2026-10-05)**; aprobada el 2026-10-06 (decisiones y alternativas en D17 y en `TASKS.md` Fase 12).
**Demostrable:** recepción abre la caja con $500 de fondo, cobra tres ventas (una en efectivo
con cambio, una con tarjeta y una por transferencia), registra un retiro de $200, cierra contando el efectivo y
ve el sobrante o faltante; el dueño ve las ventas del mes por método de pago, por sucursal y por empleado y
descarga el CSV.

**Fuera de esta fase:** cancelar una venta con reembolso (hoy no existe en la interfaz), comisiones por
empleado, reportes de inventario o de utilidad, facturación en los reportes, gráficas con librería y
exportación a Excel.

### Fase 13 — Venta de mostrador como punto de venta

Tercera fase de la **etapa de mejoras**. Sin servicio externo ni dependencia nueva. La venta de mostrador pasa
de un formulario escondido en el menú a una pantalla de punto de venta, a la que se entra por un botón flotante
desde cualquier vista, y deja de exigir un cliente registrado (D18). Si quien compra pide factura, se da de alta
como cliente o se elige uno registrado, completando sus datos fiscales al momento.

**Estado: terminada (2026-10-05)**; aprobada el 2026-10-05 (decisiones y alternativas en D18 y en `TASKS.md` Fase 13).
**Demostrable:** recepción toca el botón flotante desde la agenda, escanea o busca dos productos, cobra en efectivo
sin registrar al cliente; en otra venta pide factura a alguien nuevo (se captura y queda dado de alta) y en otra a un
cliente registrado al que se le completan los datos fiscales que le faltaban.

**Fuera de esta fase:** atajos de teclado, venta en espera, cantidades fraccionarias, vender servicios en el
punto de venta, y el timbrado real con el PAC.

### Después de la Fase 13 (no ahora)

OpenPay real, WhatsApp Business API, recordatorios automáticos, reserva en línea, paquetes y membresías,
comisiones por empleado, importador de clientes.

---

## Parte 3 — Decisiones técnicas

Cada una con la alternativa que se descartó. Están abiertas a discusión: si alguna no
convence, cambiarla ahora es barato.

### D1 — Supabase con RLS, en vez de un backend propio

**Alternativa descartada:** API en Node/Express o PHP con la lógica de tenencia en el
código.
**Por qué:** el backend es el punto débil del usuario y multiplicaría el trabajo. Con RLS
el aislamiento vive en la base y aplica aunque el frontend se equivoque. Además Supabase
trae Auth y Storage.
**Costo aceptado:** dependencia de un proveedor, y que las reglas complejas se escriben
en SQL.

### D2 — `memberships` como fuente de permisos, no un claim en el JWT

**Alternativa descartada:** `tenant_id` inyectado en el token de sesión.
**Por qué:** con el claim, revocarle acceso a alguien no surte efecto hasta que caduca su
token (~1 h). Eso es un hueco de seguridad real, no una molestia. Además el claim exige
un _auth hook_ que no se prueba bien en local, y complica al `owner` que ve varias
sucursales.
**Costo aceptado:** una consulta extra por query, mitigada con función `STABLE` e índice
en `memberships(user_id, tenant_id)`.
**Si algún día hace falta:** el cambio se hace dentro de `app.is_member_of()`, sin tocar
las políticas.

### D3 — Edge Function para la vista pública, no RLS con la llave anónima

**Alternativa descartada:** el navegador anónimo consulta Postgres con el token en un
header y las políticas lo comparan.
**Por qué:** esa opción obliga a darle `select` al rol `anon` sobre tablas con datos de
todos los tenants. Un error en una política se vuelve fuga masiva. Con la Edge Function,
`anon` no tiene acceso a nada; si la función se equivoca, el peor caso es un bug, no una
brecha.
**Costo aceptado:** un artefacto más que desplegar, y aprender un poco de Deno.
**Segunda alternativa descartada:** canjear el token por un JWT corto. Más limpio si
hubiera muchas pantallas públicas; hay una sola.

### D4 — Token aleatorio hasheado, no un UUID ni un JWT firmado

**Alternativa descartada:** usar el UUID de la mascota como link.
**Por qué:** un UUID v4 no es adivinable, pero está en toda la base y en cada respuesta
de la API; se filtra solo. Un token dedicado se puede revocar, expirar y auditar sin
tocar la mascota. Y guardarlo hasheado significa que un respaldo robado no da acceso.
32 bytes aleatorios son inadivinables por fuerza bruta.
**Costo aceptado:** el token se muestra una sola vez; si se pierde, se genera otro.

### D5 — Precios con IVA incluido, desglosado hacia atrás

**Alternativa descartada:** guardar precio neto y sumar 16 % al cobrar.
**Por qué:** en el mostrador mexicano el precio de lista es lo que paga el cliente. Si el
dueño teclea 350 y el ticket dice 406, en la demo eso se ve como un error.
**Costo aceptado:** el desglose se calcula por partida y hay que cuidar el redondeo. Por
eso `lib/money.ts` tiene tests dedicados a centavos.

### D6 — Una cita = un tipo (estética **o** veterinaria)

**Alternativa descartada:** cita mixta con ambas fichas.
**Por qué:** `kind` determina qué ficha se abre, qué rol puede atenderla y qué se le
pide al empleado. Mezclarlo obliga a manejar dos empleados, dos duraciones y dos
estados en una sola fila. Si la mascota va a baño y consulta, son dos citas que se
cobran en un mismo ticket — que es lo que pasa en la realidad, donde la atienden dos
personas distintas.
**Costo aceptado:** agendar una visita doble son dos pasos.

### D7 — La lógica en TypeScript, salvo el cobro

**Alternativa descartada A:** todo en el frontend, incluido el cobro. Riesgo de ventas a
medio escribir.
**Alternativa descartada B:** todo en Edge Functions. Un backend entero en tecnología
nueva para el usuario, con despliegue propio y tests más pesados, para un demo.
**Por qué el punto medio:** la lógica en TS es la que se puede probar con Vitest, que es
lo que el usuario quiere aprender. Solo lo que necesita atomicidad baja a SQL.

### D8 — Supabase CLI local con Docker, en vez de una base de desarrollo en la nube

**Alternativa descartada:** un tercer proyecto Supabase para desarrollo.
**Por qué:** los tests de RLS necesitan crear tenants, usuarios y datos, y borrarlos. Con
una base compartida por red eso es lento, frágil entre corridas paralelas y obliga a
meter secretos en CI. En local: `supabase db reset` en segundos, offline, gratis, y el
runner de GitHub hace exactamente lo mismo.
**Nota sobre el alcance:** Docker aquí es solo una herramienta de desarrollo, no
contradice el "sin Docker" del brief — la app no se contenedoriza, no hay Dockerfile ni
compose propios.

### D9 — TypeScript

**Alternativa descartada:** JavaScript con JSDoc.
**Por qué:** `supabase gen types typescript` genera los tipos de toda la base desde las
migraciones. Es tipado gratis y atrapa justo los errores caros aquí: nombre de columna
mal escrito, campo faltante al insertar, confundir pesos con centavos. Sin ese generador,
TS costaría más de lo que da.
**Costo aceptado:** curva de aprendizaje. Se mitiga con `any` cuando estorbe — el
objetivo es el autocompletado, no la pureza de tipos.
**Esta es la decisión más fácil de revertir hoy y la más cara de revertir en la fase 4.**

### D10 — Producción es el demo

**Alternativa descartada:** enseñar desde staging y dejar producción esperando.
**Por qué:** una URL estable y bonita para enseñar, y por meses no habría diferencia real
entre ambos entornos. Staging sigue existiendo para revisar PRs.
**Costo aceptado:** `demo:reset` corre contra producción. Es seguro **mientras no haya
datos reales**. El día que entre el primer cliente de verdad, esta decisión se revisa.

### D11 — Sin i18n, sin librería de formularios, sin librería de gráficas

**Por qué:** el producto es solo para México y solo en español. La validación de
formularios de Vuetify alcanza. La única gráfica (peso de la mascota) se dibuja con un
`<svg>` de veinte líneas. Cada dependencia es superficie que mantener y entender.

### D12 — Un solo test E2E

**Alternativa descartada:** una suite de Playwright cubriendo cada flujo.
**Por qué:** los E2E son lentos, frágiles y caros de mantener. Aportan más como red de
seguridad antes de una demo que como red de cobertura. La cobertura real vive en los
unitarios y en los tests de RLS.

### D13 — Permisos en una tabla (`role_permissions`), no un rol hardcodeado en código

**Alternativa descartada:** un solo punto de chequeo aislado en código (una función SQL
+ un composable de frontend, ambos comparando `role_in(tenant_id) = 'owner'`), sin
tabla nueva — la recomendación inicial para la fase 9, antes de discutirlo con el
usuario.
**Por qué se descartó esa alternativa:** da casi el mismo beneficio de "un solo lugar
que cambiar" con mucho menos riesgo, pero el usuario prefirió la tabla — quería que
"a futuro se puedan modificar los permisos de cada rol" fuera literal desde el día uno,
no una promesa de que sería fácil migrar después.
**Por qué la tabla, con `tenant_id` incluido (no global):** cada negocio en esta
plataforma es independiente (CLAUDE.md §7) — una regla de permisos igual para todos
los tenants habría sido la primera excepción a eso. `app.has_permission(tenant_id,
module, action)` reutiliza el mismo `role_in()` que ya usa toda política del proyecto.
**Costo aceptado:** una tabla más, sin pantalla de administración en esta fase (se
siembra a mano, mismo criterio que las tablas de tenencia de la fase 1) — y el riesgo
real de una tabla de permisos: una fila faltante o mal sembrada deja a un rol sin
acceso a algo que debería tener. Mitigado en parte porque `owner` nunca depende de la
tabla (bypass explícito en `app.has_permission()`).
**Si algún día hace falta una pantalla para editarla:** la tabla y la función ya están
listas; falta solo la política de INSERT/UPDATE y su UI — mismo patrón que esta misma
fase le acaba de aplicar a `memberships`/`membership_branches`.

---

### D14 — Superadmin en una tabla aparte (`platform_admins`), no un rol de `memberships`

**Alternativa descartada:** agregar un valor `superadmin` al enum `role` de
`memberships`.
**Por qué se descartó:** `memberships` siempre pertenece a un `tenant_id` (§6.1) y
`app.is_member_of()` la usan todas las políticas de negocio; meter ahí a alguien sin
negocio rompería ese supuesto y arriesgaría abrir datos de negocio a quien solo debe
ver datos de la empresa.
**Por qué la tabla aparte:** el superadmin queda fuera del camino de todas las
políticas de negocio: no ve `customers`, `pets` ni expedientes aunque una política se
equivoque, porque ninguna lo menciona. Solo las RPCs `platform_*` lo reconocen, vía
`app.is_platform_admin()`.
**Dos correcciones al diseño original, descubiertas al escribir las migraciones:**
plan/estado/notas NO son columnas de `tenants` (RLS filtra filas, no columnas, y cualquier
miembro del negocio lee su fila de `tenants`: el dueño habría visto lo que la plataforma
anota sobre él) y la bitácora NO reutiliza `audit_log` (la lee el dueño y su trigger exige
`tenant_id`). Ver CLAUDE.md §6.8.
**Costo aceptado:** `platform_admins` es una excepción a la regla de `tenant_id` en
toda tabla (igual que `profiles`), y el primer superadmin no puede crearse desde la UI:
se crea con un script. La Edge Function necesita dos clientes de Supabase para que la
bitácora registre a la persona correcta.
**Decisión relacionada:** plan, vigencia y suspensión son informativos en esta fase;
bloquear acceso implicaría tocar `app.is_member_of()`, que usa toda la base, y se
decidirá cuando se diseñe la gestión real de planes.
**Riesgo resuelto:** `demo:reset` ocultaba toda empresa fuera de la semilla. Ahora solo oculta
las marcadas `is_demo` (default `false`, casilla en el alta) — CLAUDE.md §10.

---

### D15 — Existencias como suma de movimientos inmutables, no una columna `stock`

**Estado:** aprobada (2026-10-01).
**Alternativa descartada:** `products.stock int` que se actualiza en cada venta o compra.
**Por qué se descartó:** una columna se descuadra en cuanto dos cobros coinciden o un proceso falla a
medias, y cuando se descuadra no hay forma de saber por qué. Es el mismo problema que el dinero en
flotantes: el error vive en el dato y no se ve.
**Por qué los movimientos:** `stock_movements` solo se inserta (sin UPDATE ni DELETE, ni para el
dueño; corregir es otro movimiento). La existencia es una suma que siempre se puede auditar y
reconstruir, y el historial por producto sale gratis. Mismo criterio que el expediente (§8.5) y
`audit_log` (§8.6).
**Costo aceptado:** calcular la suma en cada consulta. Con el volumen de un negocio de mascotas es
irrelevante; si algún día duele, se agrega una tabla de saldos derivada, sin tocar los movimientos.
**Decisiones relacionadas:** cantidades enteras (§8.2); **no se vende ni se consume con existencia 0**
(validado en la base, no solo en la pantalla); aviso de stock bajo y leyenda "Sin inventario".
El consumo en la consulta es un movimiento propio (`consumption`) que nace al registrar la línea;
cancelar el cobro no lo revierte porque el medicamento ya se aplicó.

---

### D16 — Facturar mediante un PAC (con Edge Function), no timbrar por cuenta propia

**Estado:** aprobada (2026-10-01). PAC elegido: **Facturapi**.
**Alternativa descartada:** generar y sellar el XML nosotros mismos y hablar directo con el SAT.
**Por qué se descartó:** timbrar exige ser PAC autorizado o contratar uno de todos modos; lo
demás (validaciones, catálogos del SAT que cambian, cancelación con aceptación del receptor)
es mantenimiento fiscal permanente que no es el negocio de este producto.
**Por qué un PAC detrás de una Edge Function:** la llave del PAC es un secreto, igual que la
`service_role`, y no puede vivir en el frontend. La función revalida permiso con el JWT de quien
llama antes de usarla (patrón de `platform-admin`, D14).
**Requisito duro:** el PAC debe ser **multi-emisor**: cada negocio factura con su propio RFC y
certificado. El certificado (CSD) pasa directo al PAC y **no se guarda** en nuestra base.
**PAC elegido: Facturapi.** Multi-emisor incluido, sandbox y prueba de 14 días. Precios consultados el
2026-10-01 en su página (verificar antes de contratar): $299 MXN/mes por la API + $0.60 por timbre,
IVA incluido, sin paquetes prepagados. Se descartó Factura.com (plan anual con tope de 2 a 15 RFC, que
limita a un SaaS que crece), Facturama (también multi-emisor, pero con API anual más paquetes de
timbres) y SW Sapien (sin precios públicos).
**Reconfirmada el 2026-10-02 (#2036):** los precios de Facturapi se volvieron a leer en su página y
coinciden ($299 MXN/mes + $0.60 por timbre, IVA incluido, cobro a mes vencido, multi-RFC sin costo extra,
modo de prueba de 14 días sin tarjeta). Facturama (API multi-emisor $1,650 MXN/año + $0.50 por timbre,
prepago con vigencia anual) sale unas ~$1,900 MXN/año más barato más $0.10 por timbre, pero exige prepago,
los timbres vencen al año y no se pudo confirmar su sandbox en la página; la diferencia es chica frente a
la facilidad de integración. El usuario confirmó Facturapi. **Sin dependencia nueva:** la Edge Function
habla con la API por `fetch` (Deno), no con su SDK de npm. Los precios se verifican otra vez antes de
contratar el plan de pago (el modo de prueba basta para desarrollar).
**Pendiente de decidir antes de producción (2026-10-04):** emitir facturas exige la llave de la
*organización* de cada negocio (`sk_test_` en sandbox, `sk_live_` en producción). La de pruebas se puede consultar
cuando haga falta; la *live* solo se muestra al crearla, así que hay que decidir dónde guardarla (cifrada en la
base, o un secreto por negocio). Hasta entonces la función solo timbra en modo pruebas. Las rutas de la API
quedan aisladas en `functions/_shared/facturapi.ts`.
**Costo aceptado:** dependencia de un tercero y costo por timbre. **Lo absorbe la plataforma dentro del plan**, con un tope de facturas por negocio
(decisión del usuario, 2026-10-01). La forma de pago (crédito/débito) se elige a mano al cobrar con tarjeta. El armado del comprobante vive en `lib/cfdi.ts` (puro y probado) y el PAC queda detrás
de un adaptador delgado, de modo que cambiar de proveedor no toca la lógica ni la base.
**Riesgo conocido:** el desglose de IVA hacia atrás (D5) debe coincidir al centavo con lo que
valida el PAC; por eso la suma de los conceptos se prueba contra el total de la venta.

### D17 — Corte de caja por turno de sucursal, sin bloquear el cobro; reportes calculados en la base

**Estado:** aprobada (2026-10-06).

**1. Qué es un corte: un turno de caja por sucursal, con apertura y cierre explícitos.**
Se abre con un fondo inicial y se cierra con el conteo; puede haber varios por día (turno de mañana y de
tarde) y solo **uno abierto a la vez por sucursal** (índice único parcial, garantizado por la base).
**Alternativa descartada:** corte diario automático sin apertura. Es más simple, pero no sabe con cuánto
efectivo empezó el día, que es justo lo que hace falta para detectar un faltante.
**Costo aceptado:** alguien tiene que acordarse de abrir la caja. Se mitiga con el punto 2.

**2. Cobrar NO exige caja abierta, y la venta no apunta a la caja: se asigna por rango de tiempo.**
Una venta pertenece al corte de su sucursal cuya apertura y cierre contienen `paid_at`. **Alternativa
descartada:** una columna `cash_session_id` en `sales` y obligar a abrir caja para cobrar. Bloquear el cobro
porque se olvidó abrir la caja es peor que el problema que se quiere resolver, y exigiría modificar la RPC de
cobro y sus tests (que hoy son estables). **Costo aceptado:** si dos turnos se solapan por un error de captura,
una venta podría caer en dos; el índice único parcial lo impide para abiertos y la RPC de cierre lo valida.

**3. El efectivo esperado se calcula en la base y se congela al cerrar.**
`esperado = fondo + efectivo cobrado − cambio entregado + ingresos − retiros/gastos`. Dos detalles que no
son obvios:
- **El cambio no está guardado:** el cobro acepta pagos que suman **más** que el total (se paga con $500 una
  venta de $350) y registra el monto entregado. El cambio es `pagado − total` de esa venta, y solo sale de la
  caja si hubo efectivo (nunca más que el efectivo recibido). Se calcula en `lib/cashCount.ts` (puro, con
  tests de bordes) y la RPC de cierre usa la misma regla.
- **Tarjeta y transferencia no entran al efectivo esperado**, pero sí al reporte del turno.
Al cerrar se guardan `esperado`, `contado` y `diferencia` como **instantánea**: si después cambia algo, el
corte ya cerrado no se mueve.

**4. Retiros, gastos e ingresos de caja son movimientos inmutables** (`cash_movements`: sin UPDATE ni DELETE;
se corrige con otro movimiento), mismo criterio que `stock_movements` (D15). **Alternativa descartada:**
no tenerlos. Sin ellos, pagar una propina o comprar hielo con efectivo de la caja produce un "faltante" falso
en cada turno y el corte deja de ser creíble.

**5. Un corte cerrado no se edita ni se borra** (trigger, también para `service_role`): es un documento
contable, igual que el expediente (§8.5). Un error de captura se aclara con una nota, no reescribiéndolo.

**6. Reportes: funciones SQL que agregan (`SECURITY DEFINER`, revalidan permiso y sucursal), no consultas
que traen filas al navegador.** **Alternativa descartada:** pedir todas las ventas y sumar en el cliente: el
API devuelve máximo 1 000 filas por consulta y un reporte del mes las pasaría sin avisar, dando totales
**incorrectos** sin ningún error. **Fechas:** el periodo ("hoy", "este mes") se interpreta en la zona de cada
sucursal (§8.3), no en UTC ni en la del navegador; una venta a las 11 pm en Tijuana no es del día siguiente.
**Qué cuenta:** ventas `paid`; las canceladas se excluyen de los totales y se muestran aparte (conteo y
monto). El IVA se desglosa por partida, como siempre (§8.2); no es un reporte fiscal oficial.

**7. Atribución a empleados:** las partidas de servicio se atribuyen al empleado de la cita
(`appointments.employee_user_id`); los productos de mostrador y las ventas sin cita, a quien cobró
(`sales.closed_by`). **Costo aceptado:** un producto vendido junto con un servicio se atribuye al empleado
del servicio. Es la regla más simple y se documenta en la pantalla.

**8. Permisos por módulo (D13), no por rol fijo:** dos módulos nuevos en `permission_module`:
`cash_register` (dueño y recepción ver/editar; el resto nada) y `reports` (solo el dueño por defecto,
configurable con filas). Recepción solo ve las sucursales que tiene asignadas.

**9. Sin librería de gráficas (D11) y sin Excel:** las barras se dibujan con CSS/SVG, y se exporta a **CSV**
(sin dependencia). Si las barras no alcanzan, se propone una librería aparte, con su justificación.

**Riesgo conocido:** que el corte no cuadre por una venta con cambio mal calculado. Por eso la regla vive en
una función pura con tests y la RPC de cierre la repite en SQL; un test compara ambas con las mismas entradas
(mismo patrón que `lib/cfdi.ts` y su copia).

---

### D18 — Venta de mostrador como punto de venta (pantalla completa), con venta libre y factura a pedido

**Estado:** aprobada (2026-10-05).

**1. Acceso: botón circular flotante, no una entrada del menú.** Se quita "Venta de mostrador" del menú
lateral. Un botón circular fijo abajo a la derecha (escritorio) abre `/app/venta-mostrador`, que sigue siendo
una pantalla completa. **En móvil el botón se oculta** (decidido por el usuario). Solo lo ven dueño y recepción (`requiresFrontDesk`, como hoy). Los permisos no cambian.

**2. Interfaz de punto de venta.** La pantalla se rehace con la lógica de un POS (referencia: captura de un POS
comercial): búsqueda de producto, tabla de partidas con precio, cantidad e importe, total grande y botones de
Cobrar y Cancelar. **Solo productos** (decidido por el usuario). De la referencia **entran**: búsqueda por código de barras (se busca en `products.sku`, el código
interno opcional del negocio), cantidades **enteras** y un botón "Consultar precio" que abre un diálogo para
buscar un producto y ver su precio sin agregarlo al ticket. **No entran:** atajos de teclado, "Poner en
espera" ni "Lista de espera", ni cantidades fraccionarias (decidido por el usuario).

**3. La venta es libre: no exige cliente.** `sales.customer_id` pasa a admitir nulo (migración aditiva,
§8.1) y `checkout_counter_sale()` acepta `p_customer_id` nulo. **Alternativa descartada:** un cliente
"Público en general" falso por negocio; ensuciaría el listado de clientes y los reportes. **Costo aceptado:**
todo lo que lea `sales.customer_id` (ticket, historial, reportes, factura) debe tolerar nulo; la tarea 13.2 lo
revisa pieza por pieza.

**4. Factura desde una venta libre.**
- *No es cliente registrado:* se capturan sus datos fiscales en el momento y **se crea el cliente** (opción
  "a" del usuario) con `requires_invoice`; la factura usa esos datos y **la venta queda ligada al cliente
  nuevo** (decidido por el usuario).
- *Sí es cliente registrado:* un selector con los clientes registrados. Si al elegido le faltan datos
  fiscales, se le piden en el momento y se guardan.
- Las reglas de §8 no cambian; los datos fiscales siguen validándose con `lib/validation.ts`.

**5. Sin dependencias nuevas** (§3). Todo con Vue, Vuetify y lo que ya existe.

**6. Extensión de captura (2026-10-09, aprobada por el usuario).** Escribir el código o el nombre era poco amigable.
Se agrega una **cuadrícula de productos tocables debajo de la barra de captura**, un solo campo "código de barras o
nombre" que además filtra la cuadrícula, resaltado de la fila agregada, botones − y + en la cantidad y atajos F2
(captura) y F9 (cobrar). **Esto revoca el "sin atajos" del punto 2.** *Alternativas descartadas por ahora:* cuadrícula
junto al ticket (menos espacio para el ticket), categorías (necesitan migración y campo en Inventario), fotos de
producto (bucket y columna nuevos) y escaneo con cámara (dependencia nueva, §3). *Costo aceptado:* la cuadrícula
muestra todo el catálogo con existencia, que con cientos de productos obliga a filtrar; por eso el campo la filtra.

**7. Categorías y dos filas (2026-10-09, aprobada por el usuario; reemplaza la cuadrícula única del punto 6).**
La cuadrícula plana no escala con un catálogo grande. Los productos se agrupan en **categorías**; el punto de venta
muestra **dos filas**: arriba, categorías (o los productos de la categoría abierta, con "Volver") en una sola fila con
scroll horizontal; abajo, los **últimos productos vendidos**, tantos como quepan en el ancho. Decisiones del usuario:
- *Modelo:* tabla `product_categories` por negocio (nombre + ícono, RLS con el permiso `inventory`), no un enum fijo.
  **Alternativa descartada:** enum de Postgres (más simple, pero todos los negocios tendrían las mismas y agregar una
  pide migración). **Costo aceptado:** migración, RLS, bitácora y una pantalla de administración.
- *Administración:* en Inventario (diálogo de categorías y selector en el formulario de producto).
- *Íconos:* lista curada de ~24 de Material Design; no se guarda texto libre.
- *Sin categoría:* tarjeta "Sin categoría" (solo si hay productos sin ella). Desactivar una categoría (borrado suave)
  **no modifica sus productos**: pasan ahí.
- *Campo de captura:* escribir reemplaza la fila superior por los productos que coinciden; el código exacto sigue
  agregando directo.
- *Fila inferior:* últimos productos **vendidos** (no dados de alta), con existencia en la sucursal.
*Costo aceptado:* "últimos vendidos" depende de que haya ventas; en un negocio nuevo la fila inferior empieza vacía.

**Pendientes:** ninguno.

### D19 — Clientes y mascotas: acciones en la tabla y modales de edición directa

**Estado:** aprobada (2026-10-08).

**1. Acciones en la tabla.** Columna "Acciones" con editar y eliminar, solo para dueño y recepción. La fila deja de
ser clicable. Headers en negritas.

**2. Eliminar es borrado suave en cascada.** Cliente: sus mascotas y sus citas **programadas**. Mascota: sus citas **programadas** (las demás se conservan como historia; decidido el 2026-10-08). El expediente nunca se
borra (§8.5) y las ventas cobradas no se tocan. La cascada vive en una RPC `SECURITY DEFINER` (una sola transacción,
revalida membresía y rol, §7.3.4), no en varias llamadas desde el navegador: si una falla a la mitad, no queda un
cliente borrado con sus mascotas vivas. **Alternativa descartada:** encadenar los `softDelete` de los services desde el
frontend (no es atómico). **Costo aceptado:** una migración y una RPC nuevas.

**3. Modales de edición directa.** El de cliente reemplaza al detalle y al formulario; el de mascota pierde la vista
previa. Los componentes que queden sin uso no se borran (decisión del usuario).

**4. Cartilla como tabla.** Se arma con el catálogo `vaccines` filtrado por especie; el registro sigue en
`VaccinationDialog`. La tabla es una función pura en `lib/` (§4).

**5. Sin dependencias nuevas** (§3).

**Pendientes:** el ícono definitivo de esterilización (se usa uno provisional, verde/amarillo).

---

---

### D20 — Identidad visual: tema con tokens, color por tipo de visita apto para daltonismo y logo "Dos mitades"

**Estado:** aprobada (2026-10-08).

**1. Personalidad: clínica y confiable.** Neutros fríos (pizarra) en lugar del fondo cálido actual, verde azulado
profundo como color de marca (`#0F6B66`), tarjetas con borde fino de 1 px en vez de sombra, un solo radio por
tipo de control. Todo vive en `plugins/vuetify.ts` (§5.3), no en overrides sueltos.

**2. Color por tipo de visita.** Estética = naranja `#C25400`, veterinaria = azul `#0072B2` (paleta Okabe-Ito, pensada
para daltonismo). Se usa igual en agenda, chips, historial y reportes. **El color nunca es la única señal:** cada
tipo lleva también ícono y texto. Contraste calculado contra texto blanco: 4.60:1, 5.19:1 y 6.33:1 (marca); AA exige
4.5:1. Un test de `lib/` verifica los contrastes para que nadie rompa la paleta sin darse cuenta.
**Riesgo aceptado (decidido el 2026-10-08):** el verde de marca y el azul de veterinaria se parecen para algunos tipos
de daltonismo; se mitiga con luminosidad distinta, ícono y texto. **Alternativa descartada:** cambiar el azul por morado.

**3. Tipografía Inter con `@fontsource-variable/inter`.** Se sirve desde nuestro propio dominio. **Alternativas
descartadas:** `<link>` a Google Fonts (depende de un tercero y le manda la IP del usuario) y pila del sistema (menos
personalidad). **Costo aceptado:** una dependencia nueva (§3), aprobada por el usuario el 2026-10-08. Cifras
tabulares en dinero, folios y tickets para que las columnas alineen.

**4. Modo oscuro incluido** (decidido el 2026-10-08). Segundo tema de Vuetify con los mismos roles semánticos; se elige
según `prefers-color-scheme` y el usuario puede cambiarlo. La preferencia se guarda en el navegador (comodidad por
persona, no dato de negocio; si el almacenamiento falla, se usa la del sistema).

**5. Logo "C — Dos mitades".** Dos círculos que se cruzan: estética (naranja), veterinaria (azul) y el cruce en verde de
marca. Cuenta el diferenciador del producto y conecta con el color por tipo de visita. En SVG propio, sin dependencia.
**Alternativas descartadas:** A (huella con cruz) y B (corazón con huella), ambas más genéricas.

**6. Misma identidad en el superadmin** (decidido el 2026-10-08): `SuperadminLayout` usa el mismo tema y componentes.

**7. Sin servicio externo.** Única dependencia nueva: la fuente.

**8. Pantalla Inicio (acordada el 2026-10-08).** Es la pantalla de entrada, con resumen del día y accesos rápidos; la
Agenda sigue siendo una opción del menú. Cada bloque se muestra según el rol y el permiso (la regla real la sigue
imponiendo la base). No agrega tablas: reutiliza citas, ventas, caja y reportes. **Alternativa descartada:** poner las
tarjetas arriba de la Agenda (mezclaba dos usos en una pantalla que además ocupa todo el ancho). **Costo aceptado:** al
cambiar la pantalla de entrada hay que actualizar varias redirecciones (router, login, selección de negocio).

**Pendientes:** versión del logo para fondo oscuro y su contraste; colores de naranja y azul en modo oscuro
(se proponen `#E8793A` y `#3FA0D6`, por verificar con el mismo test); (el dashboard sí lleva tarjetas de resumen, confirmado el 2026-10-08).

---

### D21 — Acceso del cliente: PWA instalable y cuenta propia (sin app nativa)

**Estado:** aprobada el 2026-10-09. Se construye en la rama `feat/loading-states` (fase 17).

**Problema.** Hoy el cliente consulta a su mascota solo con un link con token (§7.4) que la recepción copia y pega.
Si lo pierde, hay que generar otro; no hay forma de "entrar" por su cuenta ni de ver todas sus mascotas juntas.

**1. Formato: PWA, no app nativa.** La vista pública ya es web y está pensada para móvil. Una PWA (manifest, ícono y
service worker) se instala en la pantalla de inicio sin tienda. **Alternativa descartada:** app nativa (cuenta de
Apple ~99 USD/año y de Google, revisión por versión, dos plataformas o un framework nuevo, y en multi-tenant habría que
decidir una app para todos o una por negocio). §1 ya deja la app nativa fuera de alcance. **Costo aceptado de la PWA:**
las notificaciones push en iPhone solo funcionan con la PWA instalada (iOS 16.4 o posterior), y no hay presencia en
las tiendas.

**2. Fase 16A — PWA sobre la vista actual (bajo riesgo).** Manifest con la identidad de la fase 15, íconos, pantalla
sin conexión mínima y aviso "Agregar a inicio". **No cambia el acceso:** sigue siendo el link con token. Sin servicio
externo. Dependencia: ninguna si el service worker se escribe a mano (el caché solo del cascarón de la app, **nunca de
datos de la mascota**); si se prefiere `vite-plugin-pwa`, es dependencia nueva y se justifica aparte (§3).

**3. Fase 16B — Cuenta del cliente (la parte grande, decidir antes de construir).** Que el cliente entre con su
teléfono o correo mediante un código de un solo uso y vea todas sus mascotas. Implica:
- **Rol nuevo "cliente"** con RLS propio y tests de aislamiento (no ve a otros clientes ni notas internas ni montos
  ajenos). Hoy `anon` no lee nada y todo pasa por la Edge Function (§7.4). **Alternativa A (recomendada):** el cliente
  sigue sin tocar Postgres; una Edge Function nueva emite una sesión corta y devuelve el mismo DTO de lista blanca.
  **Alternativa B:** cliente como usuario de Supabase Auth con políticas RLS propias (más superficie de ataque).
- **Envío del código:** correo (barato, sin costo por mensaje) o SMS/WhatsApp (servicio externo, costo por mensaje).
  Se justifica con el usuario antes (§3) y se elige canal; el correo es el punto de partida.
- Vincular persona ↔ cliente: por teléfono o correo ya capturado en `customers`; qué hacer si hay duplicados o el dato
  no coincide.

**4. Fuera de esta decisión:** push y recordatorios de vacunas (candidato aparte: WhatsApp, §1), pagos en línea y
reserva en línea.

**Pendientes:** elegir A o B del punto 3, el canal del código, y si el service worker es a mano o con plugin.

---

### D22 — Estados de carga: skeletons, barra de navegación y error de pantalla que no baja

**Estado:** aprobada el 2026-10-09 y construida en la fase 17.

**Problema.** Hoy hay 23 spinners o barras sueltas (`v-progress-circular` / `v-progress-linear`) y solo una pantalla
usa skeleton (Inventario). Las tablas quedan vacías con una barra fina y "Cargando…". Varias pantallas de detalle
(cobro, atención, venta, cita) muestran un círculo chico y nada más, y al navegar desde el menú no hay ninguna señal
mientras baja el código de la pantalla nueva (las rutas son `() => import(...)`).

**1. Skeletons compartidos.** `TableSkeleton`, `CardSkeleton` y `PageSkeleton` sobre `v-skeleton-loader` (ya se usa en
Inventario, sin dependencia nueva). Se muestran **solo en la primera carga**; al recargar, la tabla conserva sus filas y
solo lleva la barra fina, para que no parpadee. Con un **retraso de ~150 ms**: una respuesta rápida no enseña nada.
Respetan `prefers-reduced-motion`. Pieza compartida de §5.6: se usa en lugar de rehacerla. **Alternativa descartada:**
un spinner mejor estilizado (no dice qué viene ni evita el salto de diseño cuando llegan los datos).

**2. Barra de progreso global arriba**, atada al router (`beforeEach` / `afterEach`). Aparece si la navegación tarda más
de ~150 ms. Resuelve que, desde el menú, la pantalla anterior se queda quieta sin explicación mientras baja la nueva.
**Alternativa descartada:** poner el skeleton en `AppLayout` (no cubre las rutas de superadmin ni la pública, y hoy la
pantalla anterior sigue visible hasta que la nueva baja).

**3. Error al bajar una pantalla (`router.onError`).** Tras un despliegue, los archivos con hash del build anterior
desaparecen y la importación falla; hoy no hay manejo, así que no hay aviso. Se detecta el error de importación dinámica
(el mensaje cambia entre Chrome, Firefox y Safari, así que la detección es una función pura en `lib/`, con tests) y se
muestra "Hay una versión nueva de la aplicación" con botón para recargar. **No se recarga solo en bucle:** a lo más una
vez por sesión de navegación (marca en `sessionStorage`, con `try/catch`, §5.6).

**4. Skeleton por pantalla**, con la forma real de cada contenido, en lugar del círculo: Inicio, Reportes, Caja, cobro,
atención, detalle de venta y de cita, diálogos de cliente y mascota, y las pantallas de superadmin. Se migra por lotes.

**5. Fuera de esta decisión.**
- **La pantalla en blanco al recargar la página (F5)** se **ignora a propósito** (decidido el 2026-10-08): no se
  atiende en esta fase.
- Precarga de pantallas al pasar el mouse por el menú: queda como opcional, solo si tras el punto 2 aún se nota la espera.
- Cambiar cómo cargan los stores o los services: solo se cambia lo que se ve mientras llegan los datos.

**6. Sin dependencias nuevas** (§3). No toca la base ni las reglas de §7 y §8.

**Texto del aviso (decidido el 2026-10-09):** "Hay una versión nueva de FullPetCare. Recarga la página para continuar.", con el botón "Recargar".

**Pendiente:** si el retraso de 150 ms se ajusta tras probarlo en staging con red lenta.

### D23 — Suscripción modular: plan = base + módulos + extras, con derechos que impone la base

**Estado:** aprobada como **planeación** el 2026-10-09; **aún no se trabaja** (no hay fecha). Las decisiones de producto
de abajo ya las tomó el usuario; solo quedan pendientes los precios.

**Problema.** Hoy el plan es solo informativo (§6.8): no limita nada, el dueño no puede elegirlo y no hay cobro real.
Cada negocio necesita pagar por lo que usa: una veterinaria sin estética, un negocio que ya tiene su inventario o su
terminal de cobro, etc.

**Decidido por el usuario (2026-10-09).**
1. **Precio = base + módulos sumados** (cuota dinámica). Los planes del catálogo pasan a ser **plantillas** que precargan
   módulos; el superadmin puede ajustar a una empresa en particular. **Alternativa descartada:** planes cerrados
   (Básico/Pro/Premium) con personalización como excepción.
2. **Estética y Veterinaria son módulos independientes, pero se exige al menos uno.** Lo impone la base (restricción o
   trigger), no solo el formulario.
3. **Los cambios de plan aplican en el siguiente corte**, sin prorrateo. Se guardan como "cambio programado" y se
   aplican al renovar. **Alternativa descartada:** prorratear (cálculo de saldos y devoluciones, más superficie de error).
4. **Sucursales y empleados extra cobran por unidad pasada una cantidad incluida.** **Incluidos en la base: 1 sucursal y 3 empleados con acceso** (decidido el 2026-10-09); el umbral se guarda como dato
   del catálogo, no en código, para poder ajustarlo sin migración.
5. **Prueba gratis desde el primer release.** Duración: 14 días con todos los módulos (decidido el 2026-10-09). Al terminar sin plan
   elegido entra al mecanismo que ya existe (vigencia vencida → gracia → solo lectura → baja, §6.8): no se inventa uno nuevo.

**1. Derechos (*entitlements*) en la base, no en la interfaz.** Mismo patrón que `tenant_access_level()` (§6.8) y
`has_permission()` (D13): `app.has_module(tenant_id, módulo)` y `app.within_limit(tenant_id, límite, cantidad)`,
`STABLE`, que consultan las políticas RLS y las RPC (con `SECURITY DEFINER` donde haga falta, revalidando membresía,
§7.3.4). Ocultar menús con `v-if` es comodidad, nunca la regla. Cada tabla de un módulo lleva su test: sin el módulo,
ni la API directa escribe.

**2. Qué es base y qué es módulo (confirmado el 2026-10-09).**
- **Base (siempre):** clientes, mascotas, agenda, catálogo de servicios, cobro de citas, empleados y permisos, vista
  pública, Inicio.
- **Módulos:** Estética, Veterinaria, Inventario y productos, Punto de venta, Caja, Reportes, Facturación (CFDI).
- **Dependencias:** Punto de venta requiere Inventario (solo vende productos); Facturación y Reportes no tienen
  dependencia (confirmado).
- **Límites:** sucursales y empleados con acceso. Almacenamiento queda fuera de esta decisión.

**3. Apagar un módulo no borra nada (§8.5).** Los datos se conservan. Un módulo apagado deja de aceptar escrituras y
desaparece de menús y rutas; el **expediente clínico sigue legible** aunque Veterinaria se apague, porque es un
documento legal. Citas ya agendadas de un tipo apagado se pueden atender y cobrar hasta cerrarlas. Reactivar el módulo
devuelve todo como estaba.

**4. Precio como dato, con copia al contratar.** `module_prices` y límites en el catálogo; la suscripción guarda una
**copia** de lo contratado (`*_snapshot`, como en §6.3), así que subir un precio del catálogo no toca a quien ya paga.
Todo en centavos (§8.2) con IVA incluido (D5). Anual con descuento propuesto (porcentaje en *basis points*). La suma
vive en `lib/subscriptionPricing.ts` (función pura, muy probada) y la repite la base, como `cashCount` (D17).

**5. Pago real: se decide al final.** Se construye todo con pago simulado, como SPEI/OpenPay hoy, y el proveedor se elige
cuando el modelo esté estable. Candidatos: Stripe, Conekta/OpenPay, Mercado Pago. Al elegir se justifica con el usuario
(costo, alternativas y contras, §3) y entra por Edge Function con webhooks, sin tocar la `service_role` desde el frontend.

**6. Cambia lo escrito en §6.8:** "el plan es solo informativo" y "autoservicio fuera de alcance". Se actualizan en el
mismo PR de la fase 18.

**7. Fases propuestas.**
- **Fase 18, motor de derechos:** módulos, `has_module`, límites, menús y rutas limitados, restricción de "al menos uno",
  tests de aislamiento. Aún sin precios ni cobro.
- **Fase 19, constructor de planes:** el superadmin arma plantillas, precios y ajustes por empresa; calculadora.
- **Fase 20, autoservicio del dueño:** elegir plan al darse de alta, prueba gratis, "Mi suscripción", cambios
  programados al corte y pago simulado.
- **Fase 21, pago real:** proveedor, webhooks, reintentos de cobro y factura de la suscripción.

**Cambio de plan que choca con un límite (decidido el 2026-10-09):** si el plan nuevo permite menos sucursales o
empleados de los que hay activos, el cambio **no se programa** hasta que el dueño desactive los sobrantes (se le pide en
pantalla, nunca se desactiva a nadie solo). La base lo revalida también al aplicarse en el corte.

**Pendiente:** precios de cada módulo, de la sucursal y del empleado extra, y el porcentaje de descuento anual.

---

### D24 — Recordatorios de citas y vacunas: primero a mano con un toque, después automáticos

**Estado:** propuesta (2026-10-09); no se construye hasta que el usuario la apruebe.

**Problema.** La cartilla guarda `next_due_date` y la agenda guarda las citas, pero nadie avisa al cliente: hoy el link
se copia y se pega a mano (§1). Es donde más valor se pierde en una veterinaria o estética: citas a las que el cliente
no llega y vacunas que nadie recuerda.

**1. Se construye en dos escalones.** El primero no necesita ningún servicio externo.
- **Escalón 1 (fase 22B y 22C): lista de recordatorios con envío "de un toque".** Una pantalla muestra a quién hay que
  avisar hoy o mañana y arma el mensaje; el botón abre WhatsApp con el texto ya escrito (enlace `wa.me`) y la persona
  solo presiona enviar. Se registra que se avisó. Costo: cero. Contra: lo manda una persona, desde el teléfono o el
  WhatsApp Web del negocio.
- **Escalón 2 (fase 22D): envío automático.** Requiere un servicio externo y se justifica con el usuario antes (§3).

**2. Canal del envío automático (pendiente de elegir).**

| Canal | A favor | En contra |
| --- | --- | --- |
| **A. WhatsApp Business API** (directo con Meta o con un proveedor intermediario) | Es el canal que el cliente sí lee en México | Cobra por conversación según tarifas vigentes (verificar antes de decidir); exige verificar el negocio y que Meta apruebe las plantillas; sin la respuesta del cliente no hay conversación |
| **B. Correo** (servicio de correo transaccional) | Casi gratis, sin aprobación de plantillas, mismo canal que el código de acceso de D21 | Mucha gente no lo lee para esto; requiere dominio con SPF/DKIM para no caer en spam |
| **C. SMS** | Llega a cualquier teléfono | Caro por mensaje y poco profesional; no se recomienda |

Recomendación: empezar por **B** (o por el escalón 1 solamente) y dejar **A** como segundo canal cuando haya un negocio
que lo pague, porque el costo por mensaje puede volverse un módulo o extra de la suscripción (D23, fases 19 a 21).

**3. Qué se recuerda (primera versión).** (a) Cita agendada, con antelación configurable por negocio (por defecto 24 h).
(b) Vacuna próxima, a 7 días del `next_due_date`. **No se recuerda** una cita `walk_in`, cancelada, ni de un cliente sin
consentimiento. Queda como candidato aparte la `next_visit_date` de la consulta.

**4. Consentimiento (obligatorio).** `customers.accepts_reminders` (booleano, `false` por defecto) con su fecha. Se marca
en el formulario del cliente. WhatsApp exige el permiso del cliente y la ley mexicana de datos personales pide un aviso
de privacidad; **sin consentimiento no se envía nada**, ni a mano ni automático. Los clientes que ya existen quedan en
`false` (más seguro; el importador de D25 trae una columna opcional para marcarlo). Se necesita una forma de baja:
enlace en el correo y, para WhatsApp, responder "BAJA" (esto último pide recibir mensajes entrantes, fuera de esta fase).

**5. Diseño de datos.**
- Tabla `reminders` (§6: `tenant_id`, borrado suave, RLS): `kind` (`appointment` | `vaccination`), `appointment_id` o
  `vaccination_id` (un `check` exige exactamente uno), `customer_id`, `channel` (`manual_whatsapp` | `whatsapp` |
  `email`), `scheduled_for`, `status` (`pending` | `sent` | `failed` | `skipped`), `sent_at`, `sent_by`, `attempts`,
  `error_message`, `provider_message_id`. Un **índice único parcial** impide dos recordatorios vivos de lo mismo
  (idempotencia: si el trabajo corre dos veces, no manda doble). Sin política de DELETE.
- Los usuarios solo insertan `manual_whatsapp` (lo que ellos mismos mandaron); los envíos automáticos y sus estados los
  escribe únicamente la Edge Function, mismo patrón que `invoice_requests` (§6.5).
- Ajustes por negocio en `tenant_reminder_settings` (activar cada tipo, antelación, canal) y un módulo nuevo de
  permisos `reminders` en `role_permissions` (dueño y recepción ver/editar; groomer y vet nada), como `cash_register`.
- **Horas en la zona de la sucursal (§8.3).** `scheduled_for` es `timestamptz`; "mañana" se calcula con la zona IANA de
  la sucursal, y no se envía de noche (ventana propuesta: 08:00 a 21:00 locales).

**6. Envío automático.** `pg_cron` (ya lo usa `suspend_expired_tenants`, §6.8) corre cada hora y encola lo que toca
(`app.enqueue_due_reminders()`, solo `postgres`/`service_role`). Una Edge Function `send-reminders` toma los pendientes
(`for update skip locked`, para que dos ejecuciones no tomen la misma fila), envía, registra el resultado y reintenta
hasta 3 veces. La llave del proveedor vive solo en las variables de la función, nunca en el frontend (§10). Si se
reprograma o cancela la cita, el recordatorio pendiente se descarta.

**7. Privacidad del mensaje.** Solo lo mínimo: nombre de la mascota, fecha, hora y sucursal. **Nunca** diagnóstico,
tratamiento, montos ni notas internas (mismo criterio que la vista pública, §7.4).

**8. El demo nunca manda mensajes reales.** Producción es el demo (D10). Local, staging y las empresas marcadas
`is_demo` usan un **proveedor simulado** que solo registra; así ningún cliente ficticio, ni uno real por error, recibe un
mensaje durante una presentación. Los tests de la Edge Function usan ese mismo simulado (sin mocks elaborados, §9).

**9. Fuera de esta decisión:** confirmar la cita respondiendo el mensaje (necesita recibir mensajes entrantes),
campañas o promociones, y recordatorios push de la PWA (D21).

**Pendientes:** aprobar o ajustar el escalón 1; elegir canal del escalón 2 y proveedor; consentimiento de los clientes ya
existentes; antelación y ventana de envío por defecto.

---

### D25 — Importador de clientes y mascotas desde CSV

**Estado:** propuesta (2026-10-09); no se construye hasta que el usuario la apruebe.

**Problema.** Casi ningún negocio empieza desde cero: trae cientos de clientes en Excel, en un cuaderno capturado o en otro
sistema. Capturarlos uno por uno es la razón más probable por la que un negocio no se cambie.

**1. Formato: un CSV, una fila por mascota.** Se ofrece una **plantilla descargable** con columnas fijas; los datos del
cliente se repiten en cada una de sus mascotas y las filas con el mismo teléfono se agrupan en un solo cliente. Una fila
sin datos de mascota crea un cliente sin mascotas. **Alternativas descartadas:** dos archivos (clientes y mascotas; el
usuario tendría que ligarlos por una llave que no existe en sus hojas) y mapeo libre de columnas (más pantalla, más
errores; se reconsidera si los negocios traen formatos muy distintos).

**2. Excel (`.xlsx`) no se lee en esta fase.** Leer `.xlsx` en el navegador pide una librería nueva (§3). El usuario guarda
la hoja como "CSV UTF-8" (se explica en la propia pantalla). El lector de CSV se escribe a mano en `lib/csv.ts`
(comillas, comas y saltos de línea dentro de comillas, BOM, saltos CRLF y separador `;`, que Excel con configuración
regional en español usa a veces). Si resulta frágil, se propone `papaparse` y se justifica aparte.

**3. Todo se valida en el navegador y se revalida en la base.** La lógica es una función pura en
`lib/importCustomers.ts`: de filas y clientes existentes a un plan (`crear`, `omitir`, `error`, con la fila y el motivo).
Reutiliza `lib/validation.ts` (teléfono, RFC, CP, `customerFiscalProblems`). La vista previa muestra los errores por
fila **antes** de escribir nada. Como el navegador no es de fiar (§7), la RPC vuelve a validar.

**4. Duplicados.** Un cliente es duplicado si su teléfono normalizado (10 dígitos) ya existe en el negocio o se repite en
el archivo (si no trae teléfono, por correo). **Política: omitir, nunca sobrescribir** lo que ya está capturado. Una
mascota es duplicada si el mismo cliente ya tiene una del mismo nombre y especie.

**5. Aplicar: una sola RPC atómica.** `import_customers(p_rows jsonb, p_file_name text)` (`SECURITY DEFINER`, revalida
membresía y rol dueño o recepción en la primera línea, §7.3.4). **Todo o nada** en una transacción, con un máximo de
**1 000 filas por archivo** (un archivo mayor se parte). Devuelve el resumen (creados, omitidos, errores).
**Alternativa descartada:** un `insert` por cliente desde el navegador (no es atómico: una conexión caída dejaría la
importación a medias, mismo argumento que el borrado en cascada de D19).

**6. Deshacer.** Cada importación crea un registro en `import_batches` (`tenant_id`, quién, nombre del archivo, conteos) y
`customers`/`pets` ganan `import_batch_id` (nullable, migración aditiva, §8.1). La RPC `undo_import(p_batch_id)` oculta
(borrado suave, §8.5) lo importado **que todavía no tenga citas ni ventas**; lo que ya se usó se queda y se informa. Sin
esto, un archivo mal armado ensucia la cartera y arreglarlo es a mano.

**7. Privacidad.** El archivo se procesa en el navegador y **no se guarda**; solo queda el resumen. Los datos de los tests y
de la plantilla de ejemplo son ficticios (§11). Los clientes importados quedan con `accepts_reminders = false`, salvo
que el archivo traiga la columna opcional `acepta_recordatorios` (D24).

**8. Fuera de esta decisión:** importar citas, ventas, historial clínico, cartillas de vacunación y productos
(candidatos posteriores; la cartilla es el más pedido), y leer `.xlsx`.

**Pendientes:** aprobar la plantilla de columnas (propuesta en 23.1), si el lector de CSV se escribe a mano o con
librería, y el máximo de filas.

---

### D26 — Correcciones 1: el traslape avisa en vez de bloquear, cliente y mascota juntos, y búsqueda sin acentos en la base

**Estado:** aprobada el 2026-10-12 (decisiones de producto y pendientes resueltos por el usuario; tabla de `TASKS.md`
"Correcciones 1"). Aún no se construye.

**Problema.** Doce observaciones de uso. La mayoría son de interfaz, pero tres tocan reglas que hoy vive la base (el
traslape de citas, el correo del cliente y la búsqueda), y esas no se arreglan solo en Vue.

**1. El traslape deja de rechazarse.** Hoy `create_appointment()` y `reschedule_appointment()` lanzan "Este empleado ya
tiene una cita en ese horario" y `computeAvailableSlots` **oculta** los huecos ocupados. El usuario pidió lo contrario:
elegirlos y solo avisar con un chip amarillo. Si solo cambiara la interfaz, la base lo rechazaría al guardar, así que
**cambia la regla en la base**. Alternativas: (a) quitar el rechazo (elegida); (b) conservarlo y que el aviso sea "esto
va a fallar" (contradice lo pedido); (c) un parámetro `p_allow_overlap` (una regla que depende de quien llama no
protege nada). **Costo aceptado:** un empleado puede quedar con dos citas encimadas; "ocupado" pasa a ser un aviso, no una
garantía, y los tests que hoy esperan el rechazo cambian de sentido.

**2. Fecha y hora, validadas también en la base.** Pasado (sin tolerancia), fin ≤ inicio, día cerrado y fuera de
horario, solo al crear y reprogramar. El "ahora" es el `now()` **de la base**, no el reloj del navegador (mismo motivo
que ya usa `create_walk_in_appointment`), y el horario se calcula en la zona IANA de la sucursal (§8.3). **Alternativa
descartada:** validar solo en el formulario (cualquier llamada directa a la API se salta la regla).

**3. Correo único por negocio, con un trigger y no con un índice único.** Un índice único parcial
(`where deleted_at is null`) **fallaría al aplicarse** si hoy hay duplicados, y no puede expresar "solo cuando el correo
cambia", que es lo que se pidió para no bloquear a nadie por un dato que ya estaba así. El trigger toma un candado por
(negocio, correo) para que dos altas simultáneas no pasen las dos. **Costo aceptado:** es una regla nuestra, no una
garantía del motor. **Efecto en D25 (importador, propuesta):** una fila con correo repetido se reporta como error de
esa fila.

**4. Cliente y mascota se dan de alta en una sola transacción** (`create_customer_with_pet()`), por el mismo
argumento que el borrado en cascada de D19: dos inserts desde el navegador pueden dejar un cliente sin mascota si el
segundo falla, justo lo que la regla "mascota obligatoria" quiere evitar. **Alcance:** es una regla del **alta**, no un
invariante de la tabla (un cliente puede quedarse sin mascotas si se eliminan después). **No definido:** si aplica al
importador de D25.

**5. Búsqueda sin acentos resuelta en la base.** Extensión `unaccent` (contrib de Postgres, disponible en Supabase) con
una función `app.search_norm()` `IMMUTABLE` que la envuelve (la original es `STABLE` y no sirve para índices), y RPC
`search_*` con la seguridad de **quien llama** (RLS aplica, §7.3). Se conserva el criterio de cada pantalla: clientes
"empieza con" (ver el comentario de `customers.sql`), mascotas y productos "contiene". **Alternativas:** (b) columna
generada `search_text` con índice trigram, más rápida con miles de filas pero con más piezas (se reconsidera si algún
negocio crece); (c) normalizar en el navegador, que es lo que ya hacen `lib/petSearch.ts` y `lib/productSearch.ts` y lo
que el usuario descartó ("lo debe procesar el back"). **Riesgo:** hoy mascotas, inventario y punto de venta filtran en
memoria y una consulta por tecla agrega latencia; se mide en el punto de venta y, si estorba, se agrega espera al
teclear. **Dependencia:** una extensión de Postgres, justificada aquí (§3, §11).

**6. Página de cliente con ruta propia** (`/app/clientes/:id`) y no un diálogo a pantalla completa (lo eligió el
usuario): se puede abrir con un enlace y el botón de atrás funciona. Reutiliza la gráfica de peso, el link para
compartir y la cartilla de `PetEditDialog`, sin duplicarlos. **Revierte** la decisión 2 de la fase 14 ("la fila no abre
nada"). `PetsPanel.vue` y los diálogos viejos se conservan sin uso (regla de D19).

**7. Tooltips con `v-tooltip` de Vuetify en una pieza compartida.** Alternativa descartada: el atributo `title` del
navegador (tarda, no se puede dar estilo y no aparece con el teclado; hoy solo 3 botones lo usan). El texto del tooltip
es también el `aria-label`, así que los 6 botones que hoy no tienen ninguno quedan cubiertos. Solo con puntero.

**8. Empleados.** "Eliminar" es borrado suave de la **membresía** (no de `auth.users` ni de `profiles`: la persona es
global y podría trabajar en otro negocio, §6.1). Desactivar y eliminar se **bloquean con citas programadas**, como las
sucursales, con un trigger (la regla vive en la base, §7.3).

**9. Color de aviso de traslape: un token nuevo.** El `warning` actual (`#9A5B00` claro, `#F0B24A` oscuro) ya significa
"sin esterilizar" y alertas de inventario, y en claro es casi el naranja de estética (`#C25400`), que §5.6 reserva.
Reutilizarlo mezclaría significados. El usuario pidió "un amarillo distinto" y revisará la paleta después; el test de
contraste AA valida cualquier valor.

**10. Sin dependencias npm nuevas** (§3). No relaja §7 ni §8: la migración es aditiva (§8.1), no hay dinero ni fechas
fuera de UTC, y todo `SECURITY DEFINER` revalida membresía.

**Decisiones que cerraron los pendientes (2026-10-12):**

1. **Llegada sin cita:** el traslape **avisa y el trabajador decide** si lo acepta (el aviso dice que ya hay una cita y
   que puede alterar la cronología). A diferencia de agendar, pide **confirmación**. `create_walk_in_appointment()`
   deja de heredar el rechazo, pero **conserva su ventana de pasado de 10 minutos**: no hereda la regla "sin tolerancia".
2. **Reprogramar** permite el traslape con aviso, igual que agendar (misma regla en las dos RPC).
3. **Fuera del horario laboral no se muestran huecos**, como hoy; solo se deshabilitan los pasados y se marcan los
   ocupados.
4. **Eliminar mascota** desde su tarjeta en la página de cliente.
5. **"Editar" abre los modales** `CustomerEditDialog` y `PetEditDialog` ya existentes (menos código nuevo que un modo
   edición dentro de la página).
6. **Empleados:** la fila deja de abrir el formulario; se edita con el ícono.
7. **Contraseña de empleado:** temporal, mostrada una sola vez y con cambio obligatorio. Esto **amplía §7.6**, que hoy
   deja fuera a los empleados invitados; solo aplica al restablecimiento, no a la invitación. **Alternativa
   descartada:** enlace de recuperación al correo.

**Sin pendientes de producto.** Aprobada por escrito el 2026-10-12 (C1.1).

**Decisiones surgidas al construir la ola 1 (2026-10-12):**

8. **Re-alta de un empleado eliminado: se reactiva su fila.** `memberships` tiene `unique (tenant_id, user_id)` y el alta
   rechaza si la fila existe aunque esté eliminada ("Esta persona ya tiene acceso"). El alta debe **reactivar** la
   membresía eliminada (quitar `deleted_at`, `is_active = true`, nuevo rol y sucursales) en lugar de rechazarla.
   Pendiente de construir (migración nueva sobre `create_employee_membership`).
9. **La ñ no se confunde con la n** en la búsqueda de la base (`app.search_norm()` la conserva). Hoy el navegador
   (`lib/petSearch.ts`, `lib/productSearch.ts`) las iguala; al conectar los buscadores (C1.20) ese comportamiento cambia
   y es lo deseado.
10. **La llegada sin cita no valida horario de sucursal ni traslape** (solo su ventana de 10 minutos de pasado): una
    urgencia fuera de horario se puede registrar. El aviso y la confirmación del traslape son de la interfaz.

### D27 — Ancho del contenido: dos anchos, el de listados crece con la ventana hasta 1440 px

**Estado:** aprobada el 2026-10-12 (el usuario eligió `clamp` y tope de 1440 px). Construida en la fase 24.

**Problema.** `VContainer` tiene un solo `maxWidth: 860` en `plugins/vuetify.ts`. En un monitor de 1920 px quedan
unos 500 px vacíos a cada lado, y a las tablas y a la página del cliente (tres columnas) les falta espacio. Para
formularios y detalle de una columna, en cambio, 860 px es lo correcto.

**Decisión.**
1. **Ancho de listados y tableros:** `clamp(860px, 75vw, 1440px)`. Nunca baja de 860 (como hoy), crece con la
   ventana y no pasa de 1440. Es el nuevo default de `VContainer`.
2. **Ancho de formularios y detalle:** 860 px fijos, pasados por una constante compartida (`lib/contentWidth.ts`);
   las páginas no escriben números sueltos.
3. **Sin cambio:** Agenda y Punto de venta (ya sin tope), vista pública (480 px) y las pantallas de autenticación.

**Alternativas descartadas.** (a) Subir el tope global a un número fijo: estira los formularios. (b) Sin tope
(`fluid`) en todo: las tablas se vuelven ilegibles en monitores ultraanchos. (c) Preferencia del usuario "centrado o
completo" en el menú: más piezas (preferencia, control, probar dos modos por pantalla) para un problema que se
resuelve con dos anchos; queda como mejora posterior si alguien la pide.

**Contras y riesgos.** `75vw` incluye el menú lateral, así que el contenido real queda un poco más angosto de lo que
dice la fórmula; se ajusta a ojo en 1366, 1440, 1920 y 2560 px. `SettingsPage` ubica su riel lateral en el margen libre
del contenedor (`settings-container`): **debe quedarse en 860 explícito**, o el riel se mueve. Sin dependencias nuevas
(§3), sin tocar la base ni §7 y §8.

### D28 — Calendario de la agenda: bloques tonales, marco de tarjeta y barra única

**Estado:** aprobada el 2026-10-12 (el usuario eligió las propuestas A y B). Se construye en la fase 25.

**Problema.** El calendario de la agenda (`EmployeeDayScheduler.vue`, `EmployeeWeekCalendar.vue`) se ve básico junto
al resto del sistema: cada cita es un relleno sólido y saturado del color de su estado, el calendario flota sin
tarjeta, los encabezados son los de la librería, el origen de la cita se marca con emojis y el filete de la franja de
tipo es blanco fijo (se ve duro en modo oscuro).

**Decisión.**
1. **Bloque tonal.** Fondo = el color del estado mezclado al 16 % con `surface`, texto `on-surface`, borde fino del
   color del estado y radio `md`; punteado en cancelada y "no se presentó". El bloque **no lleva íconos** (decisión del
   usuario, 2026-10-12): el nombre del estado va en el tooltip y en la leyenda (`lib/agendaStatus.ts`), que sí usa el
   ícono. Excepción a "el color nunca va solo" (§5.6), igual que la franja de tipo.
2. **Franja de tipo.** Se queda como única señal del tipo dentro del bloque (sin ícono; el nombre va en el tooltip,
   decisión del usuario del 2026-10-12, excepción a "el color nunca va solo" de D20); su filete usa `surface`.
3. **Origen de la cita.** Sin ícono en el bloque; "Sin cita" y "Urgente" van en el tooltip. Fuera los emojis.
4. **Marco.** `v-card` con borde que agrupa barra, leyenda y calendario. Barra única con `‹ Hoy ›` y la fecha escrita,
   que abre un `v-date-picker`.
5. **Encabezados.** Empleado con avatar de iniciales y contador de citas del día; días de la semana con la tipografía
   de marca.
6. **Sin estado vacío.** Se construyó un `EmptyState` compacto sobre la cuadrícula y el usuario lo quitó por redundante
   (2026-10-12): un día sin citas es la cuadrícula vacía, con los empleados en "Sin citas".

**Alternativas descartadas.** (a) Mantener el relleno sólido y solo afinar bordes: no resuelve la sensación de peso.
(b) Tarjeta que cambia de contenido según su alto, tooltip propio y línea de "ahora" (propuesta C): se pospone; depende
de cómo se comporte `eventContent` con la altura real de cada bloque y la línea de "ahora" exige un reloj de sucursal.
(c) Cambiar de librería de calendario: descartado en D20 y en `CLAUDE.md` §3.

**Contras y riesgos.** El fondo tonal es más claro que el relleno sólido: el contraste debe medirse (25.3) y se
revisa a ojo en ambos temas. `color-mix()` exige un navegador reciente (2023 en adelante), el mismo piso que ya pide
Vuetify 3.13. Sin dependencias nuevas (§3), sin tocar la base ni §7 y §8.

---

### D29 — Correcciones 2: imagen de empresa, catálogo de vacunas editable y vista responsiva

**Estado:** propuesta del 2026-10-13, pendiente de aprobación. Se construiría en la fase 26.

**Decisiones del usuario (2026-10-13).**
1. **Imagen de empresa:** se muestra **en el lugar de las iniciales** del selector de negocio ("PF" en
   Patitas Felices). No se pidió en la vista pública ni en el ticket: quedan fuera hasta que se pida.
2. **Catálogo de vacunas:** lo editan **dueño y veterinario**.
3. **Tablas en pantallas chicas:** cards en todas (Clientes, Servicios, Inventario, Empleados, Sucursales, Reportes).
4. **Agenda en celular:** lista del día por hora.

**Supuestos a confirmar.**
- Las vacunas viven en una sección "Vacunas" de Configuración (no se eligió ubicación). Alternativa: pestaña junto a
  Servicios, pero Servicios es de dueño y recepción, y ahí el vet no entra.
- El permiso de vacunas sigue por **rol** (como hoy), no por `role_permissions`: abrirlo a `vet` es una migración
  pequeña. Alternativa: un módulo de permisos nuevo, más flexible pero desproporcionado para esto.
- La imagen va en bucket **privado** con URL firmada, igual que `pet-photos`; no hace falta bucket público.
- Reportes: sus tablas son numéricas; las cards de Reportes se limitan a resúmenes legibles, y el CSV sigue igual.

**Alternativas descartadas.** (a) Solo scroll horizontal en las tablas: es lo que hay hoy y es lo que se observó.
(b) Una librería de tablas responsivas: no se agregan dependencias (§3).

**Contras y riesgos.** Abrir `vaccines` al vet es la primera vez que un catálogo lo escribe alguien que no es dueño:
un vet puede ocultar una vacuna que otro usa; mitiga el borrado suave y la bitácora. La imagen de empresa es la primera
columna que el usuario sube fuera del expediente: tamaño y tipo se limitan en el bucket. Respeta §7 y §8 (RLS, migraciones
aditivas, borrado suave).

---

### D30 — Observaciones del veterinario: catálogos, receta, cobro de paso, familias, cirugías y hospitalización

**Estado:** aprobada por el usuario el 2026-10-14. Sale de la visita a un veterinario (12 observaciones) y de
una ronda de preguntas con el usuario. Construida la oleada 1 (fases 27, 28, 29B y 16A). Se construye en las fases **27 a 33** (más la 16B, ya propuesta). Ninguna fase
arranca sin que se apruebe esta decisión.

**Las 12 observaciones y dónde cae cada una.**

| # | Observación | Fase |
| - | ----------- | ---- |
| 1 | Catálogo de razas (y de especies, ampliado a aves y reptiles) | 27 |
| 2 | Edad y cálculo de fecha de nacimiento | 27 |
| 3 | Formato de receta médica | 28 |
| 10 | Proveedores de insumos | 29 |
| 12 | Medicamentos a medias (fraccionados) | 29 |
| 8 | Comprobante rápido sin registrar | 30 |
| 5 | Familias | 31 |
| 4 | Transferencia de dueños | 31 |
| 6 | Costos de cirugía | 32 |
| 7 | Costos de hospitalización (y su control) | 33 |
| 11 | Contacto directo con el cliente | 16B y 33: el aviso dentro del sistema |
| 9 | Mensajes por WhatsApp | **Ya existe como propuesta: fase 22 (D24).** Es un aviso de eventos, no comunicación directa |

El orden pedido por el usuario es: razas, especies, edad, receta, proveedores y fraccionados primero; **hospitalización
al final**, porque depende de la 16B.

**Decisiones del usuario (2026-10-14).**
1. **Razas y especies:** catálogos **editables**. Especie = gran grupo (aves, reptiles…) + especie común dentro del grupo.
   Las razas cuelgan de la especie; en aves y reptiles el nivel es la especie común, sin razas. Hoy `pets.species` es el
   enum `dog | cat | other`.
2. **Edad:** si el dueño dice "tiene 3 años" (o "3 años y 2 meses"), el sistema **calcula una fecha aproximada** y el
   veterinario puede proponerle otra al cliente. La fecha queda marcada como **estimada**.
3. **Receta:** se **imprime desde el navegador**; sin dependencia de PDF. Lleva datos del veterinario con **cédula**, de la
   empresa y la sucursal, fecha, mascota y dueño, y debajo una tabla con medicamento, dosis, frecuencia y duración, más
   espacio de **firma**. El medicamento sale del catálogo de productos o es **texto libre**; los de texto libre generan un
   **aviso al dueño del negocio** para que decida registrarlos. La receta queda **ligada a la consulta**. La emiten solo
   **veterinario y dueño**, y solo si tienen cédula (un dueño puede ser veterinario). La cédula se captura al dar de alta
   al veterinario.
4. **Proveedores:** solo **catálogo** (nombre, contacto, teléfono, correo, tipo y notas). Un producto puede tener
   **varios** proveedores. **Sin órdenes de compra ni cuentas por pagar.**
5. **Fraccionados:** el inventario registra la **presentación** (caja de N blísters, frasco de N ml). Al vender se elige
   **unidad o producto** (por defecto, producto). Un envase **abierto** se indica y lleva cuánto se ha usado. El precio de
   la unidad **se calcula** y se puede modificar **en el producto y en cada venta**, por veterinario, dueño y recepción.
6. **Cobro de paso:** un servicio (y productos en el mismo ticket) **sin cita y sin cliente**. Lleva servicio, precio,
   fecha, **quién atendió** y el **grupo de especie** (genérico: perro, gato, ave, reptil; solo estadística). Entra a
   reportes y caja como cualquier venta. Se imprime desde el navegador.
7. **Familias:** una familia tiene **nombre propio** y **varias mascotas**; se muestra como "Familia X – Nube, Toby…".
   Un cliente pertenece a **una sola** familia. Hay un **titular** y los demás miembros solo **ven la mascota, la cartilla,
   las citas y la bitácora de hospitalización, y reciben avisos**. Los miembros no titulares **no ven montos**.
8. **Transferencia:** la mascota pasa a un **cliente suelto**; si ese cliente pertenece a una familia, la familia accede.
   Las **citas programadas se transfieren**, las **ventas se quedan** con el dueño anterior y los **links compartidos se
   revocan**. El nuevo dueño ve **todo el historial** (cartilla, medicamentos, expediente, estética, hospitalización) **sin
   montos**. El dueño o familia anterior solo ve **lo ocurrido mientras fue dueño**.
9. **Cirugías:** catálogo propio del negocio (el Excel del veterinario no se comparte). Cada cirugía es un **paquete con
   renglones** de tipo consumible, honorario o medicamento, cada uno con su precio. Consumibles y medicamentos se ligan a
   productos y **descuentan inventario**; los honorarios no. El veterinario puede **ajustar los renglones** de una cirugía
   concreta y también **armar una desde cero** con renglones del catálogo.
10. **Hospitalización:** estancia **y** control. Ingreso, alta, días, **medicamentos administrados** (descuentan inventario
    y se cobran), **espacio** y **bitácora**. La bitácora la escriben veterinario, dueño del negocio y recepción; cada nota
    lleva hora, lo realizado, biometrías **opcionales** y texto libre. Las biometrías son: temperatura, peso, frecuencia
    cardiaca, color de mucosas, estado de ánimo y micción/defecación (las tres últimas con **opciones fijas**).
    - **Espacios:** jaulas definidas por el negocio **por sucursal**, **sin tope** de mascotas por jaula.
    - **Tarifa:** por **día** o por **estancia**, a elegir al ingresar. El negocio **configura** cómo cuenta el día
      (natural o 24 horas) y si la tarifa es única o por tipo de espacio. *(Lectura mía de "El negocio lo configura"; se
      corrige si no era eso.)*
    - **El dueño de la mascota** ve salud, bitácora **y costo**, solo lectura y **en cuanto llega al servidor**. Los
      miembros no titulares de la familia ven salud y bitácora, **no el costo**.
    - **Aviso al abrir el cobro** de una mascota que sigue hospitalizada ("¿ya se le dio de alta?").
11. **Contacto directo:** el dueño se entera **dentro del sistema**, sin WhatsApp, mediante la PWA con cuenta del cliente
    y notificaciones push (16B). Es requisito de la fase 33.

**Decisiones técnicas propuestas (a confirmar al construir).**
- **Catálogos (27):** tablas `species_groups`, `species` y `breeds`, con `tenant_id`, borrado suave y edición por dueño y
  veterinario (mismo patrón que `vaccines`, D29). `pets` gana `species_id` y `breed_id` **nulos**; el enum `pet_species`
  y el texto `breed` **se conservan** (migración aditiva, §8.1) y se rellenan al editar la mascota. Un catálogo base se
  siembra por negocio con razas en español y la ortografía correcta (Xoloitzcuintle, Pastor alemán, Schnauzer…).
  *Alternativa descartada:* un catálogo global de plataforma, porque cada negocio querrá agregar el suyo.
- **Edad (27):** función pura en `lib/` (años y meses → fecha aproximada) y columna `pets.birth_date_is_estimated`.
  Sin dependencia nueva.
- **Cédula (28):** va en `employee_details`, que ya guarda datos personales por membresía (§6.7).
  *Alternativa:* `profiles` (global), descartada porque el dueño que también es veterinario no siempre tiene detalle de
  empleado; **a confirmar**.
- **Fraccionados (29):** la existencia se guarda en la **unidad base** (tableta, ml), siempre entera (§8.2), con un factor
  de conversión por producto. *Alternativa descartada:* dos productos (caja y suelta), porque la existencia se
  descuadra al recortar un blíster. El redondeo del precio de la unidad usa `lib/money.ts` y tiene tests de borde.
- **Cobro de paso (30):** RPC nueva (como `checkout_counter_sale`) que cobra servicios y productos sin cita ni cliente.
  `sales.customer_id` ya admite nulo. Revalida permiso y sucursal (§7.3).
- **Familias y transferencia (31):** `families`, `family_members` y `pet_ownerships` (historial de titulares con
  fechas), con RLS y bitácora. La visibilidad por periodo la impone la base, no la interfaz. El dato monetario nunca sale
  en el DTO del nuevo dueño.
- **Cirugías (32) y hospitalización (33):** reutilizan lo que ya hay (`appointment_products` para el consumo con
  inventario, `appointment_services` para honorarios) en lugar de tablas paralelas; se decide al inventariar en 32.1 y
  33.1. La bitácora de hospitalización es **expediente**: nunca se borra y todo cambio queda en `audit_log` (§8.5, §8.6).
- **16B (cuenta del cliente y push), inferido a petición del usuario:** alternativa A de D21 (Edge Function que emite
  una sesión corta; el cliente nunca toca Postgres), código de un solo uso por **correo**, service worker escrito **a
  mano**, y notificaciones con **Web Push estándar** (sin servicio de terceros). Si una librería de cifrado en la Edge
  Function resulta necesaria, se justifica antes de agregarla (§3). El aviso de la fase 33 **no** manda datos clínicos en
  el cuerpo de la notificación: solo "Hay novedades de <mascota>".

**Decisiones surgidas al construir la oleada 1 (2026-10-14).**
- **Cédula (28):** quedó en `employee_details.professional_license` (no en `profiles`). La receta guarda una **copia**
  del nombre y la cédula al emitirse, así que corregir la ficha después no cambia recetas viejas.
- **Quién emite y quién lee (28):** emite el dueño o el veterinario **asignado a la cita** (misma regla que
  `medical_records`) y solo con cédula; la leen dueño y veterinario. Recepción y groomer no la ven. Cuando llegue la
  fase 31, el nuevo dueño y la familia la ven por la misma regla de visibilidad que el resto del expediente.
- **Aviso de medicamentos de texto libre (28):** vive en **Inicio** del dueño, no en Inventario (para no tocar el
  formulario de producto de la 29B). Ligar a un producto nuevo exige registrarlo antes en Inventario.
- **Especie y raza (27):** el enum `pet_species` y el texto `breed` se conservan y la interfaz los mantiene al elegir del
  catálogo (`species.legacy_kind`). Las vacunas "por especie" siguen distinguiendo solo perro y gato; ampliarlas a aves
  y reptiles queda como mejora aparte.
- **`demo:reset` (27):** vuelve a mostrar lo que se ocultó del catálogo, pero **no quita** lo que se agregó durante una
  demo (sin una marca `is_base` no se distingue de lo base).
- **PWA (16A):** el manifiesto es uno solo y no puede llevar el token de cada mascota, así que `start_url` es `/c` y la
  vista pública **recuerda en el teléfono el último link abierto** (`localStorage`). Es el único cambio al
  comportamiento del acceso; el acceso sigue siendo el link con token. **A confirmar con el usuario.**
- **Proveedores (29B):** el tipo de proveedor es un enum corto (medicamentos, alimento, accesorios, otro). Se agregó un
  índice único `products(tenant_id, id)` solo para la llave compuesta del vínculo.

**Decisiones surgidas al construir la oleada 2 (2026-10-14).**
- **Fraccionados (29C):** la existencia está en **unidad base** y el envase abierto se **deriva** (no hay tabla de
  envases abiertos); cambiar la presentación **reescala** la existencia con un ajuste por sucursal y se rechaza si no da
  enteros. La unidad suelta factura con su propia clave de unidad del SAT. La demo **no** trae un producto
  fraccionado de semilla (habría que tocar `demo_reset` y varias pruebas).
- **Familias (31):** la familia accede a las mascotas de todos sus miembros; el dueño sigue siendo uno
  (`pets.customer_id`). Se construyó el modelo y las reglas de visibilidad por periodo en SQL, pero **no hay quién las
  use todavía**: se conectan en la cuenta del cliente (16B). Mientras tanto, la transferencia revoca los links y el
  personal ve todo como siempre.
- **Dependencias entre ramas:** 29C y 31 no tocaron las mismas tablas y se fusionaron sin conflictos de texto.

**Decisiones surgidas al construir la oleada 3 (2026-10-14).**
- **Cobro rápido (30):** es una pantalla y una RPC propias (`checkout_quick_sale`), no una extensión del punto de venta
  ni de la llegada sin cita (ambos exigen cliente o solo venden productos). Sin factura.
- **Cirugías (32):** `appointment_services` no se reutiliza; los renglones sin producto van en
  `appointment_surgery_lines` y `checkout_appointment()` se reemplazó agregando un bloque. El precio del paquete manda
  sobre el del catálogo del día (un medicamento puede cobrarse distinto dentro de una cirugía).
- **16B y 33 siguen sin construirse:** la 16B pide un servicio de correo (código de acceso) y una librería de cifrado
  para Web Push, y CLAUDE.md §3 exige justificarlos con el usuario antes. La 33 puede construirse sin la 16B con el
  personal como único lector (ver los riesgos de abajo); falta decidirlo.

**Decisiones surgidas al construir la oleada 4 (2026-10-14).**
- **Hospitalización sin la 16B:** se construyó con el personal como único lector (lo recomendado en D30). La lectura
  del dueño y la notificación se suman cuando exista la cuenta del cliente; no hace falta tocar las tablas.
- **Cobro:** una estancia se cobra **dada de alta** (los días se cuentan hasta el alta) y a nombre del dueño del
  ingreso, aunque después se transfiera la mascota.
- **Medicamentos:** bajan del inventario al administrarse (`stock_movements.hospital_medication_id`) y se cobran con la
  estancia; uno ya cobrado no se puede quitar.
- **Demo:** `demo:reset` da de alta las estancias abiertas de Patitas Felices (no las borra: son expediente) y
  restaura los 4 espacios de ejemplo.

**Contras y riesgos.**
- **Tamaño:** son siete fases. Se aprueban y construyen **una a la vez**; esta decisión no autoriza construir ninguna.
- **Hospitalización y 16B:** si la 16B se retrasa, la 33 se puede construir con el dueño del negocio como único lector y
  sumar al dueño de la mascota después; es lo primero que se pregunta en 33.1.
- **Privacidad:** un expediente que ve el nuevo dueño, la familia y el dueño anterior por periodo es la regla más fina de
  este paquete; por eso tiene tests de aislamiento propios (31) y es la primera en revisarse.
- **Fraccionados y CFDI:** vender por unidad cambia la `ClaveUnidad` de la factura (§1, CFDI). 29.1 revisa cómo
  declarar la unidad suelta antes de construir.
- **Cobro de paso:** sin cliente no hay a quién facturar; si piden factura, el flujo del punto de venta (cliente nuevo
  o existente) ya cubre ese caso y no se duplica.
- **Excel del veterinario:** al no compartirse, el catálogo de cirugías empieza vacío y se llena a mano; una importación
  sería una mejora aparte (fase 23 ya propone un importador de clientes).
- Respeta §7 y §8: RLS, dinero entero, fechas en UTC, borrado suave y migraciones aditivas.

---

### D31 — Cuenta del dueño de la mascota: entrar, ver lo suyo y, después, su clínica

**Estado:** propuesta (2026-10-14); no se construye hasta que el usuario la apruebe. **Reemplaza la 16B de D21**
(código de un solo uso con tabla propia y vista aislada) y es la base de la lectura del dueño de la fase 33.

**Problema.** Hoy el cliente solo tiene un link por mascota (D21, §7.4): no puede volver a "su" información, ver sus
próximas citas ni enterarse de nada. Se pidió una cuenta propia donde vea sus mascotas, sus citas, promociones y,
más adelante, recomendaciones, horarios y veterinarias cercanas.

**Decisiones del usuario (2026-10-14).**
1. **Una cuenta por negocio, de momento.** La cuenta ve lo de **un negocio a la vez**. Ver mascotas de varias
   clínicas bajo una sola cuenta queda para después (ver "Supabase Auth" abajo: el modelo no lo impide).
2. **Promociones:** las publica cada negocio y **solo las ven sus clientes vinculados**.
3. **Directorio de veterinarias cercanas:** en una **etapa posterior**.
4. **Acceso con el correo personal** del dueño de la mascota (Gmail, etc.): el código le llega ahí.

**1. Autenticación: Supabase Auth con código por correo, no una tabla propia.**
- El dueño inicia sesión con un **código de un solo uso por correo** (OTP de Supabase Auth). No hay contraseña y no se
  mantiene tabla de códigos ni intentos: lo hace Auth. **Alternativa descartada (la 16B de D21):** Edge Function con
  tabla propia de códigos; es más código de seguridad a mantener sin ganar nada.
- La persona es un `auth.users` **sin membresía en ningún negocio**. Las políticas RLS del personal (`is_member_of`,
  `has_permission`…) la **niegan solas**: no hay forma de que lea una tabla de negocio por la API directa.
- **Consecuencia que hay que saber:** Auth identifica por correo, así que la cuenta es técnicamente **una por correo**.
  "Una cuenta por negocio" se cumple en lo que **ve** (un negocio a la vez), no impidiendo vincular otros: el modelo ya
  admite varios vínculos y abrirlo después no es una migración.
- Hace falta un **servicio de correo** (SMTP) para producción: el de Supabase por defecto no sirve más que para pruebas.
  Y un **dominio remitente** con SPF y DKIM, para que el código no caiga en spam. El destinatario es el correo personal.

**2. Vínculo cuenta ↔ cliente: el link con token es la prueba.**
- Tabla `customer_accounts` (`user_id`, `tenant_id`, `customer_id`, `linked_at`; único por `(user_id, tenant_id)`).
- El dueño abre su link `/c/:token` (el que ya entrega el negocio) y toca **"Guardar en mi cuenta"**: una RPC
  (`SECURITY DEFINER`, revalida que el token sea vigente) vincula a esa persona con el **cliente** de la mascota.
- **Nunca por coincidencia de correo o teléfono**: sería filtrar datos de una persona a otra. Sin link, no hay vínculo.
- Un negocio también puede **desvincular** (ya no es su cliente), y la persona puede **eliminar su cuenta** sin que se
  borre el expediente del negocio (§8.5).

**3. Qué lee la cuenta: funciones de servidor con lista blanca, no tablas.**
- `my_pets()`, `my_pet_detail()`, `my_upcoming_appointments()` y, con la 33, `my_hospital_stays()`: devuelven **solo**
  los campos de la vista pública (§7.4) y aplican las reglas de la fase 31 (`app.customer_can_view_pet*`): el dueño
  anterior ve su periodo, los montos solo el titular, la familia accede a las mascotas de sus miembros.
- **Nunca** devuelven teléfonos u otros clientes, notas internas ni identificadores de otros registros.

**4. Capas, en orden (cada una se aprueba y se construye por separado).**

| Capa | Qué entrega | Fase propuesta | Dependencia nueva |
| ---- | ----------- | -------------- | ----------------- |
| **A. Cuenta y mis mascotas** | Entrar con código, vincular con el link, ver mascotas, cartilla, historial, próximas citas y la bitácora de hospitalización | **16B** | Servicio de correo (SMTP) y dominio remitente |
| **B. Mi clínica** | Perfil del negocio (dirección, teléfono, horarios por sucursal) y **promociones** que publica el negocio para sus clientes vinculados | **34** | Ninguna |
| **C. Avisos** | Notificación en el teléfono ("Hay novedades de Nube") y recordatorios de vacunas y citas | **35** | Librería de Web Push (PushForge o `@negrel/webpush`, tras un spike) |
| **D. Más adelante** | Pedir cita en línea; recomendaciones; **directorio de veterinarias cercanas** (opt-in por negocio, coordenadas por sucursal) | sin fase | Por decidir (geolocalización) |

**Contras y riesgos.**
- **Privacidad (LFPDPPP):** una cuenta que junta datos del dueño exige **aviso de privacidad**, consentimiento al vincular
  y derecho a eliminar la cuenta. Hay que redactarlo antes de abrir la 16B a usuarios reales.
- **Superficie:** se habilitan altas por correo en Auth (hoy solo se invita al personal). Una cuenta sin vínculo no ve
  nada; aun así, el login del personal debe tratar bien a un usuario sin negocios (mandarlo a `/mi-cuenta`).
- **Correo en producción:** sin un SMTP propio el producto no puede mandar códigos a más de un par de personas por hora.
- **Soporte:** aparece un tipo de usuario nuevo ("no veo mi cita"). Conviene un mensaje claro de "pídele a tu
  veterinaria un link" cuando la cuenta no tiene vínculos.
- **Promociones:** el negocio puede publicar de más. Se limitan a texto y vigencia (sin imágenes ni precios) en la
  primera versión.

**Qué NO cambia.** El link con token por mascota (§7.4) sigue funcionando sin cuenta; la cuenta es opcional para el
dueño. La vista pública, el PWA (16A) y la cartilla actual no se tocan.

**Pendientes antes de construir.** Aprobar esta decisión; **confirmar el dominio remitente** y el proveedor de SMTP
(recomendación: Resend, con `sendEmail()` aislado para poder cambiarlo); redactar el aviso de privacidad.

---

## Parte 4 — Riesgos conocidos

| Riesgo                                             | Cómo se atiende                                                                            |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| RLS mal escrito = fuga entre tenants               | Test de aislamiento por tabla, desde la fase 1. Ninguna tabla se da por hecha sin él       |
| Recursión infinita en la política de `memberships` | `app.is_member_of()` es `SECURITY DEFINER`, que salta RLS. Documentado en `CLAUDE.md` §7.2 |
| Un `SECURITY DEFINER` sin revalidar membresía      | Revisión obligatoria: toda función así valida en su primera línea                          |
| El link público filtra de más                      | Lista blanca de campos en el DTO, tests que comparan la forma exacta de la respuesta       |
| Redondeo de centavos que no cuadra                 | IVA por partida, enteros siempre, tests de redondeo en `lib/money.ts`                      |
| Hora equivocada por zona horaria                   | `timestamptz` en la base, zona IANA por sucursal, conversión solo al mostrar               |
| El CI pasa en Mac y falla en Linux                 | `.nvmrc` compartido, cuidado con mayúsculas en imports, scripts portables                  |
| El demo se ensucia entre reuniones                 | `npm run demo:reset` antes de cada una                                                     |
| Migración mala en producción                       | Se prueba en local con `db reset` y en staging vía PR antes de llegar a `main`             |
| Fila faltante/mal sembrada en `role_permissions`   | `owner` nunca depende de la tabla (bypass en `app.has_permission()`); test que confirma que cambiar una fila cambia el resultado sin tocar código |
| `invite-employee` mal validada = invitación indebida | Revalida permiso con el JWT de quien llama ANTES de tocar `service_role`; el RPC vuelve a revalidar aunque la Edge Function fallara |
| Dos citas encimadas del mismo empleado (desde Correcciones 1, D26) | Es un aviso y no un bloqueo, a propósito; la base sigue rechazando pasado, fuera de horario y día cerrado |
