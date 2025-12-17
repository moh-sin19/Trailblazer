import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';

import { ProfileStore } from './profile.store';
import { ApiService } from './api.service';
import { UserProfile } from '../models/user';

describe('ProfileStore', () => {
  let store: ProfileStore;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;

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
    avatarUrl: 'https://example.com/avatar.jpg',
    updatedAt: '2025-01-01T00:00:00Z'
  };

  beforeEach(() => {
    const spy = jasmine.createSpyObj('ApiService', ['getProfile']);

    TestBed.configureTestingModule({
      providers: [
        ProfileStore,
        { provide: ApiService, useValue: spy }
      ]
    });

    store = TestBed.inject(ProfileStore);
    apiServiceSpy = TestBed.inject(ApiService) as jasmine.SpyObj<ApiService>;
  });

  it('should be created', () => {
    expect(store).toBeTruthy();
  });

  it('should load profile successfully', (done) => {
    apiServiceSpy.getProfile.and.returnValue(of(mockProfile));

    store.load().subscribe(profile => {
      expect(profile).toEqual(mockProfile);
      expect(apiServiceSpy.getProfile).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('should return null when API returns null', (done) => {
    apiServiceSpy.getProfile.and.returnValue(of(null));

    store.load().subscribe(profile => {
      expect(profile).toBeNull();
      expect(apiServiceSpy.getProfile).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('should handle API errors gracefully', (done) => {
    apiServiceSpy.getProfile.and.returnValue(throwError(() => new Error('API error')));

    store.load().subscribe(profile => {
      expect(profile).toBeNull();
      expect(apiServiceSpy.getProfile).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('should not reload profile if already loaded', () => {
    apiServiceSpy.getProfile.and.returnValue(of(mockProfile));

    store.load().subscribe();
    store.load().subscribe();

    expect(apiServiceSpy.getProfile).toHaveBeenCalledTimes(1);
  });

  it('should reload profile when force is true', () => {
    apiServiceSpy.getProfile.and.returnValue(of(mockProfile));

    store.load().subscribe();
    store.load(true).subscribe();

    expect(apiServiceSpy.getProfile).toHaveBeenCalledTimes(2);
  });

  it('should update profile via setProfile', (done) => {
    store.setProfile(mockProfile);

    store.profile$.subscribe(profile => {
      expect(profile).toEqual(mockProfile);
      done();
    });
  });

  it('should return snapshot of current profile', () => {
    store.setProfile(mockProfile);
    expect(store.snapshot).toEqual(mockProfile);
  });

  it('should return null snapshot when no profile loaded', () => {
    expect(store.snapshot).toBeNull();
  });

  it('should emit profile updates via observable', (done) => {
    const profiles: (UserProfile | null)[] = [];

    store.profile$.subscribe(profile => {
      profiles.push(profile);

      if (profiles.length === 2) {
        expect(profiles[0]).toBeNull();
        expect(profiles[1]).toEqual(mockProfile);
        done();
      }
    });

    store.setProfile(mockProfile);
  });
});
