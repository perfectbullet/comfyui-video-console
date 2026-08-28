<template>
  <div class="app">
    <header>
      <div><small>COMFYUI · CS-H3</small><h1>任务管理</h1><p>所有已记录任务的归档状态、详情与生成视频。</p></div>
      <nav><a href="/?mode=director">多模式导演台</a><a href="/?mode=nine-images">九图分镜版</a><a class="active" href="/?mode=tasks">任务管理</a><a href="/?mode=system">系统信息</a></nav>
    </header>
    <main>
      <section class="card summary">
        <label class="server">ComfyUI 服务地址<div class="server-picker"><select v-model="selectedServer" aria-label="常用 ComfyUI 服务" @change="chooseServer"><option value="">常用服务</option><option v-for="option in serverOptions" :key="option.url" :value="option.url">{{ option.label }}</option></select><input v-model.trim="server" placeholder="可手动输入 ComfyUI 服务地址" @blur="load" @change="load" @input="onServerInput" /></div><p v-if="serverChecking" class="server-checking">正在检查服务连通性…</p><p v-else-if="serverError" class="server-error" role="alert">{{ serverError }}</p></label>
        <div class="stats">
          <div><strong class="running">{{ running.length }}</strong><span>运行中</span></div>
          <div><strong class="queued">{{ pending.length }}</strong><span>排队中</span></div>
          <div><strong class="completed">{{ completed.length }}</strong><span>已完成</span></div>
          <div><strong class="error">{{ errorCount }}</strong><span>失败</span></div>
        </div>
        <p class="muted">每 5 秒自动刷新（<button class="inline" @click="load">立即刷新</button>）</p>
      </section>

      <section class="card">
        <div class="list-head"><div><h2>任务列表</h2><p class="muted">运行中、排队中、归档状态、已完成和失败的任务统一展示。</p></div><label class="filter">筛选<select v-model="filter"><option value="all">全部任务</option><option value="running">运行中</option><option value="queued">排队中</option><option value="archiving">正在归档</option><option value="archived">已归档</option><option value="archive_failed">归档失败</option><option value="success">仅成功</option><option value="error">仅失败</option></select></label></div>
        <p v-if="!filteredTasks.length" class="muted empty">暂无符合条件的任务。</p>
        <template v-else>
          <div v-for="t in filteredTasks" :key="t.prompt_id" class="task">
            <div class="title">
              <div><h3>任务 {{ t.prompt_id.slice(0, 8) }}</h3><span>生成服务：{{ t.serverName }} · {{ inProgress(t.status) ? '提交时间未知' : `${fmtTime(t.start)} → ${fmtTime(t.end)}（${durText(t)}）` }}</span></div>
              <div class="task-actions"><strong :class="statusClass(t.status)">{{ statusLabel(t.status) }}</strong><button v-if="t.status === 'running' || t.status === 'queued'" class="cancel" type="button" :disabled="cancelling.has(t.prompt_id)" @click="cancelTask(t)">{{ cancelling.has(t.prompt_id) ? '正在取消…' : '取消任务' }}</button></div>
            </div>
            <p><code>{{ t.prompt_id }}</code></p>
            <template v-if="t.videos && t.videos.length">
              <video v-for="(v, i) in t.videos" :key="i" :src="viewUrl(v, t)" controls></video>
              <a v-for="(v, i) in t.videos" :key="'a' + i" :href="viewUrl(v, t)" target="_blank">下载 {{ v.filename }}</a>
            </template>
            <p v-else class="muted">{{ inProgress(t.status) ? '任务处理中，完成后将显示视频。' : '无视频输出' }}</p>
          </div>
        </template>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import serverOptions from './assets/comfyui_servers.json'

const archiveBase=(import.meta.env.VITE_ARCHIVER_URL||'http://192.168.8.231:8610').replace(/\/$/,'')
const server = ref(serverOptions[0].url)
const selectedServer = ref(server.value)
const running = ref([]), pending = ref([]), completed = ref([])
const filter = ref('all')
const cancelling = ref(new Set())
const serverChecking = ref(false)
const serverError = ref('')
let timer = null

