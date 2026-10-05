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
- Plan de texto fijo "Básico", vigencia indefinida (`NULL`), sin tabla de planes.
  **Actualizado (tarea #1906):** catálogo real de planes (tabla `plans`, administrado
  por el superadmin) y forma de pago (`billing_period`: mensual/anual/indeterminado)
  que la vigencia calcula sola al asignarse — ya no se escribe una fecha a mano. El
  plan sigue siendo solo informativo: no limita nada por sí solo (el acceso lo sigue
  decidiendo el estado + la vigencia, #1905). Ver más abajo.
- Suspender o vencer la vigencia (pasada la gracia de 2 días) deja la empresa en **solo lectura**;
  darla de baja (o que el dueño cancele) le **niega todo el acceso** (tarea #1905, migraciones
  `20260925140000` a `20260925170000`, pruebas en `tenant-blocking.spec.ts`). Motivo público
  del catálogo (pestaña "Motivos") + comentarios internos; suspensión automática diaria con
  `pg_cron`; banner 3 días antes de vencer. "Pagar ahora" es un mock. Las empresas no tienen
  fecha de baja.
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

**Catálogo real de planes y forma de pago (tarea #1906, 2026-09-28):** hasta entonces
`tenant_platform_info.plan` era texto libre fijo en "Básico" y nadie podía cambiarlo
(no existía ni una RPC que escribiera esa columna) ni fijar `plan_expires_at`. Modelo
decidido con el usuario: catálogo administrado por el superadmin (tabla `plans`, mismo
patrón que `cancellation_reasons` de #1905 — pestaña "Planes"); al asignar un plan se
elige también su **forma de pago** (`billing_period`: `monthly`/`yearly`/`indefinite`)
y la base CALCULA la vigencia sola desde ese momento (mensual +1 mes, anual +1 año,
indeterminado sin vencimiento) — ya no se escribe una fecha a mano. En el mundo real la
forma de pago la elige el dueño al suscribirse (mensual o anual); indeterminado es de
uso interno del superadmin. Hoy no existe una pantalla de autoservicio para el dueño
(fuera de alcance), así que las tres las sigue asignando el superadmin desde
`/superadmin`, igual que ya asigna el plan y el estado. El plan sigue siendo SOLO
INFORMATIVO — sin cuotas de uso por plan, que queda fuera de esta tarea.
Migración `20260928120000_plans_catalog.sql`: `tenant_platform_info.plan_id` (FK) +
`plan_name_snapshot` (copia del nombre al asignar, igual que
`appointment_services.name_snapshot`, para que renombrar un plan no reescriba lo que
ya vio una empresa) + `billing_period` reemplazan la columna `plan`; RPCs
`platform_set_tenant_plan` (recibe la forma de pago, no una fecha), `platform_create_plan`
y `platform_update_plan`. Diálogo "Cambiar plan" en el detalle de la empresa
(`TenantPlanDialog.vue`) fija plan + forma de pago en una sola llamada; la vigencia ya
no se captura ahí. Diseño en `CLAUDE.md` §6.8. Tests: `platform-rls.spec.ts` (RLS del
catálogo, default `indefinite`), `platform-rpcs.spec.ts` (las 3 RPC nuevas, que mensual/anual
calculan la fecha contra `now()` de la propia transacción, snapshot al renombrar),
`platform-service.spec.ts` y `platform.spec.ts` (`billingPeriodLabel`, bitácora).
Se actualizó `supabase/seed/demo_reset.sql` (usaba la columna `plan` eliminada).
Comprobado en navegador contra Supabase local: asignar un plan mensual a una empresa y
ver la vigencia calculada (hoy + 1 mes) reflejada en el detalle y en la lista.

**Vista de configuración (tarea #1959, 2026-09-28):** el engrane de la barra (`/app/configuracion`)
reemplaza los botones "Cambiar contraseña" y "Cancelar mi cuenta", que se movieron tal cual a la
sección "Cuenta" (`AccountSettingsPage.vue`, todos los roles; cancelar solo el dueño). La otra
sección, "Empresa y sucursales" (`BranchesSettingsPage.vue`, solo el dueño), muestra los datos de
la empresa en solo lectura y permite añadir, editar (todos los datos y el horario),
deshabilitar y volver a habilitar sucursales. Migración `20260928150000_branch_settings.sql`:
columna `branches.is_active`, políticas INSERT/UPDATE solo para `owner`, auditoría, y el trigger
`prevent_disabling_branch_in_use` que **bloquea deshabilitar** una sucursal con citas pendientes a
futuro, con empleados asignados o que sea la última activa (vive en la base, no en la pantalla).
Una sucursal deshabilitada desaparece del selector de la barra, de la agenda y de la asignación de
empleados, pero conserva su historial. Lógica pura del formulario en `lib/branchSettings.ts`.
Tests: `supabase/tests/branches-settings-rls.spec.ts` (quién escribe y los cuatro bloqueos, más
los bordes de citas pasadas/canceladas), `memberships-service.spec.ts` (una deshabilitada no se
ofrece) y `lib/branchSettings.spec.ts`. Decisiones tomadas sin preguntar por ser de detalle: las
zonas horarias ofrecidas son las cuatro de CLAUDE.md §8.3 (Ciudad de México, Cancún, Hermosillo,
Tijuana); solo el nombre es obligatorio (dirección, CP y teléfono son opcionales pero se validan
si se capturan); una sucursal debe abrir al menos un día. Pendiente: comprobar la pantalla en
navegador; fuera de esta tarea, dar de baja la suscripción o eliminar la cuenta por completo.

**Visitas sin cita (tarea #1969, 2026-09-29):** botón "Llegada sin cita" en la agenda (solo
dueño/recepción) que abre `WalkInDialog.vue`: alta rápida de cliente (nombre, apellido y teléfono
de 10 dígitos, siempre obligatorios) y mascota (nombre y especie), o elegir una ya registrada;
tipo, servicios, urgente (sí/no) y notas. No se elige horario: la visita empieza ahora, y la lista
de empleados muestra quién está libre ya o cuánto espera (`lib/walkIn.ts`, función pura). Si se
elige a alguien ocupado, la cita queda `scheduled` para cuando se libere. Migración
`20260929120000_walk_in_appointments.sql`: columnas `appointments.is_walk_in` e `is_urgent` (default
`false`, citas existentes intactas) y la función `create_walk_in_appointment`, que **llama** a
`create_appointment` (mismas validaciones y snapshots) y luego marca la cita y decide el estado
(`in_progress` si empieza en ≤ 2 min, medido con el reloj de la base). En la agenda, el bloque lleva
la marca "🚶 Sin cita" o "🚨 Urgente". Tests: `lib/walkIn.spec.ts`, `branchToday` en
`lib/datetime.spec.ts` y `supabase/tests/walk-in-service.spec.ts` (estado inicial, urgente,
traslape, inicio en el pasado, groomer rechazado, `anon` rechazado). Decisiones de detalle tomadas
sin preguntar: el apellido también es obligatorio porque `customers.last_name` es `not null`; el
alta de cliente y mascota no es atómica con la cita (si la cita falla, el cliente queda y el
reintento lo reutiliza); no se restringe al horario de apertura (una emergencia puede llegar fuera
de horario); un cliente ya registrado sin teléfono no se obliga a completarlo. Pendiente: probar la
pantalla en navegador; fuera de esta tarea, fila de espera con turnos y aviso por mensaje.

**Trabajo futuro (fuera de esta fase):** cuotas de uso por plan (sucursales, empleados…).

---

## Fase 11 — Inventario, venta de productos y facturación (CFDI)

**Meta: poder vender productos (alimento, accesorios, medicamento de mostrador) con control
de existencias por sucursal, y poder facturar una venta (CFDI 4.0) a través de un PAC.**
Es la primera fase de la **etapa de mejoras** (`CLAUDE.md` §1): no es v2, es enriquecer lo
que ya existe. Prioridad alta. Orden recomendado: inventario primero (no depende de
terceros y evita rehacer los conceptos de la factura), CFDI después.

**Estado: planeada, sin construir.** Las decisiones se resolvieron con el usuario el
2026-10-01 (tabla de abajo). Seguimiento en
HMH Four: tareas #2036 a #2048.

### Decisiones (2026-10-01)

| #   | Decisión                                         | Resolución                                                                                                                                                                                                                                  |
| --- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Qué PAC** (proveedor de timbrado)              | **Facturapi.** Multi-emisor incluido, sandbox y prueba de 14 días. Precios consultados el 2026-10-01 en su página: $299 MXN/mes por la API + $0.60 por timbre, IVA incluido, sin paquetes prepagados (verificar antes de contratar). **Los timbres los absorbe la plataforma dentro del plan**, con un tope razonable de facturas por negocio (el tope se define al armar los planes). |
| 2   | Stock bajo y en cero                             | Aviso cuando queda poco (`<= min_stock`) y leyenda **"Sin inventario"** en 0. **Con existencia 0 no se puede vender**: no se agrega al ticket ni se toma en cuenta. Se valida **en la base**, no solo en la pantalla.                         |
| 3   | Factura global al público en general             | **Sí entra** en la fase (tarea 11.20), aislada al final para poder soltar la factura individual antes.                                                                                                                                      |
| 4   | Consumo de insumos desde la consulta             | **Sí entra** (tareas 11.12 a 11.14): el veterinario registra lo usado al atender; cada línea se cobra al cliente o es de uso interno; la existencia baja al registrarlo.                                                                    |
| 5   | Forma de pago (crédito/débito y demás)           | **Selección manual al cobrar con tarjeta** (crédito `04` o débito `28`). El dato queda guardado con el pago (`payments.payment_form_code`; efectivo `01` y transferencia `03` se derivan solos), la factura lo precarga y se puede cambiar al facturar. Razón: al cobrar se sabe cómo pagó el cliente; días después, no, y corregir una factura timbrada cuesta cancelar y reemplazar. |
| 6   | Cantidades fraccionarias                         | **No**: solo enteros (§8.2). Lo suelto se maneja como presentación.                                                                                                                                                                         |

### Diseño acordado (resumen; el detalle y las alternativas descartadas irán en `PLAN.md` D15 y D16)

- **Productos:** tabla `products` por tenant (nombre, SKU, precio con IVA incluido, `tax_rate_bp`,
  `cost_cents` opcional, `min_stock`, `is_active`, y las claves SAT). El **precio con IVA incluido y
  el desglose por partida** son los de siempre (§8.2); no cambia la matemática del cobro.
- **Existencias = suma de movimientos, no una columna.** Tabla `stock_movements` (por sucursal y
  producto; tipo: `purchase` | `sale` | `sale_reversal` | `consumption` | `consumption_reversal` | `adjustment` | `loss`; cantidad con signo;
  referencia a la venta si aplica). Es una **bitácora inmutable** (sin UPDATE ni DELETE, ni siquiera
  para el dueño): corregir un error es otro movimiento. Así el stock nunca se desfasa de su
  historia. Una vista/RPC calcula la existencia actual.
- **Cobro:** `sale_items.item_type` gana el valor `product` y una columna `product_id` nullable
  (migración aditiva, §6.5), con un `check` que exige exactamente uno de `service_id` / `product_id`.
  Al **pagar** se generan los movimientos de venta; al **cancelar** una venta pagada, los movimientos
  inversos. Todo dentro de la RPC de cobro (`SECURITY DEFINER`, revalida membresía, §7.3).
- **Consumo en la atención:** tabla `appointment_products` (como `appointment_services`, con snapshot
  de nombre, precio e IVA) y un interruptor `is_billable`. El movimiento de stock (`consumption`) se
  genera **al registrar** la línea y se revierte (`consumption_reversal`) si el veterinario la quita;
  cancelar el cobro **no** devuelve stock (el medicamento ya se aplicó). Las líneas cobrables pasan al
  ticket **sin crear un segundo movimiento**. Una vacuna se liga a su producto; el **lote sigue siendo
  texto capturado a mano** (lotes y caducidades siguen fuera de alcance, §1).
- **Permisos:** nuevo valor `inventory` en el enum `permission_module` (la migración de
  `role_permissions` ya lo anticipa) y `invoicing` para facturación. Dueño todo; recepción
  ver/editar; groomer sin acceso; vet ver. Se ajusta con filas, no con migraciones (D13).
- **Facturación:** se reutiliza `invoice_requests` (ya existe, con RLS y bitácora) y se le agregan
  estado, UUID fiscal, rutas de XML/PDF, cancelación y mensaje de error. **Nunca se borra** una
  factura: se cancela (es un documento fiscal, igual que el expediente, §8.5).
- **Edge Function `invoicing`** (la cuarta): timbra, cancela y descarga. Es la única que habla con
  el PAC; la llave del PAC vive solo como secreto de la función, nunca en el frontend. Revalida
  permiso con el JWT de quien llama **antes** de tocar nada (mismo patrón que `platform-admin`).
- **Certificado de sello digital (CSD) del negocio:** el dueño sube su `.cer`, `.key` y contraseña.
  Pasan **directo al PAC** desde la Edge Function y **no se guardan** en nuestra base ni en Storage.
  Solo guardamos el identificador de la organización en el PAC y si el CSD está vigente.
- **Lo difícil se prueba en puro:** armar el comprobante (conceptos, impuestos, forma de pago,
  RFC genérico, uso de CFDI) vive en `lib/cfdi.ts`: entra una venta, sale el cuerpo de la factura.
  El PAC queda detrás de un adaptador delgado; no hay mocks elaborados (§9).
- **Ambientes:** local y staging usan el **sandbox** del PAC; solo producción timbra de verdad. Si
  alguien apunta a producción por error, el CI y `.env.example` lo hacen difícil (llaves distintas).

### 11A. Preparación

- [ ] **11.1** 📚 Registrar las decisiones de arriba en `PLAN.md`
  (D15 inventario, D16 facturación y PAC). Confirmar con el contador del negocio demo: claves SAT por
  defecto de los servicios (estética y veterinaria), tratamiento de IVA tasa 0 vs. exento en productos y
  plazos del SAT para facturar. **Avance 2026-10-01:** las seis decisiones están cerradas. Sin contador: los códigos del SAT por servicio y producto son **editables por cada negocio** (el sistema propone un valor por defecto, que el negocio puede cambiar con su propio contador) y el sistema no impone plazos fiscales de la factura global, solo avisa. Pendiente: dar de alta Facturapi (#2036) y, antes de producción, una consulta puntual con un contador. _Verificar:_ `PLAN.md` tiene D15 y D16 sin "pendiente"; el usuario aprobó
  por escrito la lista de dependencias nuevas (si el PAC trae SDK; si no, es `fetch` y no hay dependencia).
- [x] **11.2** 📚🧪 Claves SAT en `services`: `sat_product_code` y `sat_unit_code` (migración aditiva,
  `E48` unidad de servicio por defecto en la unidad; el código de producto, el que confirme el
  contador). Campos en el formulario de servicio, validación en `lib/validation.ts` (8 dígitos
  / 2 o 3 caracteres: el catálogo del SAT tiene unidades de 2, como `EA`). Los servicios existentes se rellenan con el valor por defecto en la misma
  migración. **Hecho 2026-10-01 (#2037):** columnas `not null` con `default` (`70122000` "Salud animal", `E48`)
  y `check` de formato en la base. **Pendiente antes de producción:** un contador debe revisar la clave de
  producto por defecto, sobre todo para estética (no se encontró una clave específica en el catálogo; se usó la de salud animal). _Verificar:_ test de validación en `lib/`; `db:reset` limpio; un servicio sin clave no
  se puede guardar de nuevo.

### 11B. Productos e inventario

- [x] **11.3** 📚 Migración `products`: tabla con las columnas de §6 (`tenant_id`, `deleted_at`,
  trigger de `updated_at`, índice que empieza por `tenant_id`), RLS activa y forzada en la misma
  migración, política de lectura para miembros, escritura para quien tenga `inventory`/`edit`
  (`app.has_permission`). Se agrega `inventory` a `permission_module` y sus filas en
  `role_permissions` (explicar el cuidado de `alter type ... add value` dentro de una transacción).
  _Verificar:_ `db:reset` limpio. **Hecho 2026-10-02 (#2038):** dos migraciones (`inventory_permission_module`, que solo agrega el valor al enum, y `products`, que lo usa: Postgres no deja usar un valor de enum en la misma transacción donde se agregó). Lectura con `inventory`/`view`, escritura con `inventory`/`edit`; filas por defecto (dueño y recepción ver+editar, vet solo ver, groomer nada) para los negocios existentes y en `seed.sql`. Claves SAT por defecto `01010101` (genérica del SAT) y `H87` (pieza), pendientes de revisión por un contador. **Los negocios que se den de alta después de la migración no reciben filas de `inventory` solos** (igual que `employees` hoy): solo el dueño tendría acceso hasta sembrarlas; decidir si un trigger sobre `tenants` las crea.
- [x] **11.4** 🧪 Tests de aislamiento de `products`: otro tenant no los ve ni los edita; groomer sin
  permiso no escribe; borrado suave funciona (cuidado con la trampa de §7.2: SELECT sin filtrar
  `deleted_at` si hay UPDATE para un rol normal); no hay política de DELETE. _Verificar:_ verde, y
  se rompe a propósito una política para ver que el test falla (mutación, como en 10.4). **Hecho:** `products-rls.spec.ts` (25 tests); con `products_select using (true)` fallan 3.
- [x] **11.5** 📚 Migración `stock_movements`: bitácora inmutable (sin UPDATE/DELETE, trigger
  `prevent_hard_delete()` + trigger que rechaza UPDATE), `branch_id` + `product_id`, tipo enum,
  cantidad entera con signo (`check <> 0`), referencia opcional a `sale_id`. Vista `product_stock`
  (`security_invoker`, explicar por qué: que RLS del que consulta aplique, no la del dueño de la
  vista). Con `app.log_change()` y `enforce_tenant_writable`. _Verificar:_ `db:reset` limpio. **Hecho 2026-10-02 (#2039):** migración `stock_movements` (sin `updated_at`/`deleted_at`: es inmutable). Además de lo pedido: `check` de signo según el tipo, motivo obligatorio en `adjustment`/`loss`, trigger que impide dejar la existencia en negativo (con candado por producto y sucursal para dos ventas simultáneas), e INSERT directo solo de `purchase`/`adjustment`/`loss` (venta y consumo los generarán las RPC de 11.10 y 11.12). La vista `product_stock` trae una fila por producto activo y sucursal activa, con 0 si no hay movimientos.
- [x] **11.6** 🧪 Tests de `stock_movements`: aislamiento por tenant y por sucursal; no se puede
  actualizar ni borrar un movimiento (ni el dueño, ni `service_role`); la existencia es la suma
  correcta con compras, ventas, ajustes y mermas mezclados; **un producto sin movimientos tiene
  existencia 0, no `NULL`** (si no, la pantalla muestra "NaN"). _Verificar:_ verde. **Hecho:** `stock-movements-rls.spec.ts` (25 tests); al abrir la política de lectura y quitar los triggers de inmutabilidad y de no-negativo fallan 6.
- [x] **11.7** 📚🧪 `lib/inventory.ts` (puro): existencia a partir de movimientos, alerta de stock
  bajo (`<= min_stock`), validación de cantidades enteras y positivas, regla de stock (no se vende ni se consume
  sin existencia). Tests de bordes: existencia exactamente igual al mínimo, `min_stock = 0`, venta que
  deja justo en 0, cantidad 0 o negativa en una compra. _Verificar:_ verde. **Hecho:** `lib/inventory.ts` (16 tests).
- [x] **11.8** 📚 `services/products.ts` y `services/inventory.ts` (lista, alta, edición, desactivar;
  registrar compra, ajuste y merma con motivo obligatorio en los dos últimos) + `useInventoryStore`.
  _Verificar:_ tests de servicio/store; la capa de §4 se respeta (ningún componente toca `supabase.ts`). **Hecho:** `services/products.ts`, `services/inventory.ts` y `stores/inventory.ts` (con `inventory.spec.ts`, 8 tests con mocks). No hay test de servicio contra Supabase real: un movimiento no se puede borrar, así que dejaría basura permanente en la base local; la lógica de la base ya la cubre `stock-movements-rls.spec.ts`.
- [x] **11.9** Pantalla de **Inventario** (menú lateral, bajo el permiso `inventory`): lista con
  existencia y alerta de stock bajo por sucursal, alta/edición de producto, diálogo de entrada de
  compra y de ajuste. Móvil usable. _Verificar:_ en navegador, con el dueño y con un groomer que no
  la ve ni entra por URL directa. **Hecho 2026-10-02 (#2040):** ruta `/app/inventario` (`requiresPermission: 'inventory'`) y entrada de menú gateadas por `canView('inventory')`; botones de alta, edición, compra, ajuste y activar/desactivar solo con `canEdit('inventory')`. Verificado con Playwright a 390 px: el dueño ve la lista, registra una compra y un ajuste que excede la existencia muestra "No hay existencia suficiente"; el groomer no ve el menú y la URL directa lo manda a la agenda. Se agregó `validateProduct` (lib) y `saveProduct`/`setProductActive` (store) con sus tests. El IVA no se captura en el formulario: el alta usa 16 % (decisión pendiente si hace falta tasa 0). Las mermas existen en el store pero la pantalla solo ofrece compra y ajuste (lo que pide la tarea).

### 11C. Vender productos en el cobro

- [x] **11.10** 📚🧪 Migración de `sale_items` (`item_type = 'product'`, `product_id` nullable,
  `check` de exactamente uno) y RPC de cobro extendida: calcula IVA por partida con la misma función
  de §8.2, crea los movimientos de venta al pagar y los inversos al cancelar. **Todo o nada.** Tests:
  venta mixta servicio + producto cuadra al centavo; cancelar devuelve la existencia exacta; un producto con existencia 0 se rechaza
  (en la base, no solo en la pantalla) y una cantidad mayor a la existencia también; producto de otro tenant o sucursal rechazado; dos cobros
  simultáneos del mismo producto no pierden un movimiento. _Verificar:_ verde; los tests de cobro de
  la fase 5 siguen verdes **sin modificarlos** (prueba de que la migración fue aditiva). **Hecho 2026-10-03 (#2041):** migraciones `sale_item_product_type` y `sale_products_checkout`. `checkout_appointment()` gana `p_products` (default `[]`: quien la llama como antes obtiene lo mismo); lo común a cita y mostrador vive en dos auxiliares internos (`app.add_product_items`, `app.finalize_sale`). Nueva RPC `checkout_counter_sale()` (venta sin cita; **pide un cliente registrado**, el "público en general" llega con 11.20). La existencia que baja al pagar es un movimiento `sale`; al cancelar una venta pagada la devuelve un **trigger** sobre `sales` (no una RPC: así un UPDATE directo tampoco puede saltarse la devolución) con un `sale_reversal` por el neto exacto, idempotente. Tests en `checkout-products-rpc.spec.ts`. La prueba de dos cobros simultáneos del mismo producto no se repitió aquí: el candado vive en el trigger de `stock_movements` (11.5/11.6).
- [x] **11.11** Carrito y cobro con productos: agregar producto al resumen de cobro, cantidad, aviso de
  stock; el ticket los desglosa. `lib/money.ts` no cambia (es la prueba de que el diseño aguantó). **Al cobrar con tarjeta se elige
  crédito o débito** (decisión #5): columna nueva `payment_form_code` en `payments`, obligatoria cuando
  `method = 'card'`; test de que no se puede registrar un pago con tarjeta sin ella.
  _Verificar:_ el E2E existente (agendar → atender → cobrar) sigue verde, y una venta de solo mostrador
  (sin cita) se cobra y descuenta stock. **Hecho 2026-10-03 (#2041):** `payments.payment_form_code` (check `NOT VALID`: los pagos con tarjeta anteriores no se inventan un valor; los nuevos lo exigen en la RPC y en la tabla; efectivo `01` y transferencia `03` se derivan solos) y la factura precarga ese código. Pantalla: `CheckoutPage` cobra cita + productos y, sin `id`, la venta de mostrador (`/app/venta-mostrador`, menú "Venta de mostrador", solo recepción/dueño). **Único cambio a un test existente:** el de `checkout-rpc.spec.ts` que pagaba con tarjeta sin tipo ahora manda `payment_form_code` (es justo lo que la regla nueva prohíbe). **Pendiente de verificar:** el E2E (Playwright) y la pantalla en navegador no se corrieron en esta sesión.

### 11C-bis. Insumos usados en la atención veterinaria

- [x] **11.12** 📚🧪 Migración `appointment_products` (snapshot de nombre, precio e IVA; `is_billable`;
  RLS que solo deja escribir a `owner` y `vet`, lectura según el rol que ya ve la cita) y RPCs para
  agregar y quitar una línea: revalidan membresía y rol (§7.3.4), rechazan existencia 0, y generan o
  revierten el movimiento de consumo en la misma transacción. Tests: groomer y recepción no escriben;
  otro tenant no ve nada; quitar una línea devuelve la existencia exacta; producto sin existencia se
  rechaza; cita ya cobrada no admite cambios. _Verificar:_ verde. **Hecho 2026-10-03 (#2042, parte de base de datos; la pantalla es 11.13):** migración `appointment_products` con RPC `add_appointment_product` / `remove_appointment_product`. **Se escribe solo por RPC**, sin política de INSERT/UPDATE para usuarios (más estricto que "RLS que deja escribir a owner y vet"): una línea sin su movimiento de stock descuadraría el inventario; solo dueño y vet pasan la RPC. Solo citas veterinarias y no canceladas. Quitar la línea la oculta (`deleted_at`) y devuelve el neto exacto con `consumption_reversal`. `stock_movements` gana `appointment_product_id` (nullable). Lectura: sigue a la cita (por sucursal). Tests en `appointment-products-rpc.spec.ts`.
- [x] **11.13** Apartado **"Productos y medicamentos usados"** en la pantalla de atención veterinaria:
  agregar producto y cantidad, interruptor "Cobrar al cliente", quitar línea. La vacuna se liga a su
  producto (columna nueva y opcional en `vaccinations`): descuenta una pieza; el lote se sigue
  capturando a mano. _Verificar:_ en navegador, con un vet; el groomer no ve el apartado. **Hecho 2026-10-03 (#2042):** `AppointmentProductsPanel` en la atención veterinaria (solo dueño y vet, `canRegisterSupplies`); `services/appointmentProducts.ts`. La vacuna se liga a la **línea de insumo** (`vaccinations.appointment_product_id`, no al producto suelto: la línea ya es el vínculo con el movimiento de stock), con un trigger que exige que sea de la misma cita y negocio. Orden al aplicar: primero la pieza, luego la vacuna (la vacunación es expediente y no se borra; la línea sí se puede quitar, y si la vacuna falla se quita para devolver la existencia). Una pieza ligada a una vacuna ya registrada no se puede quitar. Verificado en navegador con el vet de la semilla (agregar, quitar, vacuna con pieza, existencias correctas) con un script temporal que no se subió.
- [x] **11.14** 📚🧪 Las líneas cobrables pasan al cobro: la RPC de cobro las convierte en `sale_items`
  **sin** crear otro movimiento de stock; garantía en la base de que una línea se cobra una sola vez.
  Tests: ticket con servicios, productos de mostrador y productos de consulta cuadra al centavo; las
  líneas de uso interno no aparecen; cancelar la venta no devuelve el consumo. _Verificar:_ verde; el E2E
  sigue verde. **Hecho 2026-10-03 (#2043):** migración `checkout_billable_supplies`: `sale_items.appointment_product_id` y `checkout_appointment()` (mismo cuerpo, un paso más) que copia los insumos cobrables con su snapshot de precio e IVA, **sin** movimiento de stock. Que cancelar no devuelva el consumo sale solo del diseño: la devolución revierte los movimientos `sale` de la venta y el consumo se ligó a la línea, no a la venta. «Se cobra una sola vez» = trigger (no índice único, porque tras cancelar la venta la cita se puede volver a cobrar) con candado por línea; también exige que la línea sea de la misma cita. La pantalla de cobro suma y lista los insumos (`supplyItems`), si no, el total en pantalla quedaría corto frente al de la base. Verificado en navegador (insumo cobrable aparece, el de uso interno no, cobro exitoso).

### 11D. Facturación (CFDI 4.0)

- [ ] **11.15** 📚 Configuración fiscal del negocio (solo dueño): pantalla que valida RFC, razón
  social, régimen y código postal de `tenants` (ya existen, §8.4) y sube el CSD al PAC mediante la Edge
  Function. Migración con lo mínimo (id de organización en el PAC, serie, CSD vigente hasta).
  Explicar qué es un CSD, un PAC y por qué el certificado no se guarda. _Verificar:_ en sandbox, un
  negocio de prueba queda "listo para facturar"; con datos fiscales incompletos, la pantalla dice cuál
  falta, en español y sin jerga. **Hecho 2026-10-04 (#2044), pendiente de verificar en sandbox:** migración
  `tenant_invoicing_settings` (id de la organización en el PAC y vigencia del certificado; solo el dueño la lee y
  **nadie la escribe desde el navegador**, solo la Edge Function). Los datos fiscales se escriben con la RPC
  `update_tenant_fiscal_data` (solo dueño, valida RFC/régimen/CP; una política de UPDATE en `tenants` dejaría
  tocar también otras columnas). Cambiar el RFC borra la vigencia del certificado (un CSD es de un solo RFC).
  `can_manage_invoicing()` = dueño + negocio no en solo lectura: la usa la función, que escribe con `service_role`
  y se saltaría ese bloqueo. Edge Function `invoicing`, acción `setup` (la `stamp`/`cancel`/`download` llegan en
  11.18): crea la organización en Facturapi, le manda los datos fiscales y el certificado, y guarda solo la
  vigencia. **"Listo para facturar" se calcula** (`lib/fiscalSetup.ts`), no se guarda: un booleano se
  desactualizaría al vencer el certificado. Pantalla en Configuración → Facturación. Tests: `fiscalSetup.spec.ts`,
  `invoicing-settings-rls.spec.ts`, `invoicing-function.spec.ts` (solo guardias previos al PAC).
  **Pendiente:** (1) contratar Facturapi y poner `FACTURAPI_USER_KEY` (`supabase secrets set`); (2) confirmar en el
  sandbox los endpoints (`/organizations`, `/legal`, `/certificate`) y el campo con la vigencia
  (`certificate.expires_at`), que se escribieron de memoria de su documentación; (3) probar en navegador el
  flujo completo y que un certificado equivocado muestre el mensaje.
- [x] **11.16** 📚🧪 `lib/cfdi.ts` (puro): de venta + cliente + pagos a cuerpo de comprobante. Cubre
  desglose de IVA hacia atrás por concepto, **la suma de los conceptos debe dar exactamente el total
  de la venta** (el riesgo del redondeo, abajo), forma de pago desde `payments.payment_form_code` (con pagos mezclados, la de mayor monto; a confirmar con un contador),
  tasa 0 vs. exento, uso de CFDI por defecto, y rechazo de datos del cliente incompletos. Tests de
  bordes: precio 0, cantidad > 1 con centavos que no dividen exacto, un solo concepto de $1, venta con
  descuento, pago mixto efectivo + tarjeta. _Verificar:_ verde; cobertura de `lib/` ≥ 80 %.
  **Hecho 2026-10-04 (#2045):** `lib/cfdi.ts` (97 % de cobertura). El **descuento de la venta se reparte entre los
  conceptos** por el método del mayor residuo y el IVA se recalcula sobre lo que de verdad pagó el cliente por cada
  uno; el total del comprobante es exactamente `sales.total_cents` (se prueba con 300 ventas generadas). Ojo: la
  RPC de cobro **no ajusta `sales.tax_cents` por el descuento**, por eso la factura no usa esos totales sino que
  recalcula desde las partidas. Tasa 0 se factura como tasa 0 %, no como exento (**a confirmar con un contador**,
  igual que la forma de pago de pagos mixtos, que aquí es la del pago de mayor monto: el `invoiceRequests.create`
  del cobro sigue guardando `06` en ese caso y la factura la corrige al emitir). La Edge Function usa una copia
  (`functions/_shared/cfdi.ts`, las funciones solo importan de su carpeta) y `cfdi-parity.spec.ts` exige que ambas den
  lo mismo.
- [x] **11.17** 📚🧪 Migración de `invoice_requests` (estado, `fiscal_uuid`, rutas de XML y PDF,
  fecha de timbrado, cancelación y motivo SAT, `error_message`) + bucket privado `invoices` con la
  convención `{tenant_id}/{invoice_request_id}.{ext}` + `invoicing` en `permission_module`. RLS y tests:
  otro tenant no ve facturas ni sus archivos; una factura timbrada no se puede editar ni borrar (solo
  cambia de estado vía la Edge Function). _Verificar:_ verde.
  **Hecho 2026-10-04 (#2045):** migraciones `invoicing_permission_module` y `invoice_requests_stamping`. Estados
  `pending` → `stamping` → `stamped` → `cancelled`; el candado de "una sola factura viva por venta" es un índice
  único parcial (`stamping` y `stamped` cuentan; una cancelada libera la venta). **La política de INSERT original
  dejaba crear una solicitud con cualquier estado**: se endureció para que los usuarios solo creen `pending` limpias
  (si no, se fabricaba una "timbrada" falsa). Un trigger impide editar los datos de una timbrada (solo cancelar) y
  tocar una cancelada, incluso con `service_role`; el borrado físico se bloquea salvo en `pending` (no es aún un
  documento fiscal, y las pruebas existentes la limpian así). `can_invoice()` para la Edge Function. Bucket privado
  `invoices` con solo lectura para quien tenga `invoicing`/ver. Permisos por defecto: dueño y recepción, el resto
  nada (también en `seed.sql`). Tests: `invoice-stamping-rls.spec.ts`.
- [ ] **11.18** 📚🧪 Edge Function `invoicing` (acciones `stamp`, `cancel`, `download`): revalida
  permiso y membresía con el JWT **antes** de usar el PAC; un solo timbrado por venta (idempotente: si
  se reintenta tras una falla de red, no timbra dos veces); guarda XML y PDF; en error del PAC guarda el
  mensaje y deja la solicitud reintentable. Tests de la función (necesitan `supabase functions serve`,
  como los de `platform-admin`): sin sesión, otro tenant, venta no pagada, venta ya facturada, PAC
  caído. _Verificar:_ timbrado exitoso en sandbox con XML descargable; cancelación con motivo.
  **Avance 2026-10-04 (#2045), código hecho y pendiente de sandbox (queda sin marcar):** acciones `stamp`, `cancel` y
  `download` (esta última re-guarda los archivos si no se alcanzaron a guardar; abrirlos lo hace la pantalla con ligas
  firmadas del bucket). Todo lo específico de Facturapi vive en `functions/_shared/facturapi.ts`. La función
  **recalcula los importes ella misma** y exige que sumen el total del ticket; la solicitud pasa a `stamping` con una
  toma atómica y, si el PAC falla, vuelve a `pending` con su mensaje. Solo se ofrecen los motivos de cancelación 02 y
  03 (el 01 pide la factura sustituta y el 04 es de la global). Tests (`invoicing-function.spec.ts`): sin sesión,
  sin permiso, otro negocio, venta inexistente, no pagada, sin certificado, y motivos inválidos. **Pendiente /
  decisiones abiertas:** (1) verificar en sandbox; (2) **timbrar en producción** necesita la llave *live* de cada
  organización, que el PAC solo muestra al crearla: hay que decidir dónde guardarla (hoy `FACTURAPI_MODE=live`
  responde "no habilitado"; en `test` se pide la llave de pruebas de la organización); (3) si la función se cae
  después de timbrar y antes de anotarlo, la solicitud queda en `stamping` (el UUID va al log para recuperarla a
  mano); no hay recuperación automática; (4) las rutas de la API de organizaciones (`PUT /organizations/{id}` y
  `/csd`) salieron de la documentación pública y las fuentes consultadas no coincidían del todo.
- [ ] **11.19** Interfaz de facturación: botón "Facturar" en el detalle de la venta, formulario con los
  datos fiscales del cliente (precargados de `customers`), estado de la factura, descarga de PDF/XML y
  cancelación con motivo. El link/archivo se comparte a mano (WhatsApp sigue fuera de alcance).
  _Verificar:_ en navegador, flujo completo en sandbox: cobrar → facturar → descargar → cancelar.
  **Avance 2026-10-04 (#2045), pantalla hecha y pendiente de verificar en navegador con el sandbox (queda sin marcar):**
  no existía un "detalle de venta", así que se creó `/app/ventas/:id` (`SaleDetailPage` + `InvoicePanel`, gateada por el
  permiso `invoicing`), con enlace desde la pantalla de cobro y desde el detalle de una cita ya cobrada. Precarga los
  datos del cliente (o los de la solicitud pedida al cobrar) y la forma de pago del cobro, corregible; muestra estado,
  último error con "Reintentar", descarga de PDF/XML y cancelación con motivo. `lib/invoiceStatus.ts` decide cuál
  factura mostrar si una venta tiene varias.
  **Cancelación (#2046, 2026-10-05):** la base guarda **quién** cancela (`cancelled_by`, columna nueva con un check:
  una cancelada siempre trae motivo, fecha y persona). La bitácora no sirve para eso: la función escribe con
  `service_role` y ahí `auth.uid()` es nulo. La función toma a la persona de su JWT, nunca del navegador, y **guarda el
  XML y el PDF antes de cancelar** si faltaban (una cancelada ya no se puede tocar). La pantalla muestra motivo, fecha y
  quién, y deja descargar los archivos. Siguen sin ofrecerse el motivo 01 (exige la factura sustituta, y el índice de
  "una viva por venta" no deja emitir la nueva mientras la vieja sigue timbrada) y el 04 (solo de la global, 11.20).
- [ ] **11.20** Factura global al público en general: agrupa las
  ventas del periodo sin factura individual en un solo CFDI (RFC genérico, información global con
  periodicidad, mes y año). Tabla puente venta ↔ factura para que ninguna venta quede en dos
  facturas. Tests de bordes: venta ya facturada no entra, periodo sin ventas, cambio de mes, venta
  cancelada. _Verificar:_ en sandbox, una global del mes con ventas mixtas; las ventas incluidas ya no
  ofrecen "Facturar".

### 11E. Cierre

- [ ] **11.21** 📚🧪 Extender el E2E: agendar → atender → cobrar **con un producto** → facturar en
  sandbox. Sigue siendo **un solo** test (D12). _Verificar:_ verde en local y en CI (el CI usa el
  sandbox; la llave va en GitHub Secrets, nunca en el repo).
- [x] **11.22** Semilla y reset: productos ficticios y existencias para Patitas Felices en `seed.sql`
  y `demo-reset.sh`; el reset **no** toca nada fiscal real ni llama al PAC. _Verificar:_ `db:reset` y
  `demo:reset` dejan el inventario limpio. **Hecho 2026-10-06 (#2048, parte de semilla; el E2E con sandbox y la
  documentación de cierre, 11.21 y 11.23, siguen pendientes):** los productos ya estaban en `seed.sql` (11.3); el
  reset ahora **restaura el catálogo base y las existencias** (oculta los productos creados en una demo y los insumos
  de consultas anteriores). Como `stock_movements` es inmutable, las existencias se corrigen con un movimiento
  `adjustment` por la diferencia, y repetir el reset no escribe nada de más. **Desviación:** las existencias viven
  solo en `demo_reset.sql` y **no** en `seed.sql`, porque 21 tests de inventario (consumo de insumos, cobro con
  productos y movimientos) asumen existencia 0 en la semilla; sembrarlas obligaba a reescribirlos. Para verlas en
  local, se corre `demo_reset.sql` contra la base local. Deja visibles los tres estados de Inventario (normal, stock
  bajo y "Sin inventario"). No toca `tenant_invoicing_settings`. Tests en `demo-reset.spec.ts`.
- [ ] **11.23** 📚 Documentar al cerrar: tablas nuevas en `CLAUDE.md` §6, módulos nuevos de permisos
  en §6.7/§7.2, la Edge Function `invoicing` en §3/§4/§10 y la dependencia (si el PAC trae SDK); quitar
  "Venta de productos e inventario" y "CFDI real" de la lista de "Aún no construido" (§1); `.env.example`
  con las llaves del PAC (vacías). _Verificar:_ `CLAUDE.md`, `PLAN.md` y `TASKS.md` coinciden.

**Riesgos de la fase:**

| Riesgo                                                        | Cómo se atiende                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Los conceptos del CFDI no suman el total de la venta          | Desglose por partida (§8.2) + test en `lib/cfdi.ts` que compara la suma con el total; casos de centavos que no dividen |
| Timbrar dos veces la misma venta                              | Un solo timbrado por venta, idempotente, garantizado por la base (índice único parcial) y no por la interfaz      |
| Timbrar en producción desde local o staging                   | Llaves del PAC distintas por ambiente; solo producción tiene la de timbrado real                                  |
| Fuga del certificado (CSD) de un negocio                      | No se guarda en nuestra base ni en Storage; pasa directo al PAC desde la Edge Function                            |
| El stock se desfasa                                           | Existencia = suma de movimientos inmutables; no hay columna que se pueda descuadrar                                |
| Claves SAT o tratamiento de IVA mal asignados                 | Se confirman con un contador en 11.1; el sistema valida formato, no contenido fiscal                              |
| Costo por timbre sin dueño                                    | Decisión #1: se define quién lo paga antes de abrir la función a negocios reales                                   |
| Descontar dos veces un insumo (al usarlo y al cobrarlo)       | El movimiento nace al registrar la línea; el cobro solo crea la partida del ticket. Test que cuenta los movimientos |
| Vender con existencia 0 saltándose la pantalla                | La validación vive en la RPC de cobro, no en el frontend; test que lo intenta directo                              |

---

## Fase 12 — Corte de caja y reportes

**Meta: que recepción cierre la caja contando el efectivo y vea si sobra o falta dinero, y que el dueño
vea cuánto se vendió, por qué método de pago, por sucursal y por empleado.**
Segunda fase de la **etapa de mejoras** (`CLAUDE.md` §1). Todo sale de datos que ya existen: sin servicio
externo ni dependencia nueva.

**Estado: terminada (2026-10-05).** Aprobada el 2026-10-06. Las decisiones y sus alternativas están en
`PLAN.md` D17. Seguimiento en HMH Four: tareas #2071 a #2079 (12.1 → #2071, 12.2 → #2072, 12.3 a 12.6 → #2073 y #2074, 12.7 → #2075, 12.8 y 12.9 → #2076, 12.10 y 12.11 → #2077, 12.12 y 12.13 → #2078, 12.14 y 12.15 → #2079).

### Decisiones (aprobadas el 2026-10-06)

| #   | Decisión                                | Propuesta                                                                                                                                                                                                  |
| --- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Unidad del corte                        | **Turno de caja por sucursal**, con apertura (fondo inicial) y cierre (conteo). Varios por día; solo uno abierto a la vez por sucursal (lo garantiza la base).                                              |
| 2   | ¿Cobrar exige caja abierta?             | **No.** La venta se asigna al corte por rango de tiempo (`paid_at` dentro del turno de su sucursal); no se toca la RPC de cobro ni sus tests.                                                              |
| 3   | Efectivo esperado                       | `fondo + efectivo cobrado − cambio + ingresos − retiros/gastos`. **El cambio no está guardado**: se deriva de `pagado − total`, y solo sale de la caja si hubo efectivo. Tarjeta y transferencia no cuentan. |
| 4   | Retiros, gastos e ingresos de caja      | **Sí**, como movimientos inmutables (`cash_movements`). Sin ellos, cualquier gasto chico con efectivo de la caja da un faltante falso.                                                                      |
| 5   | Corte cerrado                           | **No se edita ni se borra** (ni con `service_role`). Se guardan esperado, contado y diferencia como instantánea. Un error se aclara con una nota.                                                           |
| 6   | Dónde se calculan los reportes          | **En la base** (funciones SQL), no sumando en el navegador: el API corta a 1 000 filas y los totales saldrían mal sin avisar. El periodo se interpreta en la **zona de cada sucursal** (§8.3).              |
| 7   | Ventas canceladas                       | Se **excluyen** de los totales y se muestran aparte. **No** se construye cancelar con reembolso (hoy no hay interfaz para cancelar una venta).                                                              |
| 8   | Atribución a empleados                  | Servicios: el empleado de la cita. Productos de mostrador y ventas sin cita: quien cobró. Un producto vendido con un servicio va al empleado del servicio.                                                  |
| 9   | Permisos                                | Módulos nuevos `cash_register` (dueño y recepción ver/editar) y `reports` (solo dueño por defecto). Se ajustan con filas (D13). Recepción solo ve sus sucursales.                                           |
| 10  | Gráficas y exportación                  | **Sin librería** (D11): barras con CSS/SVG. Exportar a **CSV**; Excel queda fuera.                                                                                                                         |

### 12A. Preparación

- [x] **12.1** 📚 Revisar y aprobar las decisiones de arriba y `PLAN.md` D17 (cambiar lo que no convenza
  ahora es barato). _Verificar:_ el usuario aprobó por escrito; D17 sin "pendiente de aprobación". **Hecho
  2026-10-06 (#2071):** el usuario aprobó las diez decisiones sin cambios.
- [x] **12.2** 📚🧪 `lib/cashCount.ts` (puro): efectivo esperado de un turno a partir de fondo, ventas con sus
  pagos y movimientos de caja; cambio de una venta; diferencia (sobrante/faltante). Explicar por qué el cambio
  se deriva y no se guarda. Tests de bordes: pago exacto, cambio con efectivo, **pago mixto efectivo + tarjeta
  con sobrepago**, venta solo con tarjeta (cambio 0 aunque el monto exceda), turno sin ventas, retiro mayor al
  efectivo, venta cancelada, descuento. _Verificar:_ verde; cobertura de `lib/` ≥ 80 %.
  **Hecho 2026-10-06 (#2072):** `lib/cashCount.ts` (22 tests). Reglas que quedaron fijas y que la RPC de cierre
  (12.6) debe repetir en SQL: el **cambio de una venta** es `pagado − total`, **limitado al efectivo recibido** en
  esa venta (con tarjeta de más no hay cambio en efectivo); el efectivo que se queda en caja es lo recibido menos el
  cambio; solo cuentan ventas `paid`. Un retiro mayor al efectivo deja el esperado **negativo** (se devuelve tal
  cual para que la pantalla lo señale, no se recorta a 0). Un monto no entero o negativo **lanza error** en vez de
  redondear en silencio. Supuesto a confirmar con un contador o con el negocio: si alguien paga con tarjeta de más y
  se le devuelve efectivo, el sistema no lo ve (no hay forma de registrarlo todavía).

### 12B. Caja en la base de datos

- [x] **12.3** 📚 Migración (solo el enum): valores `cash_register` y `reports` en `permission_module`, en un
  archivo aparte (Postgres no deja usar un valor de enum nuevo en la misma transacción). _Verificar:_
  `db:reset` limpio; los tests de permisos existentes siguen verdes sin modificarlos.
  **Hecho 2026-10-07 (#2073):** migración `cash_permission_modules`.
- [x] **12.4** 📚🧪 Migración `cash_sessions`: sucursal, abierta por, fondo inicial, fecha de apertura y de
  cierre, cerrada por, `expected_cents`, `counted_cents`, `difference_cents`, nota. RLS por sucursal y permiso
  `cash_register`; índice único parcial "una abierta por sucursal"; trigger que impide editar o borrar una
  cerrada (también `service_role`); bitácora; permisos por defecto en los negocios existentes y en la semilla.
  Tests: aislamiento entre negocios y entre sucursales, rol sin permiso, segunda caja abierta rechazada,
  cerrada inmutable. _Verificar:_ verde.
  **Hecho 2026-10-07 (#2073):** `cash_sessions` + `open_cash_session()`. Los usuarios **no escriben la tabla**: abrir y
  cerrar son RPC. Checks en la base: abierta = sin datos de cierre, cerrada = con todos, y `diferencia = contado −
  esperado`. Una sucursal sin acceso, inexistente o ajena recibe el mismo mensaje de "sin permiso". Permisos por
  defecto de `cash_register` (dueño y recepción) y `reports` (solo dueño) en negocios existentes y en la semilla.
  Tests en `cash-register.spec.ts`.
- [x] **12.5** 📚🧪 Migración `cash_movements` (retiro, gasto, ingreso; monto entero positivo; motivo
  obligatorio; ligado a la caja abierta): bitácora **inmutable** como `stock_movements`. Tests: no se
  modifica ni se borra, solo en caja abierta, motivo obligatorio, aislamiento. _Verificar:_ verde.
  **Hecho 2026-10-07 (#2074):** `cash_movements` (retiro, gasto, ingreso). Se insertan directo (política con permiso
  `cash_register`/editar, sucursal propia y `created_by = auth.uid()`) y un trigger exige caja **abierta de la misma
  sucursal y negocio**, también para `service_role`. Sin UPDATE ni DELETE (ni con `service_role`).
- [x] **12.6** 📚🧪 RPC `open_cash_session` y `close_cash_session` (`SECURITY DEFINER`, revalidan membresía,
  permiso y sucursal en la primera línea, §7.3.4). El cierre **calcula el esperado en SQL con la misma regla**
  de `lib/cashCount.ts` y congela esperado, contado y diferencia. Tests: cierre cuadrado, con sobrante y con
  faltante; ventas de otra sucursal o fuera del rango no cuentan; cierre de una caja ya cerrada; **un test
  compara la RPC contra `lib/cashCount.ts` con las mismas entradas** (mismo patrón que `cfdi-parity`).
  _Verificar:_ verde.
  **Hecho 2026-10-07 (#2073):** `close_cash_session()` con `for update` (dos cierres simultáneos no se pisan). El
  esperado lo calcula `app.cash_session_summary()`, que repite la regla de `lib/cashCount.ts`; **el test de paridad
  corre cuatro escenarios por las dos** (incluye pago mixto con sobrepago, tarjeta de más y venta cancelada) y también
  prueba que una venta de otra sucursal o anterior a la apertura no cuenta. El turno es el rango `[apertura, cierre)`
  de la sucursal; `closed_at` usa `clock_timestamp()` (no `now()`, que dentro de una transacción no avanza).
  **Para 12.10/12.11:** `cash_session_summary` es interna (sin `EXECUTE` para usuarios); la pantalla de caja
  necesitará una RPC pública que la envuelva y revalide permiso para mostrar "cobrado en el turno".

### 12C. Reportes en la base de datos

- [x] **12.7** 📚🧪 RPC `report_sales_summary(desde, hasta, sucursal)`: por día, por método de pago y por
  sucursal (subtotal, IVA, descuento, total, número de ventas) más las canceladas aparte. El periodo se
  interpreta en la zona de la sucursal. Revalida permiso `reports` y sucursal. Tests de bordes: venta a las
  11 pm en Tijuana, cambio de mes, periodo sin ventas, venta cancelada, descuento, **pago mixto** (el monto va
  a cada método), aislamiento entre negocios y sucursales, usuario sin permiso. _Verificar:_ verde; los totales
  coinciden al centavo con la suma de los tickets.
  **Hecho 2026-10-08 (#2075):** `report_sales_summary(negocio, desde, hasta, sucursal?)` devuelve un jsonb con
  totales, por día (incluye los días sin ventas, para la gráfica), por sucursal, cobrado por método y canceladas
  aparte. Las fechas son **locales de cada sucursal**, ambas incluidas; tope de un año. Exige permiso `reports`/ver
  y acceso a la sucursal; cualquier otro caso (negocio ajeno, sucursal sin acceso) responde igual "sin permiso".
  Índice nuevo en `sales (negocio, sucursal, paid_at)`. **Advertencias de lectura que la pantalla (12.12) debe
  decir:** (1) subtotal e IVA son los guardados en la venta, **antes del descuento** (el cobro no recalcula el IVA al
  descontar); el total es el exacto y `subtotal + IVA − descuento = total`. (2) Por método se reporta lo cobrado sin el
  cambio; si alguien paga con tarjeta de más, ese sobrepago sí aparece y el total por métodos puede exceder al de
  ventas. Tests en `report-sales-summary.spec.ts` (16): venta a las 11 pm, misma hora en CDMX y Tijuana, cambio de
  mes, periodo sin ventas, descuento, canceladas, pago mixto, aislamiento y sucursal.
- [x] **12.8** 🧪 RPC `report_top_items`: servicios y productos más vendidos (cantidad e importe), con el IVA
  por partida. Tests: producto y servicio en el mismo ticket, cantidad > 1, partida de insumo de consulta,
  periodo vacío. _Verificar:_ verde.
  **Hecho 2026-10-09 (#2076):** `report_top_items(negocio, desde, hasta, sucursal?, límite)` devuelve
  `{ services, products }`, cada lista ordenada por cantidad y luego por importe (límite de 1 a 100). Un insumo de
  consulta cobrado cuenta como **producto**. El importe es el de la partida **con IVA y antes del descuento de la
  venta**, así que la suma de la lista puede exceder al total de ventas cuando hubo descuentos (la pantalla debe
  decirlo). Nombre = el de la partida más reciente. Las dos funciones comparten la validación de permiso y periodo
  (`app.assert_report_access`, interna). Tests en `report-top-items-staff.spec.ts`.
- [x] **12.9** 🧪 RPC `report_staff_activity`: citas atendidas y monto de servicios por empleado, y ventas de
  mostrador por quien cobró (regla 8 de las decisiones). Tests: cita sin empleado, empleado dado de baja,
  producto vendido junto con un servicio. _Verificar:_ verde.
  **Hecho 2026-10-09 (#2076):** `report_staff_activity(negocio, desde, hasta, sucursal?)`: una fila por empleado
  con citas completadas, importe de servicios, de productos y total. Atribución por **partida**: ligada a una cita →
  empleado de esa cita; producto sin cita en una venta que lleva citas → empleado de la **cita más temprana** del
  ticket; venta sin citas → quien cobró (`closed_by`). Lo que no tenga empleado (p. ej. una venta antigua sin
  `closed_by`) sale como **"Sin asignar"** en vez de perderse. Las citas se cuentan por su fecha local de inicio y no
  dependen de que se hayan cobrado. Un empleado dado de baja aparece si tuvo actividad. **Corrección al plan:** "cita
  sin empleado asignado" **no puede ocurrir** (`appointments.employee_user_id` es obligatorio); el caso real de
  "Sin asignar" es la venta sin `closed_by`.

### 12D. Interfaz

- [x] **12.10** Servicio `services/cashRegister.ts` y `services/reports.ts` y su store (estado de la caja
  abierta, periodo y sucursal elegidos). _Verificar:_ tests de store de las transiciones (abrir, movimiento,
  cerrar); `npm run lint && npm run test:unit` en verde.
  **Hecho 2026-10-10 (#2077, parte de la caja; los servicios y el store de Reportes llegan con 12.12):**
  `services/cashRegister.ts`, `stores/cashRegister.ts` (11 tests de transiciones: abrir, movimiento, cerrar, y que un
  dato inválido **no llegue al servidor**) y `lib/cashRegister.ts` (13 tests: de texto en pesos a centavos sin
  flotantes, montos que se rechazan y mensajes en español). Migración nueva `cash_session_overview()`: la función
  pública que envuelve el resumen interno del turno y revalida permiso y sucursal (4 tests).
- [x] **12.11** Pantalla **Caja**: abrir con fondo, ver lo cobrado en el turno por método, registrar retiros
  y gastos, cerrar contando el efectivo (muestra esperado y diferencia **después** de capturar el conteo, no
  antes), historial de cortes y comprobante de corte imprimible (mismo estilo que el ticket). Explicar en
  pantalla qué es el fondo y la diferencia. _Verificar:_ en navegador con recepción: abrir → cobrar → retiro →
  cerrar; un groomer no ve la pantalla.
  **Hecho 2026-10-10 (#2077):** `/app/caja` (`CashRegisterPage` + diálogos de movimiento y de cierre + comprobante
  imprimible), con entrada "Caja" en el menú y la ruta gateada por `cash_register`. El cierre es en dos pasos: se
  captura el conteo **sin ver el esperado** y se pide confirmar; el esperado y la diferencia salen al cerrar (el conteo
  a ciegas es solo de la interfaz: la función del resumen sí devuelve el esperado, que quien tiene permiso puede
  calcular con lo que ve). **Verificado en navegador** con Playwright contra la base local (script desechable, no se
  sube): recepción ve la caja cerrada, un fondo inválido da error en español, abre con $500, registra un gasto de $30,
  cierra contando $470 y el comprobante dice "La caja cuadra", el corte aparece en el historial, y un groomer que
  escribe `/app/caja` en la barra termina en la agenda. **No cubierto:** el aviso de ventas en efectivo fuera de un
  turno (queda como riesgo de la fase) y probar con ventas reales del día.
- [x] **12.12** Pantalla **Reportes** (solo con permiso): periodo (hoy, semana, mes, rango), sucursal (el
  dueño ve todas), tarjetas de totales, barras por día y por método dibujadas con CSS/SVG, tablas de más
  vendidos y de empleados, y **exportar a CSV** (con codificación para que Excel lea los acentos).
  _Verificar:_ en navegador; el CSV abre en Excel sin caracteres rotos y suma lo mismo que la pantalla.
  **Hecho 2026-10-11 (#2078):** `/app/reportes` (`ReportsPage`): periodo (hoy, esta semana de lunes a hoy, este mes,
  mes pasado, rango de fechas con tope de un año), sucursal (si hay más de una), tres pestañas (resumen, más vendido,
  empleados), tarjetas de totales, barras por día y por método dibujadas con CSS (sin librería, D11) y descarga a
  CSV por reporte. `lib/reports.ts` (20 tests: periodos con cruce de mes, año y bisiesto; escala de barras; CSV),
  `services/reports.ts` y `stores/reports.ts` (6 tests). El CSV lleva **BOM** (Excel lee los acentos), importes en
  pesos con punto y sin "$" (Excel los suma) y **neutraliza las fórmulas**: un nombre de producto que empiece con
  `=`, `+`, `-` o `@` se prefija con una comilla, porque Excel lo ejecutaría. La pantalla **explica las dos
  advertencias**: subtotal e IVA antes del descuento, y el sobrepago con tarjeta en el cobrado por método.
  **Verificado en navegador** con Playwright contra la base local (script desechable): con 3 ventas pagadas y 1
  cancelada, el total ($895.00), el ticket promedio, las canceladas y el desglose por método coinciden con los
  tickets; el CSV de ventas por día suma lo mismo que la pantalla (con BOM); el nombre de producto `=CMD(...)` sale
  neutralizado; un rango invertido da un error en español; y recepción, que no tiene `reports`, ni ve el menú ni
  entra por URL (termina en la agenda). **No cubierto:** abrir el CSV en un Excel real (se comprobó el contenido y
  el BOM, no la apertura) y la pantalla con miles de ventas.
- [x] **12.13** Menú y rutas: entradas "Caja" y "Reportes" gateadas por permiso (`requiresPermission`), igual
  que Inventario. _Verificar:_ cada rol ve solo lo suyo, y la URL directa de una pantalla sin permiso redirige.
  **Hecho 2026-10-11 (#2077 y #2078):** "Caja" y "Reportes" ya están en el menú y en el router con
  `requiresPermission`; probado con dueño (ve ambos), recepción (ve Caja, no Reportes) y groomer (ninguno).

### 12E. Cierre

- [ ] **12.14** Semilla y reset: un corte cerrado de ejemplo y ventas variadas de los últimos días para que los
  reportes no salgan vacíos en la demo; `demo_reset.sql` restaura los cortes sin borrarlos (son inmutables: se
  ocultan o se compensan, como el inventario). **No** va en `seed.sql` si rompe tests existentes (como pasó
  con las existencias en 11.22). _Verificar:_ `demo:reset` deja los reportes con datos y la caja cerrada.
- [x] **12.15** 📚 Documentar al cerrar: tablas nuevas en `CLAUDE.md` §6.5, módulos nuevos en §6.7/§7.2, quitar
  "reportes y corte de caja" de los candidatos de §1, y la nota de que "Reportes financieros avanzados" sigue
  fuera. _Verificar:_ `CLAUDE.md`, `PLAN.md` y `TASKS.md` coinciden.
  **Hecho 2026-10-05 (#2079, parte 12.15):** `CLAUDE.md` §6.5 documenta `cash_sessions` y `cash_movements` (turno,
  RPC de apertura, cierre y resumen, inmutabilidad del corte cerrado, regla del efectivo esperado) y las tres funciones
  de reportes; §6.7 y §7.2 listan los módulos `cash_register` y `reports` con sus permisos por defecto (y corrigen la
  lista de módulos, que había quedado en `employees` e `inventory`); §1 quita "corte de caja y reportes" de los
  candidatos y precisa qué "Reportes financieros avanzados" sigue fuera (utilidad, inventario, facturación y Excel
  nativo); §10 describe lo que `demo:reset` deja ahora (esto último depende del PR de 12.14). `PLAN.md` y
  `TASKS.md` marcan la fase 12 como terminada. **Verificado** releyendo cada afirmación contra las migraciones, las
  rutas y los archivos de `src/` (nombres de funciones, tablas, permisos y rutas existen). **No cubierto:** el
  ejemplo de demostración de `PLAN.md` ("tres ventas, retiro de $200") no se reprodujo de principio a fin en esta
  tarea; lo verificado en navegador está en 12.11 y 12.12.

**Riesgos de la fase:**

| Riesgo                                                        | Cómo se atiende                                                                                                   |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| El efectivo esperado no cuadra por el cambio mal calculado    | El cambio se deriva (no se guarda) en una función pura con tests de bordes; la RPC de cierre repite la regla y un test compara ambas |
| Totales de reporte incorrectos por pasar de 1 000 filas        | Se agrega en SQL, no en el navegador                                                                              |
| Una venta nocturna cae en el día equivocado                   | El periodo se interpreta en la zona de la sucursal (§8.3) y hay test con Tijuana a las 11 pm                      |
| Dos cajas abiertas a la vez en una sucursal                   | Índice único parcial en la base                                                                                   |
| Reescribir un corte ya cerrado para "arreglar" un faltante    | Trigger que lo impide, también con `service_role`; el error se aclara con una nota                                |
| Una venta sin caja abierta queda fuera de todo corte          | Los reportes no dependen de la caja; la pantalla avisa cuando hay ventas en efectivo fuera de un turno             |
| Que recepción vea reportes de otras sucursales                | RPC con permiso `reports` y sucursal revalidados; test de aislamiento por sucursal                                 |
