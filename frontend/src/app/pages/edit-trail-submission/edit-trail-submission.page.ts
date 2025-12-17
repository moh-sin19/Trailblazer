import { AfterViewInit, Component, ElementRef, OnDestroy, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import maplibregl, { GeoJSONSource, LngLatBounds, Map } from 'maplibre-gl';
import { finalize } from 'rxjs/operators';
import { LatLng, TrailPhoto } from '../../models/trail';
import { ApiService } from '../../services/api.service';
import { TrailSubmissionPayload } from '../../models/trail-submission';

@Component({
  standalone: true,
  selector: 'app-edit-trail-submission',
  imports: [CommonModule, FormsModule],
  templateUrl: './edit-trail-submission.page.html'
})
export class EditTrailSubmissionPage implements AfterViewInit, OnDestroy {
  submissionId?: number;
  name = '';
  difficulty: 'Easy' | 'Moderate' | 'Hard' = 'Moderate';
  ascent = 200;
  time = 2;
  description = '';
  submitting = false;
  fittingRoute = false;
  loading = true;
  submissionNotice: { kind: 'success' | 'error'; message: string } | null = null;
  submissionNoticeTimer: ReturnType<typeof setTimeout> | null = null;
  selectedPhotos: File[] = [];
  photoPreviewUrls: string[] = [];
  existingPhotos: TrailPhoto[] = [];

  @ViewChild('mapEl', { static: false }) mapEl!: ElementRef<HTMLDivElement>;
  private map?: Map;
  private readonly routeSourceId = 'submit-route';
  private readonly routeLineLayerId = 'submit-route-line';
  private readonly routePointLayerId = 'submit-route-points';
  private readonly routeStartLayerId = 'submit-route-start';

  routeSegments: LatLng[][] = [[]];
  totalPoints = 0;
  totalDistanceKm = 0;

  constructor(
    private readonly api: ApiService,
    private readonly route: ActivatedRoute,
    private readonly router: Router
  ) {}

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
    // Load submission data first
    this.loadSubmission();
  }

  private initializeMap(): void {
    if (!this.mapEl) {
      console.error('Map element not available yet');
      return;
    }

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
      if (this.canFocusRoute) {
        this.focusRoute();
      }
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

  loadSubmission(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (!id) {
      console.error('No ID found in route params');
      this.router.navigate(['/profile']);
      return;
    }

    console.log('Loading trail submission with ID:', id);
    this.submissionId = parseInt(id, 10);
    this.api.getTrailSubmission(this.submissionId)
      .pipe(finalize(() => {
        console.log('Finished loading, setting loading = false');
        this.loading = false;
        // Initialize map after loading is complete and DOM is updated
        setTimeout(() => this.initializeMap(), 0);
      }))
      .subscribe({
        next: submission => {
          console.log('Trail submission loaded:', submission);
          this.name = submission.name;
          this.difficulty = submission.difficulty;
          this.ascent = submission.elev_gain_m || 200;
          this.time = submission.expected_time_h || 2;
          this.description = submission.description || '';
          this.routeSegments = submission.segments.length > 0 ? submission.segments : [[]];
          this.existingPhotos = submission.photos || [];
        },
        error: error => {
          console.error('Failed to load trail submission', error);
          this.setSubmissionNotice('error', 'Failed to load trail submission.');
          this.router.navigate(['/profile']);
        }
      });
  }

  submit() {
    if (!this.submissionId) return;

    const preparedSegments = this.routeSegments.filter(segment => segment.length >= 2);
    if (!preparedSegments.length) {
      this.setSubmissionNotice('error', 'Please sketch the trail route on the map by dropping at least two points.');
      return;
    }

    const payload = this.buildSubmissionPayload(preparedSegments);
    console.log('Trail update payload', payload);

    this.submitting = true;
    this.api.updateTrailSubmissionWithPhotos(this.submissionId, payload, this.selectedPhotos)
      .pipe(finalize(() => (this.submitting = false)))
      .subscribe({
        next: response => {
          this.setSubmissionNotice('success', `Trail updated successfully with ${response.total_points} points across ${preparedSegments.length} segment(s).`);
          setTimeout(() => {
            this.router.navigate(['/profile']);
          }, 2000);
        },
        error: error => {
          console.error('Trail update failed', error);
          const errorMsg = error?.error?.detail || 'Sorry, something went wrong while updating your trail. Please try again.';
          this.setSubmissionNotice('error', errorMsg);
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

    // Account for existing photos when calculating remaining slots
    const totalExisting = this.existingPhotos.length + this.selectedPhotos.length;
    const remainingSlots = 5 - totalExisting;
    const filesToAdd = validFiles.slice(0, remainingSlots);

    if (filesToAdd.length < validFiles.length) {
      this.setSubmissionNotice('error', 'Maximum 5 photos allowed per trail submission.');
    }

    this.selectedPhotos.push(...filesToAdd);

    filesToAdd.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        this.photoPreviewUrls.push(e.target?.result as string);
      };
      reader.readAsDataURL(file);
    });

    input.value = '';
  }

  removePhoto(index: number): void {
    this.selectedPhotos.splice(index, 1);
    this.photoPreviewUrls.splice(index, 1);
  }

  deleteExistingPhoto(photo: TrailPhoto): void {
    if (!this.submissionId) return;

    if (!confirm(`Are you sure you want to delete this photo? This action cannot be undone.`)) {
      return;
    }

    this.api.deleteTrailSubmissionPhoto(this.submissionId, photo.id).subscribe({
      next: () => {
        // Remove from the local array
        this.existingPhotos = this.existingPhotos.filter(p => p.id !== photo.id);
        this.setSubmissionNotice('success', 'Photo deleted successfully.');
      },
      error: (err) => {
        console.error('Failed to delete photo:', err);
        const errorMsg = err?.error?.detail || 'Failed to delete photo. Please try again.';
        this.setSubmissionNotice('error', errorMsg);
      }
    });
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
