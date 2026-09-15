# ComfyUI 视频控制台 · 部署说明

> 前端提供 ｜ 更新于 2026-09-15 ｜ 项目 `comfyui-video-console`
>
> 线上地址：`https://ailabs.zenking.cc/comfyui-video-console/`

前端是纯静态页面（3 个文件，约 164 KB）。页面走 HTTPS，接口通过**同源反代**访问，
所以**只需要 Nginx**，浏览器侧不用开任何跨域。

---

## 零、先看这张图：请求是怎么走的

```
浏览器  https://ailabs.zenking.cc/comfyui-video-console/
   │
   ├─ /comfyui-video-console/            ← 前缀反代，剥掉前缀
   │     └─→ http://172.17.220.95:8600/  ← docker 容器 vue-web（serve -s 托管 dist）
   │
   ├─ /comfyui-video-console/api/...     ← 前缀反代，剥前缀 + 补回 /api/
   │     └─→ http://<archiver 主机>:8610/api/...
   │
   └─ /comfyui/...                       ← 前缀反代
         └─→ http://<comfyui 主机>:8188/...
```

**关键点**：页面挂在子路径下，所以产物里的资源引用和接口基址**都必须是相对的**，
一旦写成 `/assets/...` 这种以 `/` 开头的绝对路径，就会跑到域名根去，
而域名根是禅境AI 主站，它会把所有找不到的路径兜底成自己的 `index.html` → `text/html`。

---

## 一、产物从哪来、怎么发

**A. 走仓库脚本（推荐，现有 docker 就是这条路的产物）**

```bash
cd ~/Desktop/eureka_work/comfyui-video-console
REMOTE_HOST=zenking@192.168.8.231 ./build_web_and_deploy.sh
```

脚本会 rsync 源码到 `/data/aigc/comfyui-h3/web/`，再在服务器上
`docker compose up -d --build vue-web`。注意 `Dockerfile` 里有 `npm run build`——
**dist 是在镜像构建阶段生成的**，所以这条路不需要手动传 dist。

**B. 只换静态产物**

```bash
unzip -o dist.zip -d /tmp/deploy
cp -r /tmp/deploy/dist/. /data/aigc/comfyui-h3/comfyui-video-console/
```

> ⚠️ 如果服务器上的 `vue-web` 是**镜像内烘焙 dist**（没把宿主机目录挂进容器），
> 那么只复制文件**不生效**，必须 `docker compose up -d --build vue-web` 重建。
> 用第二节末尾的 ① 号校验命令确认入口 hash 变了，就知道走通了没有。

---

## 二、Nginx 配置

实测线上拓扑（2026-09-15）：公开入口 nginx 在 `ailabs.zenking.cc`，
该 `server` 块的 `location /` 属于**禅境AI 主站**。下面 ①②③ 三条 location 是挂进
同一个 server 块的。

```nginx
server {
    listen 443 ssl;
    http2 on;                                   # nginx < 1.25.1 改成 listen 443 ssl http2;
    server_name ailabs.zenking.cc;
    ssl_certificate     /etc/nginx/ssl/<域名>.crt;
    ssl_certificate_key /etc/nginx/ssl/<域名>.key;

    client_max_body_size 200m;                  # 不设的话上传图片报 413
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;

    # ── ① 前端静态页（已有） ──────────────────────────────────────────
    # proxy_pass 结尾这个 "/" 不能省：它会把 /comfyui-video-console/ 前缀剥掉，
    # 上游容器收到的才是 /assets/xxx.js。去掉它 → 上游收到带前缀的路径 → 404。
    location /comfyui-video-console/ {
        proxy_pass http://172.17.220.95:8600/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200m;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }

    # ── ② archiver 后端接口（★ 当前缺失，必须补） ─────────────────────
    # 不补的后果：页面能打开，但「服务器列表」拿到的是容器 SPA 兜底返回的
    # index.html（200 + text/html），解析不出 JSON，下拉框永远空的。
    location /comfyui-video-console/api/ {
        proxy_pass http://<archiver 主机>:8610/api/;   # 同样：剥前缀 + 补回 /api/
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200m;
        proxy_read_timeout 600s;
        proxy_buffering off;
    }

    # ── ③ ComfyUI 本体（★ 当前缺失，生成任务必需） ───────────────────
    # 浏览器要直接跟 ComfyUI 说话（提交任务、轮询进度、取图）。
    # 页面上写死的 http://192.168.8.231:8188 在 HTTPS 页面下会被「混合内容」拦掉，
    # 必须经这里反代出去。
    location /comfyui/ {
        proxy_pass http://<comfyui 主机>:8188/;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        client_max_body_size 200m;
        proxy_read_timeout 3600s;           # 出图/出视频很慢，别用默认 60s
        proxy_buffering off;
    }

    # ④ 禅境AI 主站（原有的，别动）
    location / { try_files $uri $uri/ /index.html; }
}
```

`<archiver 主机>` / `<comfyui 主机>`：**archiver / ComfyUI 装在宿主机上就写 `127.0.0.1`**，
跨机才写内网 IP。反代之后浏览器只认同源，两边都不用配 CORS。

**为什么 ①②③ 的书写顺序无所谓**：nginx 对普通前缀 location 用的是
**最长前缀优先**，不是先到先得。`/comfyui-video-console/api/` 比
`/comfyui-video-console/` 长，所以一定先命中它。不需要正则，也不需要调顺序。

