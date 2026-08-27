<template>
  <div class="app">
    <header>
      <div><small>COMFYUI · CS-H3</small><h1>CS-H3 多模态参考导演台</h1><p>批量调用 CS-H3 导演台工作流，经 SwarmUI 队列分发到 4 实例并行。</p></div>
      <nav><a href="/?mode=storyboard">九宫格分镜生成</a><a href="/?mode=i2v">I2V 首帧生视频</a><a href="/?mode=director">多模式导演台</a><a href="/?mode=nine-images">九图分镜版</a><a class="active" href="/?mode=csh3">CS-H3 导演台</a><a href="/?mode=tasks">任务管理</a><a href="/?mode=system">系统信息</a></nav>
    </header>
    <main>
      <section class="card settings">
        <h2>工作流参数</h2>
        <label>服务地址<input v-model.trim="server" /></label>
        <div class="params">
          <label>任务数量<input v-model.number="count" type="number" min="1" max="20" /></label>
          <label>时长（秒）<input v-model.number="duration" type="number" min="4" max="15" step="0.5" /></label>
          <label>输出像素 MP<input v-model.number="mp" type="number" min="0.1" max="16" step="0.1" /></label>
          <label>seed 策略<select v-model="seedMode"><option value="random">随机（每任务不同）</option><option value="fixed">固定</option></select></label>
          <label v-if="seedMode === 'fixed'">固定 seed<input v-model.number="seed" type="number" /></label>
        </div>
        <label>全局提示词<textarea v-model="globalPrompt" rows="12" /></label>
        <button :disabled="running" @click="submitBatch">{{ running ? '批量生成中…' : '批量提交任务' }}</button>
        <p class="muted">提示：并发上限 3（内存保护），批量任务会自动排队；每条真实生成约 30 分钟。</p>
      </section>
      <section class="card result">
        <h2>任务列表</h2>
        <p v-if="!jobs.length" class="muted">尚未提交任务。</p>
        <article v-for="(j, i) in jobs" :key="i">
          <div class="title"><div><h3>任务 {{ i + 1 }}</h3></div><strong :class="j.status">{{ statusName(j.status) }}</strong></div>
          <p><code>{{ j.id || '…' }}</code></p>
          <pre>{{ j.log }}</pre>
          <video v-if="j.video" :src="j.video" controls></video>
          <a v-if="j.video" :href="j.video" target="_blank">打开 / 下载结果</a>
        </article>
      </section>
    </main>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const server = ref('/comfy')
const promptUrl = ref('/cs-h3-prompt.json')
const count = ref(1), duration = ref(10), mp = ref(0.4), seedMode = ref('random'), seed = ref(666)
const globalPrompt = ref('')
const jobs = ref([]), running = ref(false)

const statusName = s => ({ uploading: '上传中', queued: '等待中', running: '生成中', completed: '已完成', error: '失败' }[s] || '处理中')