const successful = status => ['success', 'completed', 'archived'].includes(status)
const failed = status => ['error', 'failed', 'interrupted', 'archive_failed'].includes(status)
const inProgress = status => ['running', 'queued', 'archiving'].includes(status)
const errorCount = computed(() => completed.value.filter(t => failed(t.status)).length)
const allTasks = computed(() => [...running.value, ...pending.value, ...completed.value].sort((a, b) => {
  if (inProgress(a.status) !== inProgress(b.status)) return inProgress(a.status) ? -1 : 1
  return (b.end || b.start || 0) - (a.end || a.start || 0)
}))
const filteredTasks = computed(() => filter.value === 'all' ? allTasks.value : allTasks.value.filter(t => filter.value === 'success' ? successful(t.status) : filter.value === 'error' ? failed(t.status) : t.status === filter.value))
function statusLabel(status) { return ({ running: '运行中', queued: '排队中', archiving: '正在归档', archived: '已归档', archive_failed: '归档失败', completed: '生成完成', success: '成功', failed: '失败', interrupted: '已中断', error: '失败' })[status] || '处理中' }
function statusClass(status) { return successful(status) ? 'completed' : failed(status) ? 'error' : status }
function setCancelling(promptId, value) {
  const next = new Set(cancelling.value)
  value ? next.add(promptId) : next.delete(promptId)
  cancelling.value = next
}

