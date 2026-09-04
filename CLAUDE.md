# CLAUDE.md — FullPetCare

Contexto permanente del proyecto. Este archivo se lee al inicio de cada sesión.
Si algo aquí contradice una instrucción puntual del usuario, gana el usuario, pero
avísale de la contradicción.

---

## 1. Qué es el producto

**FullPetCare** es un SaaS multi-tenant para negocios de cuidado de mascotas en México.
El diferenciador es cubrir **los dos lados del negocio en una sola plataforma**:

- **Estética canina**: citas de baño/corte, ficha de la mascota con preferencias de
  corte, historial de servicios, notas del groomer.
- **Veterinaria**: consulta, expediente clínico básico, cartilla de vacunación con
  recordatorios, peso e historial.
- **Común**: agenda por sucursal y por empleado, catálogo de servicios, cobro y ticket,
  cliente con sus mascotas.

Estado actual: **demo funcional** para validar el concepto con dueños de negocio reales.
No es un producto maduro. Pero las decisiones estructurales (§6, §7, §8) van bien desde
el día uno porque retrofitearlas cuesta carísimo.

### Alcance de v1

Debe recorrerse un flujo completo de principio a fin:

1. Login y selección de tenant/sucursal
2. Dashboard con la agenda del día
3. Crear cita: cliente y mascota (o alta nueva), tipo (estética o veterinaria),
   servicios, horario y empleado
4. Atender la cita: ficha según el tipo (corte y notas, o consulta y vacunas)
5. Cobrar: resumen, método de pago simulado, ticket
6. Historial completo de una mascota mezclando ambos tipos de visita
7. Vista cliente pública (solo lectura) por link con token, optimizada para móvil

### Fuera de alcance en v1 (no lo construyas aunque parezca obvio)

- **Venta de productos e inventario.** Decidido explícitamente: v1 es solo servicios.
  El modelo de venta (`sales` / `sale_items`) está diseñado para aceptar productos
  después sin migración destructiva, pero no hay tabla `products` ni UI de venta.
- App móvil nativa (la vista cliente cubre esa necesidad)
- CFDI real (solo campos y `invoice_requests` listos)
- Pasarela de pago real (SPEI/OpenPay simulados)
- Lotes y caducidades de medicamento
- Reportes financieros avanzados
- Envío automático de notificaciones por WhatsApp (el link se copia y se pega a mano)
- Docker de la app, Kubernetes, infraestructura como código

---

## 2. Con quién trabajas

El usuario es **desarrollador frontend de nivel medio**:

- **Rápido en**: Vue 3, Vuetify, SASS, JavaScript de UI.
- **Sabe**: SQL, algo de PHP.
- **Limitado en**: backend.
- **Cero experiencia en**: pruebas unitarias, DevOps.
- **Quiere aprender**: tests y DevOps en este proyecto.

Consecuencias directas para cómo escribes:

1. **Nada de cajas negras.** Cada test, cada archivo de CI, cada política RLS lleva
   explicación de qué hace y por qué. En los tests, di qué caso cubre y por qué ese
   caso importa (qué se rompería en producción si no existiera).
2. **Comenta el CI bloque por bloque.** No una línea al inicio: cada paso.
3. **Explica antes de introducir un concepto nuevo** (mocks, fixtures, `SECURITY
DEFINER`, protección de rama, variables de entorno por ambiente).
4. En Vue/Vuetify/SASS puedes ir al grano, ahí no necesita andamiaje.
5. Explica en español, con ejemplos concretos del propio proyecto, no genéricos.

---

## 3. Stack y por qué

Ya está decidido. **No lo cambies sin discutirlo primero.**

| Capa            | Elección                                  | Por qué                                                                        |
| --------------- | ----------------------------------------- | ------------------------------------------------------------------------------ |
| UI              | Vue 3 (Composition API, `<script setup>`) | Terreno del usuario                                                            |
| Componentes     | Vuetify 3                                 | Terreno del usuario; Material da un demo presentable sin diseñador             |
| Build           | Vite                                      | Estándar de Vue 3                                                              |
| Estado          | Pinia                                     | Estándar; los stores son unidad de prueba                                      |
| Rutas           | Vue Router                                | Estándar                                                                       |
| Estilos         | SASS                                      | Terreno del usuario                                                            |
| Backend/BD      | Supabase (Postgres, Auth, Storage)        | RLS en Postgres es el aislamiento multi-tenant real; evita escribir un backend |
| Serverless      | Supabase Edge Functions                   | **Solo** para la vista pública del cliente (§7.4)                              |
| Hosting         | Cloudflare Pages                          | Despliegue por git, previews por PR, gratis                                    |
| CI              | GitHub Actions                            | Integrado a los PRs                                                            |
| Tests unitarios | Vitest + Vue Test Utils                   | Vitest comparte config con Vite                                                |
| Tests de BD/RLS | Vitest + `pg` contra Supabase local       | Un solo runner y un solo lenguaje que aprender                                 |
| E2E             | Playwright                                | Un único test: agendar → atender → cobrar                                      |
| Lenguaje        | TypeScript                                | Ver §5.1                                                                       |
| Runtime         | Node 22 LTS, fijado en `.nvmrc`           | Mac y runner de Linux iguales                                                  |
| Paquetes        | npm                                       | Ya instalado, cero setup extra                                                 |

