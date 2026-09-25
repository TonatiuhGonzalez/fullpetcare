# TASKS.md — FullPetCare

Tareas en orden de dependencia. Se hace una a la vez.

**Regla: una tarea no se marca `[x]` hasta que su verificación pasa y, si tiene test, el
test está escrito, explicado y en verde.** Las tareas marcadas 🧪 llevan test obligatorio.
Las marcadas 📚 requieren explicación escrita para el usuario (concepto nuevo).

Formato: `- [ ] **N.M** Qué hacer. _Verificar:_ cómo se sabe que quedó._

---

## Fase 0 — Preparar la máquina

- [x] **0.1** Instalar Node 22 con nvm (`nvm install 22`). _Verificar:_ `node -v` dice v22.x
- [x] **0.2** Verificar Docker Desktop corriendo. _Verificar:_ `docker ps` responde sin error
- [x] **0.3** Instalar el CLI de Supabase (`brew install supabase/tap/supabase`). _Verificar:_ `supabase --version`
- [x] **0.4** Crear cuenta/organización en Supabase y en Cloudflare si no existen. _Verificar:_ acceso a ambos paneles

---

## Fase 1 — La tubería, viva

**Meta: una URL en internet donde entras con un usuario semilla y ves tu rol y sucursal.**

### 1A. Repositorio y esqueleto

- [x] **1.1** `git init`, `.gitignore` (node_modules, dist, .env.local, .supabase), commit inicial con los tres .md. _Verificar:_ `git log` tiene un commit
- [x] **1.2** Crear repo en GitHub y `git push` de `main`. _Verificar:_ el repo se ve en github.com — [público](https://github.com/TonatiuhGonzalez/fullpetcare); ver nota en 1.3
- [x] **1.3** 📚 Activar protección de rama en `main`: prohibir push directo, exigir PR. _Verificar:_ un `git push` directo a main es rechazado. **Explicar qué protege y por qué** — GitHub Free no permite branch protection en repos privados de cuenta personal; el usuario decidió volver el repo público para tenerla real. Confirmado con un push directo rechazado (`GH006`).
- [x] **1.4** `.nvmrc` con `22`. _Verificar:_ `nvm use` en la raíz selecciona 22
- [x] **1.5** Scaffold Vite + Vue 3 + TypeScript. _Verificar:_ `npm run dev` levanta en :5173 — confirmado con `curl` (HTTP 200)
- [x] **1.6** Instalar y configurar Vuetify 3 con `vite-plugin-vuetify` y tema propio en `plugins/vuetify.ts`. _Verificar:_ un `v-btn` con el color de marca se renderiza — HomePage provisional usa `v-card`/`v-icon` con el tema `fullPetCareTheme`
- [x] **1.7** Instalar Pinia y Vue Router; estructura de carpetas de `CLAUDE.md` §4 con un `.gitkeep` por carpeta. _Verificar:_ `npm run build` pasa
- [x] **1.8** ESLint (flat config) + Prettier + `eslint-plugin-vue`; scripts `lint` y `format`. _Verificar:_ `npm run lint` termina en 0
- [x] **1.9** Instalar Vitest; script `test:unit`; `vitest.config.ts` con alias `@` → `src`. _Verificar:_ `npm run test:unit` corre (sin tests aún)
- [x] **1.10** 🧪 📚 Primer test tonto (`lib/money.spec.ts` con `formatMXN`) para ver el runner en verde. **Explicar la anatomía de un test: `describe`, `it`, `expect`, y por qué el nombre importa** — 3 tests en verde

### 1B. Base de datos local

- [x] **1.11** 📚 `supabase init`; revisar `config.toml`. **Explicar qué levanta `supabase start`: Postgres, Auth, Storage, Studio, y en qué puertos**
- [x] **1.12** `supabase start` y confirmar Studio en :54323. _Verificar:_ Studio abre — confirmado con `curl` (HTTP 307, redirect normal) y los 11 contenedores healthy
- [x] **1.13** Migración `extensions_and_helpers`: `pgcrypto`, esquema `app`, función `app.set_updated_at()`. _Verificar:_ `supabase db reset` aplica sin error
- [x] **1.14** Migración `tenancy`: `tenants`, `branches`, `profiles`, enum `member_role`, `memberships`, `membership_branches`, con índices e `updated_at`. _Verificar:_ las tablas aparecen en Studio
- [x] **1.15** 📚 Migración `rls_helpers`: `app.is_member_of()`, `app.role_in()`, `app.can_access_branch()`, todas `stable security definer`. **Explicar `SECURITY DEFINER`, `STABLE`, `search_path`, y por qué sin esto la política de `memberships` se llama a sí misma en bucle infinito**
- [x] **1.16** 📚 Migración `rls_tenancy`: RLS `enable` + `force` en las cinco tablas, con sus políticas de select. Sin políticas de insert/update/delete todavía — v1 no tiene pantalla de administración para estas tablas (se siembran); se agregan con su propio test cuando exista esa pantalla. **Explicar qué es una política y cómo Postgres la pega a cada query**
- [x] **1.17** Trigger que crea una fila en `profiles` al registrarse un usuario en `auth.users`. _Verificar:_ confirmado vía seed (4 usuarios → 4 profiles automáticos)
- [x] **1.18** `seed.sql`: dos tenants ("Patitas Felices" con sucursales Centro y Del Valle; "Huellitas Spa" con Zona Río, Tijuana), cuatro usuarios de demo con sus membresías (los 4 en Patitas Felices; Huellitas Spa se deja sin personal — solo existe para probar aislamiento y dar una sucursal en otra zona horaria). Datos ficticios en español. IDs fijos para tenants/sucursales/usuarios (ver `supabase/tests/fixtures.ts`). _Verificar:_ login real contra la API de Auth confirmado con `curl`; RLS confirmado manualmente (dueño ve 2 sucursales, anon ve 0)
- [x] **1.19** Script `db:types` (usa el CLI de Homebrew, no `npx`) → `src/types/database.ts`. _Verificar:_ el archivo se genera, lint y build pasan

### 1C. El test que importa

- [x] **1.20** 📚 Helper de tests de BD (`supabase/tests/helpers.ts`): conexión con `pg`, `set_config()` para simular rol + `request.jwt.claims` dentro de una transacción que siempre termina en ROLLBACK. **Explicar cómo se simula un usuario autenticado dentro de una transacción de Postgres**
- [x] **1.21** 🧪 📚 **Test de aislamiento entre tenants**: usuario del tenant A consulta `branches`; recibe solo las suyas y **cero** del tenant B. Con y sin `tenant_id` explícito en el where, más un caso "reasignar el tenant cambia lo que se ve". **Explicar por qué este test es el más importante del repo y qué se rompería sin él** — verificado además desactivando RLS a propósito: 6/9 tests se ponen en rojo, confirmando que no son falsos positivos
- [x] **1.22** 🧪 Test: un usuario sin membresía activa no ve nada de ningún tenant
- [x] **1.23** 🧪 Test: `anon` no puede leer `tenants`, `branches`, `memberships` ni `profiles`
- [x] **1.24** Script `test:db` que corre solo los tests de `supabase/tests/`. _Verificar:_ `npm run test:db` en verde — 9/9

### 1D. Sesión y UI mínima

- [x] **1.25** `src/services/supabase.ts`: cliente único desde `import.meta.env`. `.env.example` con `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`. _Verificar:_ arranca sin valores hardcodeados — falla rápido y con mensaje claro si faltan
- [x] **1.26** 📚 Documentar en el README qué variable es pública y cuál nunca sale del servidor. **Explicar por qué la anon key es pública por diseño y qué la hace segura (RLS)**
- [x] **1.27** `useSessionStore`: login, logout, carga de `memberships`, `activeTenantId`, `activeBranchId`, persistencia en localStorage. Incluye `services/auth.ts`, `services/profiles.ts`, `services/memberships.ts`
- [x] **1.28** 🧪 Tests de `useSessionStore` (6): al elegir tenant se fija el rol correcto; login fallido deja status "error" sin tocar memberships; logout limpia todo incl. localStorage; membresía guardada que ya no existe se descarta; con una sola opción se elige sola; membresía guardada válida se conserva. Primeros mocks del proyecto, explicados en el archivo
- [x] **1.29** `LoginPage.vue` con email y contraseña. _Verificar:_ confirmado en navegador — login con `dueno@patitasfelices.mx` entra
- [x] **1.30** `SelectBusinessPage.vue`: elegir tenant y sucursal. Si solo hay una opción, salta sola (lógica en el store, cubierta por el test de 1.28). _Verificar:_ confirmado en navegador — dueño ve selector de 2 sucursales
- [x] **1.31** Guard de router: `/app/*` y `/seleccionar-negocio` exigen sesión, si no redirige a `/login` con `?redirect=`; async con `ensureInitialized()` para no parpadear en un refresh. _Verificar:_ confirmado en navegador — sin sesión, `/` termina en `/login`; con sesión, F5 no vuelve a pedir login
- [x] **1.32** Layout privado (`AppLayout.vue`): barra con nombre del negocio, selector de sucursal (o texto fijo si solo hay una), rol, usuario y botón de salir
- [x] **1.33** `AgendaPage.vue` provisional: muestra nombre, rol, negocio y sucursal activa. _Verificar:_ flujo completo confirmado en navegador (login → seleccionar sucursal → agenda con los datos correctos)

### 1E. Nube y CI

- [x] **1.34** Crear proyectos Supabase `fullpetcare-staging` y `fullpetcare-prod`. _Verificar:_ ambos responden — creados vía Management API tras resolverse el incidente de plataforma ("Project Lifecycle Actions") y corregir el alcance del token de acceso personal (debía ser de organización, no de un proyecto específico): `fullpetcare-staging` (`yoccqfdiytomaltispvs`, us-west-2) y `fullpetcare-prod` (`boajojegcmpvzjsloosk`, us-east-1), ambos `ACTIVE_HEALTHY`
- [x] **1.35** `supabase link` + `supabase db push` a staging y prod. _Verificar:_ el esquema existe en los dos — las 5 migraciones (extensiones/helpers, tenencia, RLS helpers, RLS tenencia, perfil al registrarse) se aplicaron sin error en ambos proyectos, con autorización explícita del usuario antes de cada push por tratarse de un cambio en una base de datos remota. El repo local queda enlazado (`supabase link`) a `fullpetcare-staging` por defecto, no a prod, para evitar que un comando futuro (p. ej. `db push` accidental) afecte producción sin querer
- [x] **1.36** Crear los usuarios de demo en prod y correr la semilla de negocio. _Verificar:_ login contra prod funciona desde local — se corrió `supabase/seed.sql` tal cual contra `fullpetcare-prod` con `supabase db query --linked` (mismo patrón que `db reset` en local: los 4 usuarios de demo se insertan directo en `auth.users`/`auth.identities`, válido aquí porque, a diferencia de una producción real, este proyecto "prod" existe únicamente para alojar datos ficticios de demo — CLAUDE.md §10). Verificado con `POST /auth/v1/token?grant_type=password` contra el proyecto real: `dueno@patitasfelices.mx` / `Demo1234!` devuelve `access_token`. **Nota de seguridad:** al consultar las API keys del proyecto por la Management API quedó expuesta en esta sesión la `service_role` key legacy de prod. Los secretos legacy ya no se pueden rotar (deprecados por Supabase) — en su lugar se desactivaron por completo desde Settings → API Keys → "Disable legacy API keys". El proyecto ya usa el par nuevo (`publishable`/`secret`), así que no se perdió funcionalidad. Resuelto
- [x] **1.37** 📚 Conectar Cloudflare Pages al repo: build `npm run build`, salida `dist`, variables de entorno distintas para Production y Preview. **Explicar preview por PR vs producción por main** — proyecto `fullpetcare` conectado vía el flujo "legacy Pages" (el wizard de Cloudflare arranca por defecto en "Workers", hay que entrar por el link "Continue to Pages" para llegar al flujo clásico que sí respeta `_redirects`). Preset "Vue", build `npm run build`, salida `dist`. Variables: Production apunta a `fullpetcare-prod`, Preview a `fullpetcare-staging` (con `NODE_VERSION=22` en ambas; el wizard solo permite un set al crear el proyecto, las de Preview se sobreescribieron después en Settings → Environment variables). Verificado en real: `https://fullpetcare.pages.dev` carga y el login con `dueno@patitasfelices.mx` funciona
- [x] **1.38** `public/_redirects` con `/* /index.html 200` para que las rutas del SPA no den 404. _Verificar:_ confirmado con un build local — `dist/_redirects` queda igual al de `public/` (Vite copia `public/` tal cual). Verificación final en el sitio desplegado: confirmada en 1.43, navegando rutas internas en `fullpetcare.pages.dev` sin 404
- [x] **1.39** 📚 `.github/workflows/ci.yml` **comentado bloque por bloque**: checkout, setup-node con `.nvmrc` y caché de npm, `npm ci`, `lint`, `test:unit`, setup del CLI de Supabase, `supabase start`, `test:db`. **Explicar cada paso: qué hace, por qué está, y qué pasa si falla** — verificado en GitHub Actions real (no solo local): PR #4 en verde, 4m59s, lint + 9 tests unitarios + 9 tests de RLS contra Supabase levantado en el runner. En el camino se encontraron y corrigieron dos problemas que solo aparecen en CI, no en local: `version: latest` del CLI de Supabase topó con rate limit de la API de GitHub (se fijó a `2.116.0`), y el trigger disparaba el workflow dos veces por commit en una rama con PR abierto (se limitó `push` a solo `main`)
- [x] **1.40** Exigir que el CI pase para poder mergear (branch protection → required checks). _Verificar:_ un PR con un test roto no deja mergear — se agregó `required_status_checks` (check `Lint y pruebas`, `strict: true`) a la protección de `main` vía la API de GitHub. Verificado con un PR desechable (#5, rama `chore/verify-branch-protection`) con un test roto a propósito: el check falló y GitHub marcó el PR como `mergeStateStatus: BLOCKED`. PR cerrado y rama borrada sin mergear
- [x] **1.41** Workflow de despliegue de migraciones a prod al mergear en `main` (`supabase db push` con `SUPABASE_ACCESS_TOKEN` y `SUPABASE_DB_PASSWORD` desde Secrets). _Verificar:_ una migración trivial llega sola a prod — `.github/workflows/deploy-migrations.yml`, disparado solo en push a `main` que toque `supabase/migrations/**` (filtro por `paths` para no correr en cada merge). Verificado con una migración trivial (`comment on table tenants`, PR #7): al mergear, el workflow corrió solo y el comentario apareció en `fullpetcare-prod` sin intervención manual
- [x] **1.42** README con: requisitos, cómo levantar local, cómo correr cada tipo de test, cómo desplegar — requisitos, local y pruebas ya existían de fases anteriores; se agregó la sección "Despliegue" (los tres entornos, qué pasa en un PR vs un merge a main, cómo funciona `deploy-migrations.yml`, y cómo enlazar el repo a un proyecto de Supabase en la nube a mano)
- [x] **1.43** **Cierre de fase:** PR completo, CI verde, merge, y verificar el login en la URL pública de Cloudflare. _Verificar:_ 🎉 hay algo vivo en internet — PR #8 mergeado con CI verde; login confirmado por el usuario en `https://fullpetcare.pages.dev` con `dueno@patitasfelices.mx`. **Fase 1 completa: la tubería está viva.**

---

## Fase 2 — Clientes y mascotas

**Meta: dar de alta un cliente con su mascota y foto, buscarlo y editarlo.**

- [x] **2.1** 📚 Migración `0005_audit.sql`: `audit_log` + `app.log_change()` genérico. **Explicar qué es un trigger, cuándo dispara y por qué la auditoría va en la base y no en la app** — `20260904180629_audit.sql`. Verificado a mano con una tabla temporal dentro de una transacción revertida: INSERT/UPDATE/DELETE quedan registrados con el actor correcto y los valores antes/después
- [x] **2.2** Migración `0006_soft_delete.sql`: `app.prevent_hard_delete()` para tablas de expediente. _Verificar:_ un `delete` directo lanza excepción — `20260904180953_soft_delete.sql`
- [x] **2.3** 🧪 Test: `delete` sobre una tabla de expediente falla incluso con service role — `supabase/tests/soft-delete.spec.ts`, prueba que ni siquiera `service_role` (que sí bypassa RLS) puede saltarse el trigger
- [x] **2.4** Migración `0007_customers.sql`: `customers` con campos CFDI (`rfc`, `legal_name`, `tax_regime_code`, `cfdi_use`, `postal_code`, `requires_invoice`), RLS, auditoría, índice de búsqueda por nombre y teléfono — `20260904181845_customers.sql`. Búsqueda por nombre con índice btree + `text_pattern_ops` (prefijo, no substring — se decidió no agregar `pg_trgm` para mantenerlo simple)
- [x] **2.5** Migración `0008_pets.sql`: enums de especie y sexo, `pets`, `pet_weights` (`weight_grams` entero), RLS, auditoría — `20260904182054_pets.sql`. `pet_weights.appointment_id` queda sin FK todavía (la tabla `appointments` no existe hasta fase 3)
- [x] **2.6** Semilla: 8 clientes y 12 mascotas ficticias en español, repartidas entre los dos tenants — 6 clientes/9 mascotas en Patitas Felices, 2 clientes/3 mascotas en Huellitas Spa. Ids fijos en `supabase/tests/fixtures.ts`. Verificado con `db reset` + conteo real: 8/12/6-2/9-3
- [x] **2.7** `lib/validation.ts`: RFC (persona física y moral), teléfono a 10 dígitos, código postal — valida solo la FORMA del RFC (longitud y tipo de caracteres), no el dígito verificador real del SAT
- [x] **2.8** 🧪 Tests de `validation.ts`: RFC válido, RFC con homoclave mal, RFC de moral, cadena vacía, minúsculas, espacios — 14 tests, 23/23 en verde
- [x] **2.9** `services/customers.ts`: `list`, `search`, `getById`, `create`, `update`, `softDelete` — `search` busca por nombre O apellido con `ilike` prefijo (empieza con), unidos con `.or()`
- [x] **2.10** 🧪 Tests de `services/customers.ts` contra Supabase local: crear, buscar por nombre parcial, que el borrado suave desaparezca de `list` pero siga en la base — `supabase/tests/customers-service.spec.ts`. Nuevo patrón de test: sesión real vía `supabase.auth.signInWithPassword` (no `pg` + simulación de rol) para probar el camino que de verdad usa la app; se agregó el alias `@` y las variables `VITE_*` locales a `vitest.db.config.ts` para que esto funcione. **Se encontró y corrigió un bug real de RLS en el camino**: Postgres exige que la fila resultante de un UPDATE siga pasando la política de SELECT, así que `deleted_at is null` en el SELECT de una tabla con UPDATE para un rol autenticado rompe el borrado suave — se quitó de `customers`/`pets`/`pet_weights`, se documentó en CLAUDE.md §7.2, y se corrigió preventivamente en las 4 tablas de tenencia de fase 1 (migración `fix_select_policies_for_soft_delete.sql`, sin efecto práctico hoy porque esas tablas no tienen UPDATE para authenticated)
- [x] **2.11** 🧪 Tests RLS de `customers`: el tenant B no ve clientes del A, ni por select ni por update directo por id — `supabase/tests/customers-rls.spec.ts`, con un caso de control (el dueño real sí ve/edita) para confirmar que el aislamiento no es un falso positivo
- [x] **2.12** `services/pets.ts` con lo equivalente, más `listByCustomer` y `addWeight` — también `listWeights` (historial ordenado por `measured_at desc`)
- [x] **2.13** 🧪 Tests de `services/pets.ts` y RLS de `pets` y `pet_weights` — `pets-service.spec.ts` (sesión real) y `pets-rls.spec.ts` (aislamiento + caso de control + confirma que cualquier rol activo puede registrar peso). 26/26 tests de BD en verde
- [x] **2.14** 📚 Bucket de Storage `pet-photos` con política por tenant (la ruta del archivo empieza con el `tenant_id`). **Explicar cómo funcionan las políticas de Storage y por qué la ruta es parte de la seguridad** — `20260904190536_pet_photos_bucket.sql`. Bucket privado (`public: false`), 5 MB, solo JPEG/PNG/WebP. Políticas sobre `storage.objects` usando `storage.foldername(name)[1]` como tenant_id; sin UPDATE/DELETE (reemplazar foto = subir una nueva ruta)
- [x] **2.15** 🧪 Test: un usuario del tenant A no puede leer un archivo bajo la carpeta del tenant B — `supabase/tests/storage-rls.spec.ts`, con sesión real y caso de control; prueba explícitamente que conocer la ruta exacta no alcanza
- [x] **2.16** `CustomersPage.vue`: lista con búsqueda y paginación simple — paginación de `v-data-table` (del lado del cliente), búsqueda sin debounce (volumen de demo)
- [x] **2.17** `CustomerFormDialog.vue`: alta y edición, con sección fiscal colapsada (solo si "requiere factura") — en `src/components/` (no termina en "Page")
- [x] **2.18** `CustomerDetailPage.vue`: datos del cliente y sus mascotas
- [x] **2.19** `PetFormDialog.vue`: alta y edición, con subida de foto y preferencias de corte — `services/pets.ts` ganó `uploadPhoto`/`getPhotoUrl` (URL firmada, el bucket es privado)
- [x] **2.20** `PetDetailPage.vue` provisional: ficha con foto, datos y peso actual — verificado en navegador por el usuario: login → Clientes → alta de cliente (con y sin factura) → ficha → alta de mascota con foto → ficha de mascota, todo funcionando
- [x] **2.21** **Cierre de fase:** PR, CI verde, merge, verificar en producción — PR #14 mergeado con CI verde; usuario confirmó el flujo de clientes/mascotas funcionando en `fullpetcare.pages.dev`. **Fase 2 completa.**

---

## Fase 3 — Catálogo y agenda

**Meta: agendar una cita y verla en la agenda del día, en la hora correcta de su sucursal.**

- [x] **3.1** Migración `0009_services.sql`: enum `service_kind`, tabla `services` (`duration_minutes`, `price_cents`, `tax_rate_bp`), RLS — `20260904192944_services.sql`. Solo `owner` da de alta/edita (config de negocio); cualquier rol activo lee
- [x] **3.2** Migración `0010_appointments.sql`: enum `appointment_status`, `appointments`, `appointment_services` con campos `*_snapshot`, RLS, índice `(tenant_id, branch_id, starts_at)` — `20260904193058_appointments.sql`. Lectura por `app.can_access_branch()` (no todo el tenant); UPDATE permite owner/receptionist o al empleado asignado (para fase 4). De paso se completó la FK pendiente de `pet_weights.appointment_id` (fase 2, no se pudo crear antes porque `appointments` no existía)
- [x] **3.3** Semilla: catálogo de servicios en español (baño, corte de raza, deslanado, consulta general, vacunación, desparasitación) con precios y duraciones realistas — 6 servicios en Patitas Felices, ids fijos en `fixtures.ts`
- [x] **3.4** 📚 `lib/datetime.ts`: `toBranchTime()`, `fromBranchTime()`, `formatTime()`, `formatDate()`, `dayRangeUtc()`. **Explicar por qué la base guarda UTC, por qué se usa la zona de la sucursal y no la del navegador, y por qué IANA en vez de offset fijo (el caso Tijuana)** — se instaló `date-fns`/`@date-fns/tz` (preaprobadas en §3, nunca antes usadas). Se verificó a mano ANTES de escribir la implementación real que `new TZDate(stringSinOffset, zona)` usa la zona del SISTEMA para parsear el string, no la zona pedida — la forma correcta es pasar año/mes/día/hora por separado. Hubiera sido un bug silencioso en cada hora de cita
- [x] **3.5** 🧪 Tests de `datetime.ts`: mismo instante mostrado en CDMX, Tijuana y Cancún; el rango del día de una sucursal no es el mismo que el de otra; cambio de horario de verano en Tijuana — 12 tests nuevos (32/32 en total). De paso, un test atrapó una suposición mía equivocada (Cancún no comparte zona con CDMX, es UTC-5 propia)
- [x] **3.6** 📚 `lib/availability.ts`: función pura `computeAvailableSlots({ branchHours, existingAppointments, employeeId, durationMinutes, stepMinutes })`. **Explicar por qué esto es una función pura y por qué eso la vuelve trivial de probar** — trabaja en minutos desde medianoche con horas 'HH:mm' locales (la conversión de UTC ya la hizo lib/datetime.ts antes), así que no sabe nada de zonas horarias ni de Date
- [x] **3.7** 🧪 Tests de `availability.ts` (el mejor material didáctico del proyecto): día vacío; una cita a media mañana parte el día en dos; cita que termina exactamente cuando empezaría otra (¿cabe? sí); servicio más largo que el hueco restante antes de cerrar; empleado con la agenda llena; día en que la sucursal no abre; duración cero — 8 tests nuevos, 40/40 en total, todos en verde a la primera
- [x] **3.8** `services/services.ts` (catálogo): `listByKind`, `create`, `update`, `setActive` (antes `deactivate`; alimenta el switch activar/desactivar de CatalogPage, que sustituyó al ícono "Desactivar" y al checkbox "Activo" del dialog) — `listByKind` trae activos e inactivos (CatalogPage los necesita para reactivar); el paso de agendar filtra `is_active` por su cuenta
- [x] **3.9** 🧪 Tests + RLS de `services` — `services-service.spec.ts` (incluye que recepción NO puede dar de alta, solo owner) y `services-rls.spec.ts` (aislamiento + control). 35/35 tests de BD
- [x] **3.10** `services/appointments.ts`: `listByDay`, `getById`, `create` (con snapshots), `reschedule`, `cancel`, `changeStatus` — `create`/`reschedule` llaman a funciones de Postgres (`create_appointment`/`reschedule_appointment`, migración `appointment_booking_rpc.sql`) vía `.rpc()` en vez de insertar directo: agendar toca dos tablas relacionadas (cita + snapshots de servicios) y necesita quedar en una sola transacción, algo que PostgREST no da entre dos `.insert()` sueltos desde el cliente. Las funciones viven en el esquema `public` (no `app`) — PostgREST solo expone RPCs de `public`, se descubrió al ver que `supabase gen types` no las encontraba en `app`. Traslape verificado también contra service_role (no solo el rol del cliente) — cubre el caso normal, no las dos-solicitudes-simultáneas-en-el-mismo-segundo (anotado en el comentario de la migración, se resolvería con un `EXCLUDE` constraint que no hace falta para este demo)
- [x] **3.11** 🧪 Test clave: al crear la cita se copian nombre, precio y duración; si después cambia el precio del servicio, la cita conserva el original — verificado subiendo el precio real después de agendar y confirmando que el snapshot no cambió
- [x] **3.12** 🧪 Test: no se puede crear una cita que se encime con otra del mismo empleado — más el caso de control (termina justo cuando otra empieza, sí cabe)
- [x] **3.13** 🧪 Tests RLS de `appointments` y `appointment_services` — 9 tests: aislamiento por tenant, alcance por SUCURSAL dentro del mismo tenant (con casos de control), que la política de INSERT sigue protegiendo aunque la app normal use la RPC, y que solo owner/receptionist o el empleado ASIGNADO puede actualizar una cita. Dos bugs de los propios tests (no del código) atrapados y corregidos: usé una sucursal a la que el rol de prueba no tenía acceso, lo que hacía que el rechazo pareciera correcto por la razón equivocada
- [x] **3.14** `useAgendaStore`: día activo, sucursal, citas cargadas, filtro por empleado — la sucursal de la agenda es independiente de la sucursal activa de la sesión (arranca igual, pero se puede ver la agenda de otra sucursal del mismo tenant sin cambiar de contexto — CLAUDE.md §8.3). `memberships.ts` ganó `timezone` en `BranchSummary` (lo necesita `dayRangeUtc`)
- [x] **3.15** 🧪 Tests de `useAgendaStore`: cambiar de día recarga; cambiar de sucursal limpia el filtro de empleado — 4 tests nuevos (44/44 unitarios en total), mismo patrón de mocks que session.spec.ts
- [x] **3.16** `CatalogPage.vue`: catálogo de servicios, separado en pestañas Estética / Veterinaria — solo owner ve alta/edición/desactivar; `lib/money.ts` ganó `pesosToCents` para capturar el precio
- [x] **3.17** `AgendaPage.vue` real: agenda del día por empleado, con navegación de fechas — `services/appointments.ts#listByDay` ahora trae `customerName`/`petName` embebidos (evita una consulta por fila); `services/memberships.ts` ganó `listBranchEmployees`
- [x] **3.18** `NewAppointmentPage.vue` paso a paso: cliente y mascota (con alta rápida) → tipo → servicios → empleado y horario (usando los huecos calculados) — nuevo `services/branches.ts` y `lib/availability.ts#hoursForDate` (lee `branches.opening_hours`, sembrado por primera vez con horarios reales lunes-sábado). Reutiliza `CustomerFormDialog`/`PetFormDialog` de fase 2 para el alta rápida
- [x] **3.19** `AppointmentDetailPage.vue`: detalle, reagendar, cancelar — reagendar mantiene la duración original y deja que la RPC valide el traslape. Todo el flujo (catálogo, agenda, nueva cita, detalle) verificado en navegador por el usuario
- [x] **3.20** 🧪 Test de componente (uno de los pocos): el selector de huecos no ofrece horarios ocupados — se extrajo `TimeSlotPicker.vue` de `NewAppointmentPage.vue` para poder montarlo aislado. Primer test de componente del proyecto: hizo falta `css: true`, inlinear `vuetify` en `server.deps` y un stub de `ResizeObserver` en `vitest.config.ts`/`src/test-setup.ts` (jsdom no lo implementa y algunos componentes de Vuetify lo necesitan para montarse)
- [x] **3.21** **Cierre de fase:** PR, CI verde, merge, agendar una cita en producción — PR #19 mergeado con CI verde. Antes de verificar hubo que sincronizar a mano los datos de negocio de fases 2-3 (clientes, mascotas, servicios, horario de sucursales) que le faltaban a `fullpetcare-prod` desde la 1.36 — esos datos no viajan solos con los despliegues automáticos de migraciones (1.41), solo el esquema. Usuario confirmó una cita real agendada de principio a fin en `fullpetcare.pages.dev`. **Fase 3 completa.**

---

## Fase 4 — Atender

**Meta: atender una cita de estética y una de veterinaria, cada una con su ficha.**

- [x] **4.1** Migración `0011_grooming_records.sql`: tabla, RLS (lectura: owner, receptionist, groomer), auditoría, sin delete — `20260904214054_grooming_records.sql`. Sin `deleted_at` (CLAUDE.md §8.5: expediente no se borra, ni suave ni duro), con `prevent_hard_delete()`. Escritura: owner o el groomer ASIGNADO a esa cita
- [x] **4.2** Migración `0012_medical_records.sql`: tabla con `temperature_deci_c`, RLS **restringida a owner y vet**, auditoría, sin delete — `20260904214332_medical_records.sql`, mismo patrón que grooming_records con vet en vez de groomer
- [x] **4.3** 🧪 📚 **Test de RLS por rol**: un usuario `groomer` autenticado consulta `medical_records` y recibe cero filas. **Explicar por qué esto se prueba en la base y no confiando en un `v-if` de la UI** — `medical-records-rls.spec.ts` y `grooming-records-rls.spec.ts` (13 tests de aislamiento por tenant, por rol, y de escritura). Un bug en mis propios tests (no en el código): usar `asUser()` dentro de una transacción con datos sin confirmar abre OTRA conexión que no ve nada — se corrigió usando `setRole()` sobre el mismo cliente
- [x] **4.4** Migración `0013_vaccines.sql`: catálogo `vaccines` y `vaccinations` (`applied_at`, `batch_number`, `next_due_date`), RLS, auditoría — `20260904214944_vaccines.sql`. `vaccines` es catálogo normal (como `services`); `vaccinations` SÍ es expediente (CLAUDE.md §8.5 la nombra junto a medical/grooming records). A diferencia de medical_records, la lectura de `vaccinations` es para cualquier rol activo (CLAUDE.md §7.4: hasta la vista pública sin login la va a mostrar) — solo escribir (aplicar una vacuna) es owner/vet
- [x] **4.5** Semilla: vacunas comunes (rabia, triple felina, séxtuple canina, bordetella) con sus intervalos — ids fijos en `fixtures.ts`. Se encontró y corrigió un bug propio: usé `g` como prefijo de id, que no es un dígito hexadecimal válido para un UUID (rompía el `db reset` completo, con efecto cascada en 42 tests)
- [x] **4.6** `lib/vaccination.ts`: `computeNextDueDate()` y `classifyVaccineStatus()` (vigente / por vencer / vencida) — función pura, recibe "hoy" explícito (nunca lee el reloj); "vence hoy" cuenta como "por vencer", no "vencida" (el día no ha terminado)
- [x] **4.7** 🧪 Tests de `lib/vaccination.ts`: vence hoy, vence mañana, venció ayer, vacuna sin intervalo definido, cachorro con esquema inicial — 10 tests nuevos (63/63 unitarios en total), todos en verde a la primera
- [x] **4.8** `lib/appointmentStatus.ts`: máquina de estados con las transiciones permitidas — tabla `ALLOWED_TRANSITIONS` + `canTransition(from, to)`, función pura (no lee la cita real, eso es trabajo de `services/appointments.ts`). `completed`, `cancelled` y `no_show` son terminales: cero transiciones de salida
- [x] **4.9** 🧪 Tests de transiciones: `scheduled → in_progress` sí; `completed → scheduled` no; cancelar una completada no se vale — 9 tests nuevos (72/72 unitarios en total). Se integró `canTransition()` en `services/appointments.ts#changeStatus()`: antes de hacer el `UPDATE` consulta el estado actual y valida la transición, lanzando un error en español si no es válida — así `AppointmentDetailPage.vue` no puede cancelar una cita ya completada aunque el usuario le dé clic al botón
- [x] **4.10** `services/records.ts`: `saveGroomingRecord`/`saveMedicalRecord` (upsert por `appointment_id`, único por cita), `addVaccination` (siempre insert, nunca upsert: cada dosis es un hecho propio), `listVaccinationsByPet`, `getGroomingRecordByAppointment`/`getMedicalRecordByAppointment`. `addWeight` ya existía en `services/pets.ts` (Fase 2) — se le agregó un `appointmentId` opcional para ligar la pesada a la cita de veterinaria, y `records.ts` lo re-exporta para que `AttendPage.vue` importe todo de un solo lugar
- [x] **4.11** 🧪 Tests de `services/records.ts` + que el registro quedó en `audit_log` con el actor correcto — `records-service.spec.ts`, sesión real (no mock) igual que `appointments-service.spec.ts`. **Concepto nuevo importante**: `grooming_records`/`medical_records`/`vaccinations` tienen el trigger `prevent_hard_delete()` (CLAUDE.md §8.5) — ni siquiera `service_role` puede borrarlos, así que estos tests, a propósito, NO limpian esas filas al terminar: la cita y su ficha de prueba quedan permanentes en la base local, igual que pasaría con una ficha real. `npm run db:reset` limpia cuando se quiera. Bug propio encontrado: la cita de prueba de veterinaria se creó en `BRANCH_CENTRO`, pero el vet de la semilla solo tiene acceso a `BRANCH_DEL_VALLE` (`membership_branches`) — la política de `medical_records` valida "¿esta cita es tuya?" con un SELECT sobre `appointments` que también pasa por RLS, así que sin acceso a esa sucursal el `INSERT` se rechazaba aunque el vet sí fuera el empleado asignado
- [x] **4.12** `AttendPage.vue`: bifurca según `appointment.kind` y marca la cita `in_progress` al abrir — verificado a mano en local (2026-09-04): agendar y atender una cita de estética y una de veterinaria de punta a punta, el estado pasa `scheduled → in_progress → completed`. **Feedback del usuario: los flujos de agendar/atender funcionan pero la UX no convence todavía — queda pendiente una pasada de UX, no bloquea seguir con la Fase 5**
- [x] **4.13** `GroomingRecordForm.vue`: estilo de corte, navaja, shampoo, comportamiento, notas
- [x] **4.14** `MedicalRecordForm.vue`: motivo, exploración, diagnóstico, tratamiento, indicaciones, peso, temperatura, próxima visita — el peso se guarda como una fila nueva de `pet_weights` (nunca se edita una anterior), ligada a la cita
- [x] **4.15** `VaccinationDialog.vue`: aplicar vacuna con lote y cálculo automático de próxima dosis, usando `lib/vaccination.ts` (tarea 4.6)
- [x] **4.16** Al guardar la ficha, la cita pasa a `completed`; el "ofrece ir a cobrar" se resolvió con un mensaje de que el cobro llega en la Fase 5 (esa página no existe todavía, no se construyó antes de tiempo)
- [x] **4.17** **Cierre de fase:** PR, CI verde, merge (PRs #22-#25). Catálogo de vacunas sincronizado a mano en `fullpetcare-prod` (2026-09-04, mismo criterio que clientes/mascotas/servicios en Fases 2-3: las migraciones se despliegan solas, los datos de `seed.sql` no). Verificado en producción: atender una cita de estética y una de veterinaria de punta a punta — **Fase 4 completa**

---

## Fase 5 — Cobrar

**Meta: el flujo completo agendar → atender → cobrar, con ticket.**

- [x] **5.1** 📚 `lib/money.ts`: `splitTaxIncluded()`, `sumLineItems()`, `applyDiscount()`, `formatMXN()`, `parseMXNToCents()`. **Explicar por qué todo es entero, cómo se desglosa el IVA hacia atrás y por qué el impuesto se calcula por partida y no sobre el total** — `net = round(gross * 10000 / (10000 + tax_rate_bp))`, `tax = gross - net` (por resta, nunca por un segundo redondeo) para que `net + tax` dé siempre el precio exacto
- [x] **5.2** 🧪 Tests de `lib/money.ts` (los más importantes del proyecto): desglose de $350 al 16 %; tres partidas donde la suma de IVA por partida difiere de calcularlo sobre el total; precio 0; carrito vacío; descuento mayor al total; redondeo de .5 centavos; que `net + tax === gross` siempre — 22 tests nuevos (88/88 unitarios en total)
- [x] **5.3** Migración `0014_sales.sql`: `sales` (con `folio` por sucursal), enum `sale_item_type` con valor `service`, `sale_items`, RLS, auditoría — `20260907151849_sales.sql`. Folio consecutivo por `(tenant_id, branch_id)`, no por tenant (dos sucursales no comparten numeración); sin política de UPDATE/DELETE en `sale_items` (un ticket ya cobrado no se edita, se cancela la venta completa)
- [x] **5.4** Migración `0015_payments.sql`: enum `payment_method` (cash, card, transfer_spei, openpay), `payments`, RLS, auditoría — `20260907151850_payments.sql`. Enum `payment_status` con solo dos valores (`approved` para efectivo, `simulated_approved` para los tres métodos simulados) — sin `pending`/`failed`, que v1 no produce
- [x] **5.5** Migración `0016_invoice_requests.sql`: `invoice_requests` con todos los campos CFDI y `fiscal_uuid` nullable — `20260907151851_invoice_requests.sql`
- [x] **5.6** 📚 Migración `0017_checkout_rpc.sql`: `checkout_appointment(p_appointment_id, p_payments jsonb, p_discount_cents)` — revalida membresía, crea venta y partidas desde los snapshots de la cita, registra pagos, marca la cita cobrada, devuelve el `sale_id`. **Explicar qué es una transacción, qué garantiza el todo-o-nada, y por qué esta función revalida permisos aunque sea `SECURITY DEFINER`** — `20260907151852_checkout_rpc.sql`. `tax_rate_bp` se lee del catálogo ACTUAL (join a `services`), no de un snapshot: `appointment_services` (fase 3) solo congela nombre/precio/duración, no la tasa de impuesto. También bloquea cobrar una cita que no esté `completed` y cobrarla dos veces (verificado a mano con `psql` antes de escribir los tests automatizados)
- [x] **5.7** 🧪 Test del RPC: cobro exitoso deja venta + partidas + pagos consistentes — `supabase/tests/checkout-rpc.spec.ts`
- [x] **5.8** 🧪 Test del RPC: si el monto pagado no cubre el total, lanza error y **no queda nada escrito** (ni venta ni partidas) — usa `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` para seguir consultando la misma transacción de prueba después del error esperado
- [x] **5.9** 🧪 Test del RPC: un usuario de otro tenant no puede cobrar una cita ajena — más un caso de control de ROL (groomer, mismo tenant y sucursal, sin permiso de cobro)
- [x] **5.10** 🧪 Test: los totales que calcula el RPC coinciden exactamente con los de `lib/money.ts` — compara el resultado real de la base contra `sumLineItems()` llamada con los mismos datos, no contra números fijos a mano. 82/82 tests de BD en verde
- [x] **5.11** `services/checkout.ts`: arma el resumen, llama al RPC, recupera el ticket — `buildSummary()` calcula el desglose del lado del cliente con `lib/money.ts#sumLineItems` (mismos números que el RPC, tarea 5.10); `charge()` llama `checkout_appointment` y regresa el ticket completo. Con tests contra Supabase local (`checkout-service.spec.ts`, sesión real) que no estaban pedidos explícitamente en esta tarea pero siguen el mismo criterio de cobertura de `services/` de fases anteriores — atraparon dos bugs propios: el orden de borrado del cleanup violaba una FK, y todos los tests agendaban en el mismo horario (si un cleanup fallaba, tumbaba al resto por traslape). 86/86 tests de BD y 88/88 unitarios en verde
- [x] **5.12** `useCartStore`: partidas, descuento, totales en vivo — las partidas se cargan de la cita (`loadAppointment`, solo lectura: lo que de verdad se cobra lo decide `checkout_appointment()` en la base); lo que sí se agrega/quita en vivo son los PAGOS acumulados (efectivo + tarjeta, por ejemplo), con `remainingCents`/`isFullyPaid` calculados en cada cambio
- [x] **5.13** 🧪 Tests de `useCartStore`: agregar y quitar partidas (pagos) recalcula lo que falta por cubrir; el descuento nunca deja el total negativo; un pago que excede el total no deja "lo que falta" en negativo — 13 tests nuevos (101/101 unitarios en total)
- [x] **5.14** `CheckoutPage.vue`: resumen con desglose de subtotal, IVA y total; selección de método de pago simulado — ruta nueva `/app/citas/:id/cobrar`; botón "Cobrar" agregado a `AppointmentDetailPage.vue` (visible solo con la cita `completed`) y el mensaje de `AttendPage.vue` ahora enlaza aquí en vez de decir "disponible en la siguiente fase". Verificado de punta a punta en el navegador (Playwright headless, sin `chromium-cli` disponible en este entorno): agendar→atender→cobrar con un cobro real, folio consecutivo correcto, y los mismos números ($215.52 + $34.48 = $250.00) que calcula `lib/money.ts`. En el camino se encontró y corrigió un bug real: los errores de `.rpc()`/`.from()` de supabase-js NO son instancias de `Error` (a diferencia de los de `supabase.auth`, que sí lo son) — `err instanceof Error` fallaba siempre y ocultaba el mensaje real del RPC (p. ej. "Esta cita ya fue cobrada.") detrás de un genérico "revisa tu conexión"
- [x] **5.15** `TicketView.vue`: ticket imprimible (CSS `@media print`), con folio, fecha en zona de la sucursal y desglose — componente en `src/components/`, con un segundo bloque `<style>` SIN `scoped` a propósito (el `@media print` necesita ocultar TODO lo demás de la página, no solo lo de este componente)
- [x] **5.16** Casilla "requiere factura" que crea el `invoice_request` con los datos fiscales del cliente. _Verificar:_ la fila se crea con status `pending` — `services/invoiceRequests.ts` nuevo; verificado en la base tras un cobro real: `status='pending'`, RFC/razón social del cliente correctos, `payment_form_code='01'` (mapeado de "efectivo"), `payment_method_code='PUE'`. La casilla se deshabilita si al cliente le faltan datos fiscales
- [x] **5.17** **Cierre de fase:** PR #27 mergeado con CI verde; las 4 migraciones nuevas se aplicaron solas a `fullpetcare-prod` vía `deploy-migrations.yml`. Cobro real verificado de punta a punta en producción (agendar → atender → cobrar, cliente Sofía/Rocky, Ticket #1, $250.00 con IVA desglosado igual que `lib/money.ts`). En el camino, verificando ese flujo real se encontró un bug preexistente de la fase 4 (no introducido en esta fase): `AttendPage.vue` mostraba el formulario de atención antes de que terminara la transición `scheduled → in_progress`, así que guardar la ficha muy rápido podía dejar la cita sin poder completarse ("La ficha se guardó, pero no se pudo marcar la cita como completada."). Corregido (PR aparte, `fix/attend-page-status-race`) — **Fase 5 completa.**

---

## Fase 6 — Historial y red de seguridad

**Meta: la historia completa de una mascota, y un test que valida el demo antes de cada reunión.**

- [x] **6.1** `services/petHistory.ts`: `getTimeline(petId)` que mezcla citas de ambos tipos, fichas, vacunas y pesos en una sola lista ordenada por fecha — el ORDEN vive aparte, en `lib/timeline.ts#buildTimeline()` (función pura, mismo criterio que `lib/availability.ts`); `getTimeline()` solo trae los datos (citas completadas con su ficha embebida, vacunas, pesos) y llama a esa función
- [x] **6.2** 🧪 Tests de `getTimeline`: orden correcto mezclando tipos; dos eventos en el mismo instante (sort estable, se prueba que conserva el orden de entrada); mascota sin historial; que no aparecen registros de otro tenant — divididos entre `lib/timeline.spec.ts` (4 tests, puros) y `supabase/tests/pet-history-service.spec.ts` (2 tests, sesión real: aislamiento y "sin historial" sí necesitan datos de verdad). 88/88 tests de BD, 105/105 unitarios
- [x] **6.3** `PetTimeline.vue`: línea de tiempo con ícono e insignia distinta por tipo de visita — `v-timeline` de Vuetify; verificado en navegador que un groomer ve la visita veterinaria en la línea de tiempo pero SIN el diagnóstico (RLS lo oculta solo, sin ningún `v-if` de rol — CLAUDE.md §6.1)
- [x] **6.4** `VaccinationCard.vue`: cartilla con estado por vacuna (vigente / por vencer / vencida) — una fila por vacuna (la aplicación más reciente), usando `lib/vaccination.ts#classifyVaccineStatus` (fase 4, primer uso real en la UI)
- [x] **6.5** `WeightChart.vue`: gráfica de peso en SVG simple, sin librería — `<svg>` con `viewBox` fijo y `currentColor` (toma el color de texto de Vuetify)
- [x] **6.6** `PetDetailPage.vue` final: foto, datos, alertas médicas, cartilla, peso, timeline, próximas citas — reemplaza la versión provisional de la tarea 2.20; `services/appointments.ts` ganó `listUpcomingByPet`. Verificado en navegador de punta a punta con historial real (vacuna, visita de estética, visita de veterinaria, dos pesadas, una cita futura)
- [x] **6.7** Sección "Próximas vacunas" en el dashboard, ordenada por urgencia — `services/records.ts#listUpcomingVaccines()`: por (mascota, vacuna) solo cuenta la aplicación MÁS RECIENTE (una mascota puede tener varias dosis de la misma vacuna a lo largo del tiempo); orden por urgencia = `next_due_date` ascendente, sin criterio aparte (una fecha vencida ya es "menor" que una futura). No lleva sucursal — una vacunación no tiene `branch_id` (CLAUDE.md §6.4), es del negocio completo. Verificado en navegador con una vacuna vencida (chip rojo "Vencida") y una por vencer (chip naranja "Por vencer")
- [x] **6.8** 📚 Instalar y configurar Playwright; `playwright.config.ts` apuntando a Supabase local. **Explicar qué es un test end-to-end, en qué se diferencia de un unitario y por qué solo va a haber uno** — `@playwright/test` instalado; `webServer` levanta `npm run dev` solo (o reutiliza el que ya esté corriendo en local); reintenta 1 vez en local (parpadeos de Vuetify) y 0 en CI
- [x] **6.9** 🧪 📚 **El test E2E**: login → agendar cita de estética → atender con notas → cobrar en efectivo → verificar el total en el ticket → verificar que aparece en el historial de la mascota. **Explicar cada paso y qué protege** — `e2e/agendar-atender-cobrar.spec.ts`. Elige el PRIMER hueco de horario disponible (no uno fijo) para poder correrse más de una vez seguida sin reiniciar la base; verificado corriéndolo dos veces sin `db:reset` entre medio, sin choques
- [x] **6.10** Agregar el E2E al workflow de CI (job aparte, corre después de los unitarios). _Verificar:_ pasa en GitHub Actions, no solo en la Mac — job `e2e` en `.github/workflows/ci.yml`, con `needs: test`. Se encontraron y corrigieron DOS problemas que solo aparecían en Ubuntu, no en la Mac (PR #29): faltaba escribir `.env.local` para el servidor (la anon key local es fija y no secreta, se lee de `supabase status -o env`), y el servidor de DESARROLLO de Vite podía responder "504 Outdated Optimize Dep" a un import dinámico justo al arrancar en frío, abortando la navegación a mitad de la prueba sin ningún error de la app — se cambió a probar contra un build de producción (`vite preview`) en vez del servidor de desarrollo, lo que de paso también hace que el E2E pruebe lo más parecido a lo que ve un usuario real. Confirmado en verde en GitHub Actions (PR #29)
- [x] **6.11** `supabase/seed/demo_reset.sql`: limpia las tablas de negocio de los tenants demo y repuebla, sin tocar `auth.users` — `grooming_records`/`medical_records`/`vaccinations` NUNCA se pueden borrar (`app.prevent_hard_delete()`, CLAUDE.md §8.5), así que "limpiar" no puede ser "borrar todo e insertar de nuevo": las citas/mascotas "estrella" del guion (Rocky y Max) usan ids FIJOS y se reviven con `insert ... on conflict (id) do update`, recalculando fechas relativas a `now()`; todo lo demás (ventas, citas sueltas de una demo anterior) se oculta con borrado suave. `appointment_services` sí se puede borrar de verdad (no está en la lista de §8.5) — se limpia y reinserta en vez de un frágil `on conflict` sin restricción única real que lo respalde. Verificado corriéndolo dos veces seguidas contra la base local: mismos conteos de filas ambas veces
- [x] **6.12** `scripts/demo-reset.sh` + script npm `demo:reset`, con confirmación interactiva antes de ejecutar. _Verificar:_ deja el demo idéntico dos veces seguidas — apunta siempre a `fullpetcare-prod` (ref fijo, sin aceptar argumento, para que nunca sea un descuido). Probado el camino de "cancelar" (responde "n"); el camino real contra producción queda para el cierre de fase (6.14), con el usuario presente
- [x] **6.13** Semilla de demo enriquecida: historial de varios meses para 2–3 mascotas estrella, con visitas de ambos tipos, para que el timeline se vea lleno en la reunión — Rocky (Sofía): 3 visitas de estética + 1 de veterinaria + vacuna + progresión de peso a lo largo de 3 meses + una cita futura. Max (Santiago, "el único que factura"): 1 visita de veterinaria (usa su alerta médica ya sembrada, "cardiopatía leve") + vacuna + peso + una revisión de seguimiento agendada. Verificado en navegador: ambas fichas muestran timeline, cartilla y gráfica de peso completos
- [x] **6.14** **Cierre de fase:** PR #29 mergeado con CI verde (lint/unitarios/RLS y el E2E de Playwright, los tres en verde). Corrido `npm run demo:reset` contra `fullpetcare-prod` (enlazando el repo temporalmente, luego devuelto a `staging`): confirmado por API que las citas de pruebas en vivo anteriores quedaron con `deleted_at` (ocultas, no borradas) y que las 7 citas del guion fijo de Rocky y Max están activas; confirmado en el sitio real que la ficha de Rocky y el dashboard de "Próximas vacunas" se ven limpios y curados. **Fase 6 completa.**

---

## Fase 7 — Vista cliente pública

**Meta: abrir el link en el celular y ver la cartilla de la mascota.**

- [x] **7.1** Migración `0018_share_links.sql`: `share_links` con `token_hash` (nunca el token), `token_prefix`, `expires_at`, `revoked_at`, `access_count`; RLS que solo deja al personal del tenant gestionarlos; auditoría — `20260907183312_share_links.sql`. `scope` acepta `pet`/`customer` (CLAUDE.md §6.6) pero v1 solo genera links de mascota (check constraint ya cierra la puerta a una fila inconsistente); cualquier rol activo administra los links de su tenant, sin restricción por rol (a diferencia del catálogo o el expediente). 6 tests nuevos de RLS (aislamiento entre tenants + `anon` sin ningún acceso), 94/94 tests de BD en verde
- [x] **7.2** 📚 `services/shareLinks.ts`: genera 32 bytes con `crypto.getRandomValues`, guarda solo el SHA-256, devuelve el token en claro **una sola vez**. **Explicar por qué se guarda hasheado, por qué 32 bytes son inadivinables y por qué un UUID de mascota no sirve como link** — base64url a mano (`btoa` + reemplazo de caracteres), sin librería nueva; `token_prefix` (8 caracteres del token en claro, no del hash) para identificar un link en una lista sin poder reconstruirlo completo
- [x] **7.3** 🧪 Tests de `shareLinks.ts`: dos tokens nunca se repiten; en la base no queda el token en claro; revocar lo invalida — sesión real (`share-links-service.spec.ts`), 4 tests. 10/10 tests de `share_links` en verde (RLS + servicio)
- [x] **7.4** 📚 Edge Function `public-pet-view`: recibe token, hashea, busca link vigente, consulta con service role filtrando **siempre** por `tenant_id` y `pet_id` del link, devuelve un DTO de lista blanca. **Explicar qué es una Edge Function, por qué corre con service role y por qué eso es seguro solo si valida antes** — `supabase/functions/public-pet-view/index.ts`, usando `@supabase/server` (`withSupabase`, `auth: "publishable"`) en vez del patrón manual de `Deno.serve` + `createClient`. Verificado a mano contra Supabase local con un token real (incluida la foto firmada, vacunas, visitas con nombre de quien atendió, y próximas citas)
- [x] **7.5** 🧪 Test: token válido devuelve exactamente esa mascota y nada más
- [x] **7.6** 🧪 **Test de aislamiento del link**: un token del tenant A no puede devolver datos del tenant B, ni aunque se le pase un `pet_id` ajeno en el cuerpo
- [x] **7.7** 🧪 Tests: token revocado, expirado, inexistente y malformado → **todos la misma respuesta genérica** (no revelar cuál de los casos fue)
- [x] **7.8** 🧪 Test de forma de la respuesta: comparación exacta contra la lista blanca; falla si algún día alguien agrega un campo con datos internos
- [x] **7.9** 🧪 Test: `anon` sigue sin poder leer ninguna tabla directamente (regresión de `1.23` ampliada a todas las tablas) — las 21 tablas de negocio existentes hasta esta fase, `it.each`
- [x] **7.10** Registro de acceso: `access_count` y `last_accessed_at` se actualizan — con test de que un intento con token INVÁLIDO no cuenta como acceso. `supabase/tests/public-pet-view.spec.ts`: 28 tests nuevos (7.5-7.10 juntas), llamando la función real por HTTP (no se puede probar con `pg`, es Deno, no Postgres). La llave pública nueva (`sb_publishable_...`, no el `ANON_KEY` clásico) se lee de `supabase status` en el momento, no fija en el archivo — la lección de la fase 6 (un valor "fijo" que puede no serlo en otra máquina). 126/126 tests de BD en verde
- [x] **7.11** `PublicLayout.vue`: layout móvil, sin navegación interna, con el nombre y logo del negocio — "logo" es el mismo ícono de pata que usa `AppLayout.vue` (no hay un logo por tenant en el modelo de datos); el nombre del negocio llega por evento desde `PublicPetPage.vue` (viene en la respuesta de la función, no de una ruta con sesión) para no pedirlo dos veces
- [x] **7.12** `PublicPetPage.vue` (`/c/:token`): foto, datos, cartilla, historial de visitas de ambos tipos, próximas citas — bug real encontrado y corregido en el camino: `supabase.functions.invoke()` del navegador manda la anon key CLÁSICA (JWT), incompatible con `auth: "publishable"` de `@supabase/server` (formato `sb_publishable_...`); la función se cambió a `auth: "none"` porque la seguridad real de este endpoint nunca dependió de la apikey de plataforma, depende del token de `share_links` (documentado en el propio archivo). Verificado en un viewport móvil (390×844): foto, datos, próximas citas, cartilla con chip de estado, historial con quien atendió — todo con fechas en español vía `lib/datetime.ts` (se agregó `businessTimezone` al DTO para esto, ya que una vacunación no tiene sucursal propia)
- [x] **7.13** Estados de error del lado público: link inválido o vencido con un mensaje amable y sin detalles técnicos — verificado con un token inexistente: mensaje genérico, encabezado cae a "FullPetCare" (sin nombre de negocio que mostrar todavía)
- [x] **7.14** Botón en `PetDetailPage.vue`: generar link, copiarlo al portapapeles, ver links activos, revocar — `ShareLinkManager.vue` nuevo. Verificado en navegador de punta a punta: generar → copiar (con permiso de portapapeles) → revocar → confirmar que el link revocado YA NO funciona en `/c/:token` (mismo mensaje genérico que un token inexistente)
- [x] **7.15** Verificación en móvil real: abrir el link en un teléfono, revisar tamaños de toque, legibilidad y peso de la foto — revisado por el usuario en un teléfono real contra producción, se ve bien
- [x] **7.16** **Cierre de fase:** PR #31 mergeado con CI verde; migración de `share_links` y la Edge Function `public-pet-view` desplegadas solas a `fullpetcare-prod` (workflows `deploy-migrations.yml` y el nuevo `deploy-functions.yml`, primera vez que este último corre de verdad); confirmado con una llamada real a la función en producción, y el usuario verificó el link completo (generar → abrir en su celular) contra el sitio desplegado. **Fase 7 completa.**

---

## Cierre de v1

- [x] **8.1** Recorrer el flujo completo en producción con datos frescos, como si fuera la reunión — reseteado el demo primero, luego: login → sucursal → agenda (con "Próximas vacunas" ya pobladas) → agendar cita nueva → atender con nota → cobrar (Ticket #2, $215.52 + $34.48 = $250.00) → historial de Rocky con la visita recién cobrada → generar link público → abrirlo (foto, cartilla, historial) → revocar → confirmar que deja de funcionar. Todo en `fullpetcare.pages.dev` real, sin errores de consola ni de red. Un solo susto que resultó no ser bug: la foto no apareció en una captura intermedia por timing de la prueba automatizada, no por un problema real (se confirmó aparte, cargando perfecto)
- [x] **8.2** Revisar la cobertura de `lib/`, `services/` y `stores/`; llegar a 70–80 % donde falte — `npm run test:unit:coverage` no reporta bien varios archivos de `lib/` (un problema de la herramienta de cobertura de Vitest/v8, no de los tests: `datetime.ts`, `vaccination.ts`, `appointmentStatus.ts`, `validation.ts` y `timeline.ts` desaparecen del reporte aunque sus tests corren y pasan). Se revisó archivo por archivo en vez de confiar solo en el número, y se encontraron TRES `services/` con cero tests reales (solo mocks o cobertura indirecta de la tabla por RLS): `memberships.ts` (el caso especial de que el dueño ve todas las sucursales sin fila en `membership_branches`), `services/invoiceRequests.ts` (el mapeo a `payment_form_code` del SAT, CLAUDE.md §8.4 — un pago mixto efectivo+tarjeta da "06") y `vaccines.ts` (el filtro "de esta especie o sin especie"). También `lib/roles.ts` y `lib/petLabels.ts` nunca tuvieron test propio. 12 tests nuevos de servicios + 5 de `lib/` — 145/145 tests de BD, 110/110 unitarios
- [x] **8.3** Revisión de seguridad: listar todas las tablas y confirmar que cada una tiene RLS activo y su test de aislamiento — 21 tablas de negocio en el esquema, las 21 con `enable` Y `force row level security` (ninguna se quedó solo con una de las dos). Se encontraron y cerraron DOS huecos reales: `membership_branches` nunca tuvo un test de aislamiento propio desde que se creó en la fase 1 (el pendiente que dejó la tarea 1.16 nunca se cerró porque nunca hubo una pantalla de administración que lo forzara) y `invoice_requests` (fase 5) nunca tuvo uno tampoco — se agregaron 3 tests a `tenancy-isolation.spec.ts` y un archivo nuevo `invoice-requests-rls.spec.ts` (4 tests). 133/133 tests de BD en verde
- [x] **8.4** Confirmar que ningún secreto quedó en el repo (`git log -p` buscando llaves) — revisado todo el historial (`git log -p --all`) buscando `sb_secret_`/`sb_publishable_`/`sbp_`/JWTs/llaves privadas: cero coincidencias reales. Los dos JWT que sí aparecen son los del demo LOCAL fijo (anon/service_role, derivados del `JWT_SECRET` de ejemplo en `supabase/config.toml`, documentados en el README como no secretos e iguales en cualquier proyecto local). Ningún `.env*` real trackeado, solo `.env.example` con la llave vacía
- [x] **8.5** README con guion de demo: qué enseñar, en qué orden, y qué decir en cada pantalla — 7 pasos (login → agenda → agendar → atender → cobrar → historial → vista pública), apoyándose en el historial curado de Rocky/Max de `demo_reset.sql` para no construir meses de visitas en vivo
- [x] **8.6** Correr `demo:reset` y dejar el ambiente listo para la primera reunión — corrido contra `fullpetcare-prod` después del recorrido de la tarea 8.1 (que dejó una cita y una venta reales de prueba); verificado por API que solo quedan las 5 citas del guion fijo de Rocky (4 completadas + 1 agendada) y 0 ventas activas en Sucursal Centro. **v1 completo.**

---

## Fase 9 — Gestión de empleados y permisos por rol

**Meta: un CRUD de empleados (datos personales, acceso, documentos) visible solo para
el dueño hoy, pero construido para que a futuro se puedan modificar los permisos de
cada rol sin tocar código.** Pedida por el usuario después de v1; decisiones de diseño
resueltas con él antes de construir (un "empleado" es la persona que ya tiene
`membership`/`profile`, no un registro de RH aparte; dar de alta crea el acceso
completo — invita por correo; documentos como texto + archivo; permisos en una tabla
por negocio, no hardcodeados; se aprobó una segunda Edge Function).

- [x] **9.1** 📚 Migración `role_permissions.sql`: enum `permission_module` (hoy solo
  `'employees'`, mismo patrón aditivo que `sale_items.item_type`), tabla
  `role_permissions` (`tenant_id`, `role`, `module`, `can_view`, `can_edit`), RLS
  **solo SELECT** (mismo precedente que las tablas de tenencia de la fase 1: sin
  pantalla de administración todavía, se siembra a mano), y `app.has_permission()`
  — `stable security definer`, mismo molde que `app.is_member_of()`/`app.role_in()`.
  **Explicar por qué `owner` siempre regresa `true` sin mirar la tabla, y por qué eso
  es justo el mismo bypass que ya usa CLAUDE.md §6.1 en todos lados** —
  `20260910120000_role_permissions.sql`. Semilla en `seed.sql`: los dos tenants demo,
  módulo `employees`, solo `owner` en `true/true`
- [x] **9.2** Migración `employee_details.sql`: tabla 1 a 1 con `membership_id`
  (`birth_date`, `curp`, `rfc`, `voter_id_number`, sin `check` de formato — la
  validación de forma vive en `lib/validation.ts`, igual que `customers.rfc`), RLS
  vía `app.has_permission(tenant_id, 'employees', 'view'|'edit')`. Misma trampa de
  siempre (CLAUDE.md §7.2): sin `and deleted_at is null` en el SELECT, porque esta
  tabla nace con UPDATE para authenticated — `20260910120200_employee_details.sql`
- [x] **9.3** 📚 Migración `employee_access_rls.sql`: cierra el pendiente que
  `rls_tenancy.sql` dejó anotado en la fase 1 (tarea 1.16) — INSERT/UPDATE en
  `memberships` y `membership_branches`, gateados por `app.has_permission(...,
  'employees', 'edit')` (no un rol fijo: cambiar quién administra empleados es una
  fila de datos, no una migración), trigger `memberships_audit` que faltaba, y una
  política de UPDATE nueva en `profiles` (propio perfil, o quien tenga
  `employees:edit` sobre un tenant donde esa persona tiene membership activa).
  **Explicar por qué el permiso de esta migración se pregunta a una tabla en vez de
  compararse contra `'owner'` directo** — `20260910120400_employee_access_rls.sql`
- [x] **9.4** Migración `employee_documents.sql`: enum `employee_document_type`
  (`voter_id`, `address_proof`, `employment_contract`), tabla con
  `unique(membership_id, document_type)` — un solo archivo vigente por tipo, mismo
  criterio que `pets.photo_path` (ruta fija + `upsert`, sin huérfanos) — y bucket
  Storage `employee-documents` (`public: false`, imagen + PDF, 10 MB), con políticas
  idénticas en forma a `pet_photos_bucket.sql` pero llamando `app.has_permission()`
  en vez de comparar rol. `uploaded_by` con `default auth.uid()` —
  `20260910120600_employee_documents.sql`
- [x] **9.5** Migración `fix_membership_branches_select_for_soft_delete.sql`: al
  agregarle UPDATE a `membership_branches` (tarea 9.3), su política de SELECT
  original (fase 1) seguía filtrando `deleted_at is null` — la MISMA trampa de
  CLAUDE.md §7.2 que ya se había corregido una vez para `customers`/`pets` en la fase
  2, ahora tocaba pagarla aquí. El filtro se movió a
  `services/memberships.ts`/`services/employees.ts` (`.is('membership_branches.deleted_at',
  null)` explícito sobre el recurso embebido) — `20260910121000_...sql`
- [x] **9.6** 📚 RPC `create_employee_membership()`: crea `membership` +
  `membership_branches` + `employee_details` en una sola transacción — mismo motivo
  que `checkout_appointment`/`create_appointment` (PLAN.md §1.2): si la segunda
  escritura fallara, quedaría un empleado a medias. Revalida
  `app.has_permission(..., 'employees', 'edit')` adentro (CLAUDE.md §7.3.4, salta
  RLS), valida que las sucursales pedidas sean del mismo tenant, y da un mensaje
  claro si la persona ya tenía acceso a este negocio. **Explicar por qué esto NO
  puede vivir en la Edge Function** — `20260910120800_create_employee_membership_rpc.sql`
- [x] **9.7** 📚 Edge Function `invite-employee`: el único paso que exige
  `service_role` (`auth.admin.inviteUserByEmail`) — CLAUDE.md §10, esa llave nunca
  toca el frontend. A diferencia de `public-pet-view`, aquí SÍ hay sesión: se
  revalida el permiso con un cliente scoped al JWT de quien llama (RLS normal, NO
  `@supabase/server` en modo `"user"` — esa librería exige JWKS y este proyecto
  todavía firma con el secreto clásico, mismo motivo que ya documentaba
  `public-pet-view` para la anon key). Reutiliza el `userId` si el correo ya estaba
  registrado (persona que ya trabaja en otro negocio del sistema, CLAUDE.md §6.1).
  **Explicar la diferencia de auth entre esta función y `public-pet-view`, y qué
  significa `verify_jwt = true` en `config.toml` aquí** —
  `supabase/functions/invite-employee/`. Verificado a mano contra Supabase local:
  alta exitosa, rechazo a quien no tiene permiso, aislamiento entre tenants, y
  correo repetido reutilizando el id
- [x] **9.8** 🧪 Tests de RLS/RPC/Edge Function — 38 tests nuevos, 196/196 de BD en
  verde: `role-permissions-rls.spec.ts` (aislamiento + sin política de escritura),
  `employee-details-rls.spec.ts` (view/edit por `app.has_permission`, con un caso que
  prueba que cambiar SOLO una fila de `role_permissions` cambia el resultado sin
  tocar código), `employee-documents-rls.spec.ts` (tabla + Storage),
  `memberships-write-rls.spec.ts` (INSERT/UPDATE nuevos + que desactivar corta acceso
  al instante), `create-employee-membership-rpc.spec.ts` (todo o nada, revalidación
  de permiso aunque la RPC salte RLS), `invite-employee-function.spec.ts` (HTTP real,
  mismo patrón que `public-pet-view.spec.ts`)
- [x] **9.9** `lib/validation.ts#isValidCURP` + `lib/permissions.ts#hasPermission`
  (la versión "para no mostrar un botón que el backend igual va a rechazar" —
  CLAUDE.md §6.1 — mismo espíritu que `lib/roles.ts`). 12 tests nuevos, 151/151
  unitarios en verde
- [x] **9.10** `useSessionStore` gana `permissions` (cargadas junto al tenant activo)
  y `canView()`/`canEdit()`; `selectTenant()` pasa a `async` para poder recargarlas al
  cambiar de negocio sin cerrar sesión. `services/permissions.ts#listForTenant()`
  nuevo. 3 tests nuevos en `session.spec.ts` (incluido el caso de "mismo rol,
  resultado distinto" al cambiar de tenant)
- [x] **9.11** `services/employees.ts` (`list`, `inviteAndCreate`, `update`) y
  `services/employeeDocuments.ts` (`upload`, `listByMembership`, `getSignedUrl`) —
  `services/branches.ts` ganó `listByTenant()`. `update()` calcula la diferencia real
  de sucursales asignadas en vez de "borrar todo e insertar de nuevo" (el
  `unique(membership_id, branch_id)` no excluye filas borradas suavemente, así que
  soft-borrar y reinsertar la MISMA sucursal en una sola edición violaría esa
  restricción)
- [x] **9.12** `EmployeesPage.vue` (`/app/empleados`) y `EmployeeFormDialog.vue` — un
  solo diálogo con pestañas (Datos personales / Acceso / Documentos), no pasos,
  mismo criterio que ya se pidió para agendar una cita (commits #37/#38/#41). Botón
  "Empleados" en `AppLayout.vue` y guard nuevo en `router/index.ts`
  (`requiresPermission`), ambos gateados por `session.canView('employees')` — no por
  un rol fijo
- [x] **9.13** Verificación de punta a punta en navegador real (Playwright dirigido a
  mano, sin agregarlo al único E2E de CLAUDE.md §9 — esto es un flujo secundario):
  login como dueño → aparece "Empleados" → alta de un empleado nuevo (correo real
  capturado en Mailpit local, `:54324`) → aparece en la lista con su rol → editar un
  empleado sembrado, subir su credencial de elector, reabrir y confirmar "Ver
  documento actual" → login como groomer → NO aparece "Empleados" → `/app/empleados`
  por URL directa redirige a la agenda. Cero errores de consola en todo el recorrido
- [x] **9.14** Documentación: `CLAUDE.md` §3 (dos Edge Functions, ya no "solo la vista
  pública"), nueva §6.7 (las tres tablas de esta fase), §7.2 (`app.has_permission()`
  junto a las demás funciones `app.*`, y el pendiente de 1.16 ya cerrado); `PLAN.md`
  con la Fase 9 y la decisión `D13`. **Fase 9 completa.**

---

## Fase 10 — Superadmin de plataforma

**Meta: un panel `/superadmin` (misma pantalla de login) para que el equipo de la
plataforma gestione las empresas registradas: darlas de alta, ver su plan, su dueño y
su fecha de alta, suspenderlas o darlas de baja, llevar notas internas, ver métricas
de uso y restablecer la contraseña del dueño.** Prioridad alta. Ya no es "v1 a secas":
el usuario empezó a agregar características nuevas. Decisiones resueltas con él antes
de construir:

- Los superadmins viven en una tabla aparte (`platform_admins`), no en `memberships`
  (un superadmin no pertenece a ningún negocio). Puede haber varios, todos con los
  mismos permisos.
- **Solo ven datos de la empresa** (nombre, dueño, plan, estado, conteos). Nunca
  clientes, mascotas, citas ni expedientes.
- Plan y vigencia son **informativos**: plan de texto fijo "Básico", vigencia
  indefinida (`NULL`). Sin tabla de planes y sin bloqueo por vencimiento (a futuro).
- Suspender / dar de baja es **solo una etiqueta** de estado: no bloquea el acceso de
  los usuarios de la empresa (a futuro). Las empresas no tienen fecha de baja.
- Un solo dueño por empresa. El alta captura: nombre de la empresa, nombre de la
  sucursal, y nombre / correo / teléfono del dueño. Zona horaria fija
  `America/Mexico_City`. Catálogo de servicios vacío.
- La contraseña del dueño la genera el sistema (temporal, se muestra una sola vez).
  Cambiarla al primer ingreso queda como trabajo futuro.
- Cambiar la contraseña de un admin cierra sus sesiones (revoca sus refresh tokens;
  un access token ya emitido sigue válido hasta caducar).
- El primer superadmin se crea con un script, no desde la UI.

- [x] **10.1** 📚 Documentación de alcance: esta fase en `TASKS.md`, `PLAN.md`
  (Fase 10 y decisión `D14`) y una nota en `CLAUDE.md` §1. Las tablas nuevas y el rol
  de plataforma se documentan en `CLAUDE.md` §6/§7 al cerrar la fase (10.11), cuando
  ya existen. _Verificar:_ los tres archivos mencionan la fase.
- [x] **10.2** 📚 Migraciones `20260924120000_platform_admins.sql` y
  `20260924120200_tenant_platform_info.sql`: `platform_admins` (sin `tenant_id`,
  excepción documentada igual que `profiles`), `app.is_platform_admin()`
  (`SECURITY DEFINER`, explicado), `tenant_platform_info` 1 a 1 con `tenants`
  (`plan`, `plan_expires_at`, `status`, `status_reason`, `internal_notes`; creada
  por trigger al insertar un tenant), `platform_audit_log` con su propio trigger
  `app.log_platform_change()`. RLS solo SELECT, solo superadmins; sin política de
  escritura (las RPC de 10.3 escriben). **Cambio de diseño respecto al plan
  original:** plan/estado/notas NO son columnas de `tenants` (cualquier miembro del
  negocio las leería con `select *`) y la bitácora NO reutiliza `audit_log` (la lee
  el dueño del negocio y `app.log_change()` exige `tenant_id`). Nombre, teléfono y
  correo del dueño no se duplican: salen de `profiles`/`auth.users` vía la RPC de
  10.3. _Verificado:_ `supabase db reset` corre limpio (junto con los tests de
  10.4).
- [x] **10.3** 📚 RPCs de plataforma (todas revalidan `app.is_platform_admin()`
  adentro, `SECURITY DEFINER`; explicado por qué RPC y no tablas directas):
  `platform_list_tenants` (incluye dueño: nombre, correo, teléfono),
  `platform_tenant_metrics` (solo conteos; el "mes" se calcula en la zona horaria
  del negocio, §8.3), `platform_set_tenant_status` (motivo obligatorio salvo al
  reactivar), `platform_update_notes`, `platform_create_tenant` (tenant + una
  sucursal + membership del dueño, todo o nada; el usuario de Auth lo crea la Edge
  Function de 10.5) — `20260924120400_platform_rpcs.sql`. Comprobado a mano en una
  transacción con rollback; sus tests formales son la 10.4.
- [x] **10.4** 🧪 Tests de BD — 59 tests nuevos, 255/255 de BD en verde:
  `platform-rls.spec.ts` (18: `is_platform_admin()`, RLS de las tres tablas,
  el dueño no ve notas internas ni las encuentra en su `audit_log`, tablas sin
  escritura directa, bitácora inmutable) y `platform-rpcs.spec.ts` (41: las 5
  RPC rechazan a dueño, ex-superadmin y `anon`; lista con dueño y negocio sin
  dueño; métricas solo con conteos y **el mes en la zona horaria del negocio**;
  motivo obligatorio al suspender; alta con todo o nada). Helpers nuevos:
  `insertAuthUser`, `makePlatformAdmin`, `tryQuery` (SAVEPOINT). **Validado con
  mutaciones:** se rompió a propósito el cálculo del mes (UTC) y el chequeo de
  superadmin de una RPC, y los tests correctos fallaron. Los tests de Edge
  Functions (`public-pet-view`, `invite-employee`) necesitan `supabase functions
  serve` corriendo; sin él dan 503, ajeno a esta fase.
- [x] **10.5** 📚🧪 Edge Function `platform-admin` — UNA sola función con tres
  acciones (`create_tenant`, `reset_password`, `add_admin`), decidido con el
  usuario. Revalida `platform_admins` con el JWT de quien llama (paso 1, sin
  `service_role`); solo después usa la llave secreta, y solo para la API de admin
  de Auth. Las escrituras de negocio van por las RPC con el JWT del superadmin, para
  que la bitácora registre al superadmin real como actor (con `service_role`,
  `auth.uid()` es NULL). El alta crea el usuario **y** llama la RPC en un solo paso
  (si la RPC falla, borra el usuario huérfano), así que el frontend no coordina dos
  llamadas. Un correo ya registrado se rechaza con 409 (decisión 3: no secuestrar
  cuentas). Restablecer: bitácora primero, luego contraseña, luego cierra sesiones.
  Migración `20260924120600_platform_admin_support.sql`: `revoke_user_sessions`
  (solo `service_role`), `platform_list_admins`, `platform_add_admin`,
  `platform_remove_admin` (nunca deja cero superadmins), `platform_log_event` y la
  columna `event` de la bitácora. Config: `[functions.platform-admin]` en
  `config.toml`. **Explicar la diferencia entre `callerClient` y `adminClient`.**
  _Verificado:_ `platform-admin-function.spec.ts` (20 tests HTTP reales),
  `platform-admin-support.spec.ts` (22, RPC). Probado con mutaciones: quitar el
  chequeo de superadmin destapó que un no-superadmin podía **sondear qué correos
  están registrados** (recibía 409 en vez de 403) — hay test que lo impide ahora.
  Límite conocido: GoTrue ya cierra las sesiones al cambiar la contraseña, así que
  los tests no distinguen si lo hizo GoTrue o `revoke_user_sessions` (que se
  conserva como garantía propia). El camino "la RPC falla tras crear el usuario"
  (limpieza del huérfano) no tiene test: no hay forma honesta de provocarlo.
- [x] **10.6** 🧪 Generador de contraseña temporal
  (`supabase/functions/platform-admin/password.ts`, función pura; vive junto a la
  función y no en `src/lib/` porque la contraseña se genera SIEMPRE en el servidor)
  con 6 tests (`temporary-password.spec.ts`): longitud, sin caracteres ambiguos,
  una de cada clase, sin sesgo de módulo, sin repeticiones. Validado con mutación.
- [x] **10.7** 🧪 `src/services/platform.ts` (empresas, métricas, estado, notas,
  bitácora, superadmins, y las dos llamadas a la Edge Function) y
  `useSessionStore.isPlatformAdmin` (un superadmin no necesita elegir negocio;
  se restaura al recargar; se borra al salir; si no se puede confirmar, el login
  falla en vez de asumir "no es admin"). `src/types/database.ts` regenerado
  (solo inserciones). El servicio convierte a tipos de dominio (`camelCase`, `null`
  donde corresponde: el generador marca todo como `string`) y traduce errores: los
  mensajes en español de las RPC pasan tal cual, el "permission denied" de Postgres
  se oculta, y un 404/503/504 del **gateway** ("función apagada") se distingue del
  404 de **la propia función** ("empresa sin dueño"). _Verificado:_
  `platform-service.spec.ts` (21 tests contra Supabase local, con sesiones reales),
  5 tests nuevos en `session.spec.ts`, y `agenda.spec.ts` ahora simula
  `@/services/platform` (sin eso el CI, que no tiene `.env.local`, fallaba al
  cargar). Helpers compartidos en `platform-test-helpers.ts`. Probado con
  mutaciones (store y servicio). Total: 324 tests de BD y 164 unitarios en verde.
  **Lección de aislamiento:** los tests que modificaban un negocio de la semilla
  lo dejaban modificado en la base local; ahora usan un negocio desechable
  (`createScratchTenant`).
- [x] **10.8** UI `/superadmin` (misma pantalla de login; decisiones tomadas con el
  usuario: detalle en **un diálogo con pestañas**, contraseña temporal en un
  **diálogo bloqueante con botón Copiar** que se ve una sola vez, lista con
  **búsqueda + filtro por estado**, y gestión de superadmins como **pestaña junto a
  Empresas**). `SuperadminLayout.vue`, `TenantsPage.vue`, `AdminsPage.vue`,
  `TenantFormDialog.vue`, `TenantDetailDialog.vue` (Datos / Métricas / Notas /
  Bitácora; las dos últimas cargan al abrirse), `TenantStatusDialog.vue` (motivo
  obligatorio), `AdminFormDialog.vue`, `TemporaryPasswordDialog.vue`. Router:
  `/superadmin` con `meta.requiresPlatformAdmin`; un superadmin sin negocio va a
  `/superadmin` desde el login y desde `/app/*`; quien no lo es, a su agenda. La
  lógica pura va en `src/lib/platform.ts` con 20 tests (etiquetas, filtro que ignora
  acentos y mayúsculas, y la traducción de la bitácora a frases; nunca copia el
  texto de una nota). Las validaciones de correo y teléfono ya existían en
  `lib/validation.ts`. **La búsqueda cubre empresa Y nombre del dueño** (decisión
  mía: "por nombre" era ambiguo). _Verificado:_ `vue-tsc`, `npm run lint`,
  `npm run build` y 184 tests unitarios en verde. **Pendiente para 10.10:** ver la
  pantalla en un navegador real (los componentes no llevan test, CLAUDE.md §9).
- [x] **10.9** Primer superadmin y semilla. `scripts/create-superadmin.mjs` (Node,
  no bash: hay llamadas HTTP y un rollback) + `npm run superadmin:create`: crea el
  usuario en Auth con contraseña temporal (el MISMO generador que la Edge Function)
  y su fila en `platform_admins`; rechaza un correo ya registrado; si el segundo
  paso falla borra el usuario recién creado. `--local` apunta al Supabase local; sin
  `--local` exige `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (sin prefijo `VITE_`,
  documentadas en `.env.example`), **una terminal interactiva** y escribir el host
  para confirmar. `seed.sql` (bloque nuevo al final, lo existente no se tocó):
  superadmin ficticio `superadmin@fullpetcare.mx` y un tercer negocio, "Mascotas y
  Mimos", con dueño, suspendido y con notas de ejemplo. `CLAUDE.md` §8.7 y §12
  actualizados. _Verificado:_ `create-superadmin-script.spec.ts` (8 tests que corren
  el script de verdad como proceso aparte, incluidos los casos donde DEBE negarse) y
  ajustes a 3 tests que asumían "cero superadmins". Probado con mutaciones. 332
  tests de BD en verde, dos corridas seguidas, y la base queda idéntica a la semilla.
  Límite conocido: el camino "falla el segundo paso y se borra el usuario" no tiene
  test (no hay forma honesta de provocar ese fallo).
- [x] **10.10** Verificación de punta a punta en navegador real (Playwright dirigido a
  mano, fuera del único E2E de CLAUDE.md §9 — flujo secundario, igual que 9.13), con
  Supabase local, Edge Functions servidas y la UI de esta rama en su propio puerto
  (el 5173 lo ocupaba el servidor del repo principal). **15/15 pasos:** superadmin
  entra y cae en `/superadmin/empresas` con las 3 empresas; búsqueda sin acentos y por
  dueño, filtro por estado; alta con validaciones y diálogo de contraseña (formato
  correcto, **no se cierra con Esc ni clic afuera**, el botón Copiar deja de verdad la
  contraseña en el portapapeles); detalle Datos / Métricas / Notas (persisten) /
  Bitácora (con actor, sin copiar el texto de la nota); el dueño nuevo entra con la
  temporal y ve su negocio; suspender exige motivo y el dueño **sigue pudiendo
  trabajar** (es solo etiqueta); restablecer contraseña: la nueva sirve, la vieja no, y
  **la sesión que el dueño tenía abierta deja de servir** al recargar; un dueño normal
  no entra a `/superadmin` ni por URL directa; F5 mantiene la sesión; alta y baja de
  superadmins y el mensaje de "único superadmin"; salir. **0 errores de consola**
  reales (solo los 4xx esperados). Las **capturas** encontraron 2 defectos que los
  pasos no podían ver y ya están corregidos: la bitácora cortaba las frases largas
  ("…pendiente (ej") y el diálogo cambiaba de altura al cambiar de pestaña; y en
  pantallas angostas la barra se amontonaba (ahora oculta chip y nombre). El panel no
  se diseñó para móvil (solo la vista pública lo es), pero no desborda la página.
  **`demo:reset` (opción B, decidida con el usuario):** un bloque nuevo en
  `demo_reset.sql` devuelve los 3 negocios de la semilla a su estado de plataforma
  (idempotente: sin cambios no escribe ni bitácora — comprobado corriéndolo dos veces)
  y oculta las empresas fuera de la semilla. **Riesgo documentado** en `CLAUDE.md` §10
  y en la confirmación de `demo-reset.sh`: con un cliente real ese paso lo ocultaría;
  además los correos de dueños creados en una demo siguen registrados (no toca
  `auth.users`), así que cada demo necesita otro correo.
- [x] **10.11** Cierre. `CLAUDE.md`: §1 (nota), §3 y §4 (tercera Edge Function, script,
  carpeta `superadmin`), §6 (excepciones a `tenant_id`) y **§6.8 nueva** (las tres
  tablas y las decisiones que no se ven en el esquema), **§7.5 nueva** (el superadmin:
  RLS sin escritura, RPC, los dos clientes de la Edge Function, contraseñas, sesiones),
  §8.6, §8.7, §10 (advertencia de `demo:reset`) y §12 (comandos). `PLAN.md`: Fase 10
  reescrita con lo realmente construido y `D14` con las dos correcciones de diseño y el
  riesgo conocido. _Verificado:_ `npm run lint`, `vue-tsc`, `npm run build`, **184 tests
  unitarios** y **332 tests de BD** (38 archivos) en verde, esta última corrida **dos
  veces seguidas** con la base idéntica a la semilla después. Cobertura unitaria:
  `lib/platform.ts` 96 %, `stores/session.ts` 96 %; `services/platform.ts` figura en 0 %
  en esa medición porque, como el resto de los servicios, se prueba contra la base real
  desde `test:db` (21 tests).

  **Qué se puede demostrar (Fase 10):** entrar como `superadmin@fullpetcare.mx` /
  `Demo1234!` y caer en `/superadmin`; ver las 3 empresas con plan, dueño, alta,
  vigencia ("Indefinida") y estado; buscar y filtrar; dar de alta una empresa con su
  sucursal y su dueño (contraseña temporal que se ve una sola vez); iniciar sesión como
  ese dueño; suspender con motivo, dar de baja y reactivar; anotar notas internas; ver
  métricas y bitácora; restablecer la contraseña del dueño (la vieja deja de servir y
  pierde sus sesiones); agregar y quitar superadmins (sin poder quitar al último). Un
  dueño normal no entra a `/superadmin`. **No se demuestra** (fuera de alcance): bloqueo
  real por suspensión o vencimiento, gestión de planes, cambio obligatorio de contraseña
  en el primer ingreso.

  **Pendientes que quedan abiertos (decisión del usuario, no se tocaron):**
  1. ~~`deploy-functions.yml` solo desplegaba `public-pet-view`~~ **Resuelto:** ahora
     también despliega `invite-employee` y `platform-admin` (mismo patrón, con
     `verify_jwt = true` de `config.toml`). **Verificado en la nube (2026-09-25):** al
     mergear el PR #50 a `main`, "Desplegar Edge Functions a producción" y "Desplegar
     migraciones a producción" terminaron en verde (11 migraciones aplicadas en prod).
  2. ~~CORS: ninguna de las dos funciones con sesión maneja el preflight~~ **Resuelto en
     código y verificado en la nube (2026-09-25):** `supabase/functions/_shared/cors.ts` contesta el
     `OPTIONS` (204) y añade `Access-Control-Allow-*` a toda respuesta de `invite-employee`
     y `platform-admin`; probado como función pura en `functions-cors.spec.ts` (por HTTP en
     local no sirve: Kong contesta antes). Ya en prod, un `OPTIONS` sin JWT a
     `platform-admin` y a `invite-employee` responde 204 con `Access-Control-Allow-Origin`,
     así que el preflight pasa con `verify_jwt = true` y el deploy sí empaquetó
     `../_shared/cors.ts`.
  3. ~~No se pudo comprobar el CI real desde aquí~~ **Resuelto:** el PR #50
     (`develop` → `main`) pasó "Lint y pruebas" y "E2E (Playwright)" en GitHub Actions, y el
     CI de `main` posterior también.

  **Comprobado en producción (2026-09-25):** el primer superadmin se creó con
  `npm run superadmin:create` contra `fullpetcare-prod` (con la llave `sb_secret_`; el
  script no necesitó ajustes), entró a `/superadmin`, y el alta de una empresa de prueba
  funcionó de punta a punta. Sin comprobar todavía en prod: `reset_password` de un dueño e
  `invite-employee`.
  4. ~~`demo:reset` oculta toda empresa fuera de la semilla~~ **Resuelto:** columna
     `tenant_platform_info.is_demo` (default `false`), casilla "Empresa de demostración" en
     el alta, y el reset solo oculta las marcadas (migración `20260925120000_tenant_is_demo.sql`,
     tests en `demo-reset.spec.ts` y `platform-rpcs.spec.ts`). Pendiente menor: la lista del
     panel no muestra qué empresas son demo.

**Cambio de contraseña propia (hallado al probar en prod, 2026-09-25):** hasta entonces
nadie —ni el superadmin, ni un dueño, ni un empleado— podía cambiar su propia contraseña;
solo existía el restablecimiento de la contraseña de un dueño por el superadmin. Ahora hay
un botón "Cambiar contraseña" en la barra de ambos marcos (`AppLayout` y
`SuperadminLayout`) que abre `ChangePasswordDialog.vue`, para todos los roles. Verifica la
contraseña actual (volviendo a iniciar sesión con ella), cambia la nueva y cierra las
demás sesiones de la cuenta. Reglas de forma en `lib/validation.ts#passwordChangeProblems`,
servicio en `services/auth.ts#changePassword`; tests en `validation.spec.ts` y
`supabase/tests/auth-service.spec.ts`, y comprobado en navegador contra el Supabase local.
Ese diálogo por sí solo no fuerza el cambio; el cambio obligatorio se agregó después
(tarea #1904, ver abajo).

**Cambio obligatorio de la contraseña temporal (tarea #1904, 2026-09-25):** dueños y
superadmins dados de alta (y dueños con contraseña restablecida) deben cambiarla en su
primer inicio de sesión. Migración `20260925130000_must_change_password.sql`
(`profiles.must_change_password`, triggers, bloqueo en `is_member_of()` & co.), pantalla
`/cambiar-contrasena` (`ForcePasswordChangePage.vue`, reutiliza `ChangePasswordDialog`),
guard del router y `session.completePasswordChange()`. Cuentas existentes no se tocan y
los empleados invitados quedan fuera. Diseño en `CLAUDE.md` §7.6. Tests:
`supabase/tests/must-change-password.spec.ts`, ajustes en `platform-admin-function.spec.ts`
y `create-superadmin-script.spec.ts`, y `session.spec.ts`. Pendiente: comprobar en
navegador y en producción (la migración es nueva en `main`).

**Trabajo futuro (fuera de esta fase):** gestión real de planes y vigencia, y bloqueo de acceso por
vencimiento o suspensión.
