import { createApp } from 'vue'
import ShellApp from './ShellApp.vue'
import { createPinia } from 'pinia'
import './assets/style.css'

const pinia = createPinia()

createApp(ShellApp).use(pinia).mount('#app')
