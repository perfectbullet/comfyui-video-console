<template>
  <div class="app">
    <header>
      <div><small>COMFYUI · CS-H3</small><h1>任务管理</h1><p>当前 ComfyUI 实例的实时状态、历史详情与生成视频。</p></div>
      <nav><a href="/?mode=director">多模式导演台</a><a href="/?mode=nine-images">九图分镜版</a><a class="active" href="/?mode=tasks">任务管理</a><a href="/?mode=system">系统信息</a></nav>
    </header>
    <main>
      <section class="card summary">
        <label class="server">ComfyUI 服务地址<input v-model.trim="server" list="comfyui-server-options" placeholder="选择或输入 ComfyUI 服务地址" @change="load" /><datalist id="comfyui-server-options"><option v-for="option in serverOptions" :key="option.url" :value="option.url">{{ option.label }}</option></datalist></label>
        <div class="stats">
          <div><strong class="running">{{ running.length }}</strong><span>运行中</span></div>
          <div><strong class="queued">{{ pending.length }}</strong><span>排队中</span></div>
          <div><strong class="completed">{{ completed.length }}</strong><span>已完成</span></div>
          <div><strong class="error">{{ errorCount }}</strong><span>失败</span></div>
        </div>
        <p class="muted">每 5 秒自动刷新（<button class="inline" @click="load">立即刷新</button>）</p>
      </section>

      <section class="card">
        <h2>运行中 / 排队中</h2>
        <p v-if="!running.length && !pending.length" class="muted">当前无活动任务。</p>
        <table v-else>
          <thead><tr><th>状态</th><th>实例</th><th>任务 ID</th></tr></thead>
          <tbody>
            <tr v-for="t in [...running, ...pending]" :key="t.prompt_id">
              <td><strong :class="t.status">{{ t.status === 'running' ? '运行中' : '排队中' }}</strong></td>
              <td>{{ t.instance }}</td>
              <td><code>{{ t.prompt_id }}</code></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>已完成任务</h2>
        <p v-if="!completed.length" class="muted">暂无已完成任务。</p>
        <template v-else>
          <label class="filter">筛选<select v-model="filter"><option value="all">全部</option><option value="success">仅成功</option><option value="error">仅失败</option></select></label>
          <div v-for="t in filteredCompleted" :key="t.prompt_id" class="task">
            <div class="title">
              <div><h3>任务 {{ t.prompt_id.slice(0, 8) }}</h3><span>实例 {{ t.instance }} · {{ fmtTime(t.start) }} → {{ fmtTime(t.end) }}（{{ durText(t) }}）</span></div>
              <strong :class="t.status === 'success' ? 'completed' : 'error'">{{ t.status === 'success' ? '成功' : '失败' }}</strong>
            </div>
            <p><code>{{ t.prompt_id }}</code></p>
            <template v-if="t.videos && t.videos.length">
              <video v-for="(v, i) in t.videos" :key="i" :src="viewUrl(v)" controls></video>
              <a v-for="(v, i) in t.videos" :key="'a' + i" :href="viewUrl(v)" target="_blank">下载 {{ v.filename }}</a>
            </template>
            <p v-else class="muted">无视频输出</p>
          </div>
        </template>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import serverOptions from './assets/comfyui_servers.json'

const server = ref(serverOptions[0].url)
const running = ref([]), pending = ref([]), completed = ref([])
const filter = ref('all')
let timer = null

const errorCount = computed(() => completed.value.filter(t => t.status !== 'success').length)
const filteredCompleted = computed(() =>
  filter.value === 'all' ? completed.value
  : filter.value === 'success' ? completed.value.filter(t => t.status === 'success')
  : completed.value.filter(t => t.status !== 'success')
)

