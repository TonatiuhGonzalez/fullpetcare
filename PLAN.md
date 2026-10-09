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