### Dependencias permitidas y su justificación

Regla: **ninguna dependencia nueva sin justificarla antes con el usuario.**
Las aprobadas hasta ahora:

- `@supabase/supabase-js` — cliente oficial.
- `date-fns` + `@date-fns/tz` — construir un instante UTC a partir de fecha+hora local
  en una zona IANA no se hace bien con `Intl` a mano (ver §8.3). Es la única
  dependencia de fechas.
- `pg` (dev) — cliente Postgres para los tests de RLS, que necesitan conectarse como
  roles distintos.
- `eslint`, `prettier`, `eslint-plugin-vue`, `vitest`, `@vue/test-utils`,
  `@playwright/test`, `vite-plugin-vuetify` — herramientas.

Todo lo demás se pregunta. En particular **no** se agregan: librerías de gráficas,
de formularios, de i18n (§5.5), de tablas, ni utilidades tipo lodash.

---

## 4. Estructura de carpetas

```
FullPetCare/
├── .github/workflows/ci.yml     # lint + tests + tests de BD (comentado paso a paso)
├── .nvmrc                       # 22
├── .env.example                 # plantilla; nunca valores reales
├── CLAUDE.md  PLAN.md  TASKS.md  README.md
│
├── supabase/
│   ├── config.toml              # config del stack local
│   ├── migrations/              # 20260903120000_nombre.sql — inmutables una vez en main
│   ├── seed.sql                 # datos demo locales (ficticios, en español)
│   ├── seed/demo_reset.sql      # reset de datos de negocio para el demo desplegado
│   ├── functions/
│   │   └── public-pet-view/     # Edge Function de la vista cliente
│   └── tests/                   # tests de RLS y de RPCs (Vitest + pg)
│
├── scripts/
│   ├── demo-reset.sh            # restaura datos demo limpios
│   └── gen-types.sh             # regenera src/types/database.ts
│
├── e2e/                         # Playwright: un solo test de flujo completo
│
└── src/
    ├── main.ts
    ├── App.vue
    ├── plugins/vuetify.ts
    ├── router/index.ts
    ├── lib/                     # FUNCIONES PURAS. Sin red, sin Supabase. Muy testeadas.
    │   ├── money.ts             #   centavos, IVA, redondeo
    │   ├── datetime.ts          #   UTC ↔ zona de sucursal
    │   ├── availability.ts      #   cálculo de huecos en la agenda
    │   └── validation.ts        #   RFC, teléfono, CP
    ├── services/                # ACCESO A DATOS + reglas. Única capa que habla con Supabase.
    │   ├── supabase.ts          #   cliente único
    │   ├── customers.ts  pets.ts  appointments.ts  records.ts  checkout.ts  shareLinks.ts
    ├── stores/                  # Pinia: session, tenant, agenda, cart
    ├── types/database.ts        # GENERADO. No editar a mano.
    ├── composables/
    ├── components/              # tontos: reciben props, emiten eventos
    ├── layouts/
    ├── pages/                   # una carpeta por área: auth, agenda, clientes, atencion, cobro, publico
    └── styles/
```

### La regla de capas (importante)

```
pages / components  →  stores  →  services  →  supabase
                                     ↓
                                    lib (puro)
```

- Un **componente nunca importa `supabase.ts`**. Habla con un store o con un service.
- Un **service nunca importa un componente ni un store**.
- **`lib/` no importa nada del proyecto** salvo otros `lib/`. Por eso es trivial de
  probar: entra un objeto, sale un objeto.
- La lógica que se pueda expresar como función pura, **va en `lib/`**. Ahí es donde
  vive el valor de las pruebas.

---

## 5. Convenciones de código

### 5.1 TypeScript

Se usa TypeScript, no JavaScript. Razón: `supabase gen types typescript` genera los
tipos de **toda la base** a partir de las migraciones, así que el editor sabe que
`appointment.starts_at` existe y que `price_cents` es `number`. Es tipado gratis, sin
escribirlo a mano, y atrapa exactamente los errores que más duelen aquí (nombres de
columna, campos faltantes al insertar).

Modo suave: `strict: true` pero sin peleas. Si un tipo estorba más de 5 minutos, `any`
con un `// TODO: tipar` es aceptable en un demo. No se optimiza el sistema de tipos.

