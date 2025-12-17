import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import maplibregl, { GeoJSONSource, LngLatBounds, Map } from 'maplibre-gl';
import { finalize } from 'rxjs/operators';
import { LatLng } from '../../models/trail';
import { ApiService } from '../../services/api.service';
import { TrailSubmissionPayload } from '../../models/trail-submission';

@Component({
  standalone: true,
  selector: 'app-submit-trail',
  imports: [CommonModule, FormsModule],
  templateUrl: './submit-trail.page.html'
})
export class SubmitTrailPage implements AfterViewInit, OnDestroy {
  name = '';
  difficulty: 'Easy' | 'Moderate' | 'Hard' = 'Moderate';
  ascent = 200;
  time = 2;
  description = '';
  submitting = false;
  fittingRoute = false;
  submissionNotice: { kind: 'success' | 'error'; message: string } | null = null;
  submissionNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  selectedPhotos: File[] = [];
  photoPreviewUrls: string[] = [];

  @ViewChild('mapEl', { static: true }) mapEl!: ElementRef<HTMLDivElement>;
  private map?: Map;
  private readonly routeSourceId = 'submit-route';
  private readonly routeLineLayerId = 'submit-route-line';
  private readonly routePointLayerId = 'submit-route-points';
  private readonly routeStartLayerId = 'submit-route-start';

  routeSegments: LatLng[][] = [[]];
  totalPoints = 0;
  totalDistanceKm = 0;

  constructor(private readonly api: ApiService) {}

  get hasRoute(): boolean {
    return this.routeSegments.some(segment => segment.length > 0);
  }

  get canStartNewSegment(): boolean {
    if (!this.routeSegments.length) return false;
    const last = this.routeSegments[this.routeSegments.length - 1];
    return last.length >= 2;
  }

  get canUndo(): boolean {
    return this.totalPoints > 0;
  }

  get canFocusRoute(): boolean {
    return this.totalPoints >= 2;
  }

  get routeDistanceLabel(): string {
    return this.totalDistanceKm > 0 ? `${this.totalDistanceKm.toFixed(2)} km` : '0 km';
  }

  get canSubmit(): boolean {
    return this.routeSegments.some(segment => segment.length >= 2);
  }

