/**
 * 解析 Archiver 服务基址（运行时决定，不写死在产物里）。
 *
 * 优先级：
 *   1. 构建期显式指定 `VITE_ARCHIVER_URL`（临时覆盖用）
 *   2. 页面挂在子路径下，如 https://xxx/comfyui-video-console/
 *      → 返回 "/comfyui-video-console"，由线上 nginx 反代 `/<前缀>/api/`。
 *   3. 页面在根路径（本地 Vite / 测试 http://192.168.8.231:8600/）
 *      → 返回 ""（当前源 + /api/...）。
 *        本地：vite.config.js 的 proxy
 *        测试：nginx location /api/ → :8610
 *
 * 同一份 dist：线上走 2，本地/测试走 3，互不影响。
 */
function resolveArchiveBase() {
  const fromEnv = import.meta.env.VITE_ARCHIVER_URL;
  if (fromEnv) return String(fromEnv).replace(/\/$/, "");

  // 页面所在目录，例如 /comfyui-video-console/ → /comfyui-video-console
  const dir = window.location.pathname.replace(/[^/]*$/, "");
  if (dir && dir !== "/") return dir.replace(/\/$/, "");
  return "";
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
