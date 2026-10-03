import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('salesmesh_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// An expired or invalid session gets a 401 from any protected route: clear it and go to
// the login page. Auth endpoints are skipped — a 401 there means wrong credentials, which
// the login form reports itself.
api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isAuthCall = error.config?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && !isAuthCall && localStorage.getItem('salesmesh_token')) {
      localStorage.removeItem('salesmesh_token');
      localStorage.removeItem('salesmesh_user');
      window.location.assign('/login?expired=1');
    }
    return Promise.reject(error);
  }
);

export default api;