### 5.2 Nombres

- **Código y comentarios: en inglés.** Variables, funciones, tablas, columnas, ramas,
  mensajes de commit, nombres de archivo.
- **UI y datos de ejemplo: en español de México.** Todo lo que ve un usuario.
- **Documentación (`CLAUDE.md`, `PLAN.md`, `TASKS.md`, `README.md`): en español.**

| Cosa              | Convención                                 | Ejemplo                                  |
| ----------------- | ------------------------------------------ | ---------------------------------------- |
| Tablas y columnas | `snake_case`, tabla en plural              | `appointment_services.unit_price_cents`  |
| Componentes Vue   | `PascalCase`, dos palabras mínimo          | `PetTimeline.vue`, `AppointmentCard.vue` |
| Pages             | `PascalCase` terminado en `Page`           | `AgendaPage.vue`                         |
| Composables       | `useAlgo`                                  | `useBranchClock`                         |
| Services          | archivo en plural, funciones verbo primero | `appointments.ts` → `listByDay()`        |
| Stores            | `useAlgoStore`                             | `useSessionStore`                        |
| Enums de BD       | tipo Postgres `enum`, valores en inglés    | `appointment_status`                     |
| Booleanos         | `is_` / `has_`                             | `is_active`, `has_medical_alert`         |
| Dinero            | siempre sufijo `_cents`                    | `total_cents`                            |
| Migraciones       | `AAAAMMDDHHMMSS_snake_case.sql`            | `20260903120000_tenancy.sql`             |

### 5.3 Vue

- Siempre `<script setup lang="ts">`.
- Orden en el SFC: `<script setup>`, `<template>`, `<style scoped lang="scss">`.
- Props tipadas con `defineProps<{...}>()`. Nada de `props: { type: String }`.
- Componentes de presentación sin estado global. El estado vive en stores.
- Vuetify se usa tal cual viene; el tema se personaliza en `plugins/vuetify.ts`, no con
  overrides de CSS regados por los componentes.

### 5.4 Errores

- Los services **no muestran** errores; lanzan o devuelven `{ data, error }`.
- La UI decide cómo se ve el error (un `v-snackbar`, un `v-alert` en el formulario).
- Nunca se traga un error con `catch {}` vacío.
- Los mensajes que ve el usuario van en español y sin jerga: "No se pudo guardar la
  cita. Revisa tu conexión.", no "Error 500: PGRST116".

### 5.5 Sin i18n

La UI es solo español. No se instala `vue-i18n`. Los textos van directo en los
templates. Si algún día hay que internacionalizar, es un refactor mecánico y aislado;
pagar esa complejidad hoy no compra nada.

---

## 6. Modelo de datos

Reglas transversales, aplican a **toda** tabla de negocio:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id)` — sin excepción (salvo `tenants` y
  `profiles`)
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()` (trigger `set_updated_at`)
- `deleted_at timestamptz` — borrado suave (§8.5)
- Índice compuesto que empieza por `tenant_id` en todo lo que se consulta

### 6.1 Tenencia e identidad

| Tabla                 | Campos clave                                                                                  | Notas                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `tenants`             | `name`, `legal_name`, `rfc`, `tax_regime_code`, `postal_code`, `default_cfdi_use`, `timezone` | El negocio. Campos CFDI desde el día uno (§8.4)                                                  |
| `branches`            | `tenant_id`, `name`, `address`, `postal_code`, `phone`, `timezone`, `opening_hours jsonb`     | Sucursal. **Su propia zona horaria** (§8.3)                                                      |
| `profiles`            | `id` = `auth.users.id`, `full_name`, `phone`, `avatar_path`                                   | Identidad global de la persona. **Sin `tenant_id`**: una persona podría trabajar en dos negocios |
| `memberships`         | `tenant_id`, `user_id`, `role`, `is_active`                                                   | Une persona ↔ negocio ↔ rol. **Es la fuente de verdad de los permisos** (§7)                     |
| `membership_branches` | `membership_id`, `branch_id`                                                                  | A qué sucursales entra. El rol `owner` ve todas sin necesidad de filas aquí                      |

`role` es un enum: `owner` | `receptionist` | `groomer` | `vet`.

| Rol            | Ve                              | Puede                                                                |
| -------------- | ------------------------------- | -------------------------------------------------------------------- |
| `owner`        | Todas las sucursales del tenant | Todo                                                                 |
| `receptionist` | Sus sucursales                  | Clientes, mascotas, agenda, cobro. **No** escribe expediente clínico |
| `groomer`      | Sus sucursales                  | Su agenda, ficha de estética. **No lee expediente clínico**          |
| `vet`          | Sus sucursales                  | Su agenda, expediente clínico, vacunas                               |

