import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { ProfileSettingsPage } from './profile-settings.page';
import { ProfileStore } from '../../services/profile.store';
import { ApiService } from '../../services/api.service';
import { UserProfile } from '../../models/user';

describe('ProfileSettingsPage', () => {
  let component: ProfileSettingsPage;
  let fixture: ComponentFixture<ProfileSettingsPage>;
  let profileStoreSpy: jasmine.SpyObj<ProfileStore>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;
  let router: Router;

  const mockProfile: UserProfile = {
    id: 1,
    username: 'testuser',
    displayName: 'Test User',
    bio: 'Test bio',
    experience: 'intermediate',
    experienceLabel: 'Intermediate',
    role: 'standard',
    roleLabel: 'Standard',
    email: 'test@example.com',
    avatarUrl: undefined,
    updatedAt: '2025-01-01T00:00:00Z'
  };

  beforeEach(async () => {
    const profileStoreSpyObj = jasmine.createSpyObj('ProfileStore', ['load', 'set']);
    const apiServiceSpyObj = jasmine.createSpyObj('ApiService', ['updateProfile']);

    await TestBed.configureTestingModule({
      imports: [ProfileSettingsPage, ReactiveFormsModule, RouterTestingModule],
      providers: [
        { provide: ProfileStore, useValue: profileStoreSpyObj },
        { provide: ApiService, useValue: apiServiceSpyObj }
      ]
    }).compileComponents();

    profileStoreSpy = TestBed.inject(ProfileStore) as jasmine.SpyObj<ProfileStore>;
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
    router = TestBed.inject(Router);
    spyOn(router, 'navigate').and.stub();

    fixture = TestBed.createComponent(ProfileSettingsPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load profile on init', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));

    fixture.detectChanges();

    expect(profileStoreSpy.load).toHaveBeenCalled();
    expect(component.loading).toBeFalse();
  });

  it('should populate form with profile data', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));

    fixture.detectChanges();

    expect(component.form.value).toEqual({
      displayName: 'Test User',
      bio: 'Test bio',
      experience: 'intermediate'
    });
  });

  it('should validate display name required', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const displayName = component.form.get('displayName');
    displayName?.setValue('');

    expect(displayName?.hasError('required')).toBeTrue();
  });

  it('should validate display name min length', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const displayName = component.form.get('displayName');
    displayName?.setValue('AB');

    expect(displayName?.hasError('minlength')).toBeTrue();
  });

  it('should validate display name max length', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const displayName = component.form.get('displayName');
    displayName?.setValue('A'.repeat(51));

    expect(displayName?.hasError('maxlength')).toBeTrue();
  });

  it('should validate bio max length', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const bio = component.form.get('bio');
    bio?.setValue('A'.repeat(501));

    expect(bio?.hasError('maxlength')).toBeTrue();
  });

  it('should update profile successfully', (done) => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    apiServiceSpy.updateProfile.and.returnValue(of(mockProfile));

    fixture.detectChanges();

    component.form.patchValue({
      displayName: 'Updated Name',
      bio: 'Updated bio',
      experience: 'advanced'
    });

    component.onSubmit();

    setTimeout(() => {
      expect(apiServiceSpy.updateProfile).toHaveBeenCalled();
      expect(profileStoreSpy.set).toHaveBeenCalledWith(mockProfile);
      expect(component.successMessage).toBe('Profile updated successfully');
      done();
    }, 0);
  });

  it('should handle update errors', (done) => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    apiServiceSpy.updateProfile.and.returnValue(throwError(() => ({ error: { message: 'Update failed' } })));

    fixture.detectChanges();

    component.onSubmit();

    setTimeout(() => {
      expect(component.errorMessage).toBe('Update failed');
      expect(component.saving).toBeFalse();
      done();
    }, 0);
  });

  it('should handle file selection', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const file = new File(['test'], 'test.jpg', { type: 'image/jpeg' });
    const event = { target: { files: [file] } } as any;

    component.onFileSelected(event);

    expect(component.selectedFile).toBe(file);
  });

  it('should reject non-image files', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const file = new File(['test'], 'test.txt', { type: 'text/plain' });
    const event = { target: { files: [file] } } as any;

    component.onFileSelected(event);

    expect(component.errorMessage).toBe('Please select a valid image file');
    expect(component.selectedFile).toBeUndefined();
  });

  it('should reject files over 5MB', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    const largeFile = new File(['x'.repeat(6 * 1024 * 1024)], 'large.jpg', { type: 'image/jpeg' });
    const event = { target: { files: [largeFile] } } as any;

    component.onFileSelected(event);

    expect(component.errorMessage).toBe('File size must be less than 5MB');
    expect(component.selectedFile).toBeUndefined();
  });

  it('should remove avatar', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    component.currentAvatar = 'https://example.com/avatar.jpg';
    component.removeAvatar();

    expect(component.currentAvatar).toBeUndefined();
    expect(component.avatarPreview).toBeUndefined();
    expect(component.selectedFile).toBeUndefined();
  });

  it('should navigate back on cancel', () => {
    profileStoreSpy.load.and.returnValue(of(mockProfile));
    fixture.detectChanges();

    component.cancel();

    expect(router.navigate).toHaveBeenCalledWith(['/profile']);
  });
});
