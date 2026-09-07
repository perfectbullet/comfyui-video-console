<template>
  <div class="app">
    <header><div><small>COMFYUI · MINIMAX H3</small><h1>I2V 首帧生视频</h1><p>上传首帧图片与提示词，直接提交 MiniMax H3 I2V 工作流。</p></div><nav><a href="/?mode=director">多模式导演台</a><a href="/?mode=nine-images">九图分镜版</a><a href="/?mode=tasks">任务管理</a><a href="/?mode=system">系统信息</a></nav></header>
    <main class="layout">
      <section class="card form"><h2>生成设置</h2>
        <label>ComfyUI 服务地址<input v-model.trim="server" /></label>
        <label>首帧图片 <em>必选</em><input type="file" accept="image/*" @change="selectImage" /></label><img v-if="preview" :src="preview" class="preview" alt="首帧预览" />
        <label>提示词<textarea v-model="prompt" rows="10" /></label>
        <div class="params"><label>时长（秒）<input v-model.number="duration" type="number" min="2" max="15" step=".5" /></label><label>宽高比<select v-model="aspect"><option v-for="x in ratios" :key="x">{{ x }}</option></select></label><label>像素（MP）<input v-model.number="megapixels" type="number" min=".2" max="2" step=".1" /></label><label>对齐倍数<select v-model.number="multiple"><option :value="16">16</option><option :value="32">32</option><option :value="64">64</option></select></label></div>
        <button :disabled="running" @click="submit">{{ running ? '生成中…' : '生成视频' }}</button>
      </section>
      <section class="card result"><h2>任务状态</h2><p v-if="!job" class="muted">尚未提交任务。</p><template v-else><p><strong :class="job.status">{{ statusName }}</strong> <code>{{ job.id || '正在上传…' }}</code></p><pre>{{ job.log }}</pre><video v-if="job.video" :src="job.video" controls></video><a v-if="job.video" :href="job.video" target="_blank">打开 / 下载结果</a></template></section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import workflowTemplate from './assets/default_workflow.json'
const server=ref('http://192.168.8.231:8188'), image=ref(null), preview=ref(''), prompt=ref(''), duration=ref(5), aspect=ref('2:3 (Portrait Photo)'), megapixels=ref(.4), multiple=ref(32), running=ref(false), job=ref(null)
const ratios=['1:1 (Square)','2:3 (Portrait Photo)','3:2 (Landscape Photo)','4:5 (Portrait)','16:9 (Widescreen)']
const statusName=computed(()=>({uploading:'上传中',queued:'等待中',running:'生成中',completed:'已完成',error:'失败'}[job.value?.status]||'处理中'))
function selectImage(e){const f=e.target.files?.[0];if(f){image.value=f;preview.value=URL.createObjectURL(f)}}
async function upload(){const body=new FormData();body.append('image',image.value,image.value.name);body.append('overwrite','true');const r=await fetch(`${server.value}/upload/image`,{method:'POST',body});if(!r.ok)throw Error(`上传失败：HTTP ${r.status}`);return r.json()}
function workflow(name){const w=structuredClone(workflowTemplate);for(const node of Object.values(w)){if(node.class_type==='LoadImage')node.inputs.image=name;if(node.class_type==='MiniMaxH3ImageToVideo')node.inputs.prompt=prompt.value;if(node.class_type==='ResolutionSelector'){node.inputs.aspect_ratio=aspect.value;node.inputs.megapixels=megapixels.value;node.inputs.multiple=multiple.value}if(node.class_type==='PrimitiveFloat'&&node._meta?.title==='Float (duration)')node.inputs.value=duration.value}return w}
async function submit(){if(!image.value)return alert('请上传首帧图片');if(!prompt.value.trim())return alert('请填写提示词');running.value=true;job.value={status:'uploading',id:'',log:'正在上传首帧图片…',video:''};try{const file=await upload(),r=await fetch(`${server.value}/prompt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:workflow(file.name)})}),data=await r.json();if(!r.ok||data.error)throw Error(data.error?.message||data.error||`提交失败：HTTP ${r.status}`);job.value={status:'queued',id:data.prompt_id,log:`任务已提交：${data.prompt_id}`,video:''};poll()}catch(e){job.value.status='error';job.value.log+=`\n错误：${e.message}`;running.value=false}}
async function poll(){try{const r=await fetch(`${server.value}/history/${job.value.id}`),data=await r.json(),entry=data[job.value.id];if(!entry){job.value.status='queued';job.value.log+='\n等待 GPU 调度…'}else if(entry.status?.status_str==='error')throw Error('ComfyUI 执行失败');else if(entry.status?.completed){job.value.status='completed';job.value.video=output(entry.outputs||{});job.value.log+=job.value.video?'\n视频已生成。':'\n执行完成，但未找到视频输出。';running.value=false;return}else{job.value.status='running';job.value.log+='\n正在生成…'}setTimeout(poll,2500)}catch(e){job.value.status='error';job.value.log+=`\n错误：${e.message}`;running.value=false}}
function output(outputs){for(const node of Object.values(outputs))for(const key of ['images','gifs','videos']){const f=node[key]?.find(x=>x.filename);if(f)return `${server.value}/view?${new URLSearchParams({filename:f.filename,subfolder:f.subfolder||'',type:f.type||'output'})}`}return ''}
</script>