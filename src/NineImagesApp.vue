<template>
  <div class="app">
    <header>
      <div>
        <small>COMFYUI · CS-H3</small>
        <h1>九宫格分镜视频生成（九图版）</h1>
        <p>
          上传分镜图片（1–9 张均可），作为同一条 CSH3MultimodalDirector
          时间线，生成一段完整 MP4。
        </p>
      </div>
      <nav>
        <a href="/?mode=director">多模式导演台</a><a class="active" href="/?mode=nine-images">九图分镜版</a><a
          href="/?mode=tasks">任务管理</a><a href="/?mode=system">系统信息</a>
      </nav>
    </header>
    <main>
      <section class="card settings">
        <h2>生成设置</h2>
        <label>ComfyUI 服务地址
          <div class="server-picker">
            <select v-model="selectedServer" aria-label="常用 ComfyUI 服务" @change="chooseServer">
              <option value="">常用服务</option>
              <option v-for="option in serverOptions" :key="option.url" :value="option.url">
                {{ option.label }}
              </option>
            </select><input v-model.trim="server" placeholder="可手动输入 ComfyUI 服务地址" @blur="checkServer"
              @input="onServerInput" />
          </div>
          <p v-if="serverChecking" class="server-checking">
            正在检查服务连通性…
          </p>
          <p v-else-if="serverError" class="server-error" role="alert">
            {{ serverError }}
          </p>
        </label>
        <div class="params">
          <label>输出比例<select v-model="aspectRatio">
              <option>自动</option>
              <option>21:9 超宽屏</option>
              <option>16:9 横屏</option>
              <option>4:3 横屏</option>
              <option>1:1 方形</option>
              <option>3:4 竖屏</option>
              <option>9:16 竖屏</option>
            </select></label>
          <label>宫格格式<select v-model="gridLayout">
              <option>3x3 九宫格</option>
            </select></label>
          <label>输出像素规模（MP）<input v-model.number="megapixels" type="number" min=".1" max="16" step=".1" /></label>
          <label>尺寸对齐倍数<select v-model.number="resolutionMultiple">
              <option :value="16">16</option>
              <option :value="32">32</option>
              <option :value="64">64</option>
            </select></label>
          <label>Noise Seed<input v-model.number="noiseSeed" type="number" min="0" step="1" /></label>
        </div>
        <label>全局创作要求<textarea v-model="globalPrompt" rows="12" placeholder="整体风格、镜头语言、连贯性要求等" />
        </label>
        <p class="hint">
          时间线总时长 <b>{{ totalDuration.toFixed(2) }}</b> 秒（目标时长允许
          4–15 秒）。
        </p>
      </section>
      <section class="card storyboard">
        <div class="title">
          <div>
            <h2>九格分镜提示词+图片+时长</h2>
            <p>
              每格上传独立图片并填写提示词与时长；已填的分镜按顺序串成同一条时间线（可只填
              1 格或多格）。
            </p>
          </div>
          <span>{{ uploaded }}/9 已上传</span>
        </div>
        <label class="batch">批量上传分镜图片<em>推荐</em><input type="file" accept="image/png,image/jpeg,image/webp" multiple
            @change="onBatchImages" />
          <p class="tip">
            多选 1–9 张后按<b>文件名顺序</b>自动填入分镜 1–N（如 1.png → 分镜
            1，9.png → 分镜 9），可只传部分。
          </p>
        </label>
        <div class="shots">
          <div v-for="(shot, i) in shots" :key="i" class="shot">
            <div class="shot-head">
              分镜 {{ i + 1 }}<span>第 {{ startOf(i).toFixed(2) }} 秒起</span>
            </div>
            <p class="row-upload">
              <span>分镜图片<em>*</em></span>
              <button @click="handleTriggerUpload(i)" class="btn-upload" v-show="!(shot.file || shot.uploadedPath)">
                上传
              </button>
              <input :id="`upload-input-${i}`" type="file" accept="image/png,image/jpeg,image/webp"
                @change="onImage(i, $event)" hidden />
              <button v-if="shot.file || shot.uploadedPath" type="button" class="remove-image" @click="removeImage(i)">
                删除图片
              </button>
            </p>
            <img v-if="shot.preview" :src="shot.preview" class="preview" :alt="`分镜 ${i + 1} 预览`" />
            <textarea v-model="shot.prompt" rows="3" :placeholder="`第 ${i + 1} 段的提示词`" class="prompt-textarea" />
            <p class="row-dur">
              <span>时长（秒）</span><input v-model.number="shot.duration" type="number" min=".1" max="15" step=".05" />
            </p>
          </div>
        </div>
        <button :disabled="running" @click="submit" class="btn-submit">
          {{ running ? "正在上传并提交…" : "生成完整视频" }}
        </button>
        <p class="submit-hint">
          任务提交后可继续提交，ComfyUI 会在后台队列中依次生成。
        </p>
      </section>
      <section class="card result">
        <h2>任务状态</h2>
        <p v-if="!job" class="muted">尚未提交任务。</p>
        <template v-else>
          <p>
            <strong :class="job.status">{{ statusName }}</strong>
            <code>{{ job.id || "正在上传…" }}</code>
          </p>
          <pre>{{ job.log }}</pre>
          <video v-if="job.video" :src="job.video" controls></video><a v-if="job.video" :href="job.video"
            target="_blank">打开 / 下载结果</a>
        </template>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import autodlWorkflow from "./assets/CS-H3多模态参考导演台工作流-by-autodl-app-v1.json";