Que un `groomer` no pueda leer `medical_records` es una política RLS probada, no una
condición en un `v-if`.

### 6.2 Clientes y mascotas

| Tabla         | Campos clave                                                                                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `customers`   | `tenant_id`, `first_name`, `last_name`, `phone`, `email`, `notes`, + CFDI: `rfc`, `legal_name`, `tax_regime_code`, `cfdi_use`, `postal_code`, `requires_invoice` |
| `pets`        | `tenant_id`, `customer_id`, `name`, `species`, `breed`, `sex`, `birth_date`, `is_sterilized`, `photo_path`, `grooming_notes`, `medical_alerts`                   |
| `pet_weights` | `tenant_id`, `pet_id`, `appointment_id`, `weight_grams int`, `measured_at`                                                                                       |

`weight_grams` es entero (12 400 = 12.4 kg). Misma razón que el dinero: nada de
flotantes en ningún lado (§8.2). Igual `temperature_deci_c` (385 = 38.5 °C).

### 6.3 Catálogo y agenda

| Tabla                  | Campos clave                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services`             | `tenant_id`, `kind` (`grooming`\|`veterinary`), `name`, `duration_minutes`, `price_cents`, `tax_rate_bp`, `is_active`                                          |
| `appointments`         | `tenant_id`, `branch_id`, `customer_id`, `pet_id`, `kind`, `employee_user_id`, `starts_at timestamptz`, `ends_at timestamptz`, `status`, `notes`, `created_by` |
| `appointment_services` | `tenant_id`, `appointment_id`, `service_id`, `name_snapshot`, `unit_price_cents`, `quantity`, `duration_minutes_snapshot`                                      |

- **Una cita es de un solo tipo** (`kind`). Si la mascota va a baño y a consulta, son dos
  citas del mismo cliente, que pueden cobrarse en un mismo ticket.
- `status`: `scheduled` | `in_progress` | `completed` | `cancelled` | `no_show`.
- `*_snapshot`: al agendar se **copia** nombre, precio y duración del servicio. Si mañana
  suben el precio del baño, las citas viejas conservan el suyo. Un ticket histórico
  nunca cambia de monto.
- `tax_rate_bp` en _basis points_: 1600 = 16.00 %. Entero, otra vez.

### 6.4 Atención

| Tabla              | Campos clave                                                                                                                                             |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `grooming_records` | `appointment_id` (único), `pet_id`, `cut_style`, `blade_used`, `shampoo_used`, `behavior_notes`, `groomer_notes`, `condition_observations`               |
| `medical_records`  | `appointment_id` (único), `pet_id`, `reason`, `history`, `examination`, `diagnosis`, `treatment`, `indications`, `temperature_deci_c`, `next_visit_date` |
| `vaccines`         | `tenant_id`, `name`, `species`, `default_interval_days` (catálogo)                                                                                       |
| `vaccinations`     | `tenant_id`, `pet_id`, `vaccine_id`, `applied_at`, `batch_number`, `applied_by_user_id`, `next_due_date`, `appointment_id`, `notes`                      |

`grooming_records` y `medical_records` son **expediente**: nunca se borran físicamente
(§8.5) y todo cambio queda en la bitácora (§8.6).

### 6.5 Cobro

| Tabla              | Campos clave                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sales`            | `tenant_id`, `branch_id`, `customer_id`, `folio`, `status` (`open`\|`paid`\|`cancelled`), `subtotal_cents`, `tax_cents`, `discount_cents`, `total_cents`, `paid_at`, `closed_by` |
| `sale_items`       | `tenant_id`, `sale_id`, `item_type` (`service`), `service_id`, `appointment_id`, `description`, `quantity`, `unit_price_cents`, `tax_rate_bp`, `tax_cents`, `line_total_cents`   |
| `payments`         | `tenant_id`, `sale_id`, `method`, `amount_cents`, `reference`, `status`, `paid_at`                                                                                               |
| `invoice_requests` | `tenant_id`, `sale_id`, `rfc`, `legal_name`, `tax_regime_code`, `cfdi_use`, `postal_code`, `payment_form_code`, `payment_method_code`, `status`, `fiscal_uuid`                   |

- `item_type` es enum con un solo valor hoy (`service`). Cuando entren productos se
  agrega `product` y una columna `product_id` nullable: migración aditiva, sin tocar
  ventas existentes.
- `payments.method`: `cash` | `card` | `transfer_spei` | `openpay`. Los tres últimos se
  **simulan** en v1: se registra el pago con `status = 'simulated_approved'` y una
  referencia falsa. La tabla ya es la que se usará de verdad.
- `invoice_requests` no factura nada. Guarda lo que el SAT pediría. Cuando se conecte un
  PAC, se llena `fiscal_uuid` y ya.

