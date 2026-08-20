<template>
  <div class="app">
    <header><div><small>COMFYUI · CS-H3</small><h1>九宫格分镜视频生成（九图版）</h1><p>上传 9 张独立分镜图片，作为同一条 CSH3MultimodalDirector 时间线，生成一段完整 MP4。</p></div><nav><a href="/?mode=storyboard">九宫格分镜生成</a><a href="/?mode=i2v">I2V 首帧生视频</a><a href="/?mode=director">多模式导演台</a><a class="active" href="/?mode=nine-images">九图分镜版</a><a href="/?mode=system">系统信息</a></nav></header>
    <main>
      <section class="card settings">
        <h2>生成设置</h2>
        <label>ComfyUI 服务地址<input v-model.trim="server" /></label>
        <div class="params">
          <label>输出比例<select v-model="aspectRatio"><option>自动</option><option>21:9 超宽屏</option><option>16:9 横屏</option><option>4:3 横屏</option><option>1:1 方形</option><option>3:4 竖屏</option><option>9:16 竖屏</option></select></label>
          <label>宫格格式<select v-model="gridLayout"><option>3x3 九宫格</option></select></label>
          <label>输出像素规模（MP）<input v-model.number="megapixels" type="number" min=".1" max="16" step=".1" /></label>
          <label>尺寸对齐倍数<select v-model.number="resolutionMultiple"><option :value="16">16</option><option :value="32">32</option><option :value="64">64</option></select></label>
        </div>
        <label>全局创作要求<textarea v-model="globalPrompt" rows="12" placeholder="整体风格、镜头语言、连贯性要求等" /></label>
        <p class="hint">时间线总时长 <b>{{ totalDuration.toFixed(2) }}</b> 秒（目标时长允许 4–15 秒）。</p>
      </section>
      <section class="card storyboard">
        <div class="title"><div><h2>九格分镜提示词+图片+时长</h2><p>每格上传独立图片并填写提示词与时长；九段按分镜 1–9 顺序串成同一条时间线。</p></div><span>{{ uploaded }}/9 已上传</span></div>
        <label class="batch">批量上传分镜图片<em>推荐</em><input type="file" accept="image/png,image/jpeg,image/webp" multiple @change="onBatchImages" /><p class="tip">多选 9 张后按<b>文件名顺序</b>自动填入分镜 1–9（如 1.png → 分镜 1，9.png → 分镜 9）。</p></label>
        <div class="shots">
          <div v-for="(shot, i) in shots" :key="i" class="shot">
            <div class="shot-head">分镜 {{ i + 1 }}<span>第 {{ startOf(i).toFixed(2) }} 秒起</span></div>
            <label class="pick">分镜图片<em>必选</em><input type="file" accept="image/png,image/jpeg,image/webp" @change="onImage(i, $event)" /></label>
            <img v-if="shot.preview" :src="shot.preview" class="preview" :alt="`分镜 ${i + 1} 预览`" />
            <textarea v-model="shot.prompt" rows="3" :placeholder="`第 ${i + 1} 段的提示词`" />
            <label class="dur">时长（秒）<input v-model.number="shot.duration" type="number" min=".1" max="15" step=".05" /></label>
          </div>
        </div>
        <button :disabled="running" @click="submit">{{ running ? '正在生成…' : '生成完整视频' }}</button>
      </section>
      <section class="card result"><h2>任务状态</h2><p v-if="!job" class="muted">尚未提交任务。</p><template v-else><p><strong :class="job.status">{{ statusName }}</strong> <code>{{ job.id || '正在上传…' }}</code></p><pre>{{ job.log }}</pre><video v-if="job.video" :src="job.video" controls></video><a v-if="job.video" :href="job.video" target="_blank">打开 / 下载结果</a></template></section>
    </main>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import workflowTemplate from './assets/cs_h3_9panel_storyboard.api-v2.json'

