import axios from 'axios';

const cfg = window.__APP_CONFIG__ || {};

// AuthProvider registers the MSAL token getter here (avoids a circular import)
let tokenGetter = null;
export function setTokenGetter(fn) {
  tokenGetter = fn;
}

const client = axios.create({
  baseURL: cfg.DASHBOARD_API_URL,
  // first cold fetch of a wide date range pages through the full dataset
  timeout: 300_000,
});

client.interceptors.request.use(async (config) => {
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    // 401 → token likely expired: re-acquire once and retry
    if (error.response?.status === 401 && tokenGetter && !original._retried) {
      original._retried = true;
      const token = await tokenGetter();
      if (token) {
        original.headers.Authorization = `Bearer ${token}`;
        return client(original);
      }
    }
    const message =
      error.response?.data?.error ||
      error.response?.statusText ||
      error.message ||
      'Request failed';
    return Promise.reject(new Error(message));
  }
);

export default client;
