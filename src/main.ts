import { createPinia } from 'pinia'
import { createApp } from 'vue'

// Tipografía de marca (PLAN.md D20). Se sirve desde nuestro propio dominio, sin
// pedir nada a Google Fonts. Debe cargarse antes que el CSS que la usa.
import '@fontsource-variable/inter'

import App from './App.vue'
import { router } from './router'
import { vuetify } from './plugins/vuetify'
import './styles/main.scss'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.use(vuetify)

app.mount('#app')
