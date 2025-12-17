import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { Trail } from '../../models/trail';

@Component({
  standalone: true,
  selector: 'app-bookmarks',
  imports: [CommonModule, RouterLink],
  templateUrl: './bookmarks.page.html'
})
export class BookmarksPage implements OnInit {
  trails: Trail[] = [];
  loading = true;
  error: string | null = null;

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    this.loadBookmarks();
  }

  loadBookmarks(): void {
    this.loading = true;
    this.error = null;

    this.api.getMyBookmarks().subscribe({
      next: (trails) => {
        this.trails = trails;
        this.loading = false;
      },
      error: (err) => {
        console.error('Failed to load bookmarks:', err);
        this.loading = false;
        if (err.status === 401 || err.status === 403) {
          this.error = 'Please sign in to view your bookmarks.';
        } else {
          this.error = err?.error?.detail || 'Failed to load bookmarks.';
        }
      }
    });
  }

  getDifficultyColor(difficulty: string): string {
    switch (difficulty?.toLowerCase()) {
      case 'easy':
        return 'bg-green-100 text-green-800';
      case 'moderate':
        return 'bg-yellow-100 text-yellow-800';
      case 'hard':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  }

  formatDistance(km: number): string {
    return km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
  }

  formatDuration(mins: number | undefined): string {
    if (!mins) return 'N/A';
    const hours = Math.floor(mins / 60);
    const minutes = mins % 60;
    if (hours === 0) return `${minutes}min`;
    if (minutes === 0) return `${hours}h`;
    return `${hours}h ${minutes}min`;
  }
}