  ngAfterViewInit(): void {
    this.map = new maplibregl.Map({
      container: this.mapEl.nativeElement,
      style: {
        version: 8,
        glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
        sources: {
          terrain: {
            type: 'raster',
            tiles: ['https://tiles.stadiamaps.com/tiles/stamen_terrain/{z}/{x}/{y}.png'],
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
              'raster-brightness-min': 0.4,
              'raster-brightness-max': 1.0
            },
            minzoom: 0,
            maxzoom: 18
          }
        ]
      },
      center: [151.2093, -33.8688],
      zoom: 10.2,
      attributionControl: true
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.getCanvas().style.cursor = 'crosshair';
    this.map.once('load', () => {
      this.initialiseRouteLayers();
      this.refreshRouteGeometry();
      this.map?.on('click', this.handleMapClick);
    });
  }

  ngOnDestroy(): void {
    if (this.map) {
      this.map.off('click', this.handleMapClick);
      this.map.remove();
    }
    if (this.submissionNoticeTimer) {
      clearTimeout(this.submissionNoticeTimer);
      this.submissionNoticeTimer = null;
    }
  }

  submit() {
    const preparedSegments = this.routeSegments.filter(segment => segment.length >= 2);
    if (!preparedSegments.length) {
      this.setSubmissionNotice('error', 'Please sketch the trail route on the map by dropping at least two points.');
      return;
    }

    const payload = this.buildSubmissionPayload(preparedSegments);
    console.log('Trail submission payload', payload);

    this.submitting = true;
    this.api.submitTrailWithPhotos(payload, this.selectedPhotos)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: response => {
          this.setSubmissionNotice('success', `Thanks! Trail submitted with ${response.total_points} points across ${preparedSegments.length} segment(s). We'll review it shortly.`);
          this.resetForm();
        },
        error: error => {
          console.error('Trail submission failed', error);
          this.setSubmissionNotice('error', 'Sorry, something went wrong while submitting your trail. Please try again.');
        }
      });
  }

  startNewSegment(): void {
    const current = this.activeSegment();
    if (current.length < 2) return;
    this.routeSegments.push([]);
    this.refreshRouteGeometry();
  }

  undoLastPoint(): void {
    for (let i = this.routeSegments.length - 1; i >= 0; i--) {
      const segment = this.routeSegments[i];
      if (segment.length > 0) {
        segment.pop();
        this.trimTrailingEmptySegments();
        this.refreshRouteGeometry();
        return;
      }
    }
  }

  clearRoute(): void {
    this.routeSegments = [[]];
    this.refreshRouteGeometry();
  }

  focusRoute(): void {
    if (!this.map) return;
    const bounds = this.computeRouteBounds();
    if (!bounds) return;
    this.map.fitBounds(bounds, { padding: 48, duration: 600, maxZoom: 14 });
  }

  fitRoute(): void {
    if (!this.canFocusRoute || this.fittingRoute) {
      return;
    }

    this.fittingRoute = true;
    this.api.fitRoute(this.routeSegments)
      .pipe(finalize(() => (this.fittingRoute = false)))
      .subscribe({
        next: response => {
          this.routeSegments = response.segments.map(segment => segment.map(point => ({ ...point })));
          this.refreshRouteGeometry();
          this.focusRoute();
        },
        error: error => {
          console.error('Failed to fit route with Graphhopper', error);
          alert('We were unable to snap the trail to nearby paths. Please try again later.');
        }
      });
  }

  private readonly handleMapClick = (event: maplibregl.MapMouseEvent) => {
    const lng = event.lngLat.lng;
    const lat = event.lngLat.lat;
    this.addPoint({ lat, lng });
  };

  private addPoint(point: LatLng) {
    const segment = this.activeSegment();
    segment.push(point);
    this.refreshRouteGeometry();
    if (segment.length === 2) {
      this.focusRoute();
    }
  }

  private activeSegment(): LatLng[] {
    if (!this.routeSegments.length) {
      this.routeSegments.push([]);
    }
    return this.routeSegments[this.routeSegments.length - 1];
  }

  private trimTrailingEmptySegments(): void {
    while (this.routeSegments.length > 1 && this.routeSegments[this.routeSegments.length - 1].length === 0) {
      this.routeSegments.pop();
    }
    if (!this.routeSegments.length) {
      this.routeSegments.push([]);
    }
  }

  private initialiseRouteLayers(): void {
    if (!this.map || this.map.getSource(this.routeSourceId)) return;
    this.map.addSource(this.routeSourceId, {
      type: 'geojson',
      data: this.buildRouteGeoJSON()
    });
    this.map.addLayer({
      id: this.routeLineLayerId,
      type: 'line',
      source: this.routeSourceId,
      paint: {
        'line-color': '#0ea5e9',
        'line-width': 3,
        'line-opacity': [
          'case',
          ['==', ['get', 'kind'], 'line'],
          0.95,
          0
        ]
      },
      filter: ['==', ['get', 'kind'], 'line']
    });
    this.map.addLayer({
      id: this.routePointLayerId,
      type: 'circle',
      source: this.routeSourceId,
      paint: {
        'circle-radius': 5,
        'circle-color': '#2563eb',
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff'
      },
      filter: ['==', ['get', 'kind'], 'vertex']
    });
    this.map.addLayer({
      id: this.routeStartLayerId,
      type: 'circle',
      source: this.routeSourceId,
      paint: {
        'circle-radius': 6,
        'circle-color': '#16a34a',
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff'
      },
      filter: ['==', ['get', 'kind'], 'start']
    });
  }

  private refreshRouteGeometry(): void {
    this.updateRouteMetrics();
    if (!this.map) return;
    const source = this.map.getSource(this.routeSourceId) as GeoJSONSource | undefined;
    if (source) {
      source.setData(this.buildRouteGeoJSON());
    }
  }

  private updateRouteMetrics(): void {
    let points = 0;
    let distance = 0;
    for (const segment of this.routeSegments) {
      points += segment.length;
      for (let i = 1; i < segment.length; i++) {
        distance += this.haversine(segment[i - 1], segment[i]);
      }
    }
    this.totalPoints = points;
    this.totalDistanceKm = distance;
  }

  private buildRouteGeoJSON(): GeoJSON.FeatureCollection<GeoJSON.Geometry> {
    const features: GeoJSON.Feature<GeoJSON.Geometry>[] = [];

    this.routeSegments.forEach((segment, segmentIndex) => {
      if (segment.length >= 2) {
        features.push({
          type: 'Feature',
          properties: { kind: 'line', segment: segmentIndex },
          geometry: {
            type: 'LineString',
            coordinates: segment.map(point => [point.lng, point.lat]) as [number, number][]
          }
        });
      }

      segment.forEach((point, pointIndex) => {
        features.push({
          type: 'Feature',
          properties: {
            kind: pointIndex === 0 && segmentIndex === 0 ? 'start' : 'vertex',
            segment: segmentIndex,
            index: pointIndex
          },
          geometry: {
            type: 'Point',
            coordinates: [point.lng, point.lat]
          }
        });
      });
    });

    return {
      type: 'FeatureCollection',
      features
    };
  }

  private computeRouteBounds(): LngLatBounds | undefined {
    const allPoints = this.routeSegments.flat();
    if (!allPoints.length) return undefined;

    const bounds = new maplibregl.LngLatBounds(
      [allPoints[0].lng, allPoints[0].lat],
      [allPoints[0].lng, allPoints[0].lat]
    );

    for (const point of allPoints) {
      bounds.extend([point.lng, point.lat]);
    }
    return bounds;
  }

  private haversine(a: LatLng, b: LatLng): number {
    const R = 6371;
    const toRad = (value: number) => value * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat / 2);
    const s2 = Math.sin(dLng / 2);
    const aa = s1 * s1 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * s2 * s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(aa)));
  }

  private buildSubmissionPayload(preparedSegments: LatLng[][]): TrailSubmissionPayload {
    const distance = Math.round(this.totalDistanceKm * 100) / 100;
    return {
      name: this.name.trim(),
      difficulty: this.difficulty,
      distance_km: distance,
      elev_gain_m: this.ascent,
      expected_time_h: this.time,
      description: this.description,
      segments: preparedSegments,
      start: preparedSegments[0][0]
    };
  }

  onPhotosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (!input.files) return;

    const files = Array.from(input.files);

    // Validate file types and sizes
    const validFiles = files.filter(file => {
      if (!file.type.startsWith('image/')) {
        this.setSubmissionNotice('error', `${file.name} is not a valid image file.`);
        return false;
      }
      if (file.size > 10 * 1024 * 1024) {
        this.setSubmissionNotice('error', `${file.name} exceeds the 10MB size limit.`);
        return false;
      }
      return true;
    });

    // Limit to 5 photos total
    const remainingSlots = 5 - this.selectedPhotos.length;
    const filesToAdd = validFiles.slice(0, remainingSlots);

    if (filesToAdd.length < validFiles.length) {
      this.setSubmissionNotice('error', 'Maximum 5 photos allowed per trail submission.');
    }

    this.selectedPhotos.push(...filesToAdd);

    // Generate preview URLs
    filesToAdd.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.photoPreviewUrls.push(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    });

    // Clear the input so the same file can be selected again if needed
    input.value = '';
  }

  removePhoto(index: number): void {
    this.selectedPhotos.splice(index, 1);
    this.photoPreviewUrls.splice(index, 1);
  }

  private resetForm(): void {
    this.name = '';
    this.difficulty = 'Moderate';
    this.ascent = 200;
    this.time = 2;
    this.description = '';
    this.selectedPhotos = [];
    this.photoPreviewUrls = [];
    this.clearRoute();
  }

  private setSubmissionNotice(kind: 'success' | 'error', message: string): void {
    this.submissionNotice = { kind, message };
    if (this.submissionNoticeTimer) {
      clearTimeout(this.submissionNoticeTimer);
    }
    this.submissionNoticeTimer = setTimeout(() => {
      this.submissionNotice = null;
      this.submissionNoticeTimer = null;
    }, 5000);
  }
}