async function loadTemplate() {
  const r = await fetch(promptUrl.value)
  if (!r.ok) throw Error(`加载工作流模板失败：HTTP ${r.status}`)
  return await r.json()
}
function director(w) {
  const n = Object.values(w).find(n => n.class_type === 'CSH3MultimodalDirector')
  if (!n) throw Error('未找到 CSH3MultimodalDirector 节点')
  return n.inputs
}
function applyParams(w) {
  const d = director(w), t = JSON.parse(d.timeline_data)
  d.duration_seconds = duration.value
  d.output_megapixels = mp.value
  d.global_prompt = globalPrompt.value
  t.globalPrompt = globalPrompt.value
  if (t.output) t.output.megapixels = mp.value
  d.timeline_data = JSON.stringify(t)
  const noise = Object.values(w).find(n => n.class_type === 'RandomNoise')
  if (noise) noise.inputs.noise_seed = seedMode.value === 'fixed' ? seed.value : Math.floor(Math.random() * 2 ** 53)
  return w
}
async function submitOne() {
  const w = applyParams(await loadTemplate())
  const r = await fetch(`${server.value}/prompt`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: w }) })
  const data = await r.json()
  if (!r.ok || data.error) throw Error(data.error?.message || data.error || `提交失败：HTTP ${r.status}`)
  return data.prompt_id
}
async function poll(id, j) {
  try {
    const r = await fetch(`${server.value}/history/${id}`), data = await r.json(), entry = data[id]
    if (!entry) { j.status = 'queued'; setTimeout(() => poll(id, j), 3000) }
    else if (entry.status?.status_str === 'error') { j.status = 'error'; j.log += '\n执行失败' }
    else if (entry.status?.completed) { j.status = 'completed'; j.video = out(entry.outputs || {}); j.log += j.video ? '\n视频已生成。' : '\n完成（无视频输出）' }
    else { j.status = 'running'; j.log = '生成中（约 30 分钟）…'; setTimeout(() => poll(id, j), 3000) }
  } catch (e) { j.status = 'error'; j.log += `\n${e.message}` }
}
function out(outputs) {
  for (const n of Object.values(outputs)) for (const k of ['images', 'gifs', 'videos']) {
    const f = n[k]?.find(x => x.filename)
    if (f) return `${server.value}/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || '', type: f.type || 'output' })}`
  }
  return ''
}
async function submitBatch() {
  if (!globalPrompt.value.trim()) return alert('请填写全局提示词')
  running.value = true; jobs.value = []
  for (let i = 0; i < count.value; i++) {
    const j = { status: 'queued', id: '', log: `提交任务 ${i + 1}/${count.value}…`, video: '' }
    jobs.value.push(j)
    try { j.id = await submitOne(); j.log = `任务已提交：${j.id}`; poll(j.id, j) }
    catch (e) { j.status = 'error'; j.log += `\n${e.message}` }
    await new Promise(r => setTimeout(r, 800))
  }
  running.value = false
}
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap');
:global(:root) { font-family: Inter, system-ui, "Microsoft YaHei", sans-serif; color: #e7edf7; background: #101825 }
:global(body) { margin: 0 }
.app { max-width: 1450px; margin: auto; padding: 30px }
header { display: flex; justify-content: space-between; gap: 20px; margin: 10px 0 28px }
small { color: #7dd3fc; letter-spacing: .12em; font-weight: 700 }
h1 { margin: 8px 0; font-size: 32px }
h2 { margin: 0 0 10px; font-size: 18px }
p, .muted { color: #9eb0cb; margin: 0 }
nav { display: flex; gap: 8px; height: max-content; flex-wrap: wrap }
nav a { color: #c9d5e7; text-decoration: none; padding: 8px 11px; border: 1px solid #2a3a53; border-radius: 8px; font-size: 13px; white-space: nowrap }
nav .active { color: #062034; background: #67e8f9; border-color: #67e8f9 }
main { display: grid; grid-template-columns: 360px 1fr; gap: 20px }
.card { background: #172233; border: 1px solid #2a3a53; border-radius: 16px; padding: 22px; box-shadow: 0 16px 40px #0002 }
.settings { grid-row: span 2 }
label { display: block; color: #c9d5e7; font-size: 13px; font-weight: 600; margin-top: 13px }
input, select, textarea { width: 100%; margin-top: 6px; color: #ecf5ff; background: #0f1725; border: 1px solid #3a4e6d; border-radius: 8px; padding: 9px; font: inherit }
textarea { resize: vertical }
.params { display: grid; grid-template-columns: 1fr 1fr; gap: 0 10px }
button { width: 100%; margin-top: 18px; border: 0; padding: 13px; border-radius: 10px; font-size: 15px; font-weight: 700; color: #062034; background: linear-gradient(90deg, #67e8f9, #38bdf8); cursor: pointer }
button:disabled { opacity: .55; cursor: wait }
article { background: #111a28; border: 1px solid #2a3a53; border-radius: 11px; padding: 14px; margin-top: 14px }
strong { padding: 5px 10px; border-radius: 99px; font-size: 12px }
.queued { color: #fde68a; background: #41381d }
.running { color: #7dd3fc; background: #173c55 }
.completed { color: #86efac; background: #163827 }
.error { color: #fca5a5; background: #4b2029 }
code { margin-left: 10px; color: #c9d5e7; font-size: 12px; word-break: break-all }
pre { white-space: pre-wrap; background: #0d1420; border: 1px solid #293950; padding: 12px; border-radius: 8px; font-size: 12px; max-height: 120px; overflow: auto }
video { display: block; width: 100%; background: #000; border-radius: 10px; margin-top: 14px }
a { display: inline-block; margin-top: 12px; color: #7dd3fc }
</style>