### 6.6 Vista pública y bitácora

| Tabla         | Campos clave                                                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `share_links` | `tenant_id`, `scope` (`pet`\|`customer`), `pet_id`, `customer_id`, `token_hash`, `token_prefix`, `expires_at`, `revoked_at`, `created_by`, `access_count`, `last_accessed_at` |
| `audit_log`   | `tenant_id`, `table_name`, `record_id`, `action`, `actor_user_id`, `changed_at`, `old_data jsonb`, `new_data jsonb`                                                           |

`share_links` **nunca guarda el token en claro**, solo su SHA-256 (§7.4).

---

## 7. Aislamiento multi-tenant

Es la decisión más importante del proyecto. **No se confía en que el código de la app
filtre bien.** El aislamiento vive en Postgres.

### 7.1 Cómo funciona

Row Level Security es una condición SQL que Postgres pega automáticamente a **cada**
consulta sobre una tabla. Aunque el frontend escriba `select * from customers` sin
filtro, Postgres devuelve solo las filas que la política permite. Si un día se olvida un
`.eq('tenant_id', ...)` en el código, no pasa nada.

Toda tabla de negocio tiene:

```sql
alter table customers enable row level security;
alter table customers force row level security;  -- aplica también al dueño de la tabla
```

### 7.2 De dónde sale "mi tenant"

De la tabla `memberships`, no del JWT. Decidido así porque los permisos quedan vivos:
si al empleado se le revoca el acceso, deja de ver al instante, sin esperar a que
caduque su token.

Funciones auxiliares, en el esquema `app`:

```sql
-- SECURITY DEFINER: corre con los permisos del dueño de la función, NO del que consulta.
-- Es imprescindible aquí: si esta función leyera memberships como el usuario normal,
-- la política de memberships la llamaría a ella misma → recursión infinita.
-- STABLE: Postgres la evalúa una vez por consulta, no una vez por fila.
create function app.is_member_of(p_tenant_id uuid) returns boolean
  language sql stable security definer set search_path = public as $$
    select exists (
      select 1 from memberships m
      where m.user_id = auth.uid() and m.tenant_id = p_tenant_id and m.is_active
    );
  $$;

create function app.role_in(p_tenant_id uuid) returns text ...
create function app.can_access_branch(p_branch_id uuid) returns boolean ...
```

Patrón de política:

```sql
create policy customers_select on customers for select
  using (app.is_member_of(tenant_id) and deleted_at is null);

create policy customers_insert on customers for insert
  with check (app.is_member_of(tenant_id)
              and app.role_in(tenant_id) in ('owner','receptionist'));
```

**Trampa conocida — `deleted_at is null` en SELECT + UPDATE de un rol autenticado no se
llevan bien.** Postgres RLS exige que la fila RESULTANTE de un UPDATE siga pasando la
política de SELECT de la tabla, sin importar qué diga el `with check` de la propia
política de UPDATE. Si el SELECT de arriba filtra `deleted_at is null` y una política de
UPDATE le permite a `owner`/`receptionist` poner `deleted_at`, el borrado suave
(`update ... set deleted_at = now()`) falla siempre con "new row violates row-level
security policy" — descubierto y verificado a mano al escribir `customers` (fase 2).
**Si una tabla tiene UPDATE para un rol autenticado normal (no solo `service_role`), su
política de SELECT no debe filtrar `deleted_at is null`** — ese filtro se hace en la capa
de servicios (`.is('deleted_at', null)` explícito en cada consulta de lectura). Las
tablas de tenencia (§6.1) no llevan el filtro por esta misma razón, aunque hoy no tengan
UPDATE para authenticated todavía.

Para el expediente clínico, la lectura además excluye al groomer:

```sql
create policy medical_records_select on medical_records for select
  using (app.is_member_of(tenant_id) and app.role_in(tenant_id) in ('owner','vet'));
```

### 7.3 Reglas duras de RLS

1. **Toda tabla nueva nace con RLS activo y con su política, en la misma migración.**
   Una tabla sin política es una tabla invisible; una tabla con RLS apagado es una fuga.
2. **Ninguna tabla de negocio tiene política de `DELETE`.** Sin política, Postgres
   rechaza el borrado. El borrado suave se hace con `update ... set deleted_at = now()`.
3. **El rol `anon` no tiene permisos sobre ninguna tabla.** La vista pública no consulta
   Postgres directo (§7.4).
4. **Toda función `SECURITY DEFINER` revalida la membresía adentro.** `SECURITY DEFINER`
   salta RLS: si no revalida, es una puerta trasera.
5. **Cada tabla con política tiene su test de aislamiento** antes de darse por terminada.

### 7.4 La vista pública del cliente

Es la superficie más expuesta del sistema: un link que se manda por WhatsApp, sin login.

