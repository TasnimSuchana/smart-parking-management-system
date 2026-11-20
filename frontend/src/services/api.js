import axios from 'axios';

const api = axios.create({ baseURL: '/api/v1', withCredentials: true, timeout: 20000 });
const csrf = () => document.cookie.split('; ').find((c) => c.startsWith('csrf='))?.slice(5) || '';

api.interceptors.request.use((cfg) => { if (!['get', 'head', 'options'].includes(cfg.method)) cfg.headers['X-CSRF-Token'] = decodeURIComponent(csrf()); return cfg; });

// Transparent refresh: one in-flight refresh shared by all failed requests, then retry once.
let refreshing = null;
api.interceptors.response.use((r) => r, async (error) => {
  const { config, response } = error;
  if (response?.status === 401 && config && !config._retry && !config.url.startsWith('/auth/')) {
    config._retry = true;
    refreshing ||= api.post('/auth/refresh').finally(() => { refreshing = null; });
    try { await refreshing; return api(config); } catch { window.dispatchEvent(new Event('auth:expired')); }
  }
  return Promise.reject(error);
});

export const unwrap = (p) => p.then((r) => r.data.data);
export const unwrapPaged = (p) => p.then((r) => ({ items: r.data.data, meta: r.data.meta }));
export default api;
