import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ReactiveFormsModule,
  ValidatorFn,
  Validators
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';

import { AuthService, RegistrationPayload } from '../../services/auth.service';
import { RegistrationResult } from '../../models/user';

@Component({
  standalone: true,
  selector: 'app-signup',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './signup.page.html'
})
export class SignupPage {
  form: FormGroup;
  submitting = false;
  errorMessage?: string;
  result?: RegistrationResult;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService
  ) {
    this.form = this.fb.group({
      username: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9_.]{3,30}$/)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8), this.passwordComplexityValidator()]],
      displayName: ['', [this.optionalLengthValidator(3, 50)]],
    });
  }

  onSubmit(): void {
    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = undefined;

    const payload = this.buildPayload();

    this.authService
      .register(payload)
      .pipe(take(1))
      .subscribe({
        next: result => {
          this.result = result;
          this.submitting = false;
          this.form.disable();
        },
        error: err => {
          this.errorMessage = this.resolveErrorMessage(err);
          this.submitting = false;
        }
      });
  }

  private buildPayload(): RegistrationPayload {
    const value = this.form.value;
    const payload: RegistrationPayload = {
      username: (value.username as string).trim(),
      email: (value.email as string).trim(),
      password: value.password as string,
    };

    const displayName = (value.displayName as string)?.trim();
    if (displayName) {
      payload.displayName = displayName;
    }

    return payload;
  }

  private resolveErrorMessage(err: any): string {
    const detail = err?.error?.detail;
    if (err?.status === 409) {
      return detail || 'An account with that email or username already exists.';
    }

    // Check for password complexity errors
    const passwordErrors = err?.error?.password;
    if (passwordErrors && Array.isArray(passwordErrors) && passwordErrors.length > 0) {
      return passwordErrors[0];
    }

    if (detail) {
      return detail;
    }
    return 'Unable to create your account right now. Please try again.';
  }

  private passwordComplexityValidator(): ValidatorFn {
    return (control: AbstractControl) => {
      const value = control.value;
      if (!value) {
        return null;
      }

      // Check for uppercase letter
      if (!/[A-Z]/.test(value)) {
        return { complexity: 'Password must contain at least one uppercase letter.' };
      }

      // Check for lowercase letter
      if (!/[a-z]/.test(value)) {
        return { complexity: 'Password must contain at least one lowercase letter.' };
      }

      // Check for number
      if (!/\d/.test(value)) {
        return { complexity: 'Password must contain at least one number.' };
      }

      // Check for symbol (non-alphanumeric character)
      if (!/[^A-Za-z0-9]/.test(value)) {
        return { complexity: 'Password must contain at least one symbol.' };
      }

      return null;
    };
  }

  private optionalLengthValidator(min: number, max: number): ValidatorFn {
    return (control: AbstractControl) => {
      const raw = control.value;
      if (raw === null || raw === undefined) {
        return null;
      }
      const trimmed = String(raw).trim();
      if (!trimmed.length) {
        return null;
      }
      if (trimmed.length < min || trimmed.length > max) {
        return { length: { min, max } };
      }
      return null;
    };
  }
}