Diseño elegido:

1. La recepción genera un link para una mascota. Se generan **32 bytes aleatorios**
   codificados en base64url (43 caracteres). Ese token se muestra **una sola vez** en la
   UI para copiarlo.
2. En `share_links` se guarda **solo `sha256(token)`**. Si alguien se roba un respaldo de
   la base, no obtiene links usables.
3. El navegador del dueño de la mascota abre `/c/:token`. Esa ruta llama a la Edge
   Function `public-pet-view`, **no** a Postgres.
4. La Edge Function: calcula el hash, busca el `share_link` vigente (no revocado, no
   expirado), y con ese registro conoce `tenant_id` y `pet_id`. Consulta con service role
   **filtrando siempre por esos dos valores**, y devuelve un DTO con campos en lista
   blanca (cartilla, historial de visitas, próximas citas). Nada más.
5. Registra el acceso (`access_count`, `last_accessed_at`).

Por qué así y no con RLS y la llave anónima: para que el rol `anon` tenga acceso a las
tablas, habría que abrirle `select`. Un error en una sola política se vuelve fuga masiva.
Con la Edge Function, el rol anónimo no tiene nada que leer aunque se equivoque una
política.

Lo que la vista pública **nunca** devuelve: teléfonos y correos de otros clientes,
montos y tickets, notas internas del personal, nombres de empleados fuera del que
atendió, ni identificadores de otros registros.

Sus pruebas son explícitas y obligatorias: token de otro tenant, token revocado, token
expirado, token válido pidiendo otra mascota, token inexistente, y que `anon` no pueda
leer ninguna tabla directamente.

---

## 8. Decisiones innegociables

### 8.1 Migraciones versionadas desde el día uno

Todo cambio de esquema es un archivo en `supabase/migrations/`. Nunca se toca el esquema
desde el panel de Supabase. Una migración que ya está en `main` **no se edita**: se
escribe otra encima.

### 8.2 El dinero es entero, en centavos

`price_cents`, `total_cents`, `amount_cents`. **Nunca** `float`, `real`, `double` ni
`numeric` para dinero, ni en Postgres ni en TypeScript. En JS, `0.1 + 0.2 !== 0.3`; con
enteros ese problema no existe. Se convierte a pesos solo al **mostrar**, con
`formatMXN()` de `lib/money.ts`.

Mismo criterio para toda magnitud: pesos de mascota en gramos, temperatura en décimas de
grado, tasas de impuesto en _basis points_.

**IVA incluido en el precio.** `services.price_cents` es lo que paga el cliente, como en
el mostrador mexicano. El ticket desglosa hacia atrás:

```
net = round(gross * 10000 / (10000 + tax_rate_bp))
tax = gross - net
```

El impuesto se calcula **por partida** y luego se suma, no sobre el total. Es lo que hace
el SAT y evita diferencias de un centavo. Esto vive en `lib/money.ts` y tiene tests de
redondeo.

### 8.3 Fechas en UTC en la base

- Todo instante es `timestamptz`. Postgres lo guarda en UTC.
- La conversión a hora local ocurre **solo al mostrar**, usando la zona IANA de la
  sucursal (`branches.timezone`), no la del navegador. Si el dueño ve la agenda de
  Tijuana desde Mérida, debe ver la hora de Tijuana.
- Nunca se guardan offsets fijos (`-06:00`). Se guardan nombres IANA
  (`America/Mexico_City`, `America/Tijuana`, `America/Hermosillo`, `America/Cancun`).
  México eliminó el horario de verano en 2022, **pero los municipios fronterizos como
  Tijuana lo siguen aplicando** para alinearse con Estados Unidos. Un offset fijo se
  rompe ahí dos veces al año; el nombre IANA no.
- Las fechas sin hora (fecha de nacimiento, próxima vacuna) van como `date`, no como
  `timestamptz`. Un cumpleaños no tiene zona horaria.
- Todo esto está encapsulado en `lib/datetime.ts`. Los componentes no llaman a
  `date-fns` directo.

### 8.4 Campos CFDI desde el esquema inicial

Aunque no se facture: `rfc`, `legal_name` (razón social), `tax_regime_code`
(c_RegimenFiscal, p.ej. 601, 612, 626), `cfdi_use` (c_UsoCFDI, p.ej. G03, D01),
`postal_code` (domicilio fiscal), `payment_form_code` (c_FormaPago: 01 efectivo,
04 tarjeta de crédito, 28 tarjeta de débito, 03 transferencia), `payment_method_code`
(PUE/PPD).

Los códigos se guardan como texto tal cual los publica el SAT, sin traducir.

### 8.5 Borrado suave

