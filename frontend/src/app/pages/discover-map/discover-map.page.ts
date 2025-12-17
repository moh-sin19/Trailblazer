import { Component, ElementRef, OnDestroy, OnInit, AfterViewInit, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { Trail } from '../../models/trail';
import { TrailCardComponent } from '../../components/trail-card/trail-card.component';
import { FilterOptions, MapFeature, MapQueryParams, TrailCategoryOption } from '../../models/search';
import maplibregl, { Map, GeoJSONSource, MapLayerMouseEvent, Popup, LngLatBounds, FilterSpecification } from 'maplibre-gl';

@Component({
  standalone: true,
  selector: 'app-discover-map',
  imports: [CommonModule, FormsModule, RouterLink, TrailCardComponent],
  templateUrl: './discover-map.page.html'
})
export class DiscoverMapPage implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('mapEl') mapEl!: ElementRef<HTMLDivElement>;
  map?: Map;
  trails: Trail[] = [];
  filtered: Trail[] = [];

  // Filter state
  difficulty: 'easy' | 'moderate' | 'hard' | 'All' = 'All';
  minRating = 0;
  distanceMin = 0;
  distanceMax = 2000;
  selectedCategories: number[] = [];
  selectedCity = '';
  selectedCountry = '';
  searchQuery = '';

  // Filter options from backend
  filterOptions?: FilterOptions;

  view: 'map' | 'list' = 'map';
  totalCount = 0;
  private readonly markerSourceId = 'trails-source';
  private readonly lineSourceId = 'trail-lines-source';
  private readonly lineLayerId = 'trail-lines-layer';
  private readonly lineHighlightLayerId = 'trail-lines-highlight-layer';
  private readonly midpointSourceId = 'midpoint-markers-source';
  private readonly midpointLayerId = 'midpoint-markers-layer';
  private selectedTrailId?: string;
  private markerPopup?: Popup;
  private latestLineGeoJSON?: GeoJSON.FeatureCollection<GeoJSON.LineString>;


  private readonly handleTrailLineClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature || !feature.properties) return;
    const id = String(feature.properties['id']);

    // Find the corresponding marker feature to get name and distance
    const markerSource = this.map?.getSource(this.markerSourceId) as GeoJSONSource;
    if (!markerSource) return;

    // Get data from the source
    const data = (markerSource as any)._data as GeoJSON.FeatureCollection;
    const markerFeature = data?.features?.find((f: any) => f.properties?.id === id);

    const name = markerFeature?.properties?.['name'] ?? 'Trail';
    const distance = markerFeature?.properties?.['distance_km'];

    // Use the click location as coordinates for the popup
    const coordinates: [number, number] = [event.lngLat.lng, event.lngLat.lat];

    this.selectedTrailId = id;
    this.updateRouteHighlight();
    // Focus on the clicked segment, not all segments
    this.focusSegmentOnMap(feature);
    this.renderMarkerPopup(coordinates, name, distance, id);
  };

  private readonly handlePointerEnter = () => {
    if (this.map) this.map.getCanvas().style.cursor = 'pointer';
  };

  private readonly handlePointerLeave = () => {
    if (this.map) this.map.getCanvas().style.cursor = '';
  };

  private readonly handleMidpointClick = (event: MapLayerMouseEvent) => {
    const feature = event.features?.[0];
    if (!feature || !feature.properties) return;
    const id = String(feature.properties['id']);
    const name = String(feature.properties['name'] ?? 'Trail');
    const distance = feature.properties['distance_km'];

    // Use the marker's coordinates
    const coordinates = (feature.geometry as GeoJSON.Point).coordinates as [number, number];

    this.selectedTrailId = id;
    this.updateRouteHighlight();
    this.focusTrailOnMap(id);
    this.renderMarkerPopup(coordinates, name, distance, id);
  };

  private readonly handleMidpointEnter = () => {
    if (this.map) this.map.getCanvas().style.cursor = 'pointer';
  };

  private readonly handleMidpointLeave = () => {
    if (this.map) this.map.getCanvas().style.cursor = '';
  };

  constructor(private api: ApiService) {}

  ngOnInit(): void {
    // Load filter options
    this.api.getFilterOptions().subscribe(options => {
      this.filterOptions = options;
      if (options.distance_range) {
        this.distanceMin = options.distance_range.min;
        this.distanceMax = options.distance_range.max;
      }
    });

    // Load initial trails
    this.loadTrails();
  }

  ngAfterViewInit(): void {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          'terrain': {
            type: 'raster',
            tiles: [
              'https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png'
            ],
            tileSize: 256,
            attribution: '© Stamen Design, © OpenStreetMap contributors'
          }
        },
        layers: [
          {
            id: 'terrain-layer',
            type: 'raster',
            source: 'terrain',
            paint: {
              'raster-brightness-min': 0.3,
              'raster-brightness-max': 1.0
            },
            minzoom: 0,
            maxzoom: 18
          }
        ]
      },
      center: [151.2093, -33.8688],
      zoom: 9.8,
      attributionControl: true
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');

    // Listen for map movement to reload markers
    this.map.on('moveend', () => {
      if (this.view === 'map') {
        this.loadMapMarkers();
      }
    });

    // Deselect trail when clicking on empty map area
    this.map.on('click', (e) => {
      // Check if click was on a trail line
      const features = this.map!.queryRenderedFeatures(e.point, {
        layers: [this.lineLayerId]
      });

      if (features.length === 0 && this.selectedTrailId) {
        // Clicked on empty area, deselect
        this.selectedTrailId = undefined;
        this.updateRouteHighlight();
        this.markerPopup?.remove();
        this.markerPopup = undefined;
      }
    });

    this.renderIfReady();
  }

  ngOnDestroy(): void {
    this.markerPopup?.remove();
    this.markerPopup = undefined;
    if (this.map) this.map.remove();
  }

  loadTrails() {
    const params = this.buildSearchParams();
    this.api.searchTrails(params).subscribe(response => {
      this.trails = response.results;
      this.filtered = response.results;
      this.totalCount = response.total_count;
      this.renderIfReady();
    });
  }

  loadMapMarkers() {
    if (!this.map) return;

    const bounds = this.map.getBounds();
    const zoom = this.map.getZoom();
    const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;

    const params: MapQueryParams = {
      ...this.buildSearchParams(),
      bbox,
      zoom: Math.round(zoom),
      cluster: false,
      max_markers: 500
    };

    this.api.getMapData(params).subscribe(response => {
      this.renderMapMarkers(response.features);
    });
  }

  private buildSearchParams() {
    const params: any = {};

    if (this.searchQuery) params.q = this.searchQuery;
    if (this.difficulty !== 'All') params.difficulty = this.difficulty;
    if (this.distanceMin > 0) params.distance_km_min = this.distanceMin;
    if (this.distanceMax < 2000) params.distance_km_max = this.distanceMax;
    if (this.selectedCategories.length > 0) params.category_ids = this.selectedCategories.slice(0, 10);
    if (this.selectedCity) params.city = this.selectedCity;
    if (this.selectedCountry) params.country = this.selectedCountry;

    return params;
  }

  applyFilters() {
    this.loadTrails();
    if (this.view === 'map') {
      this.loadMapMarkers();
    }
  }

  private renderIfReady() {
    if (!this.map) return;
    if (this.map.isStyleLoaded()) this.loadMapMarkers();
    else this.map.once('load', () => this.loadMapMarkers());
  }

  private renderMapMarkers(features: MapFeature[]) {
    if (!this.map) return;

    // Don't remove popup here - let it persist across map updates
    // Only remove when explicitly deselecting or on cleanup

    this.removeLayer(this.midpointLayerId);
    this.removeLayer(this.lineHighlightLayerId);
    this.removeLayer(this.lineLayerId);
    this.removeSource(this.midpointSourceId);
    this.removeSource(this.markerSourceId);
    this.removeSource(this.lineSourceId);

    const pointCollection: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: features.map(feature => ({
        type: 'Feature',
        properties: {
          id: feature.slug ?? feature.id,
          name: feature.name,
          difficulty: feature.difficulty,
          distance_km: feature.distance_km,
        },
        geometry: { type: 'Point', coordinates: [feature.lng, feature.lat] },
      })),
    };

    this.map.addSource(this.markerSourceId, { type: 'geojson', data: pointCollection });

    // No cluster or individual trail markers - trails are clickable directly

    const lineFeatures = this.buildLineFeatures(features);
    if (lineFeatures.length) {
      const lineCollection: GeoJSON.FeatureCollection<GeoJSON.LineString> = {
        type: 'FeatureCollection',
        features: lineFeatures,
      };
      this.latestLineGeoJSON = lineCollection;
      this.map.addSource(this.lineSourceId, { type: 'geojson', data: lineCollection });

      // Base line styling takes cues from OSM hiking map conventions — colour encodes SAC difficulty.
      this.map.addLayer({
        id: this.lineLayerId,
        type: 'line',
        source: this.lineSourceId,
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': [
            'match', ['get', 'difficulty'],
            'Easy', '#2a9d8f',
            'easy', '#2a9d8f',
            'Moderate', '#f4a261',
            'moderate', '#f4a261',
            'Hard', '#e76f51',
            'hard', '#e76f51',
            '#4c6ef5',
          ],
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2.4, 12, 4, 15, 6.2],
          'line-opacity': 0.85,
        },
      });

      this.map.addLayer({
        id: this.lineHighlightLayerId,
        type: 'line',
        source: this.lineSourceId,
        filter: this.buildHighlightFilter(),
        layout: {
          'line-cap': 'round',
          'line-join': 'round',
        },
        paint: {
          'line-color': '#1d4ed8',
          'line-width': ['interpolate', ['linear'], ['zoom'], 8, 3, 12, 5.2, 15, 7.5],
          'line-opacity': 0.95,
        },
      });

      // Add midpoint markers
      const midpointMarkers = this.buildMidpointMarkers(features);
      if (midpointMarkers.length) {
        const midpointCollection: GeoJSON.FeatureCollection<GeoJSON.Point> = {
          type: 'FeatureCollection',
          features: midpointMarkers,
        };
        this.map.addSource(this.midpointSourceId, { type: 'geojson', data: midpointCollection });

        this.map.addLayer({
          id: this.midpointLayerId,
          type: 'circle',
          source: this.midpointSourceId,
          paint: {
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 4, 12, 6, 15, 8],
            'circle-color': [
              'match', ['get', 'difficulty'],
              'Easy', '#2a9d8f',
              'easy', '#2a9d8f',
              'Moderate', '#f4a261',
              'moderate', '#f4a261',
              'Hard', '#e76f51',
              'hard', '#e76f51',
              '#4c6ef5',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.9,
          },
        });
      }
    } else {
      this.latestLineGeoJSON = undefined;
      if (this.selectedTrailId) {
        this.selectedTrailId = undefined;
      }
    }

    this.updateRouteHighlight();
    this.rebindInteractions();
  }

  private buildLineFeatures(features: MapFeature[]): GeoJSON.Feature<GeoJSON.LineString>[] {
    const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    for (const feature of features) {
      if (feature.is_cluster || !feature.segments) continue;

      // Create a separate LineString feature for each segment
      for (const segment of feature.segments) {
        if (!Array.isArray(segment)) continue;
        const coordinates: [number, number][] = [];
        for (const point of segment) {
          if (!point || typeof point.lng !== 'number' || typeof point.lat !== 'number') continue;
          if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
          coordinates.push([point.lng, point.lat]);
        }
        if (coordinates.length < 2) continue;
        lineFeatures.push({
          type: 'Feature',
          properties: {
            id: feature.slug ?? feature.id,
            difficulty: feature.difficulty ?? 'Moderate',
          },
          geometry: {
            type: 'LineString',
            coordinates,
          },
        });
      }
    }
    return lineFeatures;
  }

  private buildMidpointMarkers(features: MapFeature[]): GeoJSON.Feature<GeoJSON.Point>[] {
    const midpointFeatures: GeoJSON.Feature<GeoJSON.Point>[] = [];
    for (const feature of features) {
      if (feature.is_cluster || !feature.segments) continue;

      // Create a midpoint marker for each segment
      for (const segment of feature.segments) {
        if (!Array.isArray(segment)) continue;
        const coordinates: [number, number][] = [];
        for (const point of segment) {
          if (!point || typeof point.lng !== 'number' || typeof point.lat !== 'number') continue;
          if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
          coordinates.push([point.lng, point.lat]);
        }
        if (coordinates.length < 2) continue;

        // Calculate midpoint
        const midIndex = Math.floor(coordinates.length / 2);
        const midpoint = coordinates[midIndex];

        midpointFeatures.push({
          type: 'Feature',
          properties: {
            id: feature.slug ?? feature.id,
            name: feature.name,
            difficulty: feature.difficulty ?? 'Moderate',
            distance_km: feature.distance_km,
          },
          geometry: {
            type: 'Point',
            coordinates: midpoint,
          },
        });
      }
    }
    return midpointFeatures;
  }

  private buildHighlightFilter(): FilterSpecification {
    const target = this.selectedTrailId ?? '__none__';
    return ['==', ['get', 'id'], target];
  }

  private updateRouteHighlight() {
    if (!this.map) return;
    const hasSelected = this.latestLineGeoJSON?.features?.some(
      feature => (feature.properties as any)?.id === this.selectedTrailId,
    );
    if (!hasSelected) {
      this.selectedTrailId = undefined;
    }
    if (this.map.getLayer(this.lineHighlightLayerId)) {
      this.map.setFilter(this.lineHighlightLayerId, this.buildHighlightFilter());
      this.map.setLayoutProperty(
        this.lineHighlightLayerId,
        'visibility',
        this.selectedTrailId ? 'visible' : 'none',
      );
    }
  }

  private rebindInteractions() {
    if (!this.map) return;
    this.map.off('click', this.lineLayerId, this.handleTrailLineClick);
    this.map.off('mouseenter', this.lineLayerId, this.handlePointerEnter);
    this.map.off('mouseleave', this.lineLayerId, this.handlePointerLeave);

    this.map.on('click', this.lineLayerId, this.handleTrailLineClick);
    this.map.on('mouseenter', this.lineLayerId, this.handlePointerEnter);
    this.map.on('mouseleave', this.lineLayerId, this.handlePointerLeave);

    // Bind midpoint marker interactions
    this.map.off('click', this.midpointLayerId, this.handleMidpointClick);
    this.map.off('mouseenter', this.midpointLayerId, this.handleMidpointEnter);
    this.map.off('mouseleave', this.midpointLayerId, this.handleMidpointLeave);

    this.map.on('click', this.midpointLayerId, this.handleMidpointClick);
    this.map.on('mouseenter', this.midpointLayerId, this.handleMidpointEnter);
    this.map.on('mouseleave', this.midpointLayerId, this.handleMidpointLeave);
  }

  private removeLayer(id: string) {
    if (this.map?.getLayer(id)) {
      this.map.removeLayer(id);
    }
  }

  private removeSource(id: string) {
    if (this.map?.getSource(id)) {
      this.map.removeSource(id);
    }
  }

  private focusTrailOnMap(trailId: string) {
    if (!this.map || !this.latestLineGeoJSON) return;
    const feature = this.latestLineGeoJSON.features.find(
      f => (f.properties as any)?.id === trailId,
    );
    if (!feature || feature.geometry.type !== 'LineString') return;
    const coordinates = feature.geometry.coordinates as [number, number][];
    if (!coordinates.length) return;

    const bounds = coordinates.reduce(
      (acc, coord) => acc.extend(coord),
      new LngLatBounds(coordinates[0], coordinates[0]),
    );
    this.map.fitBounds(bounds, {
      padding: 48,
      maxZoom: 14.5,
      duration: 500,
    });
  }

  private focusSegmentOnMap(feature: GeoJSON.Feature) {
    if (!this.map || feature.geometry.type !== 'LineString') return;
    const coordinates = feature.geometry.coordinates as [number, number][];
    if (!coordinates.length) return;

    const bounds = coordinates.reduce(
      (acc, coord) => acc.extend(coord),
      new LngLatBounds(coordinates[0], coordinates[0]),
    );
    this.map.fitBounds(bounds, {
      padding: 48,
      maxZoom: 14.5,
      duration: 500,
    });
  }

  private renderMarkerPopup(
    coordinates: [number, number],
    name: string,
    distance: unknown,
    id: string,
  ) {
    if (!this.map) return;
    this.markerPopup?.remove();
    const safeName = this.escapeHtml(name);
    const distanceLabel = typeof distance === 'number' && Number.isFinite(distance)
      ? `${distance.toFixed(1)} km`
      : null;
    const detailHref = `/trails/${encodeURIComponent(id)}`;
    const html = `
      <div class="text-sm leading-snug">
        <div class="font-semibold text-gray-900">${safeName}</div>
        ${distanceLabel ? `<div class=\"text-xs text-gray-600 mt-1\">${distanceLabel}</div>` : ''}
        <div class="mt-2">
          <a href="${detailHref}" class="text-xs font-semibold uppercase tracking-wide text-bush-700 hover:text-bush-600">View details →</a>
        </div>
      </div>
    `;

    this.markerPopup = new maplibregl.Popup({ closeButton: true, closeOnClick: false })
      .setLngLat(coordinates)
      .setHTML(html)
      .addTo(this.map);
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  toggleCategory(categoryId: number) {
    const index = this.selectedCategories.indexOf(categoryId);
    if (index === -1) {
      if (this.selectedCategories.length < 10) {
        this.selectedCategories.push(categoryId);
      }
    } else {
      this.selectedCategories.splice(index, 1);
    }
    this.applyFilters();
  }

  isCategorySelected(categoryId: number): boolean {
    return this.selectedCategories.includes(categoryId);
  }
}