function viewUrl(v, task) {
  if (v.archive_url && archiveBase) return `${archiveBase}${v.archive_url}`
  return `${task.serverUrl || server.value}/view?${new URLSearchParams({ filename: v.filename, subfolder: v.subfolder || '', type: v.type || 'output' })}`
}
function fmtTime(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}
function durText(t) {
  if (!t.start || !t.end) return '—'
  const toMs = value => typeof value === 'number' ? value : new Date(value).getTime()
  const s = Math.round((toMs(t.end) - toMs(t.start)) / 1000)
  if (!Number.isFinite(s)) return '—'
  return `${Math.floor(s / 60)}分${s % 60}秒`
}
function chooseServer() {
  if (!selectedServer.value) return
  server.value = selectedServer.value
  load()
}
function onServerInput() {
  if (server.value !== selectedServer.value) selectedServer.value = ''
  serverError.value = ''
}
function selectedServerOption() {
  const base = server.value.replace(/\/$/, '')
  return serverOptions.find(option => option.url.replace(/\/$/, '') === base)
}
function archiveTask(task) {
  return {
    prompt_id: task.prompt_id, status: task.status,
    serverName: task.server_label || task.server_id || '未标注服务器', serverUrl: task.server_url || '',
    start: task.started_at || task.submitted_at || null, end: task.finished_at || null,
    videos: (task.output_files || []).filter(file => /\.mp4$/i.test(file.filename || '')),
  }
}
async function cancelTask(task) {
  const action = task.status === 'running' ? '停止正在运行的任务' : '从队列移除任务'
  if (!window.confirm(`确认${action}？\n${task.prompt_id}`)) return
  setCancelling(task.prompt_id, true)
  try {
    const base = task.serverUrl || server.value.replace(/\/$/, '')
    let response = await fetch(`${base}/api/jobs/${encodeURIComponent(task.prompt_id)}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
    if (response.status === 404) {
      response = task.status === 'queued'
        ? await fetch(`${base}/queue`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ delete: [task.prompt_id] }) })
        : await fetch(`${base}/interrupt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    }
    if (!response.ok) throw Error(`取消失败：HTTP ${response.status}`)
    await load()
  } catch (e) {
    window.alert(e.message)
  } finally {
    setCancelling(task.prompt_id, false)
  }
}
async function load() {
  const base = server.value.trim().replace(/\/$/, '')
  if (!base) {
    serverError.value = '请输入 ComfyUI 服务地址。'
    return
  }
  serverChecking.value = true
  try {
    const [statsResult, archivedResult] = await Promise.allSettled([
      fetch(`${base}/system_stats`),
      fetch(`${archiveBase}/api/tasks?limit=1000`),
    ])
    if (archivedResult.status === 'rejected') throw archivedResult.reason
    const archivedResponse = archivedResult.value
    if (!archivedResponse.ok) throw Error(`任务归档服务响应异常：HTTP ${archivedResponse.status}`)
    const archivedTasks = (await archivedResponse.json()).map(archiveTask)
    running.value = archivedTasks.filter(task => task.status === 'running')
    pending.value = archivedTasks.filter(task => task.status === 'queued')
    completed.value = archivedTasks.filter(task => task.status !== 'running' && task.status !== 'queued')
    if (statsResult.status === 'rejected') throw statsResult.reason
    if (!statsResult.value.ok) throw Error(`ComfyUI 接口响应异常：HTTP ${statsResult.value.status}`)
    serverError.value = ''
  } catch (e) {
    console.error('加载任务失败', e)
    serverError.value = `无法连接 ComfyUI 服务地址：${base}（${e.message || '网络请求失败'}）`
  } finally { serverChecking.value = false }
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
.stats { display: flex; flex-wrap: wrap; gap: 24px; margin-bottom: 10px }
.server { display: block; max-width: 620px; color: #c9d5e7; font-size: 13px; margin-bottom: 16px }
.server input, .server select { margin-top: 6px; color: #ecf5ff; background: #0f1725; border: 1px solid #3a4e6d; border-radius: 8px; padding: 9px; font: inherit }
.server-picker { display: flex; gap: 8px }
.server-picker select { width: 220px; flex: none }
.server-picker input { min-width: 0; flex: 1 }
.server-checking, .server-error { margin: 7px 0 0; font-size: 12px }
.server-checking { color: #fde68a }
.server-error { color: #fca5a5 }
.stats div { flex: 0 0 auto; min-width: 58px; text-align: center }
.stats strong { display: block; font-size: 26px; padding: 2px 14px; border-radius: 10px }
.stats span { display: inline-block; color: #9eb0cb; font-size: 13px; white-space: nowrap; word-break: keep-all; writing-mode: horizontal-tb }
strong { padding: 5px 10px; border-radius: 99px; font-size: 12px; display: inline-block }
.queued { color: #fde68a; background: #41381d }
.running { color: #7dd3fc; background: #173c55 }
.archiving { color: #c4b5fd; background: #312e81 }
.completed { color: #86efac; background: #163827 }
.error { color: #fca5a5; background: #4b2029 }
button.inline { width: auto; margin: 0 0 0 8px; padding: 3px 10px; border-radius: 6px; font-size: 12px; font-weight: 600; color: #7dd3fc; background: #173c55; border: 1px solid #2a3a53; cursor: pointer }
table { width: 100%; border-collapse: collapse; margin-top: 10px }
th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid #2a3a53; font-size: 13px }
th { color: #7dd3fc; font-weight: 600 }
code { color: #c9d5e7; font-size: 12px; word-break: break-all }
.filter { display: inline-block; margin: 0 0 12px }
.filter select { width: auto; display: inline; margin-left: 8px }
.list-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 18px; flex-wrap: wrap }
.list-head .filter { margin: 0 }
.empty { padding: 28px 0 8px }
.task { background: #111a28; border: 1px solid #2a3a53; border-radius: 11px; padding: 14px; margin-top: 12px }
.title { display: flex; justify-content: space-between; gap: 14px; align-items: center; flex-wrap: wrap }
.task-actions { display: flex; align-items: center; gap: 8px }
.task-actions strong { white-space: nowrap; word-break: keep-all; writing-mode: horizontal-tb }
.cancel { padding: 5px 10px; border: 1px solid #71323d; border-radius: 99px; color: #fecaca; background: #3f1d1d; font: inherit; font-size: 12px; cursor: pointer }
.cancel:disabled { opacity: .55; cursor: wait }
.title h3 { margin: 0; font-size: 15px; color: #7dd3fc }
.title span { color: #9eb0cb; font-size: 12px }
video { display: block; width: 320px; max-width: 100%; background: #000; border-radius: 8px; margin-top: 10px }
a { display: inline-block; margin-top: 8px; color: #7dd3fc; margin-right: 14px }
</style>
