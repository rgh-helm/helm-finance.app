import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { installApi } from './lib/webApi.js'
import './style.css'

// Install the browser equivalent of electron/preload.cjs's window.api
// before anything else touches it.
installApi()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
