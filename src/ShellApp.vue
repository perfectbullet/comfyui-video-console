<template>
  <div class="shell">
    <header class="shell-header">
      <div>
        <small>COMFYUI · CS-H3</small>
        <h1>{{ currentTab.title }}</h1>
        <p>{{ currentTab.description }}</p>
      </div>
      <nav class="tabs" aria-label="功能切换">
        <button
          v-for="tab in tabs"
          :key="tab.mode"
          :class="{ active: mode === tab.mode }"
          type="button"
          @click="selectTab(tab.mode)"
        >
          <span v-if="tab.icon" aria-hidden="true">{{ tab.icon }}</span
          ><span v-else>{{ tab.label }}</span>
        </button>
      </nav>
    </header>

    <section class="workspace">
      <KeepAlive>
        <component :is="currentTab.component" />
      </KeepAlive>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from "vue";
import StoryboardApp from "./App.vue";
import I2VApp from "./I2VApp.vue";
import NineImagesApp from "./NineImagesApp.vue";
import SystemInfoApp from "./SystemInfoApp.vue";
import CSH3App from "./CSH3App.vue";
import TasksApp from "./TasksApp.vue";

const tabs = [
  {
    mode: "nine-images",
    label: "九图分镜版",
    title: "九宫格分镜视频生成（九图版）",
    description: "上传 1–9 张分镜图片，生成一段完整 MP4。",
    component: NineImagesApp,
  },
  {
    mode: "tasks",
    label: "任务管理",
    title: "任务管理",
    description: "查看当前 ComfyUI 实例的实时状态、历史详情与生成视频。",
    component: TasksApp,
  },
  {
    mode: "system",
    label: "系统信息",
    icon: "⚙",
    title: "系统信息",
    description: "查看 ComfyUI 运行状态与显存占用。",
    component: SystemInfoApp,
  },
];

const legacyTabs = {
  storyboard: {
    title: "九宫格分镜视频生成",
    description: "旧链接兼容页面。",
    component: StoryboardApp,
  },
  i2v: {
    title: "I2V 首帧生视频",
    description: "旧链接兼容页面。",
    component: I2VApp,
  },
  csh3: {
    title: "CS-H3 多模态参考导演台",
    description: "旧链接兼容页面。",
    component: CSH3App,
  },
};

function routeMode() {
  const value = new URLSearchParams(window.location.search).get("mode");
  return tabs.some((tab) => tab.mode === value) || legacyTabs[value]
    ? value
    : "nine-images";
}

const mode = ref(routeMode());
const currentTab = computed(
  () =>
    tabs.find((tab) => tab.mode === mode.value) ||
    legacyTabs[mode.value] ||
    tabs[1],
);

function selectTab(nextMode) {
  if (nextMode === mode.value) return;
  const url = new URL(window.location.href);
  url.searchParams.set("mode", nextMode);
  window.history.pushState({}, "", url);
  mode.value = nextMode;
}

function onPopState() {
  mode.value = routeMode();
}

onMounted(() => window.addEventListener("popstate", onPopState));
onUnmounted(() => window.removeEventListener("popstate", onPopState));
</script>

<style scoped>
.shell {
  height: 100vh;
  background: #0d1623;
  color: #e8eef8;
}
.shell-header {
  padding: 16px;
  align-items: flex-start;
}
small {
  color: #747bff;
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 800;
}
h1 {
  margin: 13px 0 5px;
  color: #f4f7ff;
  font-size: 25px;
  line-height: 1.15;
}
p {
  color: #a9bceb;
  margin: 0;
  font-size: 14px;
}
.tabs {
  display: flex;
  gap: 9px;
  flex-wrap: wrap;
  justify-content: flex-end;
  padding-top: 0;
}
.tabs button {
  width: auto;
  min-height: 33px;
  margin: 0;
  appearance: none;
  border: 1px solid #303b4c;
  border-radius: 6px;
  color: #e1e8f7;
  background: #111a27;
  padding: 7px 15px;
  box-shadow:
    inset 0 1px #ffffff08,
    0 1px 1px #0006;
  font: inherit;
  font-size: 13px;
  font-weight: 650;
  cursor: pointer;
  white-space: nowrap;
  transition:
    background 0.16s,
    border-color 0.16s,
    transform 0.16s;
}
.tabs button:hover {
  border-color: #6474ff;
  background: #172136;
}
.tabs button.active {
  color: #fff;
  background: linear-gradient(135deg, #7566f7, #6555ea);
  border-color: #8a7eff;
  box-shadow:
    inset 0 1px #ffffff2b,
    0 3px 10px #4f46e555;
}
.tabs button:last-child {
  min-width: 45px;
  padding: 7px 11px;
  font-size: 15px;
}
.workspace {
  padding: 0 20px 20px;
}
:deep(.workspace .app > header) {
  display: none;
}
:deep(.workspace .app) {
  max-width: none;
  margin: 0;
  padding: 0;
}
:deep(.workspace main) {
  gap: 20px;
}
:deep(.workspace .card) {
  background: #172336;
  border-color: #2b425f;
  border-radius: 15px;
  box-shadow: 0 12px 32px #0000002e;
}
:deep(.workspace input),
:deep(.workspace select),
:deep(.workspace textarea) {
  background: #0d1725;
  border-color: #30425a;
  color: #eaf1ff;
}
:deep(.workspace input:focus),
:deep(.workspace select:focus),
:deep(.workspace textarea:focus) {
  border-color: #6175ff;
  outline: 2px solid #6677ff2e;
}
@media (max-width: 720px) {
  .shell-header {
    flex-direction: column;
  }
  .tabs {
    justify-content: flex-start;
  }
  h1 {
    font-size: 23px;
  }
  .workspace {
    padding: 0 14px 14px;
  }
}
</style>