- `deleted_at timestamptz null` en toda tabla de negocio.
- Las políticas de lectura filtran `deleted_at is null`.
- **En expediente clínico (`medical_records`, `vaccinations`, `grooming_records`) no hay
  borrado, ni suave ni duro.** Se corrige con una nueva versión del registro y la
  bitácora guarda la anterior. Un expediente es un documento legal.
- Un trigger `prevent_hard_delete()` lanza excepción si alguien intenta un `DELETE` en
  esas tablas, incluso con service role. Cinturón además del tirante.

### 8.6 Bitácora de auditoría

Un trigger genérico `app.log_change()` en las tablas sensibles (expediente, vacunas,
ventas, pagos, membresías, share_links) escribe en `audit_log`: quién (`auth.uid()`),
qué tabla, qué registro, qué acción, cuándo, y el `old_data` / `new_data` en `jsonb`.

Va en trigger, no en el código de la app: así también registra lo que pase desde un
script o desde el panel de Supabase.

### 8.7 Semilla y reset de demo

`npm run demo:reset` restaura datos de ejemplo limpios. El usuario va a enseñar esto
muchas veces y no debe presentar con basura de la sesión anterior.

- **Los datos son siempre ficticios.** Nunca datos reales de clientes, ni siquiera
  "anonimizados". Nombres, teléfonos y RFC inventados.
- Local: `supabase db reset` (recrea la base, corre migraciones y `seed.sql`).
- Demo desplegado: `scripts/demo-reset.sh` borra las tablas de negocio de los tenants de
  demo y las repuebla. **No toca `auth.users`**, para que las credenciales de demo no
  cambien nunca.
- La semilla incluye **dos tenants**. Uno es el del demo; el otro existe para que el
  aislamiento sea verificable a ojo y por los tests.

---

## 9. Pruebas

**Regla: ninguna tarea de `TASKS.md` se marca terminada sin su prueba.**

### Qué se prueba

| Sí                                                                    | No                                       |
| --------------------------------------------------------------------- | ---------------------------------------- |
| `lib/` — funciones puras (dinero, fechas, disponibilidad, validación) | Componentes Vuetify (salvo 1–2 críticos) |
| `services/` — acceso a datos y reglas                                 | Que un botón sea azul                    |
| `stores/` — transiciones de estado de Pinia                           | Que Vuetify funcione                     |
| Políticas RLS y RPCs, contra Postgres real                            | Configuración de librerías               |
| Un único E2E: agendar → atender → cobrar                              | Flujos secundarios en E2E                |

Meta: **70–80 % de cobertura en `services/`, `stores/` y `lib/`**. Sin meta global.

### Los tres tipos

1. **Unitarios (Vitest)** — `lib/` y `stores/`. Rápidos, sin red, sin base.
2. **De base de datos (Vitest + `pg`)** — arrancan contra Supabase local, se conectan
   como distintos usuarios y verifican que las políticas hacen lo que dicen. **El test
   que intenta leer datos de otro tenant y falla vive aquí.** Cada tabla con política
   tiene el suyo.
3. **E2E (Playwright)** — uno solo, el flujo completo. Es la red de seguridad antes de
   cada demo.

### Cómo escribirlos

- Un `describe` por unidad, un `it` por comportamiento.
- El nombre del `it` describe **el comportamiento en español**, no la implementación:
  `it('cobra IVA por partida y no sobre el total', ...)`.
- **Cada test lleva un comentario de dos o tres líneas explicando qué prueba y qué se
  rompería en producción si ese caso fallara.** El usuario está aprendiendo a testear;
  un test sin explicación no le enseña nada.
- Se prueban los bordes, no el camino feliz: cero servicios, precio 0, cita que empieza
  justo cuando termina otra, redondeo de centavos, token expirado.
- Nada de mocks elaborados. Si un test necesita un mock complicado, casi siempre la
  función está mal separada: se extrae la lógica a `lib/` y se prueba pura.

---

## 10. DevOps y entornos

### Los tres entornos

| Entorno        | Frontend                             | Supabase                       | Cuándo                         |
| -------------- | ------------------------------------ | ------------------------------ | ------------------------------ |
| **local**      | `npm run dev`                        | Supabase CLI (Docker local)    | Desarrollo diario              |
| **staging**    | Preview de Cloudflare Pages (por PR) | Proyecto `fullpetcare-staging` | Revisar un PR antes de mergear |
| **producción** | Cloudflare Pages, rama `main`        | Proyecto `fullpetcare-prod`    | **Es el demo que se enseña**   |

Producción es el demo. Por eso `demo:reset` apunta ahí y es seguro: no hay datos reales.
Cuando entre el primer cliente de verdad, esa suposición cambia y hay que revisarlo.

### Git

