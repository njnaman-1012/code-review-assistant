// Authentication middleware. The server decides who the user is from the
// session cookie only - never from a user ID sent by the browser.
import { readCookie } from '../utils/cookies.js';
import { AppError } from '../utils/AppError.js';

export const SESSION_COOKIE = 'cra_session';
export const VERIFY_COOKIE = 'cra_verify';

export function createAuthMiddleware({ authService }) {
  return {
    // Protects a route: without a valid session the request stops here (401).
    async requireAuth(req, res, next) {
      const user = await authService.authenticate(readCookie(req, SESSION_COOKIE));
      if (!user) return next(new AppError('Please log in to continue.', 401, 'UNAUTHENTICATED'));
      req.user = user;
      res.setHeader('Cache-Control', 'no-store'); // personal data is never cached
      return next();
    },
  };
}

// Blocks requests that change data when they come from another website
// (cross-site request forgery). The session cookie is also SameSite=Lax.
export function createSameOriginGuard({ clientOrigins = [], allowLocalhost = false }) {
  return function sameOriginGuard(req, res, next) {
    const origin = req.headers.origin;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !origin) return next();

    let url;
    try {
      url = new URL(origin);
    } catch {
      url = null;
    }
    const ownHosts = [req.headers.host, req.headers['x-forwarded-host']].filter(Boolean);
    const allowed = url && (
      clientOrigins.includes(origin)
      || ownHosts.includes(url.host)
      // Development: the Vite dev server may run on any local port.
      || (allowLocalhost && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    );
    if (!allowed) return next(new AppError('This request is not allowed from another website.', 403, 'FORBIDDEN_ORIGIN'));
    return next();
  };
}
