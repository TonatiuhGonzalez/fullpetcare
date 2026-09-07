# FullPetCare

SaaS multi-tenant para negocios de cuidado de mascotas en México (clínicas
veterinarias y estéticas caninas). Demo funcional en construcción — ver
[`CLAUDE.md`](./CLAUDE.md) (contexto y convenciones), [`PLAN.md`](./PLAN.md)
(arquitectura y fases) y [`TASKS.md`](./TASKS.md) (tareas) para el detalle
completo.

## Requisitos

- macOS (no se soporta Windows en este proyecto)
- [nvm](https://github.com/nvm-sh/nvm) — el repo fija la versión de Node en `.nvmrc`
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — corriendo, solo como herramienta de desarrollo para Supabase local (la app en sí no se conteneriza)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) — `brew install supabase/tap/supabase`
- [GitHub CLI](https://cli.github.com/) (opcional, para PRs desde terminal)

## Poner el proyecto a correr en local

```bash
nvm use                        # usa la versión de Node de .nvmrc
npm install

npm run db:start                # levanta Postgres/Auth/Storage/Studio locales (Docker)
cp .env.example .env.local      # completa VITE_SUPABASE_ANON_KEY con lo que imprima db:start
npm run dev                     # http://localhost:5173
```

`npm run db:start` (alias de `supabase start`) imprime la URL y las llaves
del proyecto local al terminar — también se pueden consultar después con
`supabase status`. La primera vez descarga varias imágenes de Docker y
tarda unos minutos; las siguientes es cuestión de segundos.

### Usuarios de demo (solo en local, ver `supabase/seed.sql`)

Los cuatro tienen la misma contraseña: `Demo1234!`

| Correo                        | Rol                         |
| ----------------------------- | --------------------------- |
| `dueno@patitasfelices.mx`     | Dueño (ve ambas sucursales) |
| `recepcion@patitasfelices.mx` | Recepción                   |
| `groomer@patitasfelices.mx`   | Groomer                     |
| `vet@patitasfelices.mx`       | Veterinario                 |

## Variables de entorno

Todo lo que la app necesita en tiempo de ejecución vive en `.env.local`
(nunca se sube al repo — está en `.gitignore`). `.env.example` es la
plantilla con los nombres, sin valores reales.

Solo se usan variables con el prefijo `VITE_`, y eso es intencional: Vite
**incrusta esas variables directo en el bundle de JavaScript** que se
manda al navegador de cualquiera que abra la app. No son un secreto de
servidor — son texto plano, visible por cualquiera que abra las
herramientas de desarrollador. Por eso solo dos cosas viven ahí:

- `VITE_SUPABASE_URL` — la URL del proyecto. No es sensible.
- `VITE_SUPABASE_ANON_KEY` — la llave "anon" (anónima) de Supabase.

### ¿Por qué es seguro exponer la anon key en el navegador?

Porque **está diseñada para eso**. Es la llave con la que Supabase
identifica "esta petición viene de la app pública", no una credencial de
administrador — de hecho, cualquiera puede sacarla de las herramientas de
desarrollador del navegador en cualquier sitio hecho con Supabase, incluido
este. Por sí sola, esa llave no le da a nadie acceso a nada: **quien de
verdad decide qué filas puede leer o escribir cada petición es Row Level
Security (RLS) en Postgres** (ver `CLAUDE.md` §7). Con la anon key, sin
haber iniciado sesión, una consulta a `customers` devuelve cero filas —
no porque la llave lo impida, sino porque ninguna política RLS le da
permiso al rol `anon`. Con sesión iniciada, la llave sigue siendo la misma;
lo que cambia es el token de sesión (JWT) que viaja junto con ella, y las
políticas usan ESE token (vía `auth.uid()`) para decidir qué es visible.

La contraparte es la **`service_role` key**: esa sí es una credencial de
administrador — salta RLS por completo y puede leer o escribir cualquier
fila de cualquier tenant. **Esa nunca va en un archivo `VITE_*`, nunca
llega al navegador, y nunca se sube al repo.** Vive únicamente en GitHub
Secrets (para el pipeline de CI/CD) y en variables de entorno de servidor
(Edge Functions, scripts de administración como el reset de demo).

## Pruebas

```bash
npm run test:unit        # Vitest: src/lib, src/services, src/stores — no necesita Docker
npm run test:db          # Vitest + pg contra Postgres local — necesita "npm run db:start" corriendo
npm run test:e2e         # Playwright: el flujo completo (se agrega en fase 6)
npm run test:unit:coverage
```

Ver `CLAUDE.md` §9 para qué se prueba y por qué, y cada archivo de test
(`*.spec.ts`) trae su propia explicación de qué cubre cada caso.

## Otros comandos útiles

```bash
npm run lint              # ESLint + reglas de Prettier
npm run format             # Prettier, escribe los cambios

npm run db:reset           # recrea la base local desde cero (migraciones + seed.sql)
npm run db:types           # regenera src/types/database.ts desde el esquema local
npm run db:stop            # apaga los contenedores de Supabase local
```

## Despliegue

Tres entornos (ver `CLAUDE.md` §10 para el detalle):

| Entorno        | Frontend                             | Supabase             |
| -------------- | ------------------------------------- | --------------------- |
| **local**      | `npm run dev`                        | Docker (`db:start`)   |
| **staging**    | Preview de Cloudflare Pages (por PR) | `fullpetcare-staging` |
| **producción** | Cloudflare Pages, rama `main`        | `fullpetcare-prod`    |

Producción **es** el demo que se enseña — no hay datos reales de clientes
todavía, por eso es seguro resetearla o mergear ahí con frecuencia.

### Qué pasa al abrir un PR

1. GitHub Actions corre `.github/workflows/ci.yml`: lint, pruebas unitarias
   y pruebas de RLS contra un Supabase temporal dentro del runner. Main
   exige que este check pase para poder mergear (branch protection).
2. Cloudflare Pages construye un **preview deployment** en una URL propia
   del PR (`<hash>.fullpetcare.pages.dev`), usando las variables de
   entorno de Preview — que apuntan a `fullpetcare-staging`, no a prod.

### Qué pasa al mergear a `main`

1. Cloudflare Pages construye la versión de **producción**
   (`fullpetcare.pages.dev`), con las variables de entorno de Production
   apuntando a `fullpetcare-prod`.
2. Si el merge tocó `supabase/migrations/**`, `.github/workflows/deploy-migrations.yml`
   corre `supabase db push` contra `fullpetcare-prod` automáticamente — no
   hace falta correrlo a mano. Usa dos Secrets del repo:
   - `SUPABASE_ACCESS_TOKEN`: token de acceso personal, con alcance de
     organización (necesario para crear/administrar proyectos, no solo
     leerlos).
   - `SUPABASE_DB_PASSWORD`: la contraseña de Postgres de
     `fullpetcare-prod` específicamente.

   Ninguno de los dos es la `service_role` key — esa nunca vive en un
   Secret de este repo porque no la necesita ningún workflow (ver
   "Variables de entorno" arriba).

### Crear o reconfigurar los proyectos de Supabase en la nube

Es manual, se hace una vez (o cuando haga falta un proyecto nuevo), vía el
CLI ya autenticado con `supabase login`:

```bash
supabase link --project-ref <ref>              # conecta el repo local a un proyecto
supabase db push --linked                       # aplica las migraciones pendientes
```

`fullpetcare-staging` y `fullpetcare-prod` ya existen (fase 1). El repo
local queda enlazado a **staging** por defecto — evita que un `db push`
manual accidental afecte producción sin querer. Para tocar prod a mano
(algo excepcional, ya que 1.41 lo automatiza) hay que `link` explícito a
su `project-ref` primero.

## Estructura del repo

Ver `CLAUDE.md` §4 para el árbol completo comentado y la "regla de capas"
(`pages/components → stores → services → supabase`, con `lib/` como
funciones puras sin dependencias del proyecto).

## Guion de demo

Para enseñar el producto en una reunión (`fullpetcare.pages.dev`, con los
usuarios de demo del panel de arriba). El orden importa: cada pantalla se
apoya en la anterior, y el historial rico de Rocky/Max (sembrado por
`npm run demo:reset`, ver abajo) evita tener que construir meses de
visitas en vivo frente al cliente.

### 0. Antes de entrar a la sala

```bash
npm run demo:reset
```

Deja producción con las citas/ventas sueltas de la última demo ocultas, y
revive el historial curado de Rocky y Max con fechas relativas a HOY (ver
`supabase/seed/demo_reset.sql`). Sin esto, una demo anterior puede dejar
el catálogo de citas del día con basura de otra sesión.

### 1. Login y selector de negocio/sucursal

Entra con `dueno@patitasfelices.mx`. **Qué decir:** "Un mismo negocio
puede tener varias sucursales — Patitas Felices tiene Centro y Del Valle
— y cada empleado solo ve las suyas. El dueño ve todas." Elige "Sucursal
Centro".

### 2. Agenda del día

**Qué decir:** "Esta es la pantalla que un recepcionista tiene abierta
todo el día." Señala la sección "Próximas vacunas" abajo — son Rocky y
Max, con su chip de "por vencer": "el sistema avisa solo, sin que nadie
tenga que llevar un Excel aparte".

### 3. Agendar una cita nueva

Botón "Nueva cita" → cliente existente (busca "Sofía") → su mascota
(Rocky) → tipo Estética → servicio (Baño) → empleado y el primer horario
libre. **Qué decir:** "El sistema ya sabe qué horarios están libres para
Lupita ese día — no hay que revisar la agenda a mano para no encimar dos
citas."

### 4. Atender la cita

Desde el detalle de la cita, botón "Atender". Llena una nota rápida de
groomer y guarda. **Qué decir:** "Aquí la ficha cambia según el tipo de
cita — una de estética pide estilo de corte y notas de comportamiento;
una de veterinaria pide diagnóstico, peso y vacunas. Es la misma cita,
pero cada quien ve solo lo que le toca."

### 5. Cobrar

Desde el mensaje de "cita completada", "Ir a cobrar". Marca efectivo,
llena el monto completo, cobra. **Qué decir:** "El precio ya incluye IVA
— como en el mostrador real — y el ticket lo desglosa. Ahí está el
folio, van a coincidir siempre el subtotal más el IVA con el total, al
centavo."

### 6. Historial completo de una mascota

Ve a Clientes → Sofía → Rocky (o entra directo por "Buscar cliente"
desde otra pantalla). **Qué decir:** "Esto mezcla TODAS las visitas de
Rocky — estética y veterinaria, vacunas, peso — en una sola línea de
tiempo. La cita que se acaba de cobrar ya aparece aquí arriba." Señala la
gráfica de peso y la cartilla de vacunación con su chip de estado.

### 7. Vista pública para el dueño de la mascota

Desde la ficha de Rocky, botón "Generar link" al final de la página.
Cópialo y ábrelo en el celular (o en una pestaña de incógnito).
**Qué decir:** "Esto es lo que le llega al dueño de la mascota por
WhatsApp — sin necesidad de una cuenta ni una contraseña. Ve la cartilla
de su mascota, su historial, y nada más: ni un teléfono de otro cliente,
ni un peso, ni una nota interna del personal." Termina revocando el link
en la ficha para mostrar que deja de funcionar al instante.

### Si preguntan qué falta

Ventas de producto/inventario, factura fiscal real (CFDI), pasarela de
pago real, notificaciones automáticas por WhatsApp — todo está en
`CLAUDE.md` §1 como decisiones YA tomadas para v1, no como olvidos.
