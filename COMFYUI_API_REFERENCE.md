# ComfyUI 本地前端接口速查

> 适用范围：本目录 Vue 前端与本地 Codex 开发。本文只记录本项目常用的自托管 ComfyUI HTTP / WebSocket API；以服务实际版本和官方文档为准。
>
> 更新日期：2026-08-28

## 官方来源

- [服务器路由（HTTP / WebSocket）](https://docs.comfy.org/zh/development/comfyui-server/comms_routes)
- [API 示例](https://docs.comfy.org/zh/development/comfyui-server/api-examples)
- [服务器消息（WebSocket）](https://docs.comfy.org/zh/development/comfyui-server/comms_messages)
- [当前 ComfyUI 服务端实现](https://github.com/Comfy-Org/ComfyUI/blob/master/server.py)

## 本项目约定

服务地址由 [`src/assets/comfyui_servers.json`](src/assets/comfyui_servers.json) 维护。调用前统一去掉末尾斜杠：

```js
const base = server.value.replace(/\/$/, '')
```

工作流必须使用“导出 API 格式”的 JSON（节点 ID 为键，节点包含 `class_type` 和 `inputs`），不能直接提交 ComfyUI 编辑器保存的工作流界面 JSON。

当前页面会根据服务配置的 `apiFile` 选择匹配的工作流模板，再将用户输入写入目标节点的 `inputs`。

## HTTP 接口

| 目的 | 方法与路径 | 关键请求 / 响应 |
| --- | --- | --- |
| 系统状态 | `GET /system_stats` | Python、设备、显存等 |
| 节点定义 | `GET /object_info` | 全部节点及输入定义 |
| 单节点定义 | `GET /object_info/{node_class}` | 指定节点的输入定义 |
| 上传图片 | `POST /upload/image` | `FormData`：`image`、可选 `type=input`；响应含 `name`、`subfolder`、`type` |
| 提交工作流 | `POST /prompt` | `{ "prompt": workflow, "client_id"?: "uuid", "prompt_id"?: "uuid" }`；响应含 `prompt_id`、`number` |
| 查询队列 | `GET /queue` | `queue_running`、`queue_pending` |
| 查询历史 | `GET /history?max_items=100` | 近期任务字典 |
| 查询单任务 | `GET /history/{prompt_id}` | 完成后的状态与 `outputs` |
| 获取输出 | `GET /view` | 查询参数：`filename`、`subfolder`、`type` |
| 删除排队任务 | `POST /queue` | `{ "delete": ["prompt_id"] }` |
| 清空等待队列 | `POST /queue` | `{ "clear": true }`；不要在普通页面操作中使用 |
| 中断当前执行 | `POST /interrupt` | 停止当前工作流，不是按任务 ID 精确取消 |
| 精确取消任务（新版） | `POST /api/jobs/{job_id}/cancel` | 返回 `{ "cancelled": true|false }`；旧服务可能返回 `404` |

### 图片上传

```js
async function uploadImage(base, file) {
  const body = new FormData()
  body.append('image', file, file.name)
  body.append('type', 'input')
  const response = await fetch(`${base}/upload/image`, { method: 'POST', body })
  if (!response.ok) throw Error(`上传失败：HTTP ${response.status}`)
  const data = await response.json()
  return data.subfolder ? `${data.subfolder}/${data.name}` : data.name
}
```

上传后的返回路径应写入工作流中读取图片或时间线数据所需的字段。不要把浏览器本地 `File` 对象直接放进提交 JSON。

### 提交与轮询

```js
const response = await fetch(`${base}/prompt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ prompt: workflow }),
})
const data = await response.json()
if (!response.ok || data.error) throw Error(data.error?.message || data.error || '提交失败')
const promptId = data.prompt_id

const history = await fetch(`${base}/history/${promptId}`).then(r => r.json())
const entry = history[promptId]
```

`/history/{prompt_id}` 在任务尚未结束时可能没有条目。完成状态通常由 `entry.status.completed` 和 `entry.status.status_str` 判断；输出位于 `entry.outputs`。

视频节点输出一般位于 `videos`，也可能使用 `images` 或 `gifs` 字段承载文件信息。使用 `/view` 时必须保留服务返回的 `filename`、`subfolder` 和 `type`。

### 取消任务的兼容策略

优先使用新版精确取消接口；若返回 `404`，说明服务不支持该接口：

```js
// 排队任务：按 ID 从队列删除
await fetch(`${base}/queue`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ delete: [promptId] }),
})

// 运行中任务：旧版只能中断“当前”工作流
await fetch(`${base}/interrupt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: '{}',
})
```

旧版 `/interrupt` 不是按 `prompt_id` 定位：任务状态在点击前发生变化时，可能中断当时正在运行的另一项任务。因此任务管理页面必须二次确认，并优先使用新版接口。

## WebSocket

连接地址：`ws(s)://<host>/ws?clientId=<uuid>`。HTTP 为 `http:` 时使用 `ws:`，HTTPS 为 `https:` 时使用 `wss:`。

```js
const clientId = crypto.randomUUID()
const wsBase = base.replace(/^http/, 'ws')
const ws = new WebSocket(`${wsBase}/ws?clientId=${encodeURIComponent(clientId)}`)

ws.onmessage = event => {
  if (typeof event.data !== 'string') return // 二进制帧可能是预览或节点直接输出
  const message = JSON.parse(event.data)
  const { type, data } = message
  if (data?.prompt_id !== promptId) return
  if (type === 'executing' && data.node === null) {
    // 本任务执行结束；随后用 /history/{promptId} 读取最终输出
  }
}
```

| 消息类型 | 用途 |
| --- | --- |
| `status` | 队列变化，`data.exec_info.queue_remaining` 为剩余数量 |
| `execution_start` | 任务开始，含 `prompt_id` |
| `executing` | 节点开始；`node === null` 表示该任务执行完毕 |
| `progress` | 进度，含 `node`、`value`、`max` |
| `executed` | 节点产生 UI 输出时发送，不保证每个节点都有 |
| `execution_success` | 全部节点执行成功，含时间戳 |
| `execution_error` | 执行失败 |
| `execution_interrupted` | 被中断，含任务与节点信息 |
| `execution_cached` | 命中节点缓存 |

当前前端使用 HTTP 轮询，原因是简单且兼容现有服务。需要更及时的进度、队列变化或节点级进度时，可在提交时传入同一个 `client_id`，再按 `prompt_id` 过滤 WebSocket 消息；最终输出仍以 `/history/{prompt_id}` 为准。

## CORS 与安全

- 浏览器直连不同域名 / 端口的 ComfyUI 时，ComfyUI 必须允许该前端来源的 CORS 请求。
- 开发环境不可将服务地址、上传接口或取消接口暴露到不受信任的公网来源。
- 服务地址来自手动输入时，前端仅负责请求；请在网络层限制可访问的 ComfyUI 实例。

## 修改前端时的检查清单

1. 在 `comfyui_servers.json` 新增服务时，同时设置正确的 `apiFile`。
2. 确认工作流中的节点类型和模型文件名与目标服务一致。
3. 所有 `fetch` URL 都使用去除末尾 `/` 的 `base`。
4. 提交接口检查 HTTP 状态、`error` 和 `node_errors`。
5. 视频结果同时兼容 `videos`、`images`、`gifs` 输出字段。
6. 取消运行中任务时优先 `/api/jobs/{id}/cancel`；旧版 `/interrupt` 必须展示风险提示。
7. 浏览器跨域失败时，先检查 ComfyUI CORS 启动参数和反向代理响应头。
