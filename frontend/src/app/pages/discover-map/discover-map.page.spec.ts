import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DiscoverMapPage } from './discover-map.page';
import { ApiService } from '../../services/api.service';
import { of } from 'rxjs';
import { MapFeature, TrailSearchResponse, FilterOptions, MapResponse } from '../../models/search';
import { provideRouter } from '@angular/router';

describe('DiscoverMapPage', () => {
  let component: DiscoverMapPage;
  let fixture: ComponentFixture<DiscoverMapPage>;
  let mockApiService: jasmine.SpyObj<ApiService>;

  const mockFilterOptions: FilterOptions = {
    difficulties: [
      { value: 'easy', label: 'Easy' },
      { value: 'moderate', label: 'Moderate' },
      { value: 'hard', label: 'Hard' }
    ],
    categories: [
      { id: 1, name: 'Hiking', slug: 'hiking' },
      { id: 2, name: 'Cycling', slug: 'cycling' }
    ],
    cities: ['Sydney', 'Melbourne'],
    countries: ['Australia'],
    distance_range: { min: 0, max: 100 }
  };

  const mockMapFeatures: MapFeature[] = [
    {
      id: '1',
      slug: 'trail-1',
      name: 'Test Trail 1',
      lat: -33.8688,
      lng: 151.2093,
      is_cluster: false,
      cluster_count: 0,
      difficulty: 'Easy',
      distance_km: 5.5,
      segments: [
        [
          { lat: -33.8688, lng: 151.2093 },
          { lat: -33.8700, lng: 151.2100 },
          { lat: -33.8710, lng: 151.2110 },
          { lat: -33.8720, lng: 151.2120 }
        ]
      ],
      start: { lat: -33.8688, lng: 151.2093 }
    },
    {
      id: '2',
      slug: 'trail-2',
      name: 'Test Trail 2',
      lat: -33.8700,
      lng: 151.2200,
      is_cluster: false,
      cluster_count: 0,
      difficulty: 'Moderate',
      distance_km: 10.2,
      segments: [
        [
          { lat: -33.8700, lng: 151.2200 },
          { lat: -33.8710, lng: 151.2210 },
          { lat: -33.8720, lng: 151.2220 }
        ],
        [
          { lat: -33.8720, lng: 151.2220 },
          { lat: -33.8730, lng: 151.2230 },
          { lat: -33.8740, lng: 151.2240 },
          { lat: -33.8750, lng: 151.2250 },
          { lat: -33.8760, lng: 151.2260 }
        ]
      ],
      start: { lat: -33.8700, lng: 151.2200 }
    }
  ];

  const mockTrailSearchResponse: TrailSearchResponse = {
    results: [],
    total_count: 2,
    next: null,
    previous: null
  };

  const mockMapResponse: MapResponse = {
    features: mockMapFeatures,
    map_bounds: {
      south: -33.8760,
      west: 151.2093,
      north: -33.8688,
      east: 151.2260
    },
    total_in_bbox: 2
  };

  beforeEach(async () => {
    mockApiService = jasmine.createSpyObj('ApiService', [
      'searchTrails',
      'getMapData',
      'getFilterOptions'
    ]);

    mockApiService.getFilterOptions.and.returnValue(of(mockFilterOptions));
    mockApiService.searchTrails.and.returnValue(of(mockTrailSearchResponse));
    mockApiService.getMapData.and.returnValue(of(mockMapResponse));

    await TestBed.configureTestingModule({
      imports: [DiscoverMapPage],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: mockApiService }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(DiscoverMapPage);
    component = fixture.componentInstance;
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should load filter options on init', () => {
    fixture.detectChanges();

    expect(mockApiService.getFilterOptions).toHaveBeenCalled();
    expect(component.filterOptions).toEqual(mockFilterOptions);
  });

  it('should build midpoint markers from map features', () => {
    const midpointMarkers = (component as any).buildMidpointMarkers(mockMapFeatures);

    // Should have 3 markers total: 1 from trail-1 (1 segment) and 2 from trail-2 (2 segments)
    expect(midpointMarkers.length).toBe(3);

    // Check first marker (from trail-1's single segment)
    expect(midpointMarkers[0].type).toBe('Feature');
    expect(midpointMarkers[0].geometry.type).toBe('Point');
    expect(midpointMarkers[0].properties.id).toBe('trail-1');
    expect(midpointMarkers[0].properties.name).toBe('Test Trail 1');
    expect(midpointMarkers[0].properties.difficulty).toBe('Easy');
    expect(midpointMarkers[0].properties.distance_km).toBe(5.5);

    // Verify midpoint calculation (segment has 4 points, midpoint is at index 2)
    expect(midpointMarkers[0].geometry.coordinates).toEqual([151.2110, -33.8710]);

    // Check second marker (from trail-2's first segment with 3 points)
    expect(midpointMarkers[1].properties.id).toBe('trail-2');
    expect(midpointMarkers[1].properties.name).toBe('Test Trail 2');
    expect(midpointMarkers[1].properties.difficulty).toBe('Moderate');
    // Midpoint of 3-point segment is at index 1
    expect(midpointMarkers[1].geometry.coordinates).toEqual([151.2210, -33.8710]);

    // Check third marker (from trail-2's second segment with 5 points)
    expect(midpointMarkers[2].properties.id).toBe('trail-2');
    // Midpoint of 5-point segment is at index 2
    expect(midpointMarkers[2].geometry.coordinates).toEqual([151.2240, -33.8740]);
  });

  it('should skip cluster features when building midpoint markers', () => {
    const clusterFeature: MapFeature = {
      id: 'cluster-1',
      name: 'Cluster',
      lat: -33.8688,
      lng: 151.2093,
      is_cluster: true,
      cluster_count: 5,
      segments: [[{ lat: -33.8688, lng: 151.2093 }]]
    };

    const midpointMarkers = (component as any).buildMidpointMarkers([clusterFeature]);

    expect(midpointMarkers.length).toBe(0);
  });

  it('should skip features without segments', () => {
    const featureWithoutSegments: MapFeature = {
      id: '3',
      name: 'Trail 3',
      lat: -33.8688,
      lng: 151.2093,
      is_cluster: false,
      cluster_count: 0
    };

    const midpointMarkers = (component as any).buildMidpointMarkers([featureWithoutSegments]);

    expect(midpointMarkers.length).toBe(0);
  });

  it('should skip segments with invalid coordinates', () => {
    const featureWithInvalidCoords: MapFeature = {
      id: '4',
      name: 'Trail 4',
      lat: -33.8688,
      lng: 151.2093,
      is_cluster: false,
      cluster_count: 0,
      segments: [
        [
          { lat: NaN, lng: 151.2093 },
          { lat: -33.8700, lng: Infinity }
        ]
      ]
    };

    const midpointMarkers = (component as any).buildMidpointMarkers([featureWithInvalidCoords]);

    expect(midpointMarkers.length).toBe(0);
  });

  it('should skip segments with fewer than 2 points', () => {
    const featureWithShortSegment: MapFeature = {
      id: '5',
      name: 'Trail 5',
      lat: -33.8688,
      lng: 151.2093,
      is_cluster: false,
      cluster_count: 0,
      segments: [
        [
          { lat: -33.8688, lng: 151.2093 }
        ]
      ]
    };

    const midpointMarkers = (component as any).buildMidpointMarkers([featureWithShortSegment]);

    expect(midpointMarkers.length).toBe(0);
  });

  it('should apply filters and reload data', () => {
    component.difficulty = 'easy';
    component.distanceMin = 5;
    component.distanceMax = 15;
    component.selectedCategories = [1];

    component.applyFilters();

    expect(mockApiService.searchTrails).toHaveBeenCalledWith(
      jasmine.objectContaining({
        difficulty: 'easy',
        distance_km_min: 5,
        distance_km_max: 15,
        category_ids: [1]
      })
    );
  });

  it('should toggle category selection', () => {
    expect(component.selectedCategories).toEqual([]);

    component.toggleCategory(1);
    expect(component.selectedCategories).toContain(1);

    component.toggleCategory(1);
    expect(component.selectedCategories).not.toContain(1);
  });

  it('should limit category selection to 10', () => {
    for (let i = 1; i <= 12; i++) {
      component.toggleCategory(i);
    }

    expect(component.selectedCategories.length).toBe(10);
  });

  it('should build search params correctly', () => {
    component.searchQuery = 'coastal';
    component.difficulty = 'hard';
    component.distanceMin = 10;
    component.distanceMax = 50;
    component.selectedCategories = [1, 2, 3];
    component.selectedCity = 'Sydney';
    component.selectedCountry = 'Australia';

    const params = (component as any).buildSearchParams();

    expect(params.q).toBe('coastal');
    expect(params.difficulty).toBe('hard');
    expect(params.distance_km_min).toBe(10);
    expect(params.distance_km_max).toBe(50);
    expect(params.category_ids).toEqual([1, 2, 3]);
    expect(params.city).toBe('Sydney');
    expect(params.country).toBe('Australia');
  });

  it('should not include default filter values in search params', () => {
    component.difficulty = 'All';
    component.distanceMin = 0;
    component.distanceMax = 2000;
    component.selectedCategories = [];
    component.selectedCity = '';
    component.selectedCountry = '';
    component.searchQuery = '';

    const params = (component as any).buildSearchParams();

    expect(params.difficulty).toBeUndefined();
    expect(params.distance_km_min).toBeUndefined();
    expect(params.distance_km_max).toBeUndefined();
    expect(params.category_ids).toBeUndefined();
    expect(params.city).toBeUndefined();
    expect(params.country).toBeUndefined();
    expect(params.q).toBeUndefined();
  });
});
