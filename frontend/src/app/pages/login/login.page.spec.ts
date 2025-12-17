import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { LoginPage } from './login.page';
import { AuthService } from '../../services/auth.service';
import { AuthenticatedUser } from '../../models/user';

describe('LoginPage', () => {
  let component: LoginPage;
  let fixture: ComponentFixture<LoginPage>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;
  let router: Router;

  const mockUser: AuthenticatedUser = {
    id: 1,
    username: 'user',
    email: 'user@example.com',
    profile: {
      id: 1,
      username: 'user',
      displayName: 'User',
      experience: 'beginner',
      experienceLabel: 'Beginner',
      role: 'standard',
      roleLabel: 'Standard',
      email: 'user@example.com',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  };

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['login', 'completeTwoFactor']);

    await TestBed.configureTestingModule({
      imports: [LoginPage, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: authServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(LoginPage);
    component = fixture.componentInstance;
    router = TestBed.inject(Router);
    spyOn(router, 'navigateByUrl').and.stub();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not submit when form is invalid', () => {
    component.onSubmit();

    expect(authServiceSpy.login).not.toHaveBeenCalled();
    expect(component.form.invalid).toBeTrue();
  });

  it('should sign in and navigate to profile', () => {
    authServiceSpy.login.and.returnValue(of(mockUser));

    component.form.setValue({
      email: 'user@example.com',
      password: 'Password123'
    });

    component.onSubmit();

    expect(authServiceSpy.login).toHaveBeenCalledWith({
      email: 'user@example.com',
      password: 'Password123'
    });
    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile');
    expect(component.submitting).toBeFalse();
    expect(component.errorMessage).toBeUndefined();
  });

  it('should display two-factor form when challenge is returned', () => {
    authServiceSpy.login.and.returnValue(of({ twoFactorToken: 'token-123', detail: 'Check your email' }));

    component.form.setValue({
      email: 'user@example.com',
      password: 'Password123'
    });

    component.onSubmit();

    expect(component.awaitingTwoFactor).toBeTrue();
    expect(component.infoMessage).toBe('Check your email');
    expect(component.submitting).toBeFalse();
  });

  it('should submit the two-factor code and navigate after success', () => {
    authServiceSpy.login.and.returnValue(of({ twoFactorToken: 'token-123' }));
    authServiceSpy.completeTwoFactor.and.returnValue(of(mockUser));

    component.form.setValue({ email: 'user@example.com', password: 'Password123' });
    component.onSubmit();

    component.twoFactorForm.setValue({ otp: '123456' });
    component.onSubmit();

    expect(authServiceSpy.completeTwoFactor).toHaveBeenCalledWith('token-123', '123456');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/profile');
    expect(component.awaitingTwoFactor).toBeFalse();
  });

  it('should surface authentication errors', () => {
    authServiceSpy.login.and.returnValue(throwError(() => ({
      status: 403,
      error: { detail: 'Email not verified.' }
    })));

    component.form.setValue({
      email: 'user@example.com',
      password: 'Password123'
    });

    component.onSubmit();

    expect(component.errorMessage).toBe('Email not verified.');
    expect(component.submitting).toBeFalse();
  });

  it('should surface two-factor verification errors', () => {
    authServiceSpy.login.and.returnValue(of({ twoFactorToken: 'token-123' }));
    authServiceSpy.completeTwoFactor.and.returnValue(throwError(() => ({
      status: 400,
      error: { detail: 'Invalid verification code.' }
    })));

    component.form.setValue({ email: 'user@example.com', password: 'Password123' });
    component.onSubmit();

    component.twoFactorForm.setValue({ otp: '000000' });
    component.onSubmit();

    expect(component.errorMessage).toBe('Invalid verification code.');
    expect(component.submitting).toBeFalse();
  });
});