import workflow231 from "./assets/CS-H3多模态参考导演台工作流-zj-可修改的-v2-231.json";
import bjb2Workflow from "./assets/CS-H3多模态参考导演台工作流-Turbo6步-bjb2.json";
import { archiveBase, fetchComfyuiServers } from "./api/http.js";
import { useTaskStore } from "./store/task";

const taskStore = useTaskStore();
const workflowTemplates = {
  "CS-H3多模态参考导演台工作流-by-autodl-app-v1.json": autodlWorkflow,
  "CS-H3多模态参考导演台工作流-zj-可修改的-v2-231.json": workflow231,
  "CS-H3多模态参考导演台工作流-Turbo6步-bjb2.json": bjb2Workflow,
};

const defaultGlobalPrompt = ``;
const defaultShotPrompts = Array.from({ length: 9 }, () => "");
const serverOptions = ref([]);
const server = ref(""),
  selectedServer = ref(""),
  aspectRatio = ref("16:9 横屏"),
  gridLayout = ref("3x3 九宫格"),
  megapixels = ref(2.0),
  resolutionMultiple = ref(32),
  noiseSeed = ref(521283608101208),
  globalPrompt = ref(defaultGlobalPrompt);
const shots = ref(
  Array.from({ length: 9 }, (_, i) => ({
    file: null,
    preview: "",
    prompt: defaultShotPrompts[i],
    duration: 0,
  })),
);
const running = ref(false),
  job = ref(null),
  gridImage = ref(null);
const serverChecking = ref(false),
  serverError = ref("");
const uploaded = computed(
  () => shots.value.filter((s) => s.file || s.uploadedPath).length,
);
const totalDuration = computed(() =>
  shots.value.reduce(
    (a, s) => a + (s.file || s.uploadedPath ? Number(s.duration) || 0 : 0),
    0,
  ),
);
const statusName = computed(
  () =>
    ({
      uploading: "上传中",
      queued: "等待中",
      running: "生成中",
      completed: "已完成",
      error: "失败",
    })[job.value?.status] || "处理中",
);
const startOf = (i) =>
  shots.value
    .slice(0, i)
    .reduce(
      (a, s) => a + (s.file || s.uploadedPath ? Number(s.duration) || 0 : 0),
      0,
    );

