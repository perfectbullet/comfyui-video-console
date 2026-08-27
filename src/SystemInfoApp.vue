<template>
  <div class="app">
    <header><div><small>COMFYUI · CS-H3</small><h1>系统信息</h1><p>查看 ComfyUI 运行状态与显存占用，并手动释放显存（卸载模型 + 清空缓存）。</p></div><nav><a href="/?mode=storyboard">九宫格分镜生成</a><a href="/?mode=i2v">I2V 首帧生视频</a><a href="/?mode=director">多模式导演台</a><a href="/?mode=nine-images">九图分镜版</a><a href="/?mode=tasks">任务管理</a><a class="active" href="/?mode=system">系统信息</a></nav></header>
    <main class="layout">
      <section class="card settings">
        <h2>服务与刷新</h2>
        <label>ComfyUI 服务地址<input v-model.trim="server" /></label>
        <div class="row">
          <button class="ghost" :disabled="loading" @click="refresh">{{ loading ? '刷新中…' : '立即刷新' }}</button>
          <label class="check"><input type="checkbox" v-model="auto" /> 每 {{ interval / 1000 }} 秒自动刷新</label>
        </div>
        <p class="muted" v-if="updatedAt">最近更新：{{ updatedAt }}</p>
        <div class="free-block">
          <h3>显存管理</h3>
          <p class="muted">工作流跑完后模型会<b>常驻显存</b>以便复用（ComfyUI 缓存机制）。点击下方按钮可卸载全部模型并清空缓存。</p>
          <button class="danger" :disabled="freeing" @click="freeVram">{{ freeing ? '释放中…' : '释放显存' }}</button>
          <p v-if="freeMsg" :class="['msg', freeOk ? 'ok' : 'err']">{{ freeMsg }}</p>
          <p class="muted small">释放请求发出后，ComfyUI 需要几秒到几十秒完成模型卸载与缓存回收，显存数字会随后续刷新逐步下降；期间请不要提交新任务。</p>
        </div>
      </section>
      <section class="card sys">
        <h2>系统概况</h2>
        <p v-if="!stats" class="muted">加载中…（或检查服务地址是否可达）</p>
        <template v-else>
          <div class="kv"><span>ComfyUI 版本</span><b>{{ sys.comfyui_version || '—' }}</b></div>
          <div class="kv"><span>PyTorch</span><b>{{ sys.pytorch_version || '—' }}</b></div>
          <div class="kv"><span>Python</span><b>{{ (sys.python_version || '—').split(' (')[0] }}</b></div>
          <div class="kv"><span>操作系统</span><b>{{ sys.os === 'linux' ? 'Linux' : sys.os }}</b></div>
          <div class="kv"><span>任务队列</span><b :class="queueBusy ? 'warn' : 'ok-text'">运行中 {{ queue.running }} · 排队 {{ queue.pending }}</b></div>
          <div class="mem">
            <div class="mem-head"><span>内存（RAM）</span><span>{{ gb(ramUsed) }} / {{ gb(sys.ram_total) }} GB</span></div>
            <div class="bar"><i :style="{ width: pct(ramUsed, sys.ram_total) + '%' }" class="ram" /></div>
          </div>
        </template>
      </section>
      <section class="card dev">
        <h2>GPU 设备</h2>
        <p v-if="!stats" class="muted">加载中…</p>
        <div v-for="d in devices" :key="d.index" class="device">
          <div class="dev-head"><b>{{ d.name }}</b><span class="pill">{{ d.type }} · #{{ d.index }}</span></div>
          <div class="mem">
            <div class="mem-head"><span>显存（VRAM）</span><span>{{ gb(vramUsed(d)) }} / {{ gb(d.vram_total) }} GB（空闲 {{ gb(d.vram_free) }} GB）</span></div>
            <div class="bar"><i :style="{ width: pct(vramUsed(d), d.vram_total) + '%' }" class="vram" /></div>
          </div>
          <p class="muted small">占用为整卡口径（含本机其他进程）；释放显存只作用于 ComfyUI 进程。</p>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

const server=ref('http://192.168.8.231:8188')
const stats=ref(null), queue=ref({running:0,pending:0}), loading=ref(false)
const auto=ref(true), interval=5000, timer=ref(0), updatedAt=ref('')
const freeing=ref(false), freeMsg=ref(''), freeOk=ref(false)

const sys=computed(()=>stats.value?.system||{})
const devices=computed(()=>stats.value?.devices||[])
const ramUsed=computed(()=>{const s=sys.value;return s.ram_total&&s.ram_free!=null?s.ram_total-s.ram_free:0})
const queueBusy=computed(()=>queue.value.running>0||queue.value.pending>0)
const vramUsed=d=>d.vram_total&&d.vram_free!=null?d.vram_total-d.vram_free:0
const gb=n=>(n/1024**3).toFixed(1)
const pct=(a,b)=>b?Math.min(100,Math.max(0,a/b*100)):0

