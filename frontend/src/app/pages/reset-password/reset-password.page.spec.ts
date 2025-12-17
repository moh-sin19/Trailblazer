import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { ResetPasswordPage } from './reset-password.page';
import { ApiService } from '../../services/api.service';

describe('ResetPasswordPage', () => {
  let component: ResetPasswordPage;
  let fixture: ComponentFixture<ResetPasswordPage>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let router: Router;

  beforeEach(async () => {
    const apiSpy = jasmine.createSpyObj('ApiService', ['confirmPasswordReset']);

    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage, ReactiveFormsModule, RouterTestingModule],
      providers: [
        { provide: ApiService, useValue: apiSpy },
        {
          provide: ActivatedRoute,
          useValue: {
            queryParams: of({ token: 'test-token-123' })
          }
        }
      ]
    }).compileComponents();

    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.stub();

    fixture = TestBed.createComponent(ResetPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should extract token from query params', () => {
    expect(component.token).toBe('test-token-123');
  });

  it('should show error if token is missing', async () => {
    const activatedRoute = TestBed.inject(ActivatedRoute);
    (activatedRoute.queryParams as any) = of({});

    const newFixture = TestBed.createComponent(ResetPasswordPage);
    newFixture.detectChanges();

    expect(newFixture.componentInstance.errorMessage).toBe('Invalid reset link. Please request a new password reset.');
  });

  it('should validate password required', () => {
    const password = component.form.get('password');
    password?.setValue('');

    expect(password?.hasError('required')).toBeTrue();
  });

  it('should validate password min length', () => {
    const password = component.form.get('password');
    password?.setValue('short');

    expect(password?.hasError('minlength')).toBeTrue();
  });

  it('should validate confirm password required', () => {
    const confirmPassword = component.form.get('confirmPassword');
    confirmPassword?.setValue('');

    expect(confirmPassword?.hasError('required')).toBeTrue();
  });

  it('should validate password match', () => {
    component.form.patchValue({
      password: 'password123',
      confirmPassword: 'different123'
    });

    expect(component.form.hasError('passwordMismatch')).toBeTrue();
  });

  it('should accept matching passwords', () => {
    component.form.patchValue({
      password: 'password123',
      confirmPassword: 'password123'
    });

    expect(component.form.hasError('passwordMismatch')).toBeFalse();
  });

  it('should submit password reset', (done) => {
    apiServiceSpy.confirmPasswordReset.and.returnValue(of(void 0));

    component.form.patchValue({
      password: 'newpassword123',
      confirmPassword: 'newpassword123'
    });

    component.onSubmit();

    setTimeout(() => {
      expect(apiServiceSpy.confirmPasswordReset).toHaveBeenCalledWith('test-token-123', 'newpassword123');
      expect(component.success).toBeTrue();
      expect(component.submitting).toBeFalse();
      done();
    }, 0);
  });

  it('should handle reset errors', (done) => {
    apiServiceSpy.confirmPasswordReset.and.returnValue(
      throwError(() => ({ error: { message: 'Token expired' } }))
    );

    component.form.patchValue({
      password: 'newpassword123',
      confirmPassword: 'newpassword123'
    });

    component.onSubmit();

    setTimeout(() => {
      expect(component.errorMessage).toBe('Token expired');
      expect(component.success).toBeFalse();
      expect(component.submitting).toBeFalse();
      done();
    }, 0);
  });

  it('should not submit if form is invalid', () => {
    component.form.patchValue({
      password: 'short',
      confirmPassword: 'short'
    });

    component.onSubmit();

    expect(apiServiceSpy.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('should not submit if token is missing', () => {
    component.token = undefined;
    component.form.patchValue({
      password: 'newpassword123',
      confirmPassword: 'newpassword123'
    });

    component.onSubmit();

    expect(apiServiceSpy.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it('should show password mismatch error when touched', () => {
    component.form.patchValue({
      password: 'password123',
      confirmPassword: 'different123'
    });

    component.form.get('confirmPassword')?.markAsTouched();

    expect(component.passwordMismatch).toBeTrue();
  });
});
