import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { take } from 'rxjs/operators';

import { ProfileStore } from '../../services/profile.store';
import { ApiService } from '../../services/api.service';
import { ExperienceLevel, ProfileUpdatePayload, UserProfile } from '../../models/user';

@Component({
  standalone: true,
  selector: 'app-profile-settings',
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './profile-settings.page.html'
})
export class ProfileSettingsPage implements OnInit {
  form!: FormGroup;
  loading = true;
  saving = false;
  avatarPreview?: string;
  currentAvatar?: string;
  selectedFile?: File;
  errorMessage?: string;
  successMessage?: string;
  isSignedIn = false;

  readonly experienceLevels: { value: ExperienceLevel; label: string }[] = [
    { value: 'beginner', label: 'Beginner' },
    { value: 'intermediate', label: 'Intermediate' },
    { value: 'advanced', label: 'Advanced' }
  ];

  constructor(
    private fb: FormBuilder,
    private profileStore: ProfileStore,
    private apiService: ApiService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initForm();
    this.loadProfile();
  }

  private initForm(): void {
    this.form = this.fb.group({
      displayName: ['', [Validators.required, Validators.minLength(3), Validators.maxLength(50)]],
      bio: ['', [Validators.maxLength(500)]],
      experience: ['beginner', [Validators.required]]
    });
  }

  private loadProfile(): void {
    this.profileStore
      .load()
      .pipe(take(1))
      .subscribe({
        next: profile => {
          if (profile) {
            this.isSignedIn = true;
            this.populateForm(profile);
            this.currentAvatar = profile.avatarUrl;
          } else {
            this.isSignedIn = false;
          }
          this.loading = false;
        },
        error: () => {
          this.isSignedIn = false;
          this.loading = false;
        }
      });
  }

  private populateForm(profile: UserProfile): void {
    this.form.patchValue({
      displayName: profile.displayName,
      bio: profile.bio || '',
      experience: profile.experience
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files[0]) {
      const file = input.files[0];

      if (!file.type.startsWith('image/')) {
        this.errorMessage = 'Please select a valid image file';
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        this.errorMessage = 'File size must be less than 5MB';
        return;
      }

      this.selectedFile = file;

      const reader = new FileReader();
      reader.onload = () => {
        this.avatarPreview = reader.result as string;
      };
      reader.readAsDataURL(file);
    }
  }

  removeAvatar(): void {
    this.selectedFile = undefined;
    this.avatarPreview = undefined;
    this.currentAvatar = undefined;
  }

  onSubmit(): void {
    if (this.form.invalid || this.saving) {
      return;
    }

    this.saving = true;
    this.errorMessage = undefined;
    this.successMessage = undefined;

    const payload: ProfileUpdatePayload = {
      displayName: this.form.value.displayName,
      bio: this.form.value.bio || null,
      experience: this.form.value.experience
    };

    if (this.selectedFile) {
      payload.avatarFile = this.selectedFile;
    } else if (!this.currentAvatar && !this.avatarPreview) {
      payload.removeAvatar = true;
    }

    this.apiService
      .updateProfile(payload)
      .pipe(take(1))
      .subscribe({
        next: updatedProfile => {
          this.profileStore.set(updatedProfile);
          this.successMessage = 'Profile updated successfully';
          this.saving = false;

          setTimeout(() => {
            this.router.navigate(['/profile']);
          }, 1500);
        },
        error: err => {
          this.errorMessage = err?.error?.message || 'Failed to update profile';
          this.saving = false;
        }
      });
  }

  cancel(): void {
    this.router.navigate(['/profile']);
  }
}
