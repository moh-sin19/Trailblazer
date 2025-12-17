import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePage } from './profile.page';
import { ApiService } from '../../services/api.service';
import { ProfileStore } from '../../services/profile.store';
import { of, throwError } from 'rxjs';
import { PublicUserProfileView, UserProfile } from '../../models/user';
import { provideRouter } from '@angular/router';
import { ActivatedRoute } from '@angular/router';

describe('ProfilePage', () => {
  let component: ProfilePage;
  let fixture: ComponentFixture<ProfilePage>;
  let mockApiService: jasmine.SpyObj<ApiService>;
  let mockProfileStore: jasmine.SpyObj<ProfileStore>;
  let mockActivatedRoute: any;

  const mockPublicProfile: PublicUserProfileView = {
    username: 'sydney',
    displayName: 'Sydney Hiker',
    homeSuburb: 'Newtown',
    stats: {
      trailsCreated: 5,
      trailsCompleted: 10,
      commentsPosted: 15,
      trailsBookmarked: 3,
      distanceHikedKm: 120,
    },
    badges: [
      {
        id: 1,
        name: 'First Steps',
        description: 'Created your first trail',
        icon: '🥾',
        awarded: true,
        awardedAt: '2025-01-15T00:00:00Z',
        progress: undefined
      },
      {
        id: 2,
        name: 'Trail Blazer',
        description: 'Create 10 trails',
        icon: '🔥',
        awarded: false,
        awardedAt: undefined,
        progress: {
          current: 5,
          threshold: 10,
          percent: 50
        }
      }
    ],
    pendingTrails: [],
    recentTrails: [
      {
        id: 1,
        title: 'Coastal Walk',
        difficulty: 'Easy',
        distanceKm: 5.2,
        createdAt: '2025-01-10T00:00:00Z'
      }
    ],
    analytics: {
      distance: {
        totalKm: 120,
        averagePerTrailKm: 12,
        longestTrailKm: 22,
        completedTrails: 10,
      },
      difficultyBreakdown: [
        { difficulty: 'easy', count: 4, distanceKm: 30 },
        { difficulty: 'moderate', count: 4, distanceKm: 40 },
        { difficulty: 'hard', count: 2, distanceKm: 50 },
      ],
      monthlyProgress: [
        { month: '2025-01-01', count: 2, distanceKm: 20 },
        { month: '2025-02-01', count: 3, distanceKm: 36 },
        { month: '2025-03-01', count: 5, distanceKm: 64 },
      ],
    }
  };

  beforeEach(async () => {
    mockApiService = jasmine.createSpyObj('ApiService', ['getPublicProfile', 'deleteTrailSubmission']);

    const mockProfile: UserProfile = {
      id: 1,
      username: 'sydney',
      displayName: 'Sydney Hiker',
      experience: 'beginner',
      experienceLabel: 'Beginner',
      role: 'standard',
      roleLabel: 'Standard',
      email: 'sydney@example.com',
      updatedAt: '2025-01-01T00:00:00Z'
    };

    mockProfileStore = jasmine.createSpyObj('ProfileStore', ['load'], {
      profile$: of(mockProfile)
    });
    mockProfileStore.load.and.returnValue(of(mockProfile));

    mockActivatedRoute = {
      snapshot: {
        paramMap: {
          get: jasmine.createSpy('get').and.returnValue(null)
        }
      }
    };

    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: mockApiService },
        { provide: ProfileStore, useValue: mockProfileStore },
        { provide: ActivatedRoute, useValue: mockActivatedRoute }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(ProfilePage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load public profile with badges on init', () => {
    mockApiService.getPublicProfile.and.returnValue(of(mockPublicProfile));

    fixture.detectChanges();

    expect(mockApiService.getPublicProfile).toHaveBeenCalledWith('sydney');
    expect(component.publicProfile).toEqual(mockPublicProfile);
    expect(component.publicProfileError).toBeNull();
  });

  it('should handle public profile loading error', () => {
    const errorMessage = 'Network error';
    const consoleErrorSpy = spyOn(console, 'error').and.stub();
    mockApiService.getPublicProfile.and.returnValue(throwError(() => new Error(errorMessage)));

    fixture.detectChanges();

    expect(component.publicProfile).toBeNull();
    expect(component.publicProfileError).toBe('Failed to load badges and stats.');
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to load public profile:', jasmine.any(Error));
    expect((consoleErrorSpy.calls.mostRecent().args[1] as Error).message).toBe(errorMessage);
  });

  it('should call ProfileStore load on init', () => {
    mockApiService.getPublicProfile.and.returnValue(of(mockPublicProfile));

    fixture.detectChanges();

    expect(mockProfileStore.load).toHaveBeenCalled();
  });

  it('should filter awarded badges correctly', () => {
    component.publicProfile = mockPublicProfile;

    const awardedBadges = component.getAwardedBadges();

    expect(awardedBadges.length).toBe(1);
    expect(awardedBadges[0].name).toBe('First Steps');
    expect(awardedBadges[0].awarded).toBeTrue();
  });

  it('should filter in-progress badges correctly', () => {
    component.publicProfile = mockPublicProfile;

    const inProgressBadges = component.getInProgressBadges();

    expect(inProgressBadges.length).toBe(1);
    expect(inProgressBadges[0].name).toBe('Trail Blazer');
    expect(inProgressBadges[0].awarded).toBeFalse();
    expect(inProgressBadges[0].progress?.percent).toBe(50);
  });

  it('should calculate difficulty distance share', () => {
    component.publicProfile = mockPublicProfile;
    const entry = mockPublicProfile.analytics.difficultyBreakdown[0];

    const share = component.difficultyDistanceShare(entry);

    expect(share).toBe(25);
  });

  it('should format month labels for analytics charts', () => {
    component.publicProfile = mockPublicProfile;
    const monthLabel = component.formatMonthLabel(mockPublicProfile.analytics.monthlyProgress[0]);

    expect(monthLabel.toLowerCase()).toContain('jan');
  });

  it('should cap monthly bar height for tiny values', () => {
    const profileWithTinyDistance: PublicUserProfileView = {
      ...mockPublicProfile,
      analytics: {
        ...mockPublicProfile.analytics,
        monthlyProgress: [
          { month: '2025-01-01', count: 1, distanceKm: 0.1 },
          { month: '2025-02-01', count: 1, distanceKm: 4 }
        ]
      }
    };

    component.publicProfile = profileWithTinyDistance;
    const tiny = component.getMonthlyProgress()[0];
    const barHeight = component.monthlyDistanceHeight(tiny);

    expect(barHeight).toBeGreaterThan(0);
  });

  it('should return empty arrays when publicProfile is null', () => {
    component.publicProfile = null;

    expect(component.getAwardedBadges()).toEqual([]);
    expect(component.getInProgressBadges()).toEqual([]);
  });

  it('should set loading to false after ProfileStore completes', (done) => {
    mockApiService.getPublicProfile.and.returnValue(of(mockPublicProfile));

    expect(component.loading).toBeTrue();

    fixture.detectChanges();

    // Wait for async operations
    setTimeout(() => {
      expect(component.loading).toBeFalse();
      done();
    }, 100);
  });

  it('should handle ProfileStore error gracefully', (done) => {
    mockProfileStore.load.and.returnValue(throwError(() => new Error('Store error')));
    mockApiService.getPublicProfile.and.returnValue(of(mockPublicProfile));

    fixture.detectChanges();

    setTimeout(() => {
      expect(component.loading).toBeFalse();
      done();
    }, 100);
  });

  it('should load another user\'s profile when username parameter is provided', () => {
    const alexProfile: PublicUserProfileView = {
      username: 'alex',
      displayName: 'Alex Trail Runner',
      homeSuburb: undefined,
    stats: {
      trailsCreated: 12,
      trailsCompleted: 20,
      commentsPosted: 8,
      trailsBookmarked: 15,
      distanceHikedKm: 250,
    },
    badges: [],
    pendingTrails: [],
    recentTrails: [],
    analytics: {
      distance: {
        totalKm: 250,
        averagePerTrailKm: 12.5,
        longestTrailKm: 30,
        completedTrails: 20,
      },
      difficultyBreakdown: [],
      monthlyProgress: [],
    }
  };

    mockActivatedRoute.snapshot.paramMap.get.and.returnValue('alex');
    mockApiService.getPublicProfile.and.returnValue(of(alexProfile));

    fixture.detectChanges();

    expect(component.viewingUsername).toBe('alex');
    expect(mockApiService.getPublicProfile).toHaveBeenCalledWith('alex');
    expect(component.publicProfile).toEqual(alexProfile);
    expect(component.isOwnProfile).toBeFalse();
  });

  it('should set isOwnProfile to true when viewing own profile via username', (done) => {
    mockActivatedRoute.snapshot.paramMap.get.and.returnValue('SYDNEY');
    mockApiService.getPublicProfile.and.returnValue(of(mockPublicProfile));

    fixture.detectChanges();

    setTimeout(() => {
      expect(component.viewingUsername).toBe('sydney');
      expect(component.isOwnProfile).toBeTrue();
      expect(mockApiService.getPublicProfile).toHaveBeenCalledWith('sydney');
      done();
    }, 100);
  });
});
