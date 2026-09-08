# 前端 Web 控制台部署与运维（231）

> 本文说明导演台 Web UI（Vue 3 + Vite）如何通过 Docker Compose 部署到 `192.168.8.231` 并日常管理。
> 日常发布（改代码 → 上线）的命令速查见同目录《前端构建与部署命令速查.md》。
> 页面结构、核心实现与 API 依赖见同目录《前端Web控制台开发指南.md》。
> 最后更新：2026-08-26

---

## 1. 概述

| 项 | 内容 |
| --- | --- |
| 服务器 | `192.168.8.231`（Ubuntu 22.04，用户 `zenking`） |
| 项目根目录 | `/data/aigc/comfyui-h3/` |
| 前端源码目录 | `/data/aigc/comfyui-h3/web/` |
| 容器名 | `comfyui-minimax-h3-web` |
| 镜像名 | `comfyui-h3-vue-web` |
| 端口映射 | `0.0.0.0:8600 -> 80`（容器内由 `serve` 提供静态文件） |
| 访问地址 | `http://192.168.8.231:8600` |
| 编排方式 | Docker Compose（`docker-compose.yml` 中的 `vue-web` 服务） |
| 后端依赖 | `comfyui-h3` 容器（8188 端口，已开启 CORS） |

> 前端只负责静态页面 + 浏览器端直接调用 ComfyUI REST API，**不占用 GPU**。部署/重启前端不会影响 `comfyui-h3` 推理容器，也不会影响服务器上其他用户的容器（`vllm-*`、`chattutor-*`、`infinitetalk-*` 等）。

---

## 2. 架构与数据流

```text
浏览器 ──http://192.168.8.231:8600──> [comfyui-minimax-h3-web]  (serve 静态文件, 容器内 :80)
                                            │
                                            │ 浏览器跨域调用 (CORS 已开)
                                            ▼
                                    [comfyui-h3]  :8188  (ComfyUI REST API)
```

- 页面由 `serve`（Node 静态服务器）托管，构建产物是 Vite 打出的 `dist/`。
- 前端在浏览器里直接 `fetch` ComfyUI 的 `8188` 接口（上传图片、提交 prompt、轮询结果），因此 **ComfyUI 必须开启 `--enable-cors-header`**，否则上传图片会报 `Failed to fetch`。

---

## 3. 目录结构

### 3.1 本地源码（`comfyui-video-console/`）

```text
web/
├── Dockerfile          # 多阶段构建：node:22-alpine 构建 -> serve 运行
├── .dockerignore       # 排除 node_modules / dist / .vite / 日志
├── .gitignore          # Git 忽略（node_modules / dist / 日志 / .env）
├── package.json        # vue 3 + vite
├── package-lock.json
├── vite.config.js      # dev/build 配置，build.outDir = dist
├── index.html
└── src/
    ├── main.js             # 按 ?mode= 路由分发 5 个页面
    ├── App.vue             # ?mode=storyboard（缺省）：九宫格分镜生成（单张 3x3 图）
    ├── I2VApp.vue          # ?mode=i2v：I2V 首帧生视频
    ├── DirectorApp.vue     # ?mode=director：多模式导演台
    ├── NineImagesApp.vue   # ?mode=nine-images：九图分镜版（9 张独立图时间线，核心页面）
    ├── SystemInfoApp.vue   # ?mode=system：系统信息 + 释放显存
    └── assets/             # 工作流模板 JSON（含 cs_h3_9panel_storyboard.api-v2.json）
```

> `comfyui-video-console/` 是独立 Git 仓库（初始提交 `1a251b9`），源码改动先 `git commit` 再发布，便于回溯。

### 3.2 服务器（`/data/aigc/comfyui-h3/`）

```text
/data/aigc/comfyui-h3/
├── docker-compose.yml  # 含 comfyui-h3 + vue-web 两个服务
└── web/                # 与本地 web/ 同步后的前端源码（docker build 上下文）
    ├── Dockerfile
    ├── package*.json
    ├── vite.config.js
    ├── index.html
    └── src/
```

---

## 4. 部署 / 更新流程

> 适用场景：本地 `comfyui-video-console/` 源码（尤其是 `src/`）有改动，需要把新前端推到 231 并生效。

### 4.0 第 0 步：提交 Git（可选但推荐）

```bash
cd /home/zj/aigc/comfyui-video-console
git add -A && git commit -m "改动说明"
```

### 4.1 第 1 步：同步源码到服务器

**方式 A（推荐，环境有 rsync 时）：**

```bash
rsync -az --delete \
  --exclude 'node_modules' --exclude '.vite' --exclude '*.log' --exclude '.DS_Store' \
  comfyui-video-console/ \
  zenking@192.168.8.231:/data/aigc/comfyui-h3/web/
```

**方式 B（无 rsync 时，tar 管道，本次实测可用）：**