function assign(i, file) {
  const s = shots.value[i];
  if (s.preview) URL.revokeObjectURL(s.preview);
  s.file = file;
  s.preview = URL.createObjectURL(file);
}
function onImage(i, e) {
  const f = e.target.files?.[0];
  if (f) assign(i, f);
  e.target.value = "";
}
function removeImage(i) {
  const s = shots.value[i];
  if (s.preview) URL.revokeObjectURL(s.preview);
  Object.assign(s, {
    file: null,
    preview: "",
    uploadedPath: "",
    remoteName: "",
    size: null,
  });
}
function onBatchImages(e) {
  const files = [...(e.target.files || [])];
  if (!files.length) return;
  files.sort((a, b) =>
    a.name.localeCompare(b.name, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    }),
  );
  if (files.length > 9) {
    alert(
      `一次最多填入 9 张，已按文件名顺序取前 9 张（本次选择了 ${files.length} 张）。`,
    );
    files.length = 9;
  }
  files.forEach((f, i) => assign(i, f));
  e.target.value = "";
}
function director(w) {
  const n = Object.values(w).find(
    (n) => n.class_type === "CSH3MultimodalDirector",
  );
  if (!n) throw Error("未找到 CSH3MultimodalDirector 节点");
  return n.inputs;
}
function serverBase() {
  return server.value.trim().replace(/\/$/, "");
}
async function checkServer() {
  const base = serverBase();
  if (!base) {
    serverError.value = "请输入 ComfyUI 服务地址。";
    return false;
  }
  serverChecking.value = true;
  serverError.value = "";
  const controller = new AbortController(),
    timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${base}/system_stats`, {
      signal: controller.signal,
    });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    return true;
  } catch (error) {
    serverError.value = `无法连接 ComfyUI 服务地址：${base}（${error.name === "AbortError" ? "连接超时" : error.message}）`;
    return false;
  } finally {
    clearTimeout(timer);
    serverChecking.value = false;
  }
}
function chooseServer() {
  if (selectedServer.value) {
    server.value = selectedServer.value;
    checkServer();
  }
}
function onServerInput() {
  if (server.value !== selectedServer.value) selectedServer.value = "";
  serverError.value = "";
}
function selectedServerOption() {
  const url = server.value.replace(/\/$/, "");
  return serverOptions.value.find(
    (item) => item.url.replace(/\/$/, "") === url,
  );
}
function selectedWorkflow() {
  return workflowTemplates[selectedServerOption()?.apiFile] || workflow231;
}
function usesArchiver() {
  return Boolean(archiveBase && selectedServerOption()?.id);
}
async function createDraft() {
  const r = await fetch(`${archiveBase}/api/task-drafts`, { method: "POST" }),
    data = await r.json();
  if (!r.ok) throw Error(data.detail || `创建归档草稿失败：HTTP ${r.status}`);
  return data.draft_id;
}
async function dimensions(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return { width: image.naturalWidth, height: image.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}
function validate() {
  const filled = shots.value.filter((s) => s.file || s.uploadedPath);
  if (!filled.length) return "请至少上传 1 张分镜图片。";
  for (let i = 0; i < 9; i++) {
    const s = shots.value[i];
    if (!s.file && !s.uploadedPath) continue;
    const d = Number(s.duration);
    if (!isFinite(d) || d <= 0)
      return `分镜 ${i + 1} 的时长无效，请填写大于 0 的秒数。`;
    if (d > 15) return `分镜 ${i + 1} 的时长为 ${d} 秒，超出单段上限 15 秒。`;
  }
  const total = totalDuration.value;
  if (total < 4 || total > 15)
    return `总时长为 ${total.toFixed(2)} 秒，目标时长需在 4–15 秒之间。`;
  return "";
}
async function uploadFile(file, label, draftId) {
  const unique = `${Date.now()}_${Math.random().toString(16).slice(2, 8)}_${file.name}`,
    body = new FormData();
  if (usesArchiver()) {
    body.append("server_id", selectedServerOption().id);
    body.append("file", file, unique);
    const r = await fetch(`${archiveBase}/api/task-drafts/${draftId}/files`, {
      method: "POST",
      body,
    }),
      data = await r.json();
    if (!r.ok)
      throw Error(data.detail || `${label}归档上传失败：HTTP ${r.status}`);
    return data.path;
  }
  body.append("image", file, unique);
  body.append("type", "input");
  const r = await fetch(`${server.value}/upload/image`, {
    method: "POST",
    body,
  });
  if (!r.ok) throw Error(`${label}上传失败：HTTP ${r.status}`);
  const data = await r.json();
  const sub = (data.subfolder || "").replace(/\\/g, "/").replace(/\/$/, "");
  return sub ? `${sub}/${data.name}` : data.name;
}
function uploadOne(i, draftId) {
  return uploadFile(shots.value[i].file, `分镜 ${i + 1} 图`, draftId);
}
async function composeGrid() {
  const cell = 512,
    side = cell * 3,
    canvas = document.createElement("canvas");
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#101825";
  ctx.fillRect(0, 0, side, side);
  for (let i = 0; i < 9; i++) {
    const s = shots.value[i];
    if (!s.file && !s.preview) continue;
    const url = s.file ? URL.createObjectURL(s.file) : s.preview;
    try {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.src = url;
      await image.decode();
      const col = i % 3,
        row = Math.floor(i / 3),
        x = col * cell,
        y = row * cell;
      const scale = Math.max(
        cell / image.naturalWidth,
        cell / image.naturalHeight,
      ),
        w = image.naturalWidth * scale,
        h = image.naturalHeight * scale;
      ctx.drawImage(image, x + (cell - w) / 2, y + (cell - h) / 2, w, h);
    } finally {
      if (s.file && url) URL.revokeObjectURL(url);
    }
  }
  const blob = await new Promise((r) => canvas.toBlob(r, "image/png"));
  return {
    file: new File([blob], `nine_grid_${Date.now()}.png`, {
      type: "image/png",
    }),
    width: side,
    height: side,
  };
}
function timelineData(inputs) {
  const t = JSON.parse(inputs.timeline_data);
  let start = 0,
    items = [];
  shots.value.forEach((s, i) => {
    if (!s.file && !s.uploadedPath) return;
    const d = Number(s.duration);
    items.push({
      id: `image_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      kind: "image",
      file: s.uploadedPath,
      name: s.file ? s.file.name : s.remoteName || `分镜 ${i + 1}`,
      width: s.size?.width || 0,
      height: s.size?.height || 0,
      mediaDuration: 0,
      hasAudio: false,
      includeAudio: false,
      scope: "grid",
      track: "visual",
      start,
      duration: d,
      prompt: s.prompt,
      sound: "",
    });
    start += d;
  });
  t.items = items;
  t.updatedAt = Date.now();
  t.selectedId = t.items[0].id;
  t.globalPrompt = globalPrompt.value;
  t.gridImage = gridImage.value;
  t.hiddenStoryboardIndices = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return t;
}
function workflow() {
  const w = structuredClone(selectedWorkflow()),
    i = director(w);
  const randomNoise = Object.values(w).find(
    (n) => n.class_type === "RandomNoise",
  );
  if (randomNoise) randomNoise.inputs.noise_seed = Number(noiseSeed.value) || 0;
  i.mode = "宫格模式";
  i.grid_layout = "3x3 九宫格";
  i.duration_seconds = totalDuration.value;
  i.aspect_ratio = aspectRatio.value;
  i.output_megapixels = megapixels.value;
  i.resolution_multiple = resolutionMultiple.value;
  i.global_prompt = globalPrompt.value;
  i.timeline_data = JSON.stringify(timelineData(i));
  return w;
}
async function submit() {
  const problem = validate();
  if (problem) return alert(problem);
  if (!globalPrompt.value.trim() && !shots.value.some((s) => s.prompt.trim()))
    return alert("请填写全局创作要求，或至少一段分镜提示词。");
  if (!(await checkServer())) return;
  running.value = true;
  job.value = {
    status: "uploading",
    id: "",
    log: "正在上传分镜图片…",
    video: "",
  };
  try {
    const draftId = usesArchiver() ? await createDraft() : "";
    for (let i = 0; i < 9; i++) {
      const s = shots.value[i];
      if (!s.file && !s.uploadedPath) continue;
      if (s.file) {
        s.uploadedPath = await uploadOne(i, draftId);
        s.size = await dimensions(s.file);
        job.value.log += `\n分镜 ${i + 1} 上传成功：${s.uploadedPath}`;
      } else {
        job.value.log += `\n分镜 ${i + 1} 复用服务器原图：${s.uploadedPath}`;
      }
    }
    job.value.log += "\n正在自动合成 3x3 宫格底图…";
    const grid = await composeGrid(),
      gridPath = await uploadFile(grid.file, "宫格底图", draftId);
    gridImage.value = {
      file: gridPath,
      name: grid.file.name,
      width: grid.width,
      height: grid.height,
    };
    job.value.log += `\n宫格底图已上传：${gridPath}（仅满足节点宫格模式校验，切格全部隐藏，不参与生成）`;
    const w = workflow(),
      option = selectedServerOption(),
      endpoint = usesArchiver()
        ? `${archiveBase}/api/tasks`
        : `${server.value}/prompt`,
      payload = usesArchiver()
        ? {
          server_id: option.id,
          draft_id: draftId,
          prompt: w,
          request_meta: {
            mode: "nine-images",
            service_url: server.value,
            workflow_file: option.apiFile,
          },
        }
        : { prompt: w },
      r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
      data = await r.json();
    if (!r.ok || data.error)
      throw Error(
        data.error?.message || data.error || `提交失败：HTTP ${r.status}`,
      );
    const submittedJob = {
      status: "queued",
      id: data.prompt_id,
      log: `任务已提交：${data.prompt_id}\n已进入后台队列，可继续提交下一条任务。`,
      video: "",
      saveIds: Object.entries(w)
        .filter(([, n]) => n.class_type === "SaveVideo")
        .map(([id]) => id),
    };
    job.value = submittedJob;
    running.value = false;
    poll(submittedJob);
  } catch (e) {
    job.value.status = "error";
    job.value.log += `\n错误：${e.message}`;
    running.value = false;
  }
}
async function poll(task) {
  try {
    const r = await fetch(`${server.value}/history/${task.id}`),
      data = await r.json(),
      entry = data[task.id];
    if (!entry) {
      task.status = "queued";
      task.log += "\n等待 GPU 调度…";
    } else if (entry.status?.status_str === "error") {
      throw Error("ComfyUI 执行失败");
    } else if (entry.status?.completed) {
      task.status = "completed";
      task.video = output(entry.outputs || {}, task);
      task.log += task.video
        ? "\n视频已生成。"
        : "\n执行完成，但未找到视频输出。";
      return;
    } else {
      task.status = "running";
      task.log += "\n正在生成…";
    }
    setTimeout(() => poll(task), 2500);
  } catch (e) {
    task.status = "error";
    task.log += `\n错误：${e.message}`;
  }
}
function output(outputs, task) {
  const nodes = [
    ...(task.saveIds || []).map((id) => outputs[id]),
    ...Object.values(outputs),
  ];
  for (const node of nodes) {
    if (!node) continue;
    for (const key of ["videos", "images", "gifs"]) {
      const list = node[key] || [],
        mp4 = list.find(
          (x) =>
            x.filename && String(x.filename).toLowerCase().endsWith(".mp4"),
        ),
        f = mp4 || list.find((x) => x.filename);
      if (f)
        return `${server.value}/view?${new URLSearchParams({ filename: f.filename, subfolder: f.subfolder || "", type: f.type || "output" })}`;
    }
  }
  return "";
}

