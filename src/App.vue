<template>
  <div class="app">
    <header><div><small>COMFYUI · CS-H3</small><h1>九宫格分镜视频生成</h1><p>上传 3×3 故事板，生成一段连续的电影级短视频。</p></div><nav><a class="active" href="/?mode=storyboard">九宫格分镜生成</a><a href="/?mode=i2v">I2V 首帧生视频</a><a href="/?mode=director">多模式导演台</a><a href="/?mode=nine-images">九图分镜版</a><a href="/?mode=csh3">CS-H3 导演台</a><a href="/?mode=tasks">任务管理</a><a href="/?mode=system">系统信息</a></nav></header>
    <main>
      <section class="card settings">
        <h2>生成设置</h2>
        <label>ComfyUI 服务地址<input v-model.trim="server" /></label>
        <label>九宫格分镜图 <em>必选</em><input type="file" accept="image/png,image/jpeg,image/webp" @change="onGridImage" /></label>
        <img v-if="gridPreview" :src="gridPreview" class="preview" alt="九宫格预览" />
        <div class="params">
          <label>目标时长（秒）<input v-model.number="duration" type="number" min="1" max="30" step=".5" /></label>
          <label>输出比例<select v-model="aspectRatio"><option>自动</option><option>16:9</option><option>9:16</option><option>1:1</option></select></label>
          <label>宫格格式<select v-model="gridLayout"><option>3x3 九宫格</option></select></label>
          <label>输出像素规模（MP）<input v-model.number="megapixels" type="number" min=".2" max="1.5" step=".1" /></label>
          <label>尺寸对齐倍数<select v-model.number="resolutionMultiple"><option :value="16">16</option><option :value="32">32</option><option :value="64">64</option></select></label>
        </div>
        <label>全局创作要求<textarea v-model="globalPrompt" rows="14" /></label>
      </section>
      <section class="card storyboard">
        <div class="title"><div><h2>九格分镜提示词</h2><p>每一格可以补充独立的动作、镜头或音效要求。</p></div><span>{{ filled }}/9 已填写</span></div>
        <div class="shots"><label v-for="(_, i) in prompts" :key="i">分镜 {{ i + 1 }}<textarea v-model="prompts[i]" rows="4" :placeholder="`第 ${i + 1} 格的补充提示词`" /></label></div>
        <button :disabled="running" @click="submit">{{ running ? '正在生成…' : '生成连续视频' }}</button>
      </section>
      <section class="card result"><h2>任务状态</h2><p v-if="!job" class="muted">尚未提交任务。</p><template v-else><p><strong :class="job.status">{{ statusName }}</strong> <code>{{ job.id || '正在上传…' }}</code></p><pre>{{ job.log }}</pre><video v-if="job.video" :src="job.video" controls></video><a v-if="job.video" :href="job.video" target="_blank">打开 / 下载结果</a></template></section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import workflowTemplate from './assets/cs_h3_9panel_storyboard.api.json'

const defaultPrompt = `以用户上传的九格分镜图作为精确的视觉参考。创作一个单一连续的电影级镜头：黄金时刻的红土球场网球比赛。按照分镜图从左到右、从上到下的顺序，作为一个流畅不间断的连续序列呈现。

一名身穿黄色 polo 衫、黄色短裤、戴着运动太阳镜的黑人男性球员，对阵一名梳着辫子、身穿米色背心和浅蓝色网球裙的女性球员。请严格保持图中所示的面容、服装、球场、光线和色调。

画面应自然地依次呈现以下时刻：

1. 男性球员高压扣杀
2. 女性球员横穿球场疾跑
3. 男性球员反手随挥动作
4. 男性球员太阳镜与汗水的特写
5. 女性球员跃起击球
6. 女性球员正手击球触到黄色网球的瞬间
7. 男性球员在红土上低弓步救球
8. 双方球员在网前相遇握手

电影级体育影片风格，黄金时刻的阳光，暖橙色调，照片级写实，锐利对焦，浅景深，流畅的斯坦尼康运镜，无镜头切换，无文字，无标识，无转播图形。`
const server=ref('http://192.168.8.231:8188'), gridFile=ref(null), gridPreview=ref('')
const duration=ref(10), aspectRatio=ref('自动'), gridLayout=ref('3x3 九宫格'), megapixels=ref(.4), resolutionMultiple=ref(32), globalPrompt=ref(defaultPrompt), prompts=ref(Array(9).fill(''))
const running=ref(false), job=ref(null), filled=computed(()=>prompts.value.filter(x=>x.trim()).length)
const statusName=computed(()=>({uploading:'上传中',queued:'等待中',running:'生成中',completed:'已完成',error:'失败'}[job.value?.status]||'处理中'))