- **Cero commits directos a `main`.** Rama + PR siempre, con protección de rama activada.
- Ramas: `feat/…`, `fix/…`, `chore/…`, `docs/…`.
- Commits en inglés, imperativo: `add appointment availability calculator`.
- El PR no se mergea si el CI falla.

### CI (GitHub Actions)

En cada push: instalar dependencias, `lint`, `test:unit`, levantar Supabase local y
correr `test:db`. En `main`, además, aplicar migraciones a producción. El archivo va
**comentado bloque por bloque**.

### Secretos

- Nunca en el repo. `.env.example` lleva las llaves con valores vacíos o falsos.
- `.env.local` está en `.gitignore`.
- `VITE_*` son **públicas por diseño**: Vite las incrusta en el bundle. Ahí solo va la
  URL de Supabase y la **anon key** (que es pública y está pensada para eso; lo que la
  protege es RLS).
- **La `service_role` key nunca toca el frontend.** Solo vive en GitHub Secrets, en las
  variables de la Edge Function, y en el `.env.local` del usuario para correr scripts.

### Mac vs Linux

El desarrollo es solo en macOS, pero **GitHub Actions corre en Linux**. Fuentes reales de
"funciona en mi Mac y falla en CI":

1. **Mayúsculas en rutas.** macOS no distingue `PetCard.vue` de `petcard.vue`; Linux sí.
   Un import con la mayúscula mal puesta pasa en local y truena en CI. Es la causa #1.
2. `sed -i` necesita `sed -i ''` en macOS y `sed -i` en Linux. En scripts, evitar `sed`.
3. Comandos BSD vs GNU (`date`, `find`, `stat`) con banderas distintas.
4. Node distinto entre máquina y runner → por eso `.nvmrc` fijo en 22 y el mismo valor
   en el workflow.

Los scripts se escriben con `#!/usr/bin/env bash` + `set -euo pipefail` y se prefiere
Node sobre shell cuando la lógica crece.

---

## 11. Reglas de trabajo

### Cómo trabajar

1. **Simple sobre elegante.** Es un demo para validar. Si hay dos caminos, el aburrido.
2. **Una tarea de `TASKS.md` a la vez**, en orden. Marcar el checkbox solo cuando su
   prueba pasa.
3. **Explicar lo que el usuario no domina**: tests, DevOps, RLS, Postgres. Siempre.
4. Después de escribir código, correr `npm run lint && npm run test:unit`. No dar por
   hecho que pasa.
5. Nada de abstracciones especulativas. Sin capa de repositorios, sin factory patterns,
   sin "por si luego". Se extrae cuando duele por tercera vez.
6. Al terminar una fase, actualizar `TASKS.md` y decir qué se puede demostrar.

### Qué NO hacer sin preguntar

- **No cambiar el stack** ni sustituir una pieza (otro hosting, otro ORM, otro runner).
- **No agregar dependencias.** Ninguna. Se propone, se justifica, se espera respuesta.
- **No tomar una decisión que tenga más de una opción razonable.** Presentar las
  alternativas con sus contras y dejar que el usuario elija.
- **No ampliar el alcance.** Si algo parece necesario pero no está en `TASKS.md`,
  proponerlo, no construirlo. Especialmente: no reintroducir productos/inventario.
- **No relajar las reglas de §8** (dinero, fechas, CFDI, borrado suave, migraciones)
  aunque compliquen una tarea concreta.
- **No crear tablas sin RLS**, ni funciones `SECURITY DEFINER` sin revalidar membresía.
- **No editar migraciones ya mergeadas a `main`.**
- **No hacer `git push` a `main`**, ni mergear PRs, ni tocar la configuración de
  Cloudflare o Supabase en la nube, sin pedirlo antes.
- **No poner datos reales de personas** en semillas, tests o ejemplos. Ficticios siempre.
- **No borrar ni truncar nada** de un entorno desplegado sin confirmación explícita.

---

## 12. Comandos

```bash
npm run dev            # Vite en localhost:5173
npm run build          # build de producción a dist/
npm run lint           # ESLint + Prettier (lo mismo que corre el CI)

npm run test:unit      # Vitest: lib/, services/, stores/
npm run test:db        # Vitest: políticas RLS y RPCs, contra Supabase local
npm run test:e2e       # Playwright: el flujo completo
npm run test           # unit + db

npm run db:start       # supabase start  (necesita Docker corriendo)
npm run db:stop        # supabase stop
npm run db:reset       # recrea la base local: migraciones + seed.sql
npm run db:types       # regenera src/types/database.ts desde el esquema local
npm run db:diff -- x   # genera una migración a partir de cambios locales

npm run demo:reset     # restaura datos demo limpios en el entorno desplegado
```

Requisitos en la Mac: Node 22 (`nvm use`), Docker Desktop corriendo, y el CLI de
Supabase (`brew install supabase/tap/supabase`).
