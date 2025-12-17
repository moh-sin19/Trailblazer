import { Component, Input, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TrailPhoto } from '../../models/trail';
import { ApiService } from '../../services/api.service';
import { ProfileStore } from '../../services/profile.store';

@Component({
  selector: 'app-trail-photo-gallery',
  templateUrl: './trail-photo-gallery.component.html',
  styleUrls: ['./trail-photo-gallery.component.scss'],
  standalone: true,
  imports: [CommonModule]
})
export class TrailPhotoGalleryComponent {
  @Input() photos: TrailPhoto[] = [];
  @Input() trailSlug!: string;
  @Output() photosChanged = new EventEmitter<void>();

  selectedPhoto: TrailPhoto | null = null;

  constructor(
    private apiService: ApiService,
    private profileStore: ProfileStore
  ) {}

  get currentUser() {
    return this.profileStore.snapshot;
  }

  canManagePhoto(photo: TrailPhoto): boolean {
    const user = this.currentUser;
    return user ? (photo.uploader.id === user.id || user.role === 'admin') : false;
  }

  openPhoto(photo: TrailPhoto): void {
    this.selectedPhoto = photo;
  }

  closePhoto(): void {
    this.selectedPhoto = null;
  }

  async setPrimaryPhoto(photo: TrailPhoto): Promise<void> {
    if (!this.canManagePhoto(photo) || photo.is_primary) {
      return;
    }

    this.apiService.updateTrailPhoto(
      this.trailSlug,
      photo.id,
      { is_primary: true }
    ).subscribe({
      next: () => {
        this.photosChanged.emit();
        this.closePhoto();
      },
      error: (error) => {
        console.error('Failed to set primary photo:', error);
      }
    });
  }

  async deletePhoto(photo: TrailPhoto): Promise<void> {
    if (!this.canManagePhoto(photo)) {
      return;
    }

    const confirmed = confirm('Are you sure you want to delete this photo?');
    if (!confirmed) {
      return;
    }

    this.apiService.deleteTrailPhoto(this.trailSlug, photo.id).subscribe({
      next: () => {
        this.photosChanged.emit();
        this.closePhoto();
      },
      error: (error) => {
        console.error('Failed to delete photo:', error);
      }
    });
  }

  getPrimaryPhoto(): TrailPhoto | null {
    return this.photos.find(p => p.is_primary) || null;
  }

  getNonPrimaryPhotos(): TrailPhoto[] {
    return this.photos.filter(p => !p.is_primary);
  }
}
