# 前端 Web 控制台开发指南

> 本指南面向在 `comfyui-video-console/` 上继续开发的人：页面结构、核心实现原理、ComfyUI API 依赖、以及改代码的正确姿势。
> 部署/发布命令见同目录《前端构建与部署命令速查.md》，架构与运维见《前端Web控制台部署与运维.md》。
> 最后更新：2026-08-26

---

## 1. 项目与仓库

| 项 | 内容 |
| --- | --- |
| 本地源码 | `/home/zj/aigc/comfyui-video-console/`（Vue 3 + Vite，独立 Git 仓库） |
| 线上地址 | `http://192.168.8.231:8600` |
| 后端 | `http://192.168.8.231:8188`（ComfyUI v0.31.1，容器 `comfyui-h3`） |
| Git 仓库 | `web/` 目录内已 `git init`，初始提交 `1a251b9`，分支 `master` |
| 版本管理内容 | 源码、Dockerfile、`.dockerignore`、`.gitignore`、package*.json、工作流模板 JSON |
| Git 忽略 | `node_modules/`、`dist/`（容器内重建）、`*.log`、`.vite/`、`.env` |

日常开发流程：

```bash
cd /home/zj/aigc/comfyui-video-console
# 改代码 → 本地自测 → 提交
git add -A && git commit -m "说明"
# 发布（详见《前端构建与部署命令速查.md》）
npm run build && rsync -az --delete --exclude node_modules --exclude .vite --exclude '*.log' --exclude .DS_Store ./ zenking@192.168.8.231:/data/aigc/comfyui-h3/web/
ssh zenking@192.168.8.231 "cd /data/aigc/comfyui-h3 && docker compose up -d --build vue-web"
```

---

## 2. 页面与路由

路由由 `src/main.js` 按 URL 查询参数 `?mode=` 分发，共 5 个页面：

| mode | 组件 | 页面标题 | 说明 |
|---|---|---|---|
| （缺省）/`storyboard` | `App.vue` | 九宫格分镜视频生成 | 上传单张 3×3 宫格图 → 拆 9 格生成 |
| `i2v` | `I2VApp.vue` | I2V 首帧生视频 | MiniMax H3 I2V 工作流 |
| `director` | `DirectorApp.vue` | 多模式导演台 | 原版导演流水线（分段、参考素材、输出参数） |
| `nine-images` | `NineImagesApp.vue` | 九宫格分镜视频生成（九图版） | **本页为核心新增**：9 张独立图 → 同一条 CSH3MultimodalDirector 时间线 → 单条 MP4 |
| `system` | `SystemInfoApp.vue` | 系统信息 | 系统/GPU 状态 + 释放显存按钮 |

> 5 个页面共用一套深色样式（各自组件内 `<style>`），导航栏互相链接；新增页面时需同步改**所有页面**的 `<nav>`。

---

## 3. 九图版实现原理（核心）

`NineImagesApp.vue` 是项目里最关键、也最容易改坏的页面，实现要点如下。

### 3.1 数据流

```text
9 张图（或 1–9 张）──逐个 POST /upload/image──> ComfyUI input/
    │                                            │
    └── canvas 合成 3×3 宫格底图 ──POST /upload/image──> gridImage
                                                    │
                                                    ▼
           构建 workflow：CSH3MultimodalDirector 节点
           timeline_data.items = N 个 scope:"grid" 图片条目（start 累计）
           ──POST /prompt──> 轮询 /history/{id} ──> SaveVideo 输出 MP4
```

### 3.2 提交的 timeline_data 条目格式

**必须**与已验证成功任务 `a4404e7e-…` 的结构逐字段对齐（字段顺序也一致）：

```json
{
  "id": "image_<时间戳>_<随机>",
  "kind": "image",
  "file": "<上传返回的路径，如 1787xxx_abc12_1.png>",
  "name": "原始文件名",
  "width": 0, "height": 0,
  "mediaDuration": 0,
  "hasAudio": false, "includeAudio": false,
  "scope": "grid", "track": "visual",
  "start": 0.0,          // 前面所有已填分镜时长累计
  "duration": 1.0,       // 该分镜时长
  "prompt": "该段提示词",
  "sound": ""
}
```

顶层设置（写进 `timeline_data` JSON 字符串）：

```json
{
  "mode": "宫格模式",
  "grid_layout": "3x3 九宫格",
  "hiddenStoryboardIndices": [0,1,2,3,4,5,6,7,8],
  "globalPrompt": "<与节点 global_prompt 同步>",
  "gridImage": { "file": "...", "name": "...", "width": 1536, "height": 1536 },
  "items": [ ...N 个条目... ]
}
```

### 3.3 三个关键设计决策（改之前先理解）

1. **自动合成宫格底图（gridImage 不能为 null）**：宫格模式下节点 `_split_storyboard` 要求 `timeline_data.gridImage` 非空（`h3_multimodal_director.py` 的硬校验，未导入就报「宫格模式未导入宫格图像」）。页面用 canvas 把已填的图拼成 3×3（1536×1536）自动上传，**切格全部被 `hiddenStoryboardIndices:[0..8]` 隐藏、不参与生成**，真正的画面来自 items 里的独立图片 —— 这与成功任务 `a4404e7e` 完全一致。用户全程无需上传宫格图。