---

## 三、子路径部署红线（踩了就故障）

### 红线 1：`vite.config.js` 的 `base` 必须相对，不能是 `'/'`

```js
base: process.env.VITE_BASE_PATH || './',   // ✅
// base: '/',                                // ❌ 子路径下必挂
```

`base: '/'`（Vite 默认）会把资源写成绝对路径 `src="/assets/index-xxx.js"`。
页面在 `/comfyui-video-console/` 下时，浏览器会去请求**域名根**的
`/assets/index-xxx.js`，那里是禅境AI 的 SPA 兜底，返回 `text/html`，于是报：

> Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of "text/html".

**这个坑只能靠重新构建修复，改 nginx 配置救不回来**（nginx 根本没参与，请求压根没进这个 location）。

用 `'./'` 而不是写死 `'/comfyui-video-console/'` 的原因：同一份产物还要在
`http://192.168.8.231:8600/`（容器根路径）下跑，写死子路径会把内网直连弄坏。

### 红线 2：`archiveBase` 不能写死内网 IP

`src/api/http.js` 里的基址**运行时解析**，不写死在产物里：

| 访问方式 | 解析出的基址 | 实际请求 |
|---|---|---|
| `https://域名/comfyui-video-console/` | `/comfyui-video-console` | `/comfyui-video-console/api/comfyui-servers` |
| `http://192.168.8.231:8600/`（内网直连）| `http://192.168.8.231:8610` | `http://192.168.8.231:8610/api/comfyui-servers` |

规则：**页面上级路径不是根 → 用同源同前缀；在根路径 → 回退内网地址**。
优先级最高的是构建期变量 `VITE_ARCHIVER_URL`（临时覆盖用）。

所以**默认构建不需要带任何环境变量**，同一份 dist 两个环境都能跑。
但要注意：解析成同源前缀后，**必须在 nginx 补上 ② 那条反代**，否则请求
会落到容器 SPA 兜底上、返回 HTML。

### 红线 3：ComfyUI 地址同理

`src/App.vue`（分镜）和 `src/I2VApp.vue`（图生视频）里 `server` 的默认值是
写死的 `http://192.168.8.231:8188`，HTTPS 页面下会被浏览器按混合内容拦掉。
两个选择：

- **加 ③ 反代 + 把默认值改成相对路径 `/comfyui`**（推荐，一份产物两边都能跑）；
- 或者由 archiver 的 `/api/comfyui-servers` 返回浏览器可达的 url（相对路径 `/comfyui`），
  仅使用「九宫格」这类从接口取服务器列表的页面。

`comfyui_servers.json` 已无人 import，服务列表**完全依赖 ② 接口**，接口不通时不会静默降级。

---

## 四、发布后校验

```bash
# ① 入口 hash 变了没有（证明新产物真的上线了）
curl -s https://ailabs.zenking.cc/comfyui-video-console/ | grep -o 'src="[^"]*"'
#    期望看到 ./assets/index-<新hash>.js；若还是旧 hash → 产物没换成功，
#    镜像烘焙的情况下需要 docker compose up -d --build vue-web

# ② 资源必须是 application/javascript，不能是 text/html
JS=$(curl -s https://ailabs.zenking.cc/comfyui-video-console/ | grep -o 'assets/index-[^"]*\.js')
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "https://ailabs.zenking.cc/comfyui-video-console/$JS"

# ③ 接口必须返回 JSON（补了 ② 号反代之后）
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "https://ailabs.zenking.cc/comfyui-video-console/api/comfyui-servers"

# ④ ComfyUI 反代通不通（补了 ③ 号反代之后）
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  "https://ailabs.zenking.cc/comfyui/system_stats"
```

本地自查产物（不含 nginx）：

```bash
unzip -p dist.zip dist/index.html | grep -o 'src="[^"]*"'
#    必须是 ./assets/... ，出现 /assets/... 就是 base 又写错了
```

---

## 五、症状 → 原因速查

| 症状 | 真正原因 | 怎么救 |
|---|---|---|
| 控制台报 `MIME type of "text/html"`，白屏 | 产物资源路径是 `/assets/` 绝对路径，请求跑到域名根被别的站点兜底 | 重新构建（`base: './'`），改 nginx 无效 |
| 页面能开，但「服务器列表」是空的 | `/comfyui-video-console/api/` 没反代，请求落到容器 SPA 兜底 | 补 nginx ② |
| 页面报「服务列表响应异常」/ 网络错误 | 同上；旧产物里基址是内网 IP，被混合内容拦 | 补 nginx ② + 用新版产物 |
| 提交生成任务没反应 / 连不上 | `8188` 不通，混合内容或内网不可达 | 补 nginx ③ |
| 上传图片 413 | nginx 没放开体积 | `client_max_body_size 200m` |
| 发版后用户还在跑旧版 | `index.html` 被缓存 | `location = /index.html` 加 `no-store`（或靠宿主机文件名 hash） |

> 注：容器里用的是 `serve -s .`（SPA 模式），**找不到的文件会返回 `index.html` 而不是 404**。
> 所以「JS 拿到 text/html」既可能是路径错了，也可能是文件真的没上传，两种都要查。