function onGridImage(e){const f=e.target.files?.[0];if(f){gridFile.value=f;gridPreview.value=URL.createObjectURL(f)}}
function director(w){const n=Object.values(w).find(n=>n.class_type==='CSH3MultimodalDirector');if(!n)throw Error('未找到 CSH3MultimodalDirector 节点');return n.inputs}
async function dimensions(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight}}finally{URL.revokeObjectURL(url)}}
async function upload(){const body=new FormData();body.append('image',gridFile.value,gridFile.value.name);body.append('overwrite','true');const r=await fetch(`${server.value}/upload/image`,{method:'POST',body});if(!r.ok)throw Error(`上传失败：HTTP ${r.status}`);return r.json()}
async function workflow(file){const w=structuredClone(workflowTemplate),i=director(w),t=JSON.parse(i.timeline_data),size=await dimensions(gridFile.value);i.duration_seconds=duration.value;i.aspect_ratio=aspectRatio.value;i.grid_layout=gridLayout.value;i.output_megapixels=megapixels.value;i.resolution_multiple=resolutionMultiple.value;i.global_prompt=globalPrompt.value;t.globalPrompt=globalPrompt.value;t.gridImage={file:file.name,name:gridFile.value.name,...size};t.items.forEach((item,index)=>{item.start=index*duration.value/9;item.duration=duration.value/9;item.prompt=prompts.value[index]});i.timeline_data=JSON.stringify(t);return w}
async function submit(){if(!gridFile.value)return alert('请上传九宫格分镜图');if(!globalPrompt.value.trim())return alert('请填写全局创作要求');running.value=true;job.value={status:'uploading',id:'',log:'正在上传九宫格分镜图…',video:''};try{const file=await upload();job.value.log+=`\n上传成功：${file.name}`;const w=await workflow(file);const r=await fetch(`${server.value}/prompt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:w})});const data=await r.json();if(!r.ok||data.error)throw Error(data.error?.message||data.error||`提交失败：HTTP ${r.status}`);job.value={status:'queued',id:data.prompt_id,log:`任务已提交：${data.prompt_id}`,video:''};poll()}catch(e){job.value.status='error';job.value.log+=`\n错误：${e.message}`;running.value=false}}
async function poll(){try{const r=await fetch(`${server.value}/history/${job.value.id}`),data=await r.json(),entry=data[job.value.id];if(!entry){job.value.status='queued';job.value.log+='\n等待 GPU 调度…'}else if(entry.status?.status_str==='error'){throw Error('ComfyUI 执行失败')}else if(entry.status?.completed){job.value.status='completed';job.value.video=output(entry.outputs||{});job.value.log+=job.value.video?'\n视频已生成。':'\n执行完成，但未找到视频输出。';running.value=false;return}else{job.value.status='running';job.value.log+='\n正在生成…'}setTimeout(poll,2500)}catch(e){job.value.status='error';job.value.log+=`\n错误：${e.message}`;running.value=false}}
function output(outputs){for(const node of Object.values(outputs))for(const key of ['images','gifs','videos']){const f=node[key]?.find(x=>x.filename);if(f)return `${server.value}/view?${new URLSearchParams({filename:f.filename,subfolder:f.subfolder||'',type:f.type||'output'})}`}return ''}
</script>

<style>
:root{font-family:Inter,system-ui,"Microsoft YaHei",sans-serif;color:#e7edf7;background:#101825}*{box-sizing:border-box}body{margin:0}.app{max-width:1450px;margin:auto;padding:30px}header{display:flex;justify-content:space-between;gap:20px;margin:10px 0 28px}header small{color:#7dd3fc;letter-spacing:.12em;font-weight:700}h1{margin:8px 0;font-size:32px}h2{margin:0 0 12px;font-size:18px}header p,.title p,.muted{color:#9eb0cb;margin:0}header b{height:max-content;color:#bbf7d0;background:#163827;border:1px solid #2c6949;padding:8px 12px;border-radius:99px;font-size:13px}main{display:grid;grid-template-columns:390px 1fr;gap:20px}.card{background:#172233;border:1px solid #2a3a53;border-radius:16px;padding:22px;box-shadow:0 16px 40px #0002}.settings{grid-row:span 2}.result{grid-column:2}label{display:block;color:#c9d5e7;font-size:13px;font-weight:600;margin-top:14px}em{color:#fbbf24;font-style:normal}input,select,textarea{width:100%;margin-top:7px;color:#ecf5ff;background:#0f1725;border:1px solid #3a4e6d;border-radius:8px;padding:10px;font:inherit}textarea{resize:vertical;line-height:1.45}.params{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.preview{width:100%;max-height:235px;object-fit:contain;margin-top:10px;background:#0b1019;border:1px solid #3a4e6d;border-radius:10px}.title{display:flex;justify-content:space-between;gap:15px}.title span{color:#7dd3fc;font-size:13px;white-space:nowrap}.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.shots label{margin:0;padding:10px;background:#111a28;border:1px solid #2a3a53;border-radius:10px;color:#7dd3fc}.shots textarea{min-height:88px;font-size:13px}button{width:100%;margin-top:20px;border:0;padding:13px;border-radius:10px;font-size:15px;font-weight:700;color:#062034;background:linear-gradient(90deg,#67e8f9,#38bdf8);cursor:pointer}button:disabled{opacity:.55;cursor:wait}strong{padding:5px 10px;border-radius:99px;font-size:12px}.uploading,.queued{color:#fde68a;background:#41381d}.running{color:#7dd3fc;background:#173c55}.completed{color:#86efac;background:#163827}.error{color:#fca5a5;background:#4b2029}code{margin-left:10px;color:#c9d5e7;font-size:12px;word-break:break-all}pre{white-space:pre-wrap;background:#0d1420;border:1px solid #293950;padding:12px;border-radius:8px;font-size:12px;max-height:180px;overflow:auto}.result video{display:block;width:100%;max-width:680px;background:#000;border-radius:10px;margin-top:14px}.result a{display:inline-block;margin-top:12px;color:#7dd3fc}nav{display:flex;gap:8px;height:max-content;flex-wrap:wrap}nav a{color:#c9d5e7;text-decoration:none;padding:8px 11px;border:1px solid #2a3a53;border-radius:8px;font-size:13px;white-space:nowrap}nav a.active{color:#062034;background:#67e8f9;border-color:#67e8f9}@media(max-width:980px){main{grid-template-columns:1fr}.settings,.result{grid-row:auto;grid-column:auto}}@media(max-width:650px){.app{padding:18px}header{display:block}header b{display:inline-block;margin-top:14px}.shots,.params{grid-template-columns:1fr}}
</style>
