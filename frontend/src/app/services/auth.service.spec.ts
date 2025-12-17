import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { of, throwError } from 'rxjs';

import { AuthService, TwoFactorChallenge } from './auth.service';
import { ApiService } from './api.service';
import { ProfileStore } from './profile.store';
import { AuthenticatedUser } from '../models/user';
import { API_BASE_URL } from '../config/api.config';

describe('AuthService', () => {
  let service: AuthService;
  let httpMock: HttpTestingController;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let profileStoreSpy: jasmine.SpyObj<ProfileStore>;

  const baseUrl = API_BASE_URL;
  const rawUser = {
    id: 42,
    username: 'trailblazer',
    email: 'explorer@example.com',
    profile: {
      id: 99,
      username: 'trailblazer',
      display_name: 'Explorer',
      experience: 'beginner',
      experience_label: 'Beginner',
      role: 'standard',
      role_label: 'Standard user',
      email: 'explorer@example.com',
      updated_at: '2024-01-01T00:00:00Z'
    }
  };

  const normalisedUser: AuthenticatedUser = {
    id: 42,
    username: 'trailblazer',
    email: 'explorer@example.com',
    profile: {
      id: 99,
      username: 'trailblazer',
      displayName: 'Explorer',
      experience: 'beginner',
      experienceLabel: 'Beginner',
      role: 'standard',
      roleLabel: 'Standard user',
      email: 'explorer@example.com',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  };

  beforeEach(() => {
    apiServiceSpy = jasmine.createSpyObj<ApiService>('ApiService', ['normaliseAuthenticatedUser', 'normaliseProfile']);
    apiServiceSpy.normaliseAuthenticatedUser.and.returnValue(normalisedUser);
    apiServiceSpy.normaliseProfile.and.callFake((profile: any) => ({
      id: profile?.id ?? 0,
      username: profile?.username ?? '',
      displayName: profile?.display_name ?? 'Explorer',
      experience: 'beginner',
      experienceLabel: 'Beginner',
      role: 'standard',
      roleLabel: 'Standard user',
      email: profile?.email ?? '',
      updatedAt: profile?.updated_at ?? ''
    }));

    profileStoreSpy = jasmine.createSpyObj<ProfileStore>('ProfileStore', ['setProfile']);

    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [
        AuthService,
        { provide: ApiService, useValue: apiServiceSpy },
        { provide: ProfileStore, useValue: profileStoreSpy }
      ]
    });

    service = TestBed.inject(AuthService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  function flushCsrfRequest(): void {
    const csrfReq = httpMock.expectOne(`${baseUrl}/auth/csrf/`);
    expect(csrfReq.request.method).toBe('GET');
    csrfReq.flush({});
  }

  it('registers a user and normalises the response', () => {
    const payload = {
      username: 'trailblazer',
      email: 'explorer@example.com',
      password: 'SuperSecret123',
      displayName: ' Explorer '
    };

    let result: any;
    service.register(payload).subscribe(value => (result = value));

    flushCsrfRequest();

    const registerReq = httpMock.expectOne(`${baseUrl}/auth/register/`);
    expect(registerReq.request.method).toBe('POST');
    expect(registerReq.request.body).toEqual({
      username: 'trailblazer',
      email: 'explorer@example.com',
      password: 'SuperSecret123',
      display_name: ' Explorer '
    });

    registerReq.flush({
      user: rawUser,
      detail: 'Verification email sent.'
    });

    expect(apiServiceSpy.normaliseAuthenticatedUser).toHaveBeenCalledWith(rawUser);
    expect(result).toEqual({
      user: normalisedUser,
      detail: 'Verification email sent.'
    });
  });

  it('logs in a user, caches the CSRF token, and updates the profile store', () => {
    const credentials = { email: 'explorer@example.com', password: 'Secret1234' };

    let response: AuthenticatedUser | undefined;
    service.login(credentials).subscribe(value => (response = value as AuthenticatedUser));

    flushCsrfRequest();

    const loginReq = httpMock.expectOne(`${baseUrl}/auth/login/`);
    expect(loginReq.request.method).toBe('POST');
    expect(loginReq.request.body).toEqual(credentials);
    loginReq.flush(rawUser, { status: 200, statusText: 'OK' });

    expect(apiServiceSpy.normaliseAuthenticatedUser).toHaveBeenCalledWith(rawUser);
    expect(profileStoreSpy.setProfile).toHaveBeenCalledWith(normalisedUser.profile);
    expect(response).toEqual(normalisedUser);

    profileStoreSpy.setProfile.calls.reset();
    apiServiceSpy.normaliseAuthenticatedUser.calls.reset();

    service.login({ email: 'second@example.com', password: 'Secret1234' }).subscribe();

    httpMock.expectNone(req => req.url === `${baseUrl}/auth/csrf/`);

    const secondLoginReq = httpMock.expectOne(`${baseUrl}/auth/login/`);
    secondLoginReq.flush(rawUser, { status: 200, statusText: 'OK' });

    expect(apiServiceSpy.normaliseAuthenticatedUser).toHaveBeenCalled();
    expect(profileStoreSpy.setProfile).toHaveBeenCalled();
  });

  it('logs out and clears the profile store', () => {
    let completed = false;
    service.logout().subscribe(() => {
      completed = true;
    });

    flushCsrfRequest();

    const logoutReq = httpMock.expectOne(`${baseUrl}/auth/logout/`);
    expect(logoutReq.request.method).toBe('POST');
    expect(logoutReq.request.body).toEqual({});
    logoutReq.flush({});

    expect(completed).toBeTrue();
    expect(profileStoreSpy.setProfile).toHaveBeenCalledWith(null);
  });

  it('returns a two-factor challenge when required', () => {
    const credentials = { email: 'twofa@example.com', password: 'Secret1234' };

    let challenge: TwoFactorChallenge | undefined;
    service.login(credentials).subscribe(value => {
      if ('twoFactorToken' in value) {
        challenge = value as TwoFactorChallenge;
      }
    });

    flushCsrfRequest();

    const loginReq = httpMock.expectOne(`${baseUrl}/auth/login/`);
    expect(loginReq.request.method).toBe('POST');
    loginReq.flush({ two_factor_token: 'token-123', detail: 'Check your email' }, { status: 202, statusText: 'Accepted' });

    expect(challenge).toEqual({ twoFactorToken: 'token-123', detail: 'Check your email' });
    expect(profileStoreSpy.setProfile).not.toHaveBeenCalled();
  });

  it('completes two-factor login and updates profile store', () => {
    const token = 'token-xyz';
    let user: AuthenticatedUser | undefined;

    service.completeTwoFactor(token, '123456').subscribe(value => (user = value));

    flushCsrfRequest();

    const request = httpMock.expectOne(`${baseUrl}/auth/login/`);
    expect(request.request.method).toBe('POST');
    expect(request.request.body).toEqual({ two_factor_token: token, otp: '123456' });
    request.flush(rawUser, { status: 200, statusText: 'OK' });

    expect(user).toEqual(normalisedUser);
    expect(profileStoreSpy.setProfile).toHaveBeenCalledWith(normalisedUser.profile);
  });

  it('logs out from all sessions when requested', () => {
    service.logout(true).subscribe();

    flushCsrfRequest();

    const logoutReq = httpMock.expectOne(`${baseUrl}/auth/logout/`);
    expect(logoutReq.request.body).toEqual({ all_sessions: true });
    logoutReq.flush({});

    expect(profileStoreSpy.setProfile).toHaveBeenCalledWith(null);
  });

  it('verifies email tokens', () => {
    let response: AuthenticatedUser | undefined;
    service.verifyEmail('abc').subscribe(value => (response = value));

    flushCsrfRequest();

    const verifyReq = httpMock.expectOne(`${baseUrl}/auth/verify-email/`);
    expect(verifyReq.request.method).toBe('POST');
    expect(verifyReq.request.body).toEqual({ token: 'abc' });
    verifyReq.flush(rawUser);

    expect(apiServiceSpy.normaliseAuthenticatedUser).toHaveBeenCalledWith(rawUser);
    expect(response).toEqual(normalisedUser);
  });

  it('loads the current session and updates the profile store', () => {
    let response: AuthenticatedUser | null = null;
    service.loadSession().subscribe(value => (response = value));

    flushCsrfRequest();

    const sessionReq = httpMock.expectOne(`${baseUrl}/auth/session/`);
    expect(sessionReq.request.method).toBe('GET');
    sessionReq.flush(rawUser);

    expect(apiServiceSpy.normaliseAuthenticatedUser).toHaveBeenCalledWith(rawUser);
    expect(profileStoreSpy.setProfile).toHaveBeenCalledWith(normalisedUser.profile);
    expect(response).not.toBeNull();
    if (!response) {
      fail('Expected authenticated user');
      return;
    }
    expect(response).toEqual(normalisedUser);
  });

  it('returns null when session request is unauthorised', () => {
    let response: AuthenticatedUser | null = null;
    service.loadSession().subscribe({
      next: value => (response = value),
      error: () => fail('Should not error on 401'),
    });

    flushCsrfRequest();

    const sessionReq = httpMock.expectOne(`${baseUrl}/auth/session/`);
    sessionReq.flush({ detail: 'Authentication required.' }, { status: 401, statusText: 'Unauthorized' });

    expect(profileStoreSpy.setProfile).toHaveBeenCalledWith(null);
    expect(response).toBeNull();
  });

  it('propagates loadSession errors other than 401', () => {
    const errorResponse = { status: 500, statusText: 'Server Error' };
    let error: any;

    service.loadSession().subscribe({
      error: err => (error = err),
    });

    flushCsrfRequest();

    const sessionReq = httpMock.expectOne(`${baseUrl}/auth/session/`);
    sessionReq.flush({ detail: 'boom' }, errorResponse);

    expect(error).toBeTruthy();
    expect(profileStoreSpy.setProfile).not.toHaveBeenCalled();
  });
});
