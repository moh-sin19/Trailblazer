import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../services/api.service';
import { TrailPhoto } from '../../models/trail';

@Component({
  selector: 'app-trail-photo-upload',
  templateUrl: './trail-photo-upload.component.html',
  styleUrls: ['./trail-photo-upload.component.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule]
})
export class TrailPhotoUploadComponent {
  @Input() trailSlug!: string;
  @Output() photoUploaded = new EventEmitter<TrailPhoto>();

  selectedFile: File | null = null;
  previewUrl: string | null = null;
  caption: string = '';
  isPrimary: boolean = false;
  isUploading: boolean = false;
  uploadError: string | null = null;

  constructor(private apiService: ApiService) {}

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      const file = input.files[0];

      // Validate file type
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(file.type)) {
        this.uploadError = 'Please select a JPEG, PNG, or WebP image.';
        this.selectedFile = null;
        this.previewUrl = null;
        return;
      }

      // Validate file size (max 10MB)
      if (file.size > 10 * 1024 * 1024) {
        this.uploadError = 'File size must be less than 10MB.';
        this.selectedFile = null;
        this.previewUrl = null;
        return;
      }

      this.uploadError = null;
      this.selectedFile = file;

      // Generate preview
      const reader = new FileReader();
      reader.onload = (e) => {
        this.previewUrl = e.target?.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  uploadPhoto(): void {
    if (!this.selectedFile || !this.trailSlug) {
      return;
    }

    this.isUploading = true;
    this.uploadError = null;

    this.apiService.uploadTrailPhoto(
      this.trailSlug,
      this.selectedFile,
      this.caption,
      this.isPrimary
    ).subscribe({
      next: (photo) => {
        this.isUploading = false;
        this.photoUploaded.emit(photo);
        this.resetForm();
      },
      error: (error) => {
        this.isUploading = false;
        this.uploadError = error?.error?.detail || 'Failed to upload photo. Please try again.';
      }
    });
  }

  resetForm(): void {
    this.selectedFile = null;
    this.previewUrl = null;
    this.caption = '';
    this.isPrimary = false;
    this.uploadError = null;
  }

  cancelUpload(): void {
    this.resetForm();
  }
}