function viewUrl(v) {
  return `${server.value}/view?${new URLSearchParams({ filename: v.filename, subfolder: v.subfolder || '', type: v.type || 'output' })}`
}
function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
function durText(t) {
  if (!t.start || !t.end) return '—'
  const s = Math.round((t.end - t.start) / 1000)
  return `${Math.floor(s / 60)}分${s % 60}秒`
}
function queueTask(item, status) {
  return { prompt_id: item?.[1] || item?.prompt_id || '未知任务', status, instance: '当前 ComfyUI' }
}
function messageTime(entry, type) {
  const message = (entry.status?.messages || []).find(([name]) => name === type)
  return message?.[1]?.timestamp || null
}
function outputVideos(outputs) {
  return Object.values(outputs || {}).flatMap(node =>
    ['videos', 'images', 'gifs'].flatMap(key => (node[key] || []).filter(file =>
      /\.mp4$/i.test(file.filename || '')
    ))
  )
}
function historyTask([prompt_id, entry]) {
  const start = messageTime(entry, 'execution_start') || entry.prompt?.[3]?.create_time || null
  const end = messageTime(entry, 'execution_success') || messageTime(entry, 'execution_error') || null
  const success = entry.status?.completed && entry.status?.status_str !== 'error'
  return { prompt_id, status: success ? 'success' : 'error', instance: '当前 ComfyUI', start, end, videos: outputVideos(entry.outputs) }
}
async function load() {
  try {
    const base = server.value.replace(/\/$/, '')
    const [queueResponse, historyResponse] = await Promise.all([
      fetch(`${base}/queue`),
      fetch(`${base}/history?max_items=100`),
    ])
    if (!queueResponse.ok || !historyResponse.ok) throw Error('ComfyUI 接口响应异常')
    const queue = await queueResponse.json(), history = await historyResponse.json()
    running.value = (queue.queue_running || []).map(item => queueTask(item, 'running'))
    pending.value = (queue.queue_pending || []).map(item => queueTask(item, 'queued'))
    completed.value = Object.entries(history).map(historyTask).sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0))
  } catch (e) { console.error('加载任务失败', e) }
}
onMounted(() => { load(); timer = setInterval(load, 5000) })
onUnmounted(() => clearInterval(timer))
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
:global(:root) { font-family: Inter, system-ui, "Microsoft YaHei", sans-serif; color: #e7edf7; background: #101825 }
:global(body) { margin: 0 }
.app { max-width: 1280px; margin: auto; padding: 30px }
header { display: flex; justify-content: space-between; gap: 20px; margin: 10px 0 28px; flex-wrap: wrap }
small { color: #7dd3fc; letter-spacing: .12em; font-weight: 700 }
h1 { margin: 8px 0; font-size: 32px }
h2 { margin: 0 0 10px; font-size: 18px }
p, .muted { color: #9eb0cb; margin: 0 }
nav { display: flex; gap: 8px; height: max-content; flex-wrap: wrap }
nav a { color: #c9d5e7; text-decoration: none; padding: 8px 11px; border: 1px solid #2a3a53; border-radius: 8px; font-size: 13px; white-space: nowrap }
nav .active { color: #062034; background: #67e8f9; border-color: #67e8f9 }
.card { background: #172233; border: 1px solid #2a3a53; border-radius: 16px; padding: 22px; box-shadow: 0 16px 40px #0002; margin-bottom: 20px }
.stats { display: flex; gap: 24px; margin-bottom: 10px }
.server { display: block; max-width: 620px; color: #c9d5e7; font-size: 13px; margin-bottom: 16px }
.server input { width: 100%; margin-top: 6px; color: #ecf5ff; background: #0f1725; border: 1px solid #3a4e6d; border-radius: 8px; padding: 9px; font: inherit }
.stats div { text-align: center }
.stats strong { display: block; font-size: 26px; padding: 2px 14px; border-radius: 10px }
.stats span { color: #9eb0cb; font-size: 13px }
strong { padding: 5px 10px; border-radius: 99px; font-size: 12px; display: inline-block }
.queued { color: #fde68a; background: #41381d }
.running { color: #7dd3fc; background: #173c55 }
.completed { color: #86efac; background: #163827 }
.error { color: #fca5a5; background: #4b2029 }
button.inline { width: auto; margin: 0 0 0 8px; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #7dd3fc; background: #173c55; border: 1px solid #2a3a53; cursor: pointer }
table { width: 100%; border-collapse: collapse; margin-top: 10px }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a3a53; font-size: 13px }
th { color: #7dd3fc; font-weight: 600 }
code { color: #c9d5e7; font-size: 12px; word-break: break-all }
.filter { display: inline-block; margin: 0 0 12px }
.filter select { width: auto; display: inline; margin-left: 8px }
.task { background: #111a28; border: 1px solid #2a3a53; border-radius: 11px; padding: 14px; margin-top: 12px }
.title { display: flex; justify-content: space-between; gap: 14px; align-items: center; flex-wrap: wrap }
.title h3 { margin: 0; font-size: 15px; color: #7dd3fc }
.title span { color: #9eb0cb; font-size: 12px }
video { display: block; width: 320px; max-width: 100%; background: #000; border-radius: 8px; margin-top: 10px }
a { display: inline-block; margin-top: 8px; color: #7dd3fc; margin-right: 14px }
</style>