async function refresh(){
  loading.value=true
  try{
    const [rs,rq]=await Promise.all([
      fetch(`${server.value}/system_stats`),
      fetch(`${server.value}/queue`)
    ])
    if(!rs.ok)throw Error(`system_stats HTTP ${rs.status}`)
    stats.value=await rs.json()
    if(rq.ok){
      const q=await rq.json()
      queue.value={running:(q.queue_running||[]).length,pending:(q.queue_pending||[]).length}
    }
    updatedAt.value=new Date().toLocaleTimeString()
  }catch(e){
    stats.value=null;updatedAt.value=''
    freeMsg.value=`状态获取失败：${e.message}`;freeOk.value=false
  }finally{loading.value=false}
}

async function freeVram(){
  if(queueBusy.value&&!confirm(`当前有 ${queue.value.running} 个任务运行中、${queue.value.pending} 个排队中。\n释放显存会在任务间隙执行模型卸载，可能影响后续任务速度。确定继续吗？`))return
  freeing.value=true;freeMsg.value='';freeOk.value=false
  try{
    const r=await fetch(`${server.value}/free`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({unload_models:true,free_memory:true})})
    if(!r.ok)throw Error(`HTTP ${r.status}`)
    freeOk.value=true
    freeMsg.value='释放请求已发送（接口立即返回）。模型卸载 + 缓存回收是异步进行的，请在下方观察显存数字逐步下降。'
    setTimeout(refresh,2000);setTimeout(refresh,6000);setTimeout(refresh,15000)
  }catch(e){
    freeMsg.value=`释放请求失败：${e.message}`;freeOk.value=false
  }finally{freeing.value=false}
}

function tick(){if(auto.value)refresh()}
onMounted(()=>{refresh();timer.value=setInterval(tick,interval)})
onBeforeUnmount(()=>clearInterval(timer.value))
</script>

<style>
:root{font-family:Inter,system-ui,"Microsoft YaHei",sans-serif;color:#e7edf7;background:#101825}*{box-sizing:border-box}body{margin:0}.app{max-width:1250px;margin:auto;padding:30px}header{display:flex;justify-content:space-between;gap:20px;margin:10px 0 28px}header small{color:#7dd3fc;letter-spacing:.12em;font-weight:700}h1{margin:8px 0;font-size:32px}h2{margin:0 0 12px;font-size:18px}h3{margin:0 0 8px;font-size:15px}header p,.muted{color:#9eb0cb;margin:0}nav{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}nav a{color:#c9d5e7;text-decoration:none;font-size:13px;font-weight:600;padding:8px 12px;border-radius:99px;border:1px solid #2a3a53;white-space:nowrap}nav a.active{color:#062034;background:linear-gradient(90deg,#67e8f9,#38bdf8);border-color:transparent}.layout{display:grid;grid-template-columns:390px 1fr 1fr;gap:20px;align-items:start}.card{background:#172233;border:1px solid #2a3a53;border-radius:16px;padding:22px;box-shadow:0 16px 40px #0002}label{display:block;color:#c9d5e7;font-size:13px;font-weight:600;margin-top:14px}input:not([type=checkbox]){width:100%;margin-top:7px;color:#ecf5ff;background:#0f1725;border:1px solid #3a4e6d;border-radius:8px;padding:10px;font:inherit}.row{display:flex;gap:12px;align-items:center;margin-top:14px}.check{display:flex;align-items:center;gap:7px;margin:0;font-weight:400;color:#9eb0cb}.check input{margin:0}.free-block{margin-top:22px;padding:16px;background:#0e1726;border:1px dashed #3a5c8a;border-radius:10px}.free-block .muted{font-size:13px;line-height:1.5}.free-block b{color:#7dd3fc}.small{font-size:12px;line-height:1.5;margin-top:8px}button{border:0;padding:12px;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;width:100%}button.ghost{background:#1b2c46;color:#9ec5fd;border:1px solid #33517c;width:auto;padding:10px 16px}button.danger{margin-top:12px;background:linear-gradient(90deg,#f87171,#ef4444);color:#fff}button:disabled{opacity:.55;cursor:wait}.msg{margin:10px 0 0;padding:10px;border-radius:8px;font-size:13px;line-height:1.5}.msg.ok{color:#bbf7d0;background:#163827;border:1px solid #2c6949}.msg.err{color:#fecaca;background:#3f1d1d;border:1px solid #6b2c2c}.kv{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-bottom:1px solid #223048;font-size:13px}.kv span{color:#9eb0cb}.kv b{color:#ecf5ff;font-weight:600}.ok-text{color:#bbf7d0}.warn{color:#fde68a}.mem{margin-top:16px}.mem-head{display:flex;justify-content:space-between;font-size:13px;color:#c9d5e7;margin-bottom:7px}.bar{height:12px;background:#0b1019;border:1px solid #2a3a53;border-radius:99px;overflow:hidden}.bar i{display:block;height:100%;border-radius:99px}.bar .ram{background:linear-gradient(90deg,#67e8f9,#38bdf8)}.bar .vram{background:linear-gradient(90deg,#fbbf24,#f59e0b)}.device{padding:14px;background:#111a28;border:1px solid #2a3a53;border-radius:12px;margin-top:12px}.device:first-of-type{margin-top:0}.dev-head{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:4px}.dev-head b{font-size:14px}.pill{color:#7dd3fc;background:#132743;border:1px solid #2a3a53;padding:3px 10px;border-radius:99px;font-size:12px;white-space:nowrap}
</style>
