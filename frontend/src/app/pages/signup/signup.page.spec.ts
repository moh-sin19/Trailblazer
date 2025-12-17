import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { SignupPage } from './signup.page';
import { AuthService } from '../../services/auth.service';
import { RegistrationResult } from '../../models/user';

describe('SignupPage', () => {
  let component: SignupPage;
  let fixture: ComponentFixture<SignupPage>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  const registrationResult: RegistrationResult = {
    user: {
      id: 1,
      username: 'newuser',
      email: 'new@example.com',
      profile: {
        id: 1,
        username: 'newuser',
        displayName: 'New User',
        experience: 'beginner',
        experienceLabel: 'Beginner',
        role: 'standard',
        roleLabel: 'Standard',
        email: 'new@example.com',
        updatedAt: '2024-01-01T00:00:00Z'
      }
    },
    detail: 'Verification email sent. Please check your inbox.'
  };

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['register']);

    await TestBed.configureTestingModule({
      imports: [SignupPage, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: authServiceSpy }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(SignupPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should not submit when form is invalid', () => {
    component.onSubmit();
    expect(authServiceSpy.register).not.toHaveBeenCalled();
    expect(component.form.invalid).toBeTrue();
  });

  it('should register a new account and disable the form', () => {
    authServiceSpy.register.and.returnValue(of(registrationResult));

    component.form.setValue({
      username: 'newuser',
      email: 'new@example.com',
      password: 'SuperSecret123!',
      displayName: ' Trail Rider '
    });

    component.onSubmit();

    expect(authServiceSpy.register).toHaveBeenCalledWith({
      username: 'newuser',
      email: 'new@example.com',
      password: 'SuperSecret123!',
      displayName: 'Trail Rider'
    });
    expect(component.result).toEqual(registrationResult);
    expect(component.result?.detail).toBe('Verification email sent. Please check your inbox.');
    expect(component.form.disabled).toBeTrue();
  });

  it('should surface registration errors', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({
      status: 409,
      error: { detail: 'Conflict' }
    })));

    component.form.setValue({
      username: 'newuser',
      email: 'new@example.com',
      password: 'SuperSecret123!',
      displayName: ''
    });

    component.onSubmit();

    expect(component.errorMessage).toBe('Conflict');
    expect(component.submitting).toBeFalse();
  });

  it('should validate optional display name length', () => {
    const displayNameControl = component.form.get('displayName');
    displayNameControl?.setValue('aa');
    expect(displayNameControl?.hasError('length')).toBeTrue();

    displayNameControl?.setValue('aaa');
    expect(displayNameControl?.valid).toBeTrue();
  });

  it('should display password complexity errors from backend', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({
      status: 400,
      error: {
        password: ['Password must contain at least one uppercase letter.']
      }
    })));

    component.form.setValue({
      username: 'newuser',
      email: 'new@example.com',
      password: 'ValidPass123!',
      displayName: ''
    });

    component.onSubmit();

    expect(component.errorMessage).toBe('Password must contain at least one uppercase letter.');
    expect(component.submitting).toBeFalse();
  });

  it('should display multiple password validation errors', () => {
    authServiceSpy.register.and.returnValue(throwError(() => ({
      status: 400,
      error: {
        password: [
          'Password must contain at least one uppercase letter.',
          'Password must contain at least one symbol.'
        ]
      }
    })));

    component.form.setValue({
      username: 'newuser',
      email: 'new@example.com',
      password: 'ValidPass123!',
      displayName: ''
    });

    component.onSubmit();

    // Should display the first error message
    expect(component.errorMessage).toBe('Password must contain at least one uppercase letter.');
    expect(component.submitting).toBeFalse();
  });

  it('should validate password requires uppercase letter on frontend', () => {
    const passwordControl = component.form.get('password');
    passwordControl?.setValue('simple123!');
    passwordControl?.markAsTouched();

    expect(passwordControl?.hasError('complexity')).toBeTrue();
    expect(passwordControl?.errors?.['complexity']).toBe('Password must contain at least one uppercase letter.');
  });

  it('should validate password requires lowercase letter on frontend', () => {
    const passwordControl = component.form.get('password');
    passwordControl?.setValue('SIMPLE123!');
    passwordControl?.markAsTouched();

    expect(passwordControl?.hasError('complexity')).toBeTrue();
    expect(passwordControl?.errors?.['complexity']).toBe('Password must contain at least one lowercase letter.');
  });

  it('should validate password requires number on frontend', () => {
    const passwordControl = component.form.get('password');
    passwordControl?.setValue('SimplePass!');
    passwordControl?.markAsTouched();

    expect(passwordControl?.hasError('complexity')).toBeTrue();
    expect(passwordControl?.errors?.['complexity']).toBe('Password must contain at least one number.');
  });

  it('should validate password requires symbol on frontend', () => {
    const passwordControl = component.form.get('password');
    passwordControl?.setValue('SimplePass123');
    passwordControl?.markAsTouched();

    expect(passwordControl?.hasError('complexity')).toBeTrue();
    expect(passwordControl?.errors?.['complexity']).toBe('Password must contain at least one symbol.');
  });

  it('should accept valid password with all requirements', () => {
    const passwordControl = component.form.get('password');
    passwordControl?.setValue('SimplePass123!');
    passwordControl?.markAsTouched();

    expect(passwordControl?.valid).toBeTrue();
    expect(passwordControl?.hasError('complexity')).toBeFalse();
  });
});
