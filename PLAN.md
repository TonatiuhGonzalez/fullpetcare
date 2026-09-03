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
/app/agenda                   dashboard: agenda del día
/app/agenda/nueva             crear cita
/app/citas/:id                detalle
/app/citas/:id/atender        ficha según kind (estética o veterinaria)
/app/citas/:id/cobrar         resumen, pago simulado, ticket
/app/clientes                 lista y búsqueda
/app/clientes/:id             cliente y sus mascotas
/app/mascotas/:id             historial mezclado + cartilla
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

### Después de v1 (no ahora)

Productos e inventario, CFDI real con un PAC, OpenPay real, WhatsApp Business API,
reportes, recordatorios automáticos.

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
