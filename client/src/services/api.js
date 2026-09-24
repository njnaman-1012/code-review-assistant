// All communication with the backend goes through this file.
// The frontend never talks to AI services directly - only to our own API.
import axios from 'axios';

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 5 * 60 * 1000, // AI reviews can take a minute or two
  headers: { 'Content-Type': 'application/json' },
});

// Turns any Axios error into a message that can be shown to the user.
export function getErrorMessage(error) {
  let data = error?.response?.data;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  if (data?.error?.message) return data.error.message;
  if (error?.code === 'ECONNABORTED') return 'The request timed out. The review may be taking too long - please try again.';
  // 502/503/504 without our JSON error body means the backend itself is unreachable.
  if ([502, 503, 504].includes(error?.response?.status)) {
    return 'The service is not reachable right now. Please try again in a moment.';
  }
  if (error?.response) return 'Something went wrong on the server. Please try again.';
  if (error?.request) return 'Cannot reach the service. Please check your internet connection and try again.';
  return error?.message || 'An unexpected error occurred.';
}

// Generating a complete corrected / improved file can take a few minutes
// with the free AI services (the server may also retry or switch provider).
const CODE_ACTION_TIMEOUT = 10 * 60 * 1000;

export const api = {
  getHealth: () => http.get('/health').then((res) => res.data.data),
  createReview: ({ language, code }) => http.post('/reviews', { language, code }).then((res) => res.data.data),
  listReviews: (params = {}) => http.get('/reviews', { params }).then((res) => res.data.data),
  getReview: (id) => http.get(`/reviews/${id}`).then((res) => res.data.data),
  deleteReview: (id) => http.delete(`/reviews/${id}`).then((res) => res.data.data),
  // "Fix / Correct Code" and "Improve Code" - both return the complete source file.
  correctCode: (id) => http.post(`/reviews/${id}/correct`, {}, { timeout: CODE_ACTION_TIMEOUT }).then((res) => res.data.data),
  improveCode: (id) => http.post(`/reviews/${id}/improve`, {}, { timeout: CODE_ACTION_TIMEOUT }).then((res) => res.data.data),
  getReport: (id, format) => http
    .get(`/reviews/${id}/report`, { params: { format }, responseType: 'text', transformResponse: (body) => body })
    .then((res) => res.data),
};