const handleTriggerUpload = (i) => {
  document.getElementById(`upload-input-${i}`).click();
};

async function applyRerunTask(task) {
  if (!task?.prompt_id) return;
  try {
    const r = await fetch(
      `${archiveBase}/api/tasks/${encodeURIComponent(task.prompt_id)}/form`,
    );
    if (!r.ok) throw Error(`读取任务表单失败：HTTP ${r.status}`);
    const form = await r.json();
    if (form.kind && form.kind !== "nine-images")
      throw Error("该任务不是九图分镜版，无法回填。");

    const base = (form.server_url || "").replace(/\/$/, "");
    if (base) {
      server.value = base;
      selectedServer.value =
        serverOptions.value.find((o) => o.url.replace(/\/$/, "") === base)
          ?.url || "";
      checkServer();
    }

    const settings = form.settings || {};
    aspectRatio.value = settings.aspect_ratio || aspectRatio.value;
    gridLayout.value = settings.grid_layout || gridLayout.value;
    megapixels.value = settings.megapixels ?? megapixels.value;
    resolutionMultiple.value =
      settings.resolution_multiple ?? resolutionMultiple.value;
    noiseSeed.value = Number(settings.noise_seed) || noiseSeed.value;
    globalPrompt.value = settings.global_prompt || "";

    shots.value.forEach((s) => s.preview && URL.revokeObjectURL(s.preview));
    shots.value = Array.from({ length: 9 }, () => ({
      file: null,
      preview: "",
      prompt: "",
      duration: 0,
      uploadedPath: "",
      remoteName: "",
      size: null,
    }));

    await Promise.all(
      (form.shots || []).map(async (item) => {
        const i = Number(item.index);
        if (!Number.isInteger(i) || i < 0 || i > 8) return;
        const shot = shots.value[i];
        shot.prompt = item.prompt || "";
        shot.duration = Number(item.duration) || 0;
        shot.remoteName = item.name || "";
        shot.size = { width: item.width || 0, height: item.height || 0 };
        if (item.archive_url) {
          try {
            const img = await fetch(`${archiveBase}${item.archive_url}`);
            if (img.ok) {
              assign(
                i,
                new File([await img.blob()], item.name || `shot_${i + 1}.jpg`),
              );
              return;
            }
          } catch { }
        }
        if (item.uploaded_path) shot.uploadedPath = item.uploaded_path;
      }),
    );

    gridImage.value = null;
    job.value = null;
  } catch (e) {
    alert(e.message || String(e));
  } finally {
    taskStore.setRerunTask(null);
  }
}

