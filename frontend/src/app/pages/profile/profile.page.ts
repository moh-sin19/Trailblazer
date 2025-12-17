import { Component, OnInit, OnDestroy } from '@angular/core';
import { AsyncPipe, CommonModule, DatePipe, NgIf } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { take } from 'rxjs/operators';

import { ProfileStore } from '../../services/profile.store';
import { UserProfile } from '../../models/user';
import { ApiService } from '../../services/api.service';
import { DifficultyBreakdownEntry, MonthlyProgressEntry, PublicUserProfileView } from '../../models/user';

@Component({
  standalone: true,
  selector: 'app-profile',
  imports: [CommonModule, NgIf, AsyncPipe, RouterLink, DatePipe],
  templateUrl: './profile.page.html'
})
export class ProfilePage implements OnInit, OnDestroy {
  readonly profile$ = this.profileStore.profile$;
  loading = true;

  // Public profile with badges/stats
  publicProfile: PublicUserProfileView | null = null;
  publicProfileError: string | null = null;
  userNotFound = false;

  // Track if viewing own profile vs another user's
  isOwnProfile = false;
  viewingUsername: string | null = null;

  // Track if user needs to authenticate
  needsAuth = false;

  // Notification system
  notice: { kind: 'success' | 'error'; message: string } | null = null;
  noticeTimer: ReturnType<typeof setTimeout> | null = null;

  private profileSubscription: Subscription | null = null;

  constructor(
    private profileStore: ProfileStore,
    private apiService: ApiService,
    private route: ActivatedRoute
  ) {}

  ngOnInit(): void {
    // Get username from route parameter if present
    const usernameParam = this.route.snapshot.paramMap.get('username');

    // Load user's own profile initially
    this.profileStore
      .load()
      .pipe(take(1))
      .subscribe({
        next: (ownProfile) => {
          this.loading = false;
          this.handleProfileState(ownProfile, usernameParam);
        },
        error: () => {
          this.loading = false;
          this.handleProfileState(null, usernameParam);
        }
      });

    // Subscribe to profile changes (e.g., when user logs out)
    this.profileSubscription = this.profile$.subscribe((currentProfile) => {
      this.handleProfileState(currentProfile, usernameParam);
    });
  }

  private handleProfileState(currentProfile: UserProfile | null, usernameParam: string | null): void {
    // Reset state
    this.needsAuth = false;
    this.userNotFound = false;

    // Determine which username to load
    if (usernameParam) {
      // Viewing a specific user's profile
      this.viewingUsername = usernameParam;
      if (currentProfile?.username) {
        const canonicalUsername = currentProfile.username;
        this.isOwnProfile = canonicalUsername.toLowerCase() === usernameParam.toLowerCase();
        if (this.isOwnProfile) {
          this.viewingUsername = canonicalUsername;
        }
      } else {
        this.isOwnProfile = false;
      }
      this.loadPublicProfile();
    } else if (currentProfile?.username) {
      // Viewing own profile at /profile - use authenticated username directly
      this.viewingUsername = currentProfile.username;
      this.isOwnProfile = true;
      this.loadPublicProfile();
    } else {
      // Not logged in and trying to view /profile - show auth required
      this.needsAuth = true;
      this.viewingUsername = null;
      this.publicProfile = null;
    }
  }

  loadPublicProfile(): void {
    if (!this.viewingUsername) {
      return;
    }

    this.publicProfileError = null;
    this.userNotFound = false;

    this.apiService.getPublicProfile(this.viewingUsername).subscribe({
      next: (profile: PublicUserProfileView) => {
        this.publicProfile = profile;
      },
      error: (err: any) => {
        console.error('Failed to load public profile:', err);
        if (err?.status === 404) {
          this.userNotFound = true;
          this.publicProfileError = `User "@${this.viewingUsername}" not found.`;
        } else {
          this.publicProfileError = 'Failed to load badges and stats.';
        }
      }
    });
  }

  trackByKey(_: number, item: [string, string | undefined]): string {
    return item[0];
  }

  profileDetails(profile: UserProfile): [string, string | undefined][] {
    return [
      ['Username', `@${profile.username}`],
      ['Display name', profile.displayName],
      ['Email', profile.email],
      ['Experience', profile.experienceLabel],
      ['Role', profile.roleLabel],
      ['Bio', profile.bio || '—']
    ];
  }

  getAwardedBadges() {
    return this.publicProfile?.badges.filter((b) => b.awarded) || [];
  }

  getInProgressBadges() {
    return this.publicProfile?.badges.filter((b) => !b.awarded) || [];
  }

  getDifficultyBreakdown(): DifficultyBreakdownEntry[] {
    return this.publicProfile?.analytics?.difficultyBreakdown ?? [];
  }

  getMonthlyProgress(): MonthlyProgressEntry[] {
    const list = this.publicProfile?.analytics?.monthlyProgress ?? [];
    return list.slice(-6);
  }

  difficultyDistanceShare(entry: DifficultyBreakdownEntry): number {
    const breakdown = this.getDifficultyBreakdown();
    const totalDistance = breakdown.reduce((sum, item) => sum + item.distanceKm, 0);
    if (!totalDistance) {
      return 0;
    }
    const share = Math.round((entry.distanceKm / totalDistance) * 100);
    if (share === 0 && entry.distanceKm > 0) {
      return 6;
    }
    return share;
  }

  monthlyDistancePercent(entry: MonthlyProgressEntry): number {
    const months = this.getMonthlyProgress();
    const maxDistance = months.reduce((max, item) => Math.max(max, item.distanceKm), 0);
    if (!maxDistance) {
      return 0;
    }
    return Math.round((entry.distanceKm / maxDistance) * 100);
  }

  monthlyDistanceHeight(entry: MonthlyProgressEntry): number {
    const percent = this.monthlyDistancePercent(entry);
    if (percent > 0) {
      return percent;
    }
    return entry.distanceKm > 0 ? 6 : 0;
  }

  formatMonthLabel(entry: MonthlyProgressEntry): string {
    const parts = entry.month?.split('-') ?? [];
    if (parts.length < 2) {
      return entry.month;
    }
    const year = Number(parts[0]);
    const monthIndex = Number(parts[1]) - 1;
    if (Number.isNaN(year) || Number.isNaN(monthIndex)) {
      return entry.month;
    }
    const date = new Date(year, monthIndex, 1);
    return date.toLocaleString(undefined, { month: 'short', year: 'numeric' });
  }

  deleteSubmission(id: number): void {
    if (!confirm('Are you sure you want to delete this trail submission? This action cannot be undone.')) {
      return;
    }

    this.apiService.deleteTrailSubmission(id).subscribe({
      next: () => {
        // Reload the public profile to refresh the pending trails list
        this.loadPublicProfile();
        this.setNotice('success', 'Trail submission deleted successfully.');
      },
      error: (err) => {
        console.error('Failed to delete trail submission:', err);
        const errorMsg = err?.error?.detail || 'Failed to delete trail submission. Please try again.';
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
    if (this.profileSubscription) {
      this.profileSubscription.unsubscribe();
      this.profileSubscription = null;
    }
  }
}