const defaultGlobalPrompt=`整体采用电影级写实风格，画面精致、有高级商业广告质感。九个镜头围绕同一个主体展开：一只白色外带咖啡杯，杯身带简洁深绿色圆形图案，无明显品牌文字。保持咖啡杯外形、颜色、杯盖和比例在各镜头中尽可能一致。

整体叙事为“一杯咖啡从清晨出发，穿越城市、自然、雨夜与星空，最终回到温暖桌面”。镜头运动流畅克制，不要快速抖动，不要出现突兀跳切，不要改变主体结构。

要求：
- 电影感写实摄影
- 自然真实光影
- 浅景深与适度背景虚化
- 镜头运动连续、稳定
- 主体咖啡杯保持一致
- 不新增文字、水印、Logo
- 不出现杯体扭曲、液体穿模、物体变形
- 场景之间通过光线、运动方向、粒子或遮挡自然衔接
- 16:9 横屏构图
- 画面中心主体明确
- 整体色调从清晨暖色逐渐进入城市冷色、雨夜蓝色，再回归温暖金色`
const defaultShotPrompts=[
'清晨暖金色阳光缓慢照亮窗边的白色咖啡杯，镜头从稍远处缓慢向前推进，窗帘被微风轻轻吹动，杯口升起细腻真实的热气，背景城市保持柔和虚化。镜头稳定，电影感写实摄影，光影自然，最后让阳光逐渐增强并填满画面，为下一镜头形成自然亮光转场。',
'镜头从上一段的明亮光线中自然显现城市街头，同一只白色咖啡杯位于画面前景，镜头轻微横向移动，人群与车辆在背景形成自然动态虚化，阳光反射在杯身表面。保持咖啡杯稳定不变形，镜头运动平滑，最后一辆经过的车辆从镜头前方形成短暂遮挡转场。',
'镜头紧贴咖啡杯进行轻微侧向跟拍，地铁高速前进，窗外灯带连续划过形成流动光轨，杯子保持稳定，环境有轻微运动感但不要剧烈晃动。玻璃反射中出现城市光影，最后窗外一道强烈光带横向扫过整个画面，形成下一镜头的光轨转场。',
'画面从流动光带中逐渐恢复为明亮自然的绿色公园，同一只咖啡杯位于木桌中央，镜头围绕杯子做非常轻微的小幅弧形运动。树叶随风摇曳，阳光透过枝叶形成移动光斑，几片小叶子从画面前方飘过。整体清新自然，最后一片叶子贴近镜头形成柔和遮挡转场。',
'叶片离开镜头后显现平静湖面，同一只白色咖啡杯放在湖边石台，镜头缓慢下压并略微靠近杯子，湖面微风产生柔和波纹，天空和杯子的倒影轻轻晃动。保持画面宁静、真实、电影感，最后湖面反射突然被一滴雨水打破，波纹扩散至整个画面。',
'从湖面波纹自然过渡到雨夜街道积水的波纹，同一只咖啡杯出现在前景，细雨持续落下，路面反射蓝紫色和暖黄色霓虹灯光。镜头缓慢向右移动，雨滴在杯盖和桌面形成细小水珠，背景车辆灯光产生柔和散景。最后一束车灯从左向右扫过镜头，形成明亮转场。',
'强光逐渐消散，显现夜晚高楼天台，同一只咖啡杯放在安全的桌面前景，远处城市灯海闪烁。镜头从杯子近景缓慢上抬，逐步露出城市天际线，空气中有轻微雾气和真实夜景光晕。镜头稳定、宏大但克制，最后镜头继续向天空抬升。',
'镜头继续向上抬升，城市夜空逐渐变成清晰壮丽的银河，同一只咖啡杯仍位于画面下方，杯口升起的热气逐渐化成细微发光粒子并飘向星空。银河缓慢流动，星光自然闪烁，不要夸张爆炸特效。镜头随后缓慢向咖啡杯重新下降，发光粒子逐渐汇聚成暖色光芒。',
'发光粒子逐渐化成室内台灯的暖黄色光芒，同一只咖啡杯安静放在木质桌面中央，旁边可以有打开的书本或电脑，但不要出现可读文字。镜头缓慢向后拉远，杯口仍有轻微热气，室内环境温暖安静。最终画面停留在咖啡杯和暖光中，运动逐渐停止，形成完整收尾。']
const server=ref('http://192.168.8.231:8188'), aspectRatio=ref('16:9 横屏'), gridLayout=ref('3x3 九宫格'), megapixels=ref(.6), resolutionMultiple=ref(32), globalPrompt=ref(defaultGlobalPrompt)
const shots=ref(Array.from({length:9},(_,i)=>({file:null,preview:'',prompt:defaultShotPrompts[i],duration:1})))
const running=ref(false), job=ref(null), gridImage=ref(null)
const uploaded=computed(()=>shots.value.filter(s=>s.file||s.uploadedPath).length)
const totalDuration=computed(()=>shots.value.reduce((a,s)=>a+(Number(s.duration)||0),0))
const statusName=computed(()=>({uploading:'上传中',queued:'等待中',running:'生成中',completed:'已完成',error:'失败'}[job.value?.status]||'处理中'))
const startOf=i=>shots.value.slice(0,i).reduce((a,s)=>a+(Number(s.duration)||0),0)

