import { AsyncPipe, CommonModule, DatePipe, NgForOf, NgIf } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { Observable, forkJoin } from 'rxjs';
import { finalize, take } from 'rxjs/operators';

import {
  AdminComment,
  AdminDashboardSummary,
  AdminTrailSubmission,
  AdminUser,
} from '../../models/admin';
import { UserProfile, UserRole } from '../../models/user';
import { AdminService } from '../../services/admin.service';
import { ProfileStore } from '../../services/profile.store';

@Component({
  standalone: true,
  selector: 'app-admin-dashboard',
  templateUrl: './admin-dashboard.page.html',
  imports: [CommonModule, NgIf, NgForOf, AsyncPipe, FormsModule, DatePipe, RouterLink],
})
export class AdminDashboardPage implements OnInit {
  loading = true;
  accessDenied = false;
  dashboard: AdminDashboardSummary | null = null;
  users: AdminUser[] = [];
  pendingSubmissions: AdminTrailSubmission[] = [];
  recentComments: AdminComment[] = [];
  errorMessage: string | null = null;

  private readonly busyUsers = new Set<number>();
  private readonly busySubmissions = new Set<number>();
  private readonly busyComments = new Set<number>();

  constructor(
    private readonly profileStore: ProfileStore,
    private readonly adminService: AdminService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.profileStore
      .load()
      .pipe(take(1))
      .subscribe({
        next: (profile) => this.handleProfile(profile),
        error: () => {
          this.accessDenied = true;
          this.loading = false;
          this.errorMessage = 'Unable to verify your permissions. Please sign in again.';
        },
      });
  }

  getUserBusyState(userId: number): boolean {
    return this.busyUsers.has(userId);
  }

  getSubmissionBusyState(submissionId: number): boolean {
    return this.busySubmissions.has(submissionId);
  }

  getCommentBusyState(commentId: number): boolean {
    return this.busyComments.has(commentId);
  }

  onRoleChange(user: AdminUser, role: UserRole): void {
    if (role === user.role) {
      return;
    }
    this.busyUsers.add(user.id);
    this.adminService
      .updateUser(user.id, { role })
      .pipe(
        finalize(() => this.busyUsers.delete(user.id))
      )
      .subscribe({
        next: (updated) => {
          this.users = this.users.map((u) => (u.id === updated.id ? updated : u));
        },
        error: () => {
          this.errorMessage = 'Failed to update user role.';
        },
      });
  }

  toggleUserActive(user: AdminUser): void {
    this.busyUsers.add(user.id);
    this.adminService
      .updateUser(user.id, { isActive: !user.isActive })
      .pipe(finalize(() => this.busyUsers.delete(user.id)))
      .subscribe({
        next: (updated) => {
          this.users = this.users.map((u) => (u.id === updated.id ? updated : u));
        },
        error: () => {
          this.errorMessage = 'Failed to update account status.';
        },
      });
  }

  approveSubmission(submission: AdminTrailSubmission): void {
    this.performSubmissionAction(submission, () =>
      this.adminService.approveTrailSubmission(submission.id)
    );
  }

  rejectSubmission(submission: AdminTrailSubmission): void {
    this.performSubmissionAction(submission, () =>
      this.adminService.rejectTrailSubmission(submission.id)
    );
  }

  markSubmissionReviewed(submission: AdminTrailSubmission): void {
    this.performSubmissionAction(submission, () =>
      this.adminService.markTrailSubmissionReviewed(submission.id)
    );
  }

  toggleCommentVisibility(comment: AdminComment): void {
    this.busyComments.add(comment.id);
    this.adminService
      .updateComment(comment.id, { isDeleted: !comment.isDeleted })
      .pipe(finalize(() => this.busyComments.delete(comment.id)))
      .subscribe({
        next: (updated) => {
          this.recentComments = this.recentComments.map((c) =>
            c.id === updated.id ? updated : c
          );
        },
        error: () => {
          this.errorMessage = 'Failed to update comment visibility.';
        },
      });
  }

  refreshAll(): void {
    this.loadDashboardData();
  }

  private handleProfile(profile: UserProfile | null): void {
    if (!profile) {
      this.accessDenied = true;
      this.loading = false;
      this.router.navigate(['/login'], { queryParams: { redirect: '/admin' } });
      return;
    }

    if (profile.role !== 'admin') {
      this.accessDenied = true;
      this.loading = false;
      this.router.navigate(['/']);
      return;
    }

    this.loadDashboardData();
  }

  private loadDashboardData(): void {
    this.loading = true;
    this.errorMessage = null;

    forkJoin({
      dashboard: this.adminService.getDashboard(),
      users: this.adminService.listUsers(),
      submissions: this.adminService.listTrailSubmissions('pending'),
      comments: this.adminService.listComments('active'),
    }).subscribe({
      next: ({ dashboard, users, submissions, comments }) => {
        this.dashboard = dashboard;
        this.users = users;
        this.pendingSubmissions = submissions;
        this.recentComments = comments.slice(0, 12);
        this.loading = false;
      },
      error: () => {
        this.errorMessage = 'Failed to load admin data.';
        this.loading = false;
      },
    });
  }

  private performSubmissionAction(
    submission: AdminTrailSubmission,
    action: () => Observable<AdminTrailSubmission>
  ): void {
    this.busySubmissions.add(submission.id);
    action()
      .pipe(finalize(() => this.busySubmissions.delete(submission.id)))
      .subscribe({
        next: (updated) => {
          this.pendingSubmissions = this.pendingSubmissions
            .map((s) => (s.id === updated.id ? updated : s))
            .filter((s) => s.approvalState === 'pending');
          if (this.dashboard && updated.approvalState !== 'pending' && this.dashboard.stats.pendingTrailSubmissions > 0) {
            this.dashboard.stats.pendingTrailSubmissions -= 1;
          }
        },
        error: () => {
          this.errorMessage = 'Failed to update trail submission.';
        },
      });
  }
}