watch(
  () => taskStore.rerunTask,
  (task) => {
    if (task) applyRerunTask(task);
  },
);

onMounted(async () => {
  try {
    serverOptions.value = await fetchComfyuiServers();
    if (serverOptions.value[0]?.url) {
      server.value = serverOptions.value[0].url;
      selectedServer.value = serverOptions.value[0].url;
    }
  } catch (e) {
    serverError.value = `服务列表加载失败：${e.message}`;
  }
  checkServer();
});
</script>

<style scoped>
.preview {
  width: 100%;
  max-height: 235px;
  object-fit: contain;
  margin-top: 6px;
  background: #0b1019;
  border: 1px solid #3a4e6d;
  border-radius: 10px;
}

.remove-image {
  color: #fecaca;
  background: #3f1d1d;
  border-color: #71323d;
}

.submit-hint {
  margin: 9px 0 0;
  color: #9eb0cb;
  font-size: 12px;
  text-align: center;
}

.server-checking,
.server-error {
  margin: 7px 0 0;
  font-size: 12px;
  font-weight: 400;
}

.server-checking {
  color: #fde68a;
}

.server-error {
  color: #fecaca;
}

.hint {
  margin-top: 10px;
}

.hint b {
  color: #7dd3fc;
}

.batch {
  display: block;
  margin-top: 16px;
  padding: 12px;
  background: #0e1726;
  border: 1px dashed #3a5c8a;
  border-radius: 10px;
  color: #9ec5fd;
}

.batch .tip {
  margin: 8px 0 0;
  color: #7d93b5;
  font-size: 12px;
  font-weight: 400;
}

.btn-submit {
  margin-top: 20px;
  background: linear-gradient(135deg, #7164f5, #5c4de8);
  color: #fff;
}

.shot {
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: #111a28;
  border: 1px solid #2a3a53;
  border-radius: 10px;
}

.shot-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #7dd3fc;
  font-weight: 700;
  margin: 2px 0 6px;
  flex-shrink: 0;
}

.shot-head span {
  color: #9eb0cb;
  font-weight: 400;
  font-size: 12px;
}

.shot .row-upload {
  display: flex;
  justify-content: space-between;
  align-items: center;
  color: #7d93b5;
}

.shot .row-upload button {
  width: auto;
  font-size: 12px;
  padding: 6px 12px;
  font-weight: normal;
  border-radius: 4px;
  line-height: 1;
}

.shot .prompt-textarea {
  flex-grow: 1;
}

.shot .row-dur {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
}

.shot .row-dur span {
  white-space: nowrap;
}

.shot .row-dur input {
  width: 50%;
  margin-top: 0;
}
</style>
