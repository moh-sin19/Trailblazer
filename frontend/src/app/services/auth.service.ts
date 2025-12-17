import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, map, shareReplay, switchMap, tap } from 'rxjs/operators';

import { AuthenticatedUser, RegistrationResult } from '../models/user';
import { ProfileStore } from './profile.store';
import { ApiService } from './api.service';
import { API_BASE_URL } from '../config/api.config';

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegistrationPayload {
  username: string;
  email: string;
  password: string;
  displayName?: string;
}

export interface TwoFactorChallenge {
  twoFactorToken: string;
  detail?: string;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly baseUrl = API_BASE_URL;
  private csrfFetched = false;
  private csrfRequest$?: Observable<void>;

  constructor(
    private http: HttpClient,
    private profileStore: ProfileStore,
    private api: ApiService
  ) {}

  register(payload: RegistrationPayload): Observable<RegistrationResult> {
    return this.ensureCsrfToken().pipe(
      switchMap(() =>
        this.http.post<any>(`${this.baseUrl}/auth/register/`, this.serialiseRegistration(payload))
      ),
      map(raw => this.normaliseRegistration(raw))
    );
  }

  login(credentials: LoginCredentials): Observable<AuthenticatedUser | TwoFactorChallenge> {
    return this.ensureCsrfToken().pipe(
      switchMap(() =>
        this.http.post<any>(`${this.baseUrl}/auth/login/`, credentials, { observe: 'response' })
      ),
      map(response => {
        if (response.status === 202) {
          return {
            twoFactorToken: String(response.body?.two_factor_token ?? ''),
            detail: typeof response.body?.detail === 'string' ? response.body.detail : undefined
          } satisfies TwoFactorChallenge;
        }
        const user = this.api.normaliseAuthenticatedUser(response.body);
        this.profileStore.setProfile(user.profile);
        return user;
      })
    );
  }

  completeTwoFactor(twoFactorToken: string, code: string): Observable<AuthenticatedUser> {
    return this.ensureCsrfToken().pipe(
      switchMap(() =>
        this.http.post<any>(
          `${this.baseUrl}/auth/login/`,
          { two_factor_token: twoFactorToken, otp: code },
          { observe: 'response' }
        )
      ),
      map(response => {
        const user = this.api.normaliseAuthenticatedUser(response.body);
        this.profileStore.setProfile(user.profile);
        return user;
      })
    );
  }

  logout(allSessions = false): Observable<void> {
    return this.ensureCsrfToken().pipe(
      switchMap(() =>
        this.http.post(`${this.baseUrl}/auth/logout/`, allSessions ? { all_sessions: true } : {})
      ),
      map(() => void 0),
      tap(() => this.profileStore.setProfile(null))
    );
  }

  verifyEmail(token: string): Observable<AuthenticatedUser> {
    return this.ensureCsrfToken().pipe(
      switchMap(() =>
        this.http.post<any>(`${this.baseUrl}/auth/verify-email/`, { token })
      ),
      map(raw => this.api.normaliseAuthenticatedUser(raw))
    );
  }

  loadSession(): Observable<AuthenticatedUser | null> {
    return this.ensureCsrfToken().pipe(
      switchMap(() => this.http.get<any>(`${this.baseUrl}/auth/session/`))
    ).pipe(
      map(raw => this.api.normaliseAuthenticatedUser(raw)),
      tap(user => this.profileStore.setProfile(user.profile)),
      catchError(error => {
        if (error?.status === 401) {
          this.profileStore.setProfile(null);
          return of(null);
        }
        return throwError(() => error);
      })
    );
  }

  ensureCsrf(): Observable<void> {
    return this.ensureCsrfToken();
  }

  private ensureCsrfToken(): Observable<void> {
    if (this.csrfFetched) {
      return of(void 0);
    }

    if (!this.csrfRequest$) {
      this.csrfRequest$ = this.http
        .get(`${this.baseUrl}/auth/csrf/`)
        .pipe(
          map(() => void 0),
          tap(() => {
            this.csrfFetched = true;
          }),
          shareReplay(1)
        );
    }

    return this.csrfRequest$.pipe(
      catchError(err => {
        this.csrfRequest$ = undefined;
        return throwError(() => err);
      })
    );
  }

  private serialiseRegistration(payload: RegistrationPayload): Record<string, unknown> {
    const body: Record<string, unknown> = {
      username: payload.username,
      email: payload.email,
      password: payload.password
    };
    if (payload.displayName !== undefined && payload.displayName !== null) {
      body['display_name'] = payload.displayName;
    }
    return body;
  }

  private normaliseRegistration(raw: any): RegistrationResult {
    const user = this.api.normaliseAuthenticatedUser(raw?.user ?? raw);
    const detail = typeof raw?.detail === 'string' ? raw.detail : undefined;

    return {
      user,
      detail,
    };
  }
}
