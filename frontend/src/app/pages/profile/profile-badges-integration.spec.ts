import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from '../../services/api.service';
import { API_BASE_URL } from '../../config/api.config';
import { PublicUserProfileView } from '../../models/user';

describe('Profile Badges - API Integration', () => {
  let service: ApiService;
  let httpMock: HttpTestingController;
  const baseUrl = API_BASE_URL;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ApiService]
    });
    service = TestBed.inject(ApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  describe('getPublicProfile', () => {
    it('should successfully fetch profile data with badges from API', (done) => {
      const mockResponse = {
        username: 'sydney',
        display_name: 'Sydney Hiker',
        home_suburb: 'Newtown',
        stats: {
          trails_created: 5,
          trails_completed: 10,
          comments_posted: 15,
          trails_bookmarked: 3,
          distance_hiked_km: 87
        },
        badges: [
          {
            id: 1,
            name: 'First Steps',
            description: 'Created your first trail',
            icon: '🥾',
            awarded: true,
            awarded_at: '2025-01-15T00:00:00Z',
            progress: null
          },
          {
            id: 2,
            name: 'Conversationalist',
            description: 'Posted 10 comments',
            icon: '💬',
            awarded: true,
            awarded_at: '2025-01-20T00:00:00Z',
            progress: null
          },
          {
            id: 3,
            name: 'Trail Blazer',
            description: 'Create 10 trails',
            icon: '🔥',
            awarded: false,
            awarded_at: null,
            progress: {
              current: 5,
              threshold: 10,
              percent: 50
            }
          }
        ],
        pending_trails: [],
        recent_trails: [
          {
            id: 1,
            title: 'Coastal Walk',
            difficulty: 'Easy',
            distance_km: 5.2,
            created_at: '2025-01-10T00:00:00Z'
          }
        ],
        analytics: {
          distance: {
            total_km: 87,
            average_per_trail_km: 8.7,
            longest_trail_km: 12.4,
            completed_trails: 10
          },
          difficulty_breakdown: [
            { difficulty: 'easy', count: 3, distance_km: 15.6 },
            { difficulty: 'moderate', count: 4, distance_km: 28.4 },
            { difficulty: 'hard', count: 3, distance_km: 43 }
          ],
          monthly_progress: [
            { month: '2025-01-01', count: 2, distance_km: 12 },
            { month: '2025-02-01', count: 4, distance_km: 30 },
            { month: '2025-03-01', count: 4, distance_km: 45 }
          ]
        }
      };

      service.getPublicProfile('sydney').subscribe(profile => {
        // Verify basic profile structure
        expect(profile).toBeTruthy();
        expect(profile.username).toBe('sydney');
        expect(profile.displayName).toBe('Sydney Hiker');
        expect(profile.homeSuburb).toBe('Newtown');

        // Verify stats structure (camelCase after normalisation)
        expect(profile.stats).toBeTruthy();
        expect(profile.stats.trailsCreated).toBe(5);
        expect(profile.stats.trailsCompleted).toBe(10);
        expect(profile.stats.commentsPosted).toBe(15);
        expect(profile.stats.trailsBookmarked).toBe(3);
        expect(profile.stats.distanceHikedKm).toBe(87);

        expect(profile.analytics.distance.totalKm).toBe(87);
        expect(profile.analytics.distance.completedTrails).toBe(10);
        expect(profile.analytics.difficultyBreakdown.length).toBe(3);
        expect(profile.analytics.monthlyProgress.length).toBe(3);

        // Verify badges array
        expect(Array.isArray(profile.badges)).toBeTrue();
        expect(profile.badges.length).toBe(3);

        // Verify badge structure
        const firstBadge = profile.badges[0];
        expect(firstBadge.id).toBe(1);
        expect(firstBadge.name).toBe('First Steps');
        expect(firstBadge.description).toBe('Created your first trail');
        expect(firstBadge.icon).toBe('🥾');
        expect(firstBadge.awarded).toBeTrue();
        expect(firstBadge.awardedAt).toBe('2025-01-15T00:00:00Z');

        // Check that we have the Conversationalist badge (sydney has 15 comments)
        const earnedBadges = profile.badges.filter(b => b.awarded);
        expect(earnedBadges.length).toBe(2);

        const conversationalistBadge = earnedBadges.find(b => b.name === 'Conversationalist');
        expect(conversationalistBadge).toBeDefined();
        expect(conversationalistBadge!.icon).toBe('💬');

        // Verify in-progress badge with progress
        const inProgressBadges = profile.badges.filter(b => !b.awarded && b.progress);
        expect(inProgressBadges.length).toBe(1);
        expect(inProgressBadges[0].name).toBe('Trail Blazer');
        expect(inProgressBadges[0].progress?.current).toBe(5);
        expect(inProgressBadges[0].progress?.threshold).toBe(10);
        expect(inProgressBadges[0].progress?.percent).toBe(50);

        // Verify recent trails
        expect(Array.isArray(profile.recentTrails)).toBeTrue();
        expect(profile.recentTrails.length).toBe(1);
        expect(profile.recentTrails[0].title).toBe('Coastal Walk');
        expect(profile.recentTrails[0].difficulty).toBe('Easy');
        expect(profile.recentTrails[0].distanceKm).toBe(5.2);

        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/profiles/sydney/`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle API error when profile not found', (done) => {
      service.getPublicProfile('nonexistent').subscribe({
        next: () => fail('Should have failed with 404'),
        error: (error) => {
          expect(error.status).toBe(404);
          done();
        }
      });

      const req = httpMock.expectOne(`${baseUrl}/profiles/nonexistent/`);
      req.flush({ detail: 'Not found' }, { status: 404, statusText: 'Not Found' });
    });

    it('should normalise snake_case API response to camelCase', (done) => {
      const mockResponse = {
        username: 'testuser',
        display_name: 'Test User',
        home_suburb: 'Test Suburb',
        stats: {
          trails_created: 1,
          trails_completed: 2,
          comments_posted: 3,
          trails_bookmarked: 4,
          distance_hiked_km: 12
        },
        badges: [],
        pending_trails: [],
        recent_trails: [],
        analytics: {
          distance: {
            total_km: 12,
            average_per_trail_km: 6,
            longest_trail_km: 8,
            completed_trails: 2
          },
          difficulty_breakdown: [],
          monthly_progress: []
        }
      };

      service.getPublicProfile('testuser').subscribe(profile => {
        // Verify camelCase conversion
        expect(profile.displayName).toBe('Test User');
        expect(profile.homeSuburb).toBe('Test Suburb');
        expect(profile.stats.trailsCreated).toBe(1);
        expect(profile.stats.trailsCompleted).toBe(2);
        expect(profile.stats.commentsPosted).toBe(3);
        expect(profile.stats.trailsBookmarked).toBe(4);
        expect(profile.stats.distanceHikedKm).toBe(12);
        expect(profile.analytics.distance.totalKm).toBe(12);
        expect(profile.recentTrails).toEqual([]);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/profiles/testuser/`);
      req.flush(mockResponse);
    });

    it('should handle badges with null progress for awarded badges', (done) => {
      const mockResponse = {
        username: 'testuser',
        display_name: 'Test User',
        home_suburb: null,
        stats: {
          trails_created: 0,
          trails_completed: 0,
          comments_posted: 0,
          trails_bookmarked: 0,
          distance_hiked_km: 0
        },
        badges: [
          {
            id: 1,
            name: 'Welcome',
            description: 'Joined the platform',
            icon: '👋',
            awarded: true,
            awarded_at: '2025-01-01T00:00:00Z',
            progress: null
          }
        ],
        pending_trails: [],
        recent_trails: [],
        analytics: {
          distance: {
            total_km: 0,
            average_per_trail_km: 0,
            longest_trail_km: 0,
            completed_trails: 0
          },
          difficulty_breakdown: [],
          monthly_progress: []
        }
      };

      service.getPublicProfile('testuser').subscribe(profile => {
        expect(profile.badges.length).toBe(1);
        expect(profile.badges[0].awarded).toBeTrue();
        expect(profile.badges[0].progress).toBeUndefined();
        expect(profile.badges[0].awardedAt).toBe('2025-01-01T00:00:00Z');
        expect(profile.analytics.distance.totalKm).toBe(0);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/profiles/testuser/`);
      req.flush(mockResponse);
    });

    it('should handle badges with progress for unaward badges', (done) => {
      const mockResponse = {
        username: 'testuser',
        display_name: 'Test User',
        home_suburb: null,
        stats: {
          trails_created: 3,
          trails_completed: 0,
          comments_posted: 0,
          trails_bookmarked: 0,
          distance_hiked_km: 0
        },
        badges: [
          {
            id: 2,
            name: 'Creator',
            description: 'Create 5 trails',
            icon: '✨',
            awarded: false,
            awarded_at: null,
            progress: {
              current: 3,
              threshold: 5,
              percent: 60
            }
          }
        ],
        pending_trails: [],
        recent_trails: [],
        analytics: {
          distance: {
            total_km: 0,
            average_per_trail_km: 0,
            longest_trail_km: 0,
            completed_trails: 0
          },
          difficulty_breakdown: [],
          monthly_progress: []
        }
      };

      service.getPublicProfile('testuser').subscribe(profile => {
        expect(profile.badges.length).toBe(1);
        expect(profile.badges[0].awarded).toBeFalse();
        expect(profile.badges[0].awardedAt).toBeUndefined();
        expect(profile.badges[0].progress).toBeDefined();
        expect(profile.badges[0].progress?.current).toBe(3);
        expect(profile.badges[0].progress?.threshold).toBe(5);
        expect(profile.badges[0].progress?.percent).toBe(60);
        expect(profile.analytics.difficultyBreakdown.length).toBe(0);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/profiles/testuser/`);
      req.flush(mockResponse);
    });

    it('should handle recent trails with all fields', (done) => {
      const mockResponse = {
        username: 'testuser',
        display_name: 'Test User',
        home_suburb: null,
        stats: {
          trails_created: 1,
          trails_completed: 0,
          comments_posted: 0,
          trails_bookmarked: 0,
          distance_hiked_km: 0
        },
        badges: [],
        pending_trails: [],
        recent_trails: [
          {
            id: 10,
            title: 'Mountain Trail',
            difficulty: 'Hard',
            distance_km: 12.5,
            created_at: '2025-02-01T10:30:00Z'
          },
          {
            id: 11,
            title: 'Beach Walk',
            difficulty: 'Easy',
            distance_km: 3.2,
            created_at: '2025-02-02T14:00:00Z'
          }
        ],
        analytics: {
          distance: {
            total_km: 0,
            average_per_trail_km: 0,
            longest_trail_km: 0,
            completed_trails: 0
          },
          difficulty_breakdown: [],
          monthly_progress: []
        }
      };

      service.getPublicProfile('testuser').subscribe(profile => {
        expect(profile.recentTrails.length).toBe(2);

        const trail1 = profile.recentTrails[0];
        expect(trail1.id).toBe(10);
        expect(trail1.title).toBe('Mountain Trail');
        expect(trail1.difficulty).toBe('Hard');
        expect(trail1.distanceKm).toBe(12.5);
        expect(trail1.createdAt).toBe('2025-02-01T10:30:00Z');

        const trail2 = profile.recentTrails[1];
        expect(trail2.id).toBe(11);
        expect(trail2.title).toBe('Beach Walk');
        expect(trail2.difficulty).toBe('Easy');
        expect(trail2.distanceKm).toBe(3.2);
        expect(profile.analytics.distance.completedTrails).toBe(0);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/profiles/testuser/`);
      req.flush(mockResponse);
    });
  });
});
