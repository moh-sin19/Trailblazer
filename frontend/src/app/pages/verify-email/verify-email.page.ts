import { Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { AuthService } from '../../services/auth.service';
import { AuthenticatedUser } from '../../models/user';

type VerifyStatus = 'idle' | 'loading' | 'success' | 'error';

@Component({
  standalone: true,
  selector: 'app-verify-email',
  imports: [CommonModule, RouterLink],
  templateUrl: './verify-email.page.html'
})
export class VerifyEmailPage implements OnInit, OnDestroy {
  status: VerifyStatus = 'idle';
  errorMessage?: string;
  verifiedUser?: AuthenticatedUser;
  private destroy$ = new Subject<void>();

  constructor(
    private route: ActivatedRoute,
    private authService: AuthService
  ) {}

  ngOnInit(): void {
    this.route.queryParamMap
      .pipe(takeUntil(this.destroy$))
      .subscribe(params => {
        const token = params.get('token');
        if (!token) {
          this.status = 'error';
          this.errorMessage = 'Verification link is missing the token parameter.';
          return;
        }
        this.verify(token);
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  retry(token: string): void {
    this.verify(token);
  }

  private verify(token: string): void {
    if (!token) {
      this.status = 'error';
      this.errorMessage = 'Verification token is required.';
      return;
    }

    this.status = 'loading';
    this.errorMessage = undefined;

    this.authService
      .verifyEmail(token)
      .pipe(takeUntil(this.destroy$))
      .subscribe({
        next: user => {
          this.verifiedUser = user;
          this.status = 'success';
        },
        error: err => {
          this.status = 'error';
          const detail = err?.error?.non_field_errors?.[0] || err?.error?.detail;
          if (typeof detail === 'string') {
            this.errorMessage = detail;
          } else {
            this.errorMessage = 'Verification failed. The link may be invalid or expired.';
          }
        }
      });
  }
}
