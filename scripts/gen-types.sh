#!/usr/bin/env bash
# Regenera src/types/database.ts a partir del esquema de Supabase LOCAL.
# Léelo así: "lee lo que dicen las migraciones ahora mismo, y escribe los
# tipos TypeScript que le corresponden a cada tabla, columna y enum".
#
# "set -euo pipefail" (ver también CLAUDE.md §10, Mac vs Linux):
#   -e  para el script en el primer comando que falle, en vez de seguir
#       como si nada.
#   -u  trata usar una variable no definida como error, no como cadena vacía.
#   -o pipefail   si un comando de un pipe (cmd1 | cmd2) falla, todo el
#       pipe se considera fallido, no solo el último comando.
set -euo pipefail

cd "$(dirname "$0")/.."

echo "Generando src/types/database.ts desde Supabase local..."
supabase gen types typescript --local > src/types/database.ts

echo "Listo: src/types/database.ts"