```bash
SRC=comfyui-video-console
tar czf - --exclude node_modules --exclude .vite --exclude '*.log' --exclude .DS_Store -C "$SRC" . \
| ssh zenking@192.168.8.231 \
  'rm -rf /data/aigc/comfyui-h3/web && mkdir -p /data/aigc/comfyui-h3/web && tar xzf - -C /data/aigc/comfyui-h3/web'
```

> 排除 `node_modules` / `.vite` 是因为它们会在容器内重新生成；`dist` 也会被容器内的 `vite build` 重新产出，无需事先打包。

### 4.2 第 2 步：在服务器上用 Compose 重建并启动

```bash
ssh zenking@192.168.8.231
cd /data/aigc/comfyui-h3
docker compose up -d --build vue-web
```

- `--build`：强制用最新的 `web/` 重新构建镜像（会执行 `npm install` + `vite build`）。
- 只指定 `vue-web`，**不会重建/重启 `comfyui-h3`**（它作为依赖项已 Running，会被保留）。
- 首次或缓存失效时，构建会拉取 `node:22-alpine` 并执行 `npm install`，确保服务器可访问 Docker Hub 与 npm registry。

### 4.3 第 3 步：验证

```bash
# 容器状态（应看到 comfyui-minimax-h3-web Up，端口 8600->80）
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" | grep comfyui

# 页面返回 200
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:8600/

# 确认新产物已生效（标题 + 最新 JS 文件名）
curl -s http://192.168.8.231:8600/ | grep -E "<title>|index-.*\.js"
```

---

## 5. 日常管理命令

```bash
cd /data/aigc/comfyui-h3

# 启动 / 重启前端
docker compose up -d vue-web
docker compose restart vue-web

# 重新构建并启动（源码改动后）
docker compose up -d --build vue-web

# 查看状态
docker compose ps

# 查看前端日志（实时）
docker compose logs -f vue-web
# 或
docker logs -f comfyui-minimax-h3-web

# 停止 / 删除前端容器（不影响 comfyui-h3）
docker compose stop vue-web
docker compose down vue-web        # 仅停止并移除 vue-web 容器
```

> 注意：`docker compose down`（不带服务名）会停止**所有**服务，包括 `comfyui-h3` 推理容器，慎用。日常维护前端请始终带上 `vue-web`。

---

## 6. 构建原理（Dockerfile 多阶段）

```dockerfile
# 构建阶段：拉取依赖并打包
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build            # 产出 dist/

# 运行阶段：极简静态服务
FROM node:22-alpine
RUN npm install -g serve
WORKDIR /app
COPY --from=builder /app/dist .
EXPOSE 80
CMD ["serve", "-s", ".", "-l", "80"]
```

- 构建缓存：只要 `package*.json` 不变，`npm install` 层会被缓存，重新部署通常只需几秒的 `vite build`。
- 产物哈希（如 `index-Dv7tGVDM.js`）随源码变化而变，可作为"是否部署了新代码"的快速指纹。

---

## 7. 回滚

前端是纯静态页面，回滚即"用旧源码重新构建"：

```bash
# 1) 把需要回滚的 web/ 源码同步到服务器（见 4.1）
# 2) 重新构建
cd /data/aigc/comfyui-h3 && docker compose up -d --build vue-web
```

如需保留历史镜像，可在重建前 `docker tag comfyui-h3-vue-web:latest comfyui-h3-vue-web:<日期>` 打标签，便于回切。

---

## 8. 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `docker compose build` 卡在拉取 `node:22-alpine` | 服务器无法访问 Docker Hub | 检查网络/代理；或预先在有网的机器 `docker pull node:22-alpine` 后 `docker save/load` |
| `npm install` 失败 / 超时 | npm registry 不可达 | 配置 npm 镜像源（如 `npm config set registry https://registry.npmmirror.com`）后重试 |
| 页面能打开，但上传图片报 `Failed to fetch` | ComfyUI 未开 CORS | 确认 `comfyui-h3` 的 `CLI_ARGS=--enable-cors-header`，改后 `docker compose restart comfyui-h3` |
| 8600 端口被占用 | 旧容器未停或其他进程占用 | `docker ps` 查占用；`docker compose down vue-web` 后重试 |
| 改动 `src/` 后页面没变化 | 没重新 `--build` / 浏览器缓存 | 重新 `docker compose up -d --build vue-web`；浏览器强刷（Ctrl+Shift+R） |
| 部署后 `comfyui-h3` 也重启了 | 误用了 `docker compose up -d`（不带服务名）或 `down` | 只针对 `vue-web` 操作；若误重启，单独 `docker compose up -d comfyui-h3` 拉起 |

---

## 9. 验证清单（部署后自测）

- [ ] `docker ps` 中 `comfyui-minimax-h3-web` 状态为 `Up`，端口 `0.0.0.0:8600->80`
- [ ] `http://192.168.8.231:8600` 返回 200，标题为 `MiniMax H3 视频生成控制台`
- [ ] 页面引用的 JS/CSS 文件名与本次构建一致
- [ ] `comfyui-h3` 仍为 `Up`（未被影响）
- [ ] `http://127.0.0.1:8188/` 响应头含 `Access-Control-Allow-Origin: *`
