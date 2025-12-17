import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';

import { ApiService } from '../../services/api.service';

@Component({
  standalone: true,
  selector: 'app-forgot-password',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './forgot-password.page.html'
})
export class ForgotPasswordPage {
  form: FormGroup;
  submitting = false;
  submitted = false;
  errorMessage?: string;

  constructor(
    private fb: FormBuilder,
    private apiService: ApiService
  ) {
    this.form = this.fb.group({
      email: ['', [Validators.required, Validators.email]]
    });
  }

  onSubmit(): void {
    if (this.form.invalid || this.submitting) {
      return;
    }

    this.submitting = true;
    this.errorMessage = undefined;

    const email = this.form.value.email;

    this.apiService
      .requestPasswordReset(email)
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.submitted = true;
          this.submitting = false;
        },
        error: err => {
          this.errorMessage = err?.error?.message || 'Failed to send reset email. Please try again.';
          this.submitting = false;
        }
      });
  }
}
