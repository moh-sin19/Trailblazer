import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { TrailSearchParams, MapQueryParams } from '../models/search';
import { API_BASE_URL } from '../config/api.config';
import { TrailSubmissionPayload } from '../models/trail-submission';
import { LatLng } from '../models/trail';

describe('ApiService', () => {
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

  describe('searchTrails', () => {
    it('should search trails with query parameters', (done) => {
      const params: TrailSearchParams = {
        q: 'test',
        difficulty: 'easy',
        distance_km_min: 5,
        distance_km_max: 10,
        category_ids: [1, 2],
        city: 'Sydney',
        country: 'Australia',
        page: 1,
        page_size: 20
      };

      const mockResponse = {
        results: [
          {
            id: '1',
            slug: 'test-trail',
            name: 'Test Trail',
            difficulty: 'Easy',
            distance_km: 7,
            rating_avg: 4.5,
            rating_count: 10,
            description: 'A test trail',
            segments: [[
              { lat: -33.8688, lng: 151.2093 },
              { lat: -33.87, lng: 151.21 }
            ]],
            start: { lat: -33.8688, lng: 151.2093 },
            elev_gain_m: 100,
            duration_mins: 120,
            city: 'Sydney',
            country: 'Australia'
          }
        ],
        total_count: 1,
        next: null,
        previous: null
      };

      service.searchTrails(params).subscribe(response => {
        expect(response.results.length).toBe(1);
        expect(response.total_count).toBe(1);
        expect(response.results[0].name).toBe('Test Trail');
        done();
      });

      const req = httpMock.expectOne((request) => {
        return request.url === `${baseUrl}/trails/` &&
          request.params.get('q') === 'test' &&
          request.params.get('difficulty') === 'easy' &&
          request.params.get('distance_km_min') === '5' &&
          request.params.get('distance_km_max') === '10' &&
          request.params.get('category_ids') === '1,2' &&
          request.params.get('city') === 'Sydney' &&
          request.params.get('country') === 'Australia' &&
          request.params.get('page') === '1' &&
          request.params.get('page_size') === '20';
      });
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle search errors with fallback', (done) => {
      const params: TrailSearchParams = { q: 'test' };

      service.searchTrails(params).subscribe(response => {
        expect(response.results).toEqual([]);
        expect(response.total_count).toBe(0);
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/trails/'));
      req.error(new ProgressEvent('error'));
    });
  });

  describe('getMapData', () => {
    it('should get map data with bbox and zoom', (done) => {
      const params: MapQueryParams = {
        bbox: '151.0,--34.0,151.5,-33.5',
        zoom: 10,
        cluster: true,
        max_markers: 500
      };

      const mockResponse = {
        features: [
          {
            id: '1',
            slug: 'test-trail',
            name: 'Test Trail',
            lat: -33.8688,
            lng: 151.2093,
            is_cluster: false,
            cluster_count: 0,
            difficulty: 'Easy',
            distance_km: 7,
            segments: [[
              { lat: -33.8688, lng: 151.2093 },
              { lat: -33.86, lng: 151.215 },
            ]],
            start: { lat: -33.8688, lng: 151.2093 },
          }
        ],
        map_bounds: {
          south: -34.0,
          west: 151.0,
          north: -33.5,
          east: 151.5
        },
        total_in_bbox: 1
      };

      service.getMapData(params).subscribe(response => {
        expect(response.features.length).toBe(1);
        expect(response.total_in_bbox).toBe(1);
        expect(response.features[0].name).toBe('Test Trail');
        done();
      });

      const req = httpMock.expectOne((request) => {
        return request.url === `${baseUrl}/trails/map/` &&
          request.params.get('bbox') === '151.0,--34.0,151.5,-33.5' &&
          request.params.get('zoom') === '10' &&
          request.params.get('cluster') === 'true' &&
          request.params.get('max_markers') === '500';
      });
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should include search filters in map data request', (done) => {
      const params: MapQueryParams = {
        bbox: '151.0,-34.0,151.5,-33.5',
        zoom: 10,
        difficulty: 'moderate',
        distance_km_min: 5,
        distance_km_max: 15,
        category_ids: [3]
      };

      const mockResponse = {
        features: [],
        map_bounds: { south: 0, west: 0, north: 0, east: 0 },
        total_in_bbox: 0
      };

      service.getMapData(params).subscribe(() => {
        done();
      });

      const req = httpMock.expectOne((request) => {
        return request.url === `${baseUrl}/trails/map/` &&
          request.params.get('difficulty') === 'moderate' &&
          request.params.get('distance_km_min') === '5' &&
          request.params.get('distance_km_max') === '15' &&
          request.params.get('category_ids') === '3';
      });
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

  it('should handle map data errors with fallback', (done) => {
      const params: MapQueryParams = {
        bbox: '151.0,-34.0,151.5,-33.5',
        zoom: 10
      };

      service.getMapData(params).subscribe(response => {
        expect(response.features).toEqual([]);
        expect(response.total_in_bbox).toBe(0);
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/trails/map/'));
      req.error(new ProgressEvent('error'));
    });

    it('should expose segments geometry in map responses', (done) => {
      const params: MapQueryParams = {
        bbox: '151.0,-34.0,151.5,-33.5',
        zoom: 12,
      };

      const mockResponse = {
        features: [
          {
            id: 'route-1',
            slug: 'coastal-route',
            name: 'Coastal Route',
            lat: -33.9,
            lng: 151.24,
            is_cluster: false,
            cluster_count: 1,
            difficulty: 'Moderate',
            segments: [[
              { lat: -33.9, lng: 151.24 },
              { lat: -33.91, lng: 151.25 },
              { lat: -33.92, lng: 151.26 },
            ]],
            start: { lat: -33.9, lng: 151.24 },
          },
        ],
        map_bounds: { south: -34, west: 151.2, north: -33.8, east: 151.3 },
        total_in_bbox: 1,
      };

      service.getMapData(params).subscribe(response => {
        expect(response.features[0].segments?.length).toBe(1);
        expect(response.features[0].segments![0].length).toBe(3);
        expect(response.features[0].start).toEqual({ lat: -33.9, lng: 151.24 });
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/trails/map/'));
      req.flush(mockResponse);
    });
  });

  describe('getFilterOptions', () => {
    it('should get filter options from backend', (done) => {
      const mockResponse = {
        difficulties: [
          { value: 'easy' as const, label: 'Easy' },
          { value: 'moderate' as const, label: 'Moderate' },
          { value: 'hard' as const, label: 'Hard' }
        ],
        distance_range: { min: 0, max: 50 },
        categories: [
          { id: 1, name: 'Hiking', slug: 'hiking' },
          { id: 2, name: 'Mountain Biking', slug: 'mountain-biking' }
        ],
        cities: ['Sydney', 'Melbourne'],
        countries: ['Australia']
      };

      service.getFilterOptions().subscribe(response => {
        expect(response.difficulties.length).toBe(3);
        expect(response.categories.length).toBe(2);
        expect(response.cities.length).toBe(2);
        expect(response.distance_range.max).toBe(50);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/trails/filters/`);
      expect(req.request.method).toBe('GET');
      req.flush(mockResponse);
    });

    it('should handle filter options errors with fallback', (done) => {
      service.getFilterOptions().subscribe(response => {
        expect(response.difficulties.length).toBe(3);
        expect(response.categories).toEqual([]);
        expect(response.distance_range.max).toBe(2000);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/trails/filters/`);
      req.error(new ProgressEvent('error'));
    });
  });

  describe('normaliseTrail', () => {
    it('should normalise city, country, lat, lng fields', (done) => {
      const mockResponse = {
        results: [{
          id: '1',
          slug: 'test-trail',
          name: 'Test Trail',
          city: 'Sydney',
          country: 'Australia',
          latitude: -33.8688,
          longitude: 151.2093,
          difficulty: 'Easy',
          distance_km: 5,
          rating_avg: 4.0,
          rating_count: 5,
          description: 'Test',
          segments: [[
            { lat: -33.8688, lng: 151.2093 },
            { lat: -33.87, lng: 151.21 }
          ]],
          start: { lat: -33.8688, lng: 151.2093 },
          elev_gain_m: 50,
          duration_mins: 60
        }],
        total_count: 1,
        next: null,
        previous: null
      };

      service.searchTrails({}).subscribe(response => {
        const trail = response.results[0];
        expect(trail.city).toBe('Sydney');
        expect(trail.country).toBe('Australia');
        expect(trail.latitude).toBe(-33.8688);
        expect(trail.longitude).toBe(151.2093);
        done();
      });

      const req = httpMock.expectOne((request) => request.url.includes('/trails/'));
      req.flush(mockResponse);
    });

    it('should retain segments array and resolve start fallbacks', () => {
      const normalised = (service as any).normaliseTrail({
        id: 'route-2',
        name: 'Ridgeline Walk',
        difficulty: 'Hard',
        segments: [[
          { lat: -33.6, lng: 150.3 },
          { lat: -33.61, lng: 150.31 },
          { lat: -33.62, lng: 150.315 },
        ]],
        start: { lat: -33.6, lng: 150.3 },
      });
      expect(normalised.segments.length).toBe(1);
      expect(normalised.segments[0].length).toBe(3);
      expect(normalised.start).toEqual({ lat: -33.6, lng: 150.3 });
    });
  });

  describe('normaliseProfile', () => {
    it('should map API fields to app model', () => {
      const raw = {
        id: 5,
        username: 'explorer',
        display_name: 'Explorer',
        bio: 'Loves trails',
        experience: 'advanced',
        experience_label: 'Advanced',
        role: 'admin',
        role_label: 'Administrator',
        avatar_url: 'https://example.com/avatar.jpg',
        email: 'explorer@example.com',
        updated_at: '2024-01-01T00:00:00Z'
      };

      const profile = service.normaliseProfile(raw);

      expect(profile).toEqual({
        id: 5,
        username: 'explorer',
        displayName: 'Explorer',
        bio: 'Loves trails',
        experience: 'advanced',
        experienceLabel: 'Advanced',
        role: 'admin',
        roleLabel: 'Administrator',
        avatarUrl: 'https://example.com/avatar.jpg',
        email: 'explorer@example.com',
        updatedAt: '2024-01-01T00:00:00Z'
      });
    });
  });

  describe('normaliseAuthenticatedUser', () => {
    it('should map nested user data', () => {
      const raw = {
        id: 10,
        username: 'scout',
        email: 'scout@example.com',
        profile: {
          id: 10,
          username: 'scout',
          display_name: 'Trail Scout',
          experience: 'intermediate',
          experience_label: 'Intermediate',
          role: 'standard',
          role_label: 'Standard',
          email: 'scout@example.com',
          updated_at: '2024-02-01T00:00:00Z'
        }
      };

      const user = service.normaliseAuthenticatedUser(raw);

      expect(user.username).toBe('scout');
      expect(user.profile.username).toBe('scout');
      expect(user.profile.displayName).toBe('Trail Scout');
      expect(user.profile.experience).toBe('intermediate');
      expect(user.profile.role).toBe('standard');
    });
  });

  describe('submitTrail', () => {
    it('should post the trail submission payload and normalise the response', (done) => {
      const payload: TrailSubmissionPayload = {
        name: 'Skyline Track',
        difficulty: 'Hard',
        distance_km: 12.34,
        elev_gain_m: 870,
        expected_time_h: 5.5,
        description: 'Rocky scramble with sweeping views.',
        start: { lat: -33.86, lng: 151.21 },
        segments: [
          [
            { lat: -33.86, lng: 151.21 },
            { lat: -33.861, lng: 151.215 }
          ],
          [
            { lat: -33.861, lng: 151.215 },
            { lat: -33.862, lng: 151.22 }
          ]
        ]
      };

      const mockResponse = {
        id: 42,
        name: 'Skyline Track',
        difficulty: 'hard',
        distance_km: 12.34,
        elev_gain_m: 870,
        expected_time_h: 5.5,
        description: 'Rocky scramble with sweeping views.',
        start: { lat: -33.86, lng: 151.21 },
        segments: payload.segments,
        total_points: 4,
        status: 'pending',
        submitted_at: '2025-01-01T00:00:00Z'
      };

      service.submitTrail(payload).subscribe(response => {
        expect(response.id).toBe(42);
        expect(response.difficulty).toBe('Hard');
        expect(response.total_points).toBe(4);
        expect(response.segments.length).toBe(2);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/trail-submissions/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body.difficulty).toBe('hard');
      expect(req.request.body.segments.length).toBe(2);
      req.flush(mockResponse);
    });
  });

  describe('fitRoute', () => {
    it('posts segments and normalises the response', (done) => {
      const segments: LatLng[][] = [[
        { lat: -33.9, lng: 151.0 },
        { lat: -33.91, lng: 151.02 }
      ]];

      service.fitRoute(segments).subscribe(result => {
        expect(result.totalPoints).toBe(3);
        expect(result.totalDistanceKm).toBeCloseTo(1.5);
        expect(result.segments.length).toBe(1);
        expect(result.segments[0].length).toBe(3);
        expect(result.start.lat).toBeCloseTo(-33.9);
        expect(result.start.lng).toBeCloseTo(151.0);
        done();
      });

      const req = httpMock.expectOne(`${baseUrl}/trail-submissions/fit-route/`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ segments });

      req.flush({
        segments: [[
          { lat: -33.9, lng: 151.0 },
          { lat: -33.905, lng: 151.01 },
          { lat: -33.91, lng: 151.02 }
        ]],
        total_points: 3,
        total_distance_km: 1.5,
        start: { lat: -33.9, lng: 151.0 }
      });
    });
  });
});
