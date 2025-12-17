import 'zone.js';
import { bootstrapApplication } from '@angular/platform-browser';
import {
  HttpInterceptorFn,
  provideHttpClient,
  withInterceptors,
  withXsrfConfiguration
} from '@angular/common/http';
import { provideRouter } from '@angular/router';
import { provideAnimations } from '@angular/platform-browser/animations';
import { AppComponent } from './app/app.component';
import { routes } from './app/app.routes';
import { KNOWN_API_ORIGINS } from './app/config/api.config';

const CSRF_COOKIE = 'csrftoken';
const CSRF_HEADER = 'X-CSRFToken';
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE']);
const API_ORIGINS = KNOWN_API_ORIGINS;

const withCredentialsInterceptor: HttpInterceptorFn = (req, next) => {
  if (req.url.startsWith('http')) {
    return next(req.clone({ withCredentials: true }));
  }
  return next(req);
};

const readCookie = (name: string): string | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  const prefix = `${name}=`;
  const match = document.cookie
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(prefix));
  return match ? decodeURIComponent(match.slice(prefix.length)) : null;
};

const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  const method = req.method?.toUpperCase();
  const requiresToken = !!method && !SAFE_METHODS.has(method);
  const targetsApi = API_ORIGINS.some(origin => req.url.startsWith(origin));

  if (requiresToken && (targetsApi || req.url.startsWith('/api/')) && !req.headers.has(CSRF_HEADER)) {
    const token = readCookie(CSRF_COOKIE);
    if (token) {
      return next(req.clone({ headers: req.headers.set(CSRF_HEADER, token) }));
    }
  }
  return next(req);
};

bootstrapApplication(AppComponent, {
  providers: [
    provideHttpClient(
      withInterceptors([withCredentialsInterceptor, csrfInterceptor]),
      withXsrfConfiguration({
        cookieName: 'csrftoken',
        headerName: 'X-CSRFToken'
      })
    ),
    provideRouter(routes),
    provideAnimations(),
  ]
}).catch(err => console.error(err));
