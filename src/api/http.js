/**
 * 解析 Archiver 服务基址（运行时决定，不写死在产物里）。
 *
 * 优先级：
 *   1. 构建期显式指定 `VITE_ARCHIVER_URL`（临时覆盖用）
 *   2. 页面挂在子路径下，如 https://xxx/comfyui-video-console/
 *      → 取同源同前缀，由 nginx 把 `/<前缀>/api/` 反代到 archiver 后端。
 *        绝不能回退到内网 IP：HTTPS 页面请求 http:// 会被浏览器按
 *        「混合内容」直接拦掉，公网也路由不到 192.168.8.231。
 *   3. 页面在根路径（如内网直连容器 http://192.168.8.231:8600/）
 *      → 回退到 archiver 独立服务的内网地址。
 *
 * 这样同一份 dist 产物在「线上子路径」和「内网根路径」下都能跑，无需分别构建。
 */
function resolveArchiveBase() {
  const fromEnv = import.meta.env.VITE_ARCHIVER_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, "");

  // 页面所在目录，例如 /comfyui-video-console/ → /comfyui-video-console
  const dir = window.location.pathname.replace(/[^/]*$/, "");
  if (dir && dir !== "/") return dir.replace(/\/$/, "");

  return "http://192.168.8.231:8610";
}

export const archiveBase = resolveArchiveBase();

function errorMessage(response, data) {
  if (typeof data?.detail === "string") return data.detail;
  if (typeof data?.error === "string") return data.error;
  if (data?.error?.message) return data.error.message;
  return `HTTP ${response.status}`;
}

/**
 * @param {string} url
 * @param {RequestInit & { errorPrefix?: string }} [options]
 */
export async function request(url, options = {}) {
  const { errorPrefix, ...init } = options;
  const response = await fetch(url, init);

  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const detail = errorMessage(response, data);
    throw Error(errorPrefix ? `${errorPrefix}：${detail}` : detail);
  }

  return data;
}

/**
 * Archiver 服务请求（自动拼接 archiveBase）。
 * @param {string} path 以 / 开头的路径
 * @param {RequestInit & { errorPrefix?: string }} [options]
 */
export function archiveRequest(path, options = {}) {
  return request(`${archiveBase}${path}`, options);
}

/** @returns {Promise<Array<{ id: string, label: string, url: string, apiFile?: string }>>} */
export async function fetchComfyuiServers() {
  const list = await archiveRequest("/api/comfyui-servers", {
    errorPrefix: "服务列表响应异常",
  });
  return Array.isArray(list) ? list : [];
}