function assign(i,file){const s=shots.value[i];if(s.preview)URL.revokeObjectURL(s.preview);s.file=file;s.preview=URL.createObjectURL(file)}
function onImage(i,e){const f=e.target.files?.[0];if(f)assign(i,f);e.target.value=''}
function onBatchImages(e){
  const files=[...(e.target.files||[])]
  if(!files.length)return
  files.sort((a,b)=>a.name.localeCompare(b.name,'zh-Hans-CN',{numeric:true,sensitivity:'base'}))
  if(files.length>9){alert(`一次最多填入 9 张，已按文件名顺序取前 9 张（本次选择了 ${files.length} 张）。`);files.length=9}
  files.forEach((f,i)=>assign(i,f))
  e.target.value=''
}
function director(w){const n=Object.values(w).find(n=>n.class_type==='CSH3MultimodalDirector');if(!n)throw Error('未找到 CSH3MultimodalDirector 节点');return n.inputs}
async function dimensions(file){const url=URL.createObjectURL(file);try{const image=new Image();image.src=url;await image.decode();return {width:image.naturalWidth,height:image.naturalHeight}}finally{URL.revokeObjectURL(url)}}
function validate(){for(let i=0;i<9;i++){const s=shots.value[i];if(!s.file&&!s.uploadedPath)return `分镜 ${i+1} 还未上传图片。`;const d=Number(s.duration);if(!isFinite(d)||d<=0)return `分镜 ${i+1} 的时长无效，请填写大于 0 的秒数。`;if(d>15)return `分镜 ${i+1} 的时长为 ${d} 秒，超出单段上限 15 秒。`}const total=totalDuration.value;if(total<4||total>15)return `九段总时长为 ${total.toFixed(2)} 秒，目标时长需在 4–15 秒之间。`;return ''}
async function uploadFile(file,label){const unique=`${Date.now()}_${Math.random().toString(16).slice(2,8)}_${file.name}`,body=new FormData();body.append('image',file,unique);body.append('type','input');const r=await fetch(`${server.value}/upload/image`,{method:'POST',body});if(!r.ok)throw Error(`${label}上传失败：HTTP ${r.status}`);const data=await r.json();const sub=(data.subfolder||'').replace(/\\/g,'/').replace(/\/$/,'');return sub?`${sub}/${data.name}`:data.name}
function uploadOne(i){return uploadFile(shots.value[i].file,`分镜 ${i+1} 图`)}
async function composeGrid(){
  const cell=512,side=cell*3,canvas=document.createElement('canvas');canvas.width=canvas.height=side
  const ctx=canvas.getContext('2d');ctx.fillStyle='#101825';ctx.fillRect(0,0,side,side)
  for(let i=0;i<9;i++){
    const s=shots.value[i]
    const url=s.file?URL.createObjectURL(s.file):s.preview
    try{
      const image=new Image();image.crossOrigin='anonymous';image.src=url;await image.decode()
      const col=i%3,row=Math.floor(i/3),x=col*cell,y=row*cell
      const scale=Math.max(cell/image.naturalWidth,cell/image.naturalHeight),w=image.naturalWidth*scale,h=image.naturalHeight*scale
      ctx.drawImage(image,x+(cell-w)/2,y+(cell-h)/2,w,h)
    }finally{if(s.file&&url)URL.revokeObjectURL(url)}
  }
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'))
  return {file:new File([blob],`nine_grid_${Date.now()}.png`,{type:'image/png'}),width:side,height:side}
}
function timelineData(inputs){
  const t=JSON.parse(inputs.timeline_data);let start=0
  t.items=shots.value.map((s,i)=>{
    const d=Number(s.duration),item={id:`image_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,kind:'image',file:s.uploadedPath,name:s.file.name,width:s.size.width,height:s.size.height,mediaDuration:0,hasAudio:false,includeAudio:false,scope:'grid',track:'visual',start,duration:d,prompt:s.prompt,sound:''}
    start+=d;return item
  })
  t.updatedAt=Date.now();t.selectedId=t.items[0].id;t.globalPrompt=globalPrompt.value;t.gridImage=gridImage.value;t.hiddenStoryboardIndices=[0,1,2,3,4,5,6,7,8];return t
}
function workflow(){
  const w=structuredClone(workflowTemplate),i=director(w)
  i.mode='宫格模式';i.grid_layout='3x3 九宫格';i.duration_seconds=totalDuration.value;i.aspect_ratio=aspectRatio.value;i.output_megapixels=megapixels.value;i.resolution_multiple=resolutionMultiple.value;i.global_prompt=globalPrompt.value
  i.timeline_data=JSON.stringify(timelineData(i));return w
}
async function submit(){
  const problem=validate();if(problem)return alert(problem)
  if(!globalPrompt.value.trim()&&!shots.value.some(s=>s.prompt.trim()))return alert('请填写全局创作要求，或至少一段分镜提示词。')
  running.value=true;job.value={status:'uploading',id:'',log:'正在上传 9 张分镜图片…',video:''}
  try{
    for(let i=0;i<9;i++){
      const s=shots.value[i]
      if(s.file){s.uploadedPath=await uploadOne(i);s.size=await dimensions(s.file);job.value.log+=`\n分镜 ${i+1} 上传成功：${s.uploadedPath}`}
      else if(s.uploadedPath){job.value.log+=`\n分镜 ${i+1} 复用服务器原图：${s.uploadedPath}`}
      else throw Error(`分镜 ${i+1} 没有图片。`)
    }
    job.value.log+='\n正在自动合成 3x3 宫格底图…'
    const grid=await composeGrid(),gridPath=await uploadFile(grid.file,'宫格底图')
    gridImage.value={file:gridPath,name:grid.file.name,width:grid.width,height:grid.height}
    job.value.log+=`\n宫格底图已上传：${gridPath}（仅满足节点宫格模式校验，切格全部隐藏，不参与生成）`
    const w=workflow(),r=await fetch(`${server.value}/prompt`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({prompt:w})}),data=await r.json()
    if(!r.ok||data.error)throw Error(data.error?.message||data.error||`提交失败：HTTP ${r.status}`)
    job.value={status:'queued',id:data.prompt_id,log:`任务已提交：${data.prompt_id}`,video:'',saveIds:Object.entries(w).filter(([,n])=>n.class_type==='SaveVideo').map(([id])=>id)}
    poll()
  }catch(e){job.value.status='error';job.value.log+=`\n错误：${e.message}`;running.value=false}
}
async function poll(){try{const r=await fetch(`${server.value}/history/${job.value.id}`),data=await r.json(),entry=data[job.value.id];if(!entry){job.value.status='queued';job.value.log+='\n等待 GPU 调度…'}else if(entry.status?.status_str==='error'){throw Error('ComfyUI 执行失败')}else if(entry.status?.completed){job.value.status='completed';job.value.video=output(entry.outputs||{});job.value.log+=job.value.video?'\n视频已生成。':'\n执行完成，但未找到视频输出。';running.value=false;return}else{job.value.status='running';job.value.log+='\n正在生成…'}setTimeout(poll,2500)}catch(e){job.value.status='error';job.value.log+=`\n错误：${e.message}`;running.value=false}}
function output(outputs){
  const nodes=[...(job.value.saveIds||[]).map(id=>outputs[id]),...Object.values(outputs)]
  for(const node of nodes){
    if(!node)continue
    for(const key of ['videos','images','gifs']){
      const list=node[key]||[],mp4=list.find(x=>x.filename&&String(x.filename).toLowerCase().endsWith('.mp4')),f=mp4||list.find(x=>x.filename)
      if(f)return `${server.value}/view?${new URLSearchParams({filename:f.filename,subfolder:f.subfolder||'',type:f.type||'output'})}`
    }
  }
  return ''
}

</script>

<style>
:root{font-family:Inter,system-ui,"Microsoft YaHei",sans-serif;color:#e7edf7;background:#101825}*{box-sizing:border-box}body{margin:0}.app{max-width:1450px;margin:auto;padding:30px}header{display:flex;justify-content:space-between;gap:20px;margin:10px 0 28px}header small{color:#7dd3fc;letter-spacing:.12em;font-weight:700}h1{margin:8px 0;font-size:32px}h2{margin:0 0 12px;font-size:18px}header p,.title p,.muted,.hint{color:#9eb0cb;margin:0}header b{height:max-content;color:#bbf7d0;background:#163827;border:1px solid #2c6949;padding:8px 12px;border-radius:99px;font-size:13px}nav{display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap}nav a{color:#c9d5e7;text-decoration:none;font-size:13px;font-weight:600;padding:8px 12px;border-radius:99px;border:1px solid #2a3a53;white-space:nowrap}nav a.active{color:#062034;background:linear-gradient(90deg,#67e8f9,#38bdf8);border-color:transparent}main{display:grid;grid-template-columns:390px 1fr;gap:20px}.card{background:#172233;border:1px solid #2a3a53;border-radius:16px;padding:22px;box-shadow:0 16px 40px #0002}.settings{grid-row:span 2}.result{grid-column:2}label{display:block;color:#c9d5e7;font-size:13px;font-weight:600;margin-top:14px}em{color:#fbbf24;font-style:normal}input,select,textarea{width:100%;margin-top:7px;color:#ecf5ff;background:#0f1725;border:1px solid #3a4e6d;border-radius:8px;padding:10px;font:inherit}textarea{resize:vertical;line-height:1.45}.params{display:grid;grid-template-columns:1fr 1fr;gap:0 12px}.hint{margin-top:14px}.hint b{color:#7dd3fc}.title{display:flex;justify-content:space-between;gap:15px}.title span{color:#7dd3fc;font-size:13px;white-space:nowrap}.batch{display:block;margin-top:16px;padding:12px;background:#0e1726;border:1px dashed #3a5c8a;border-radius:10px;color:#9ec5fd}.batch .tip{margin:8px 0 0;color:#7d93b5;font-size:12px;font-weight:400}.batch .tip b{color:#7dd3fc}.batch input{margin-top:7px}.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:18px}.shot{display:flex;flex-direction:column;padding:10px;background:#111a28;border:1px solid #2a3a53;border-radius:10px}.shot-head{display:flex;justify-content:space-between;align-items:center;color:#7dd3fc;font-size:13px;font-weight:700;margin:2px 0 6px}.shot-head span{color:#9eb0cb;font-weight:400;font-size:12px}.shot label{margin-top:8px}.shot .pick em{margin-left:6px}.preview{width:100%;height:120px;object-fit:cover;margin-top:8px;background:#0b1019;border:1px solid #3a4e6d;border-radius:8px}.shot textarea{min-height:66px;font-size:13px}.dur input{margin-top:5px}button{width:100%;margin-top:20px;border:0;padding:13px;border-radius:10px;font-size:15px;font-weight:700;color:#062034;background:linear-gradient(90deg,#67e8f9,#38bdf8);cursor:pointer}button:disabled{opacity:.55;cursor:wait}strong{padding:5px 10px;border-radius:99px;font-size:12px}.uploading,.queued{color:#fde68a;background:#41381d}.running{color:#bfdbfe;background:#1e3a5f}.completed{color:#bbf7d0;background:#163827}.error{color:#fecaca;background:#3f1d1d}code{color:#93c5fd;font-size:12px;word-break:break-all}pre{white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;background:#0b1019;border:1px solid #2a3a53;border-radius:10px;padding:12px;color:#c9d5e7;font-size:12px}video{width:100%;margin-top:14px;border-radius:12px;background:#000}a{color:#7dd3fc}
</style>
