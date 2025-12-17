import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';

import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  selector: 'app-reset-password',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './reset-password.page.html'
})
export class ResetPasswordPage implements OnInit {
  form: FormGroup;
  token?: string;
  submitting = false;
  success = false;
  errorMessage?: string;

  constructor(
    private fb: FormBuilder,
    private apiService: ApiService,
    private route: ActivatedRoute,
    private router: Router
  ) {
    this.form = this.fb.group({
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]]
    }, { validators: this.passwordMatchValidator });
  }

  ngOnInit(): void {
    this.route.queryParams.pipe(take(1)).subscribe(params => {
      this.token = params['token'];
      if (!this.token) {
        this.errorMessage = 'Invalid reset link. Please request a new password reset.';
      }
    });
  }

  private passwordMatchValidator(group: FormGroup): { [key: string]: boolean } | null {
    const password = group.get('password')?.value;
    const confirmPassword = group.get('confirmPassword')?.value;
    return password === confirmPassword ? null : { passwordMismatch: true };
  }

  onSubmit(): void {
    if (this.form.invalid || this.submitting || !this.token) {
      return;
    }

    this.submitting = true;
    this.errorMessage = undefined;

    const password = this.form.value.password;

    this.apiService
      .confirmPasswordReset(this.token, password)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.success = true;
          this.submitting = false;

          setTimeout(() => {
            this.router.navigate(['/']);
          }, 3000);
        },
        error: err => {
          this.errorMessage = err?.error?.message || 'Failed to reset password. The link may have expired.';
          this.submitting = false;
        }
      });
  }

  get passwordMismatch(): boolean {
    return this.form.errors?.['passwordMismatch'] &&
           this.form.get('confirmPassword')?.touched || false;
  }
}
