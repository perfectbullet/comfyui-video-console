export const archiveBase = (
  import.meta.env.VITE_ARCHIVER_URL || "http://192.168.8.231:8610"
).replace(/\/$/, "");

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
