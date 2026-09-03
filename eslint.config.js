// Config "flat" de ESLint (el formato actual; reemplaza a .eslintrc).
// Es un array de "capas": cada objeto agrega o ajusta reglas para ciertos
// archivos. ESLint las aplica en orden, y la última que toque una regla
// gana — por eso `eslintConfigPrettier` va al final: apaga cualquier regla
// de estilo que pudiera pelearse con Prettier (Prettier formatea, ESLint
// solo revisa errores de lógica y convenciones de Vue/TS).
import pluginVue from 'eslint-plugin-vue'
import { withVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import eslintConfigPrettier from 'eslint-config-prettier'
import globals from 'globals'

export default withVueTs(
  {
    name: 'app/ignores',
    ignores: [
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/src/types/database.ts', // generado por Supabase, no se lintea (tarea 1.19)
      'playwright-report/**',
      'test-results/**',
    ],
  },
  // Reglas "esenciales" de Vue: errores comunes (v-for sin :key, variables
  // no declaradas en el template, etc.). Hay niveles más estrictos
  // ("recommended", "strongly-recommended") pero para un demo, "essential"
  // es el que atrapa bugs reales sin pelear por estilo.
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  {
    name: 'app/language-options',
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    name: 'app/rules',
    rules: {
      // TypeScript ya avisa de variables no usadas con más detalle;
      // se desactiva la versión genérica de ESLint para no duplicar el aviso.
      'no-unused-vars': 'off',
    },
  },
  eslintConfigPrettier,
)
