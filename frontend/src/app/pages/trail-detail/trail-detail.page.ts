import { Component, ElementRef, ViewChild, AfterViewInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { Trail, Comment } from '../../models/trail';
import { StarRatingComponent } from '../../components/star-rating/star-rating.component';
import { TrailPhotoGalleryComponent } from '../../components/trail-photo-gallery/trail-photo-gallery.component';
import { TrailPhotoUploadComponent } from '../../components/trail-photo-upload/trail-photo-upload.component';
import { FormsModule } from '@angular/forms';
import maplibregl, { Map, GeoJSONSource, Marker } from 'maplibre-gl';
import { finalize } from 'rxjs/operators';

@Component({
  standalone: true,
  selector: 'app-trail-detail',
  imports: [CommonModule, FormsModule, RouterLink, StarRatingComponent, TrailPhotoGalleryComponent, TrailPhotoUploadComponent],
  templateUrl: './trail-detail.page.html'
})
export class TrailDetailPage implements AfterViewInit, OnDestroy {
  trail?: Trail;
  comments: Comment[] = [];
  ratingInput = 0;
  commentBody = '';
  sortBy: 'newest' | 'helpful' = 'helpful';
  editingCommentId: number | null = null;
  editingBody = '';
  editingRating: number | null = null;
  replyingToId: number | null = null;
  replyBody = '';
  isCompleted = false;
  completingTrail = false;
  completionNotice: { kind: 'success' | 'error'; message: string } | null = null;
  isBookmarked = false;
  bookmarkingTrail = false;
  saveCount = 0;

  @ViewChild('routeMapEl') set routeMapEl(el: ElementRef<HTMLDivElement> | undefined) {
    if (el && !this.map) {
      this._routeMapEl = el;
      this.initializeMap();
    }
  }
  get routeMapEl(): ElementRef<HTMLDivElement> | undefined {
    return this._routeMapEl;
  }
  private _routeMapEl?: ElementRef<HTMLDivElement>;
  private map?: Map;
  private routeMarkers: Marker[] = [];
  private completionNoticeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private route: ActivatedRoute, private api: ApiService) {
    const identifier = this.route.snapshot.paramMap.get('id') ?? this.route.snapshot.paramMap.get('slug');
    if (identifier) {
      this.api.getTrail(identifier).subscribe(t => {
        this.trail = t;
        this.updateCompletionState(Boolean(t?.viewer_has_completed));
        this.updateBookmarkState(Boolean(t?.viewer_has_bookmarked), t?.save_count ?? 0);
        if (t?.slug || t?.id) {
          this.loadComments();
          // Track view when trail loads
          this.trackView(t.slug ?? t.id);
        }
        // Render if map is already initialized
        this.renderIfReady();
      });
    }
  }

  private trackView(identifier: string): void {
    // Track view in background - don't block UI
    this.api.trackTrailView(identifier).subscribe({
      next: (result) => {
        // Update view count if trail is loaded
        if (this.trail) {
          this.trail.view_count = result.view_count;
        }
      },
      error: () => {
        // Silently ignore view tracking errors
      }
    });
  }

  ngAfterViewInit(): void {
    // Map initialization now happens in the ViewChild setter
  }

  ngOnDestroy(): void {
    this.routeMarkers.forEach(marker => marker.remove());
    this.routeMarkers = [];
    if (this.map) {
      this.map.remove();
      this.map = undefined;
    }
    if (this.completionNoticeTimer) {
      clearTimeout(this.completionNoticeTimer);
      this.completionNoticeTimer = null;
    }
  }

  private initializeMap() {
    if (this.map || !this.routeMapEl) return;

    const defaultCenter = this.trail?.start ?? { lat: -33.8688, lng: 151.2093 };
    this.map = new maplibregl.Map({
      container: this.routeMapEl.nativeElement,
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
      center: [defaultCenter.lng, defaultCenter.lat],
      zoom: 12,
      attributionControl: true,
    });
    this.map.addControl(new maplibregl.NavigationControl(), 'top-right');
    this.map.on('load', () => {
      this.renderIfReady();
    });
  }

  private renderIfReady() {
    if (!this.map || !this.trail) return;
    if (this.map.isStyleLoaded()) {
      this.renderRoute();
    } else {
      this.map.once('load', () => this.renderRoute());
    }
  }

  private renderRoute() {
    if (!this.map || !this.trail) return;

    this.initialiseRouteLayers();
    this.updateRouteOnMap();
  }

  private initialiseRouteLayers() {
    if (!this.map || this.map.getSource('detail-route')) return;
    this.map.addSource('detail-route', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
    // Thin halo to lift the trail above the basemap similar to OSM hiking renderers.
    this.map.addLayer({
      id: 'detail-route-halo',
      type: 'line',
      source: 'detail-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': 4,
        'line-opacity': 0.7,
      },
    });
    this.map.addLayer({
      id: 'detail-route-line',
      type: 'line',
      source: 'detail-route',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['match', ['get', 'difficulty'], 'Easy', '#2a9d8f', 'easy', '#2a9d8f', 'Moderate', '#f4a261', 'moderate', '#f4a261', 'Hard', '#e76f51', 'hard', '#e76f51', '#4c6ef5'],
        'line-width': 3.5,
      },
    });
  }

  private updateRouteOnMap() {
    if (!this.map || !this.trail) return;
    this.initialiseRouteLayers();

    // Build line features from segments (similar to discover map)
    const lineFeatures: GeoJSON.Feature<GeoJSON.LineString>[] = [];
    let allCoordinates: [number, number][] = [];

    if (this.trail.segments && Array.isArray(this.trail.segments)) {
      for (const segment of this.trail.segments) {
        if (!Array.isArray(segment)) continue;
        const coordinates: [number, number][] = [];
        for (const point of segment) {
          if (!point || typeof point.lng !== 'number' || typeof point.lat !== 'number') continue;
          if (!Number.isFinite(point.lng) || !Number.isFinite(point.lat)) continue;
          coordinates.push([point.lng, point.lat]);
          allCoordinates.push([point.lng, point.lat]);
        }
        if (coordinates.length < 2) continue;
        lineFeatures.push({
          type: 'Feature',
          properties: { difficulty: this.trail.difficulty },
          geometry: { type: 'LineString', coordinates },
        });
      }
    }

    const source = this.map.getSource('detail-route') as GeoJSONSource;
    source.setData({ type: 'FeatureCollection', features: lineFeatures });

    this.routeMarkers.forEach(marker => marker.remove());
    this.routeMarkers = [];

    const start = this.trail.start;
    if (start) {
      this.routeMarkers.push(new maplibregl.Marker({ color: '#059669' }).setLngLat([start.lng, start.lat]).addTo(this.map));
    }
    if (allCoordinates.length > 1) {
      const endPoint = allCoordinates[allCoordinates.length - 1];
      this.routeMarkers.push(new maplibregl.Marker({ color: '#1f2937' }).setLngLat(endPoint).addTo(this.map));
    }

    if (allCoordinates.length >= 2) {
      const bounds = allCoordinates.reduce(
        (acc, coord) => acc.extend(coord),
        new maplibregl.LngLatBounds(allCoordinates[0], allCoordinates[0]),
      );
      this.map.fitBounds(bounds, { padding: 40, duration: 600, maxZoom: 14 });
    } else if (start) {
      this.map.setCenter([start.lng, start.lat]);
      this.map.setZoom(12);
    }

    setTimeout(() => this.map?.resize(), 0);
  }

  private get trailIdentifier(): string | undefined {
    if (!this.trail) return undefined;
    return this.trail.slug || this.trail.id;
  }

  loadComments() {
    const identifier = this.trailIdentifier;
    if (!identifier) return;
    this.api.getComments(identifier, this.sortBy).subscribe(response => {
      this.comments = response.results;
    });
  }

  addComment() {
    const identifier = this.trailIdentifier;
    if (!identifier || (!this.commentBody.trim() && !this.ratingInput)) return;

    this.api.createComment(identifier, this.commentBody, this.ratingInput || undefined)
      .subscribe({
        next: (comment: Comment) => {
          this.comments.unshift(comment);
          this.commentBody = '';
          this.ratingInput = 0;
          this.loadComments(); // Reload to get updated stats
          this.refreshTrailData(); // Refresh trail data to get updated rating
        },
        error: (err) => {
          console.error('Failed to create comment:', err);
          alert(err.error?.detail || err.error?.body?.[0] || err.error?.rating?.[0] || 'Failed to post comment');
        }
      });
  }

  startEdit(comment: Comment) {
    this.editingCommentId = comment.id;
    this.editingBody = comment.body;
    this.editingRating = comment.rating;
  }

  cancelEdit() {
    this.editingCommentId = null;
    this.editingBody = '';
    this.editingRating = null;
  }

  saveEdit() {
    if (this.editingCommentId === null) return;

    this.api.updateComment(this.editingCommentId, this.editingBody, this.editingRating || undefined)
      .subscribe({
        next: () => {
          this.cancelEdit();
          this.loadComments();
          this.refreshTrailData(); // Refresh trail data to get updated rating
        },
        error: (err) => {
          console.error('Failed to update comment:', err);
          alert(err.error?.detail || 'Failed to update comment');
        }
      });
  }

  deleteComment(commentId: number) {
    if (!confirm('Are you sure you want to delete this comment?')) return;

    this.api.deleteComment(commentId).subscribe({
      next: () => {
        this.loadComments();
        this.refreshTrailData(); // Refresh trail data to get updated rating
      },
      error: (err) => {
        console.error('Failed to delete comment:', err);
        alert('Failed to delete comment');
      }
    });
  }

  toggleHelpful(comment: Comment) {
    this.api.toggleReaction(comment.id).subscribe({
      next: (updated) => {
        comment.helpful_count = updated.helpful_count;
        comment.viewer_reaction = updated.viewer_reaction;
      },
      error: (err) => {
        console.error('Failed to toggle reaction:', err);
      }
    });
  }

  startReply(commentId: number) {
    this.replyingToId = commentId;
    this.replyBody = '';
  }

  cancelReply() {
    this.replyingToId = null;
    this.replyBody = '';
  }

  addReply(parentId: number) {
    const identifier = this.trailIdentifier;
    if (!identifier || !this.replyBody.trim()) return;

    this.api.createComment(identifier, this.replyBody, undefined, parentId)
      .subscribe({
        next: () => {
          this.cancelReply();
          this.loadComments();
        },
        error: (err) => {
          console.error('Failed to post reply:', err);
          alert(err.error?.detail || 'Failed to post reply');
        }
      });
  }

  changeSortBy(sort: 'newest' | 'helpful') {
    this.sortBy = sort;
    this.loadComments();
  }

  markComplete() {
    const slug = this.trail?.slug;
    if (!slug || this.completingTrail) return;

    this.completingTrail = true;
    this.api.markTrailComplete(slug).pipe(
      finalize(() => {
        this.completingTrail = false;
      })
    ).subscribe({
      next: (response) => {
        this.updateCompletionState(true);
        const detailMessage = response?.detail || '';
        const message = detailMessage.includes('already')
          ? 'You already marked this trail as completed.'
          : 'Trail marked as completed! Check your profile to see updated stats and badges.';
        this.setCompletionNotice('success', message);
      },
      error: (err) => {
        console.error('Failed to mark trail as complete:', err);
        if (err.status === 401 || err.status === 403) {
          this.setCompletionNotice('error', 'Please sign in to mark trails as completed.');
          return;
        }
        const fallback = err?.error?.detail || err?.error?.message || 'Failed to mark trail as completed.';
        this.setCompletionNotice('error', fallback);
      }
    });
  }

  unmarkComplete() {
    const slug = this.trail?.slug;
    if (!slug || this.completingTrail) return;

    this.completingTrail = true;
    this.api.unmarkTrailComplete(slug).pipe(
      finalize(() => {
        this.completingTrail = false;
      })
    ).subscribe({
      next: (response) => {
        this.updateCompletionState(false);
        const message = response?.detail || 'Trail completion removed.';
        this.setCompletionNotice('success', message);
      },
      error: (err) => {
        console.error('Failed to remove completion:', err);
        if (err?.status === 404) {
          this.updateCompletionState(false);
          this.setCompletionNotice('success', err?.error?.detail || 'This trail was not marked as completed.');
          return;
        }
        const fallback = err?.error?.detail || 'Failed to remove completion.';
        this.setCompletionNotice('error', fallback);
      }
    });
  }

  toggleBookmark() {
    const slug = this.trail?.slug;
    if (!slug || this.bookmarkingTrail) return;

    this.bookmarkingTrail = true;
    this.api.toggleTrailBookmark(slug).pipe(
      finalize(() => {
        this.bookmarkingTrail = false;
      })
    ).subscribe({
      next: (response) => {
        this.updateBookmarkState(response.bookmarked, response.total_saves);
        const message = response.bookmarked
          ? 'Trail bookmarked! View all your bookmarks in your profile.'
          : 'Bookmark removed.';
        this.setCompletionNotice('success', message);
      },
      error: (err) => {
        console.error('Failed to toggle bookmark:', err);
        if (err.status === 401 || err.status === 403) {
          this.setCompletionNotice('error', 'Please sign in to bookmark trails.');
          return;
        }
        const fallback = err?.error?.detail || err?.error?.message || 'Failed to bookmark trail.';
        this.setCompletionNotice('error', fallback);
      }
    });
  }

  private updateBookmarkState(bookmarked: boolean, saveCount: number) {
    this.isBookmarked = bookmarked;
    this.saveCount = saveCount;
    if (this.trail) {
      this.trail.viewer_has_bookmarked = bookmarked;
      this.trail.save_count = saveCount;
    }
  }

  refreshPhotos() {
    const identifier = this.trail?.slug || this.trail?.id;
    if (!identifier) return;

    this.api.getTrail(identifier).subscribe(t => {
      if (this.trail && t) {
        this.trail.photos = t.photos;
        this.trail.primary_photo = t.primary_photo;
      }
    });
  }

  refreshTrailData() {
    const identifier = this.trail?.slug || this.trail?.id;
    if (!identifier) return;

    this.api.getTrail(identifier).subscribe(t => {
      if (this.trail && t) {
        this.trail.rating_avg = t.rating_avg;
        this.trail.rating_count = t.rating_count;
      }
    });
  }

  onPhotoUploaded() {
    this.refreshPhotos();
    this.setCompletionNotice('success', 'Photo uploaded successfully!');
  }

  private setCompletionNotice(kind: 'success' | 'error', message: string) {
    this.completionNotice = { kind, message };
    if (this.completionNoticeTimer) {
      clearTimeout(this.completionNoticeTimer);
    }
    this.completionNoticeTimer = setTimeout(() => {
      this.completionNotice = null;
      this.completionNoticeTimer = null;
    }, 5000);
  }

  private updateCompletionState(isCompleted: boolean) {
    this.isCompleted = isCompleted;
    if (this.trail) {
      this.trail = { ...this.trail, viewer_has_completed: isCompleted };
    }
  }
}