2. **图片数量 1–9 灵活**：页面允许只填部分分镜（校验只需 ≥1 张，参考流水线成功任务 `2d2d3245` 只用了 3 张）。已填的分镜按顺序生成 items，`start` 只累计已填的；总时长 = 已填分镜之和，须在节点允许的 4–15 秒内。

3. **批量上传按文件名自然排序填入**：`localeCompare(numeric:true)` 排序，`1.png→分镜1 … 9.png→分镜9`（避免字典序 `1,10,2` 的坑）。上传时客户端生成 `时间戳_随机_原文件名` 的唯一名，防止 9 张同名文件互相覆盖。

### 3.4 提交流程要点（submit）

1. 校验：≥1 张图、每段时长 0<d≤15、总时长 4–15
2. 逐张 `POST /upload/image`（form: `image` + `type=input`），记录返回的 `subfolder/name` 作为 `file`
3. canvas 合成宫格底图 → 上传 → 写入 `gridImage`
4. 深拷贝 `src/assets/cs_h3_9panel_storyboard.api-v2.json`（唯一运行模板，勿改原文件）→ 定位 `CSH3MultimodalDirector` 节点 → 覆盖 `timeline_data`
5. `POST /prompt`（body `{prompt: workflow}`）→ 每 2.5s 轮询 `/history/{id}` → 从 `SaveVideo` 节点输出取 MP4 → `/view` 展示下载

---

## 4. 系统信息页（SystemInfoApp.vue）

- 每 5 秒拉取 `GET /system_stats` + `GET /queue`，展示系统版本、RAM、GPU 显存条、运行/排队任务数
- **释放显存按钮**：`POST /free` body `{"unload_models":true,"free_memory":true}`
- ⚠️ 机制要点（改这块前必读）：`/free` 接口**只设标志位立即返回**（`server.py` 的 `post_free` 只是 `prompt_queue.set_flag(...)`），真正的 `unload_all_models + gc + empty_cache` 在队列循环里异步执行 —— 所以点击后显存要等几秒到几十秒才降，页面会做 2s/6s/15s 三次延迟刷新引导用户观察。队列有任务时会弹确认框。

---

## 5. 前端调用的 ComfyUI API 清单

| 接口 | 用途 | 备注 |
|---|---|---|
| `POST /upload/image` | 上传图片（form: image + type=input） | 返回 `{name, subfolder, type}`；客户端已加时间戳唯一名前缀 |
| `POST /prompt` | 提交工作流（`{prompt: workflow}`） | 返回 `{prompt_id}` |
| `GET /history/{prompt_id}` | 轮询单个任务状态 | `status.status_str` / `outputs` |
| `GET /history?max_items=N` | 历史任务列表 | **纯内存**，重启容器即清空 |
| `GET /queue` | 运行中/排队任务 | 系统页用 |
| `GET /system_stats` | 系统与 GPU 信息 | 系统页用 |
| `POST /free` | 释放显存 | 异步生效，见第 4 节 |
| `GET /view?filename=&subfolder=&type=` | 取输出/输入文件本体 | 视频展示、缩略图 |

---

## 6. 依赖的后端补丁（重要）

231 上 `CS-H3-Multimodal-Director` 插件（`/nfs-data/comfyui/storage-nodes/custom_nodes/CS-H3-Multimodal-Director/h3_multimodal_director.py`）打过一次补丁，**前端行为依赖它**：

- 原行为：宫格模式强制要求 `gridImage`，否则报「宫格模式未导入宫格图像」
- 补丁后：宫格模式**只要时间线有图片/视频素材就不再要求宫格图**（`has_visual_media` 检查）；完全空素材仍报错
- 备份：同目录 `h3_multimodal_director.py.bak_20260819`
- ⚠️ 升级/重装该插件会覆盖补丁，需重打（九图页仍会自动合成宫格底图所以不受影响，但流水线直用会回到老报错）

---

## 7. 开发常见坑

| 坑 | 说明 |
|---|---|
| 改了源码页面没变化 | 容器内构建，必须走「build → rsync → `up -d --build vue-web`」；浏览器强刷 Ctrl+F5 |
| JS 哈希指纹 | 构建产物名 `index-<hash>.js` 随源码变化，是判断线上是否新版本的唯一可靠依据 |
| `timeline_data` 是 JSON **字符串** | 节点输入是 STRING 类型，提交前 `JSON.stringify`，解析用 `JSON.parse` |
| 历史记录清空 | ComfyUI 历史存内存（`MAXIMUM_HISTORY_SIZE=10000`），重启容器即丢；官方无持久化参数（见 Issue #3776），目前没做替代 |
| 调试接口 | 想复现/回放任务：`GET /history/{id}` 拿 `prompt`，原样 `POST /prompt` 即可（验证补丁时的标准做法） |
| 视频"没内容" | 先看输入图 —— 若测试图是纯色块，输出自然只是色场流动（此前探针任务 `05d26683` 的教训） |
| 并行/占显存 | 队列忙时提交会排队；`/free` 只对 ComfyUI 进程生效，`nvidia-smi` 里其他 python 进程不受影响 |
