import { createApp } from 'vue'
import StoryboardApp from './App.vue'
import I2VApp from './I2VApp.vue'
import DirectorApp from './DirectorApp.vue'
import NineImagesApp from './NineImagesApp.vue'
import SystemInfoApp from './SystemInfoApp.vue'
import CSH3App from './CSH3App.vue'
import TasksApp from './TasksApp.vue'

const mode = new URLSearchParams(window.location.search).get('mode')
createApp(
  mode === 'i2v' ? I2VApp
  : mode === 'director' ? DirectorApp
  : mode === 'nine-images' ? NineImagesApp
  : mode === 'csh3' ? CSH3App
  : mode === 'tasks' ? TasksApp
  : mode === 'system' ? SystemInfoApp
  : StoryboardApp
).mount('#app')
