import { Component, OnInit, OnDestroy } from '@angular/core';
import { CommonModule, DatePipe } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { finalize } from 'rxjs/operators';
import { ApiService } from '../../services/api.service';
import { AdminService } from '../../services/admin.service';
import { TrailSubmissionResponse } from '../../models/trail-submission';
import { TrailPhoto } from '../../models/trail';

@Component({
  standalone: true,
  selector: 'app-admin-review-trail',
  imports: [CommonModule, RouterLink, DatePipe],
  templateUrl: './admin-review-trail.page.html'
})
export class AdminReviewTrailPage implements OnInit, OnDestroy {
  loading = true;
  submission: TrailSubmissionResponse | null = null;
  submissionId?: number;
  notice: { kind: 'success' | 'error'; message: string } | null = null;
  noticeTimer: ReturnType<typeof setTimeout> | null = null;
  processing = false;

  constructor(
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly api: ApiService,
    private readonly adminService: AdminService
  ) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      this.router.navigate(['/admin']);
      return;
    }

    this.submissionId = parseInt(id, 10);
    this.loadSubmission();
  }

  loadSubmission(): void {
    if (!this.submissionId) return;

    this.api.getTrailSubmission(this.submissionId)
      .pipe(finalize(() => (this.loading = false)))
      .subscribe({
        next: submission => {
          this.submission = submission;
        },
        error: error => {
          console.error('Failed to load trail submission', error);
          this.setNotice('error', 'Failed to load trail submission.');
        }
      });
  }

  deletePhoto(photo: TrailPhoto): void {
    if (!this.submissionId) return;

    if (!confirm('Are you sure you want to delete this photo? This action cannot be undone.')) {
      return;
    }

    this.api.deleteTrailSubmissionPhoto(this.submissionId, photo.id).subscribe({
      next: () => {
        if (this.submission && this.submission.photos) {
          this.submission.photos = this.submission.photos.filter(p => p.id !== photo.id);
        }
        this.setNotice('success', 'Photo deleted successfully.');
      },
      error: (err) => {
        console.error('Failed to delete photo:', err);
        const errorMsg = err?.error?.detail || 'Failed to delete photo. Please try again.';
        this.setNotice('error', errorMsg);
      }
    });
  }

  approveSubmission(): void {
    if (!this.submissionId || this.processing) return;

    if (!confirm('Approve this trail submission? It will become visible to all users.')) {
      return;
    }

    this.processing = true;
    this.adminService.approveTrailSubmission(this.submissionId)
      .pipe(finalize(() => (this.processing = false)))
      .subscribe({
        next: () => {
          this.setNotice('success', 'Trail approved successfully!');
          setTimeout(() => {
            this.router.navigate(['/admin']);
          }, 2000);
        },
        error: (err) => {
          console.error('Failed to approve trail:', err);
          const errorMsg = err?.error?.detail || 'Failed to approve trail. Please try again.';
          this.setNotice('error', errorMsg);
        }
      });
  }

  rejectSubmission(): void {
    if (!this.submissionId || this.processing) return;

    const reason = prompt('Reason for rejection (optional):');
    if (reason === null) return; // User cancelled

    this.processing = true;
    this.adminService.rejectTrailSubmission(this.submissionId)
      .pipe(finalize(() => (this.processing = false)))
      .subscribe({
        next: () => {
          this.setNotice('success', 'Trail rejected.');
          setTimeout(() => {
            this.router.navigate(['/admin']);
          }, 2000);
        },
        error: (err) => {
          console.error('Failed to reject trail:', err);
          const errorMsg = err?.error?.detail || 'Failed to reject trail. Please try again.';
          this.setNotice('error', errorMsg);
        }
      });
  }

  private setNotice(kind: 'success' | 'error', message: string): void {
    this.notice = { kind, message };
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
    }
    this.noticeTimer = setTimeout(() => {
      this.notice = null;
      this.noticeTimer = null;
    }, 5000);
  }

  ngOnDestroy(): void {
    if (this.noticeTimer) {
      clearTimeout(this.noticeTimer);
      this.noticeTimer = null;
    }
  }
}
