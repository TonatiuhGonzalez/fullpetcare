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
- [x] **3.8** `services/services.ts` (catálogo): `listByKind`, `create`, `update`, `deactivate` — `listByKind` trae activos e inactivos (CatalogPage los necesita para reactivar); el paso de agendar filtra `is_active` por su cuenta
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
- [ ] **4.10** `services/records.ts`: `saveGroomingRecord`, `saveMedicalRecord`, `addVaccination`, `listVaccinationsByPet`, `addWeight`
- [ ] **4.11** 🧪 Tests de `services/records.ts` + que el registro quedó en `audit_log` con el actor correcto
- [ ] **4.12** `AttendPage.vue`: bifurca según `appointment.kind` y marca la cita `in_progress` al abrir
- [ ] **4.13** `GroomingRecordForm.vue`: estilo de corte, navaja, shampoo, comportamiento, notas
- [ ] **4.14** `MedicalRecordForm.vue`: motivo, exploración, diagnóstico, tratamiento, indicaciones, peso, temperatura, próxima visita
- [ ] **4.15** `VaccinationDialog.vue`: aplicar vacuna con lote y cálculo automático de próxima dosis
- [ ] **4.16** Al guardar la ficha, la cita pasa a `completed` y ofrece ir a cobrar
- [ ] **4.17** **Cierre de fase:** PR, CI verde, merge, atender ambos tipos de cita en producción

---

## Fase 5 — Cobrar

**Meta: el flujo completo agendar → atender → cobrar, con ticket.**

- [ ] **5.1** 📚 `lib/money.ts`: `splitTaxIncluded()`, `sumLineItems()`, `applyDiscount()`, `formatMXN()`, `parseMXNToCents()`. **Explicar por qué todo es entero, cómo se desglosa el IVA hacia atrás y por qué el impuesto se calcula por partida y no sobre el total**
- [ ] **5.2** 🧪 Tests de `lib/money.ts` (los más importantes del proyecto): desglose de $350 al 16 %; tres partidas donde la suma de IVA por partida difiere de calcularlo sobre el total; precio 0; carrito vacío; descuento mayor al total; redondeo de .5 centavos; que `net + tax === gross` siempre
- [ ] **5.3** Migración `0014_sales.sql`: `sales` (con `folio` por sucursal), enum `sale_item_type` con valor `service`, `sale_items`, RLS, auditoría
- [ ] **5.4** Migración `0015_payments.sql`: enum `payment_method` (cash, card, transfer_spei, openpay), `payments`, RLS, auditoría
- [ ] **5.5** Migración `0016_invoice_requests.sql`: `invoice_requests` con todos los campos CFDI y `fiscal_uuid` nullable
- [ ] **5.6** 📚 Migración `0017_checkout_rpc.sql`: `checkout_appointment(p_appointment_id, p_payments jsonb)` — revalida membresía, crea venta y partidas desde los snapshots de la cita, registra pagos, marca la cita cobrada, devuelve el `sale_id`. **Explicar qué es una transacción, qué garantiza el todo-o-nada, y por qué esta función revalida permisos aunque sea `SECURITY DEFINER`**
- [ ] **5.7** 🧪 Test del RPC: cobro exitoso deja venta + partidas + pagos consistentes
- [ ] **5.8** 🧪 Test del RPC: si el monto pagado no cubre el total, lanza error y **no queda nada escrito** (ni venta ni partidas)
- [ ] **5.9** 🧪 Test del RPC: un usuario de otro tenant no puede cobrar una cita ajena
- [ ] **5.10** 🧪 Test: los totales que calcula el RPC coinciden exactamente con los de `lib/money.ts`
- [ ] **5.11** `services/checkout.ts`: arma el resumen, llama al RPC, recupera el ticket
- [ ] **5.12** `useCartStore`: partidas, descuento, totales en vivo
- [ ] **5.13** 🧪 Tests de `useCartStore`: agregar y quitar partidas recalcula; el descuento nunca deja el total negativo
- [ ] **5.14** `CheckoutPage.vue`: resumen con desglose de subtotal, IVA y total; selección de método de pago simulado
- [ ] **5.15** `TicketView.vue`: ticket imprimible (CSS `@media print`), con folio, fecha en zona de la sucursal y desglose
- [ ] **5.16** Casilla "requiere factura" que crea el `invoice_request` con los datos fiscales del cliente. _Verificar:_ la fila se crea con status `pending`
- [ ] **5.17** **Cierre de fase:** PR, CI verde, merge, hacer un cobro completo en producción

---

## Fase 6 — Historial y red de seguridad

**Meta: la historia completa de una mascota, y un test que valida el demo antes de cada reunión.**

