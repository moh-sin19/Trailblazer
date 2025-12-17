import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';

import { AuthService, TwoFactorChallenge } from '../../services/auth.service';
import { AuthenticatedUser } from '../../models/user';

@Component({
  standalone: true,
  selector: 'app-login',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './login.page.html'
})
export class LoginPage {
  form: FormGroup;
  twoFactorForm: FormGroup;
  submitting = false;
  awaitingTwoFactor = false;
  infoMessage?: string;
  private twoFactorToken?: string;
  errorMessage?: string;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
    });
    this.twoFactorForm = this.fb.group({
      otp: ['', [Validators.required, Validators.pattern(/^\d{6}$/)]]
    });
  }

  onSubmit(): void {
    if (this.awaitingTwoFactor) {
      this.submitTwoFactor();
      return;
    }

    if (this.form.invalid || this.submitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = undefined;

    const { email, password } = this.form.value;
    const payload = {
      email: (email as string).trim(),
      password: password as string
    };

    this.authService
      .login(payload)
      .pipe(take(1))
      .subscribe({
        next: result => {
          this.submitting = false;
          if (this.isTwoFactorChallenge(result)) {
            this.awaitingTwoFactor = true;
            this.twoFactorToken = result.twoFactorToken;
            this.infoMessage = result.detail ?? 'We have emailed you a 6-digit verification code.';
            this.twoFactorForm.reset();
            return;
          }
          this.router.navigateByUrl('/profile');
        },
        error: err => {
          this.errorMessage = this.resolveErrorMessage(err);
          this.submitting = false;
        }
      });
  }

  private submitTwoFactor(): void {
    if (!this.twoFactorToken) {
      this.errorMessage = 'We could not locate your verification code. Please start the login process again.';
      this.awaitingTwoFactor = false;
      return;
    }

    if (this.twoFactorForm.invalid || this.submitting) {
      this.twoFactorForm.markAllAsTouched();
      return;
    }

    this.submitting = true;
    this.errorMessage = undefined;

    const otp = this.twoFactorForm.value.otp as string;
    this.authService
      .completeTwoFactor(this.twoFactorToken, otp)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.submitting = false;
          this.awaitingTwoFactor = false;
          this.twoFactorToken = undefined;
          this.router.navigateByUrl('/profile');
        },
        error: err => {
          this.errorMessage = this.resolveErrorMessage(err);
          this.submitting = false;
        }
      });
  }

  private isTwoFactorChallenge(value: AuthenticatedUser | TwoFactorChallenge): value is TwoFactorChallenge {
    return (value as TwoFactorChallenge).twoFactorToken !== undefined;
  }

  private resolveErrorMessage(err: any): string {
    const detail = err?.error?.detail;
    if (err?.status === 400 && detail) {
      return detail;
    }
    if (err?.status === 403) {
      return detail || 'Please verify your email address before signing in.';
    }
    if (err?.status === 401) {
      return 'Invalid email or password.';
    }
    if (detail) {
      return detail;
    }
    return 'Unable to sign in right now. Please try again.';
  }
}
