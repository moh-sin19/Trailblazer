import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { ForgotPasswordPage } from './forgot-password.page';
import { ApiService } from '../../services/api.service';

describe('ForgotPasswordPage', () => {
  let component: ForgotPasswordPage;
  let fixture: ComponentFixture<ForgotPasswordPage>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    const spy = jasmine.createSpyObj('ApiService', ['requestPasswordReset']);

    await TestBed.configureTestingModule({
      imports: [ForgotPasswordPage, ReactiveFormsModule, RouterTestingModule],
      providers: [
        { provide: ApiService, useValue: spy }
      ]
    }).compileComponents();

    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;

    fixture = TestBed.createComponent(ForgotPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should initialize form with empty email', () => {
    expect(component.form.value).toEqual({ email: '' });
  });

  it('should validate email required', () => {
    const email = component.form.get('email');
    email?.setValue('');

    expect(email?.hasError('required')).toBeTrue();
  });

  it('should validate email format', () => {
    const email = component.form.get('email');
    email?.setValue('invalid-email');

    expect(email?.hasError('email')).toBeTrue();
  });

  it('should accept valid email', () => {
    const email = component.form.get('email');
    email?.setValue('test@example.com');

    expect(email?.valid).toBeTrue();
  });

  it('should submit password reset request', (done) => {
    apiServiceSpy.requestPasswordReset.and.returnValue(of(void 0));

    component.form.patchValue({ email: 'test@example.com' });
    component.onSubmit();

    setTimeout(() => {
      expect(apiServiceSpy.requestPasswordReset).toHaveBeenCalledWith('test@example.com');
      expect(component.submitted).toBeTrue();
      expect(component.submitting).toBeFalse();
      done();
    }, 0);
  });

  it('should handle submission errors', (done) => {
    apiServiceSpy.requestPasswordReset.and.returnValue(
      throwError(() => ({ error: { message: 'Email not found' } }))
    );

    component.form.patchValue({ email: 'test@example.com' });
    component.onSubmit();

    setTimeout(() => {
      expect(component.errorMessage).toBe('Email not found');
      expect(component.submitted).toBeFalse();
      expect(component.submitting).toBeFalse();
      done();
    }, 0);
  });

  it('should not submit if form is invalid', () => {
    component.form.patchValue({ email: '' });
    component.onSubmit();

    expect(apiServiceSpy.requestPasswordReset).not.toHaveBeenCalled();
  });

  it('should not submit if already submitting', () => {
    apiServiceSpy.requestPasswordReset.and.returnValue(of(void 0));

    component.form.patchValue({ email: 'test@example.com' });
    component.submitting = true;
    component.onSubmit();

    expect(apiServiceSpy.requestPasswordReset).not.toHaveBeenCalled();
  });
});