- [ ] **6.1** `services/petHistory.ts`: `getTimeline(petId)` que mezcla citas de ambos tipos, fichas, vacunas y pesos en una sola lista ordenada por fecha
- [ ] **6.2** 🧪 Tests de `getTimeline`: orden correcto mezclando tipos; dos eventos en el mismo instante; mascota sin historial; que no aparecen registros de otro tenant
- [ ] **6.3** `PetTimeline.vue`: línea de tiempo con ícono e insignia distinta por tipo de visita
- [ ] **6.4** `VaccinationCard.vue`: cartilla con estado por vacuna (vigente / por vencer / vencida)
- [ ] **6.5** `WeightChart.vue`: gráfica de peso en SVG simple, sin librería
- [ ] **6.6** `PetDetailPage.vue` final: foto, datos, alertas médicas, cartilla, peso, timeline, próximas citas
- [ ] **6.7** Sección "Próximas vacunas" en el dashboard, ordenada por urgencia
- [ ] **6.8** 📚 Instalar y configurar Playwright; `playwright.config.ts` apuntando a Supabase local. **Explicar qué es un test end-to-end, en qué se diferencia de un unitario y por qué solo va a haber uno**
- [ ] **6.9** 🧪 📚 **El test E2E**: login → agendar cita de estética → atender con notas → cobrar en efectivo → verificar el total en el ticket → verificar que aparece en el historial de la mascota. **Explicar cada paso y qué protege**
- [ ] **6.10** Agregar el E2E al workflow de CI (job aparte, corre después de los unitarios). _Verificar:_ pasa en GitHub Actions, no solo en la Mac
- [ ] **6.11** `supabase/seed/demo_reset.sql`: limpia las tablas de negocio de los tenants demo y repuebla, sin tocar `auth.users`
- [ ] **6.12** `scripts/demo-reset.sh` + script npm `demo:reset`, con confirmación interactiva antes de ejecutar. _Verificar:_ deja el demo idéntico dos veces seguidas
- [ ] **6.13** Semilla de demo enriquecida: historial de varios meses para 2–3 mascotas estrella, con visitas de ambos tipos, para que el timeline se vea lleno en la reunión
- [ ] **6.14** **Cierre de fase:** PR, CI verde, merge, correr `demo:reset` en producción y revisar que quedó limpio

---

## Fase 7 — Vista cliente pública

**Meta: abrir el link en el celular y ver la cartilla de la mascota.**

- [ ] **7.1** Migración `0018_share_links.sql`: `share_links` con `token_hash` (nunca el token), `token_prefix`, `expires_at`, `revoked_at`, `access_count`; RLS que solo deja al personal del tenant gestionarlos; auditoría
- [ ] **7.2** 📚 `services/shareLinks.ts`: genera 32 bytes con `crypto.getRandomValues`, guarda solo el SHA-256, devuelve el token en claro **una sola vez**. **Explicar por qué se guarda hasheado, por qué 32 bytes son inadivinables y por qué un UUID de mascota no sirve como link**
- [ ] **7.3** 🧪 Tests de `shareLinks.ts`: dos tokens nunca se repiten; en la base no queda el token en claro; revocar lo invalida
- [ ] **7.4** 📚 Edge Function `public-pet-view`: recibe token, hashea, busca link vigente, consulta con service role filtrando **siempre** por `tenant_id` y `pet_id` del link, devuelve un DTO de lista blanca. **Explicar qué es una Edge Function, por qué corre con service role y por qué eso es seguro solo si valida antes**
- [ ] **7.5** 🧪 Test: token válido devuelve exactamente esa mascota y nada más
- [ ] **7.6** 🧪 **Test de aislamiento del link**: un token del tenant A no puede devolver datos del tenant B, ni aunque se le pase un `pet_id` ajeno en el cuerpo
- [ ] **7.7** 🧪 Tests: token revocado, expirado, inexistente y malformado → **todos la misma respuesta genérica** (no revelar cuál de los casos fue)
- [ ] **7.8** 🧪 Test de forma de la respuesta: comparación exacta contra la lista blanca; falla si algún día alguien agrega un campo con datos internos
- [ ] **7.9** 🧪 Test: `anon` sigue sin poder leer ninguna tabla directamente (regresión de `1.23` ampliada a todas las tablas)
- [ ] **7.10** Registro de acceso: `access_count` y `last_accessed_at` se actualizan
- [ ] **7.11** `PublicLayout.vue`: layout móvil, sin navegación interna, con el nombre y logo del negocio
- [ ] **7.12** `PublicPetPage.vue` (`/c/:token`): foto, datos, cartilla, historial de visitas de ambos tipos, próximas citas
- [ ] **7.13** Estados de error del lado público: link inválido o vencido con un mensaje amable y sin detalles técnicos
- [ ] **7.14** Botón en `PetDetailPage.vue`: generar link, copiarlo al portapapeles, ver links activos, revocar
- [ ] **7.15** Verificación en móvil real: abrir el link en un teléfono, revisar tamaños de toque, legibilidad y peso de la foto
- [ ] **7.16** **Cierre de fase:** PR, CI verde, merge, mandarse el link por WhatsApp y abrirlo desde el celular

---

## Cierre de v1

- [ ] **8.1** Recorrer el flujo completo en producción con datos frescos, como si fuera la reunión
- [ ] **8.2** Revisar la cobertura de `lib/`, `services/` y `stores/`; llegar a 70–80 % donde falte
- [ ] **8.3** Revisión de seguridad: listar todas las tablas y confirmar que cada una tiene RLS activo y su test de aislamiento
- [ ] **8.4** Confirmar que ningún secreto quedó en el repo (`git log -p` buscando llaves)
- [ ] **8.5** README con guion de demo: qué enseñar, en qué orden, y qué decir en cada pantalla
- [ ] **8.6** Correr `demo:reset` y dejar el ambiente listo para la primera reunión
