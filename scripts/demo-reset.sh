#!/usr/bin/env bash
# Restaura datos de negocio limpios en el demo DESPLEGADO (CLAUDE.md §8.7,
# tarea 6.12): corre supabase/seed/demo_reset.sql contra fullpetcare-prod,
# el único ambiente que este script toca.
#
# Distinto de "npm run db:reset" (local): ese recrea TODA la base local
# desde cero (migraciones + seed.sql) — no existe un "desde cero" posible
# en un ambiente desplegado con datos reales de verdad algún día, y aunque
# hoy sea puro demo, `demo_reset.sql` ya está escrito para nunca borrar
# expediente clínico (CLAUDE.md §8.5) ni tocar auth.users — ver los
# comentarios de ese archivo para el porqué completo.
set -euo pipefail

cd "$(dirname "$0")/.."

# Fijo a propósito (tarea 1.34): este script solo tiene UN destino
# posible, no acepta un project-ref por argumento — así nunca es un
# descuido apuntarle por error a otro proyecto (o peor, a uno que algún
# día sí tenga clientes reales).
PROD_PROJECT_REF="boajojegcmpvzjsloosk"

echo "Esto va a modificar datos en fullpetcare-prod (el demo desplegado)."
echo "Se oculta (borrado suave) cualquier cita, venta o partida de una"
echo "sesión de demo anterior que no sea parte del guion fijo, y se"
echo "restaura el historial curado de Rocky y Max a su estado original."
echo
read -r -p "¿Continuar? [y/N] " confirm
if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
  echo "Cancelado."
  exit 1
fi

echo "Restaurando datos de demo en fullpetcare-prod..."

# "supabase db query --project-ref X" por sí solo NO alcanza (el CLI lo
# rechaza: "--project-ref only applies when targeting the linked
# project") — hay que enlazar el repo a X primero y usar "--linked". Como
# el repo queda enlazado a STAGING por defecto (tarea 1.35, a propósito,
# para que un comando accidental no le pegue a prod), este script guarda
# ese enlace antes de cambiarlo y lo REGRESA al terminar — para que correr
# "npm run demo:reset" nunca deje el repo apuntando a prod por accidente
# para el siguiente comando que alguien corra sin pensarlo.
PREVIOUS_PROJECT_REF=$(supabase status -o env 2>/dev/null | grep '^LINKED_PROJECT_REF=' | cut -d'"' -f2 || true)

supabase link --project-ref "$PROD_PROJECT_REF"
supabase db query --linked --file supabase/seed/demo_reset.sql

if [[ -n "$PREVIOUS_PROJECT_REF" && "$PREVIOUS_PROJECT_REF" != "$PROD_PROJECT_REF" ]]; then
  echo "Regresando el enlace del repo a $PREVIOUS_PROJECT_REF..."
  supabase link --project-ref "$PREVIOUS_PROJECT_REF"
fi

echo "Listo. El demo quedó restaurado."
