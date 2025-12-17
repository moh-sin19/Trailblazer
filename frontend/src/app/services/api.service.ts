import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { catchError, map, Observable, of, throwError } from 'rxjs';
import { Trail, Review, LatLng, Comment, TrailPhoto } from '../models/trail';
import { ReviewInput } from '../models/review';
import { TrailSearchParams, TrailSearchResponse, MapQueryParams, MapResponse, FilterOptions } from '../models/search';
import { AuthenticatedUser, ProfileUpdatePayload, UserProfile, PublicUserProfileDto, PublicUserProfileView, UserRole, mapPublicProfileDto } from '../models/user';
import { API_BASE_URL } from '../config/api.config';
import { TrailSubmissionPayload, TrailSubmissionResponse, TrailSubmissionStatus } from '../models/trail-submission';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = API_BASE_URL;
  private readonly fallbackCoords: LatLng = { lat: -33.8688, lng: 151.2093 };

  constructor(private http: HttpClient) {}

  getTrails(): Observable<Trail[]> {
    return this.http.get<unknown[]>(`${this.baseUrl}/trails/`).pipe(
      map(items => items.map(item => this.normaliseTrail(item))),
      catchError(() =>
        this.http.get<unknown[]>('assets/mock-trails.json').pipe(
          map(items => items.map(item => this.normaliseTrail(item))),
          catchError(() => of([]))
        )
      )
    );
  }

  searchTrails(params: TrailSearchParams): Observable<TrailSearchResponse> {
    let httpParams = new HttpParams();

    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.difficulty) httpParams = httpParams.set('difficulty', params.difficulty.toLowerCase());
    if (params.distance_km_min !== undefined) httpParams = httpParams.set('distance_km_min', params.distance_km_min.toString());
    if (params.distance_km_max !== undefined) httpParams = httpParams.set('distance_km_max', params.distance_km_max.toString());
    if (params.category_ids?.length) httpParams = httpParams.set('category_ids', params.category_ids.join(','));
    if (params.city) httpParams = httpParams.set('city', params.city);
    if (params.country) httpParams = httpParams.set('country', params.country);
    if (params.page) httpParams = httpParams.set('page', params.page.toString());
    if (params.page_size) httpParams = httpParams.set('page_size', params.page_size.toString());

    return this.http.get<any>(`${this.baseUrl}/trails/`, { params: httpParams }).pipe(
      map(response => ({
        results: (response.results || []).map((item: any) => this.normaliseTrail(item)),
        total_count: response.total_count || 0,
        next: response.next || null,
        previous: response.previous || null
      })),
      catchError(() => of({ results: [], total_count: 0, next: null, previous: null }))
    );
  }

  getMapData(params: MapQueryParams): Observable<MapResponse> {
    let httpParams = new HttpParams()
      .set('bbox', params.bbox)
      .set('zoom', params.zoom.toString());

    if (params.cluster !== undefined) httpParams = httpParams.set('cluster', params.cluster.toString());
    if (params.max_markers) httpParams = httpParams.set('max_markers', params.max_markers.toString());
    if (params.q) httpParams = httpParams.set('q', params.q);
    if (params.difficulty) httpParams = httpParams.set('difficulty', params.difficulty.toLowerCase());
    if (params.distance_km_min !== undefined) httpParams = httpParams.set('distance_km_min', params.distance_km_min.toString());
    if (params.distance_km_max !== undefined) httpParams = httpParams.set('distance_km_max', params.distance_km_max.toString());
    if (params.category_ids?.length) httpParams = httpParams.set('category_ids', params.category_ids.join(','));
    if (params.city) httpParams = httpParams.set('city', params.city);
    if (params.country) httpParams = httpParams.set('country', params.country);

    return this.http.get<MapResponse>(`${this.baseUrl}/trails/map/`, { params: httpParams }).pipe(
      catchError(() => of({ features: [], map_bounds: { south: 0, west: 0, north: 0, east: 0 }, total_in_bbox: 0 }))
    );
  }

  getFilterOptions(): Observable<FilterOptions> {
    return this.http.get<FilterOptions>(`${this.baseUrl}/trails/filters/`).pipe(
      catchError(() => of({
        difficulties: [
          { value: 'easy' as const, label: 'Easy' },
          { value: 'moderate' as const, label: 'Moderate' },
          { value: 'hard' as const, label: 'Hard' }
        ],
        distance_range: { min: 0, max: 2000 },
        categories: [],
        cities: [],
        countries: []
      }))
    );
  }

  getTrail(idOrSlug: string): Observable<Trail | undefined> {
    const encoded = encodeURIComponent(idOrSlug);
    return this.http.get<unknown>(`${this.baseUrl}/trails/${encoded}/`).pipe(
      map(item => this.normaliseTrail(item)),
      catchError(() =>
        this.getTrails().pipe(
          map(list => list.find(t => t.id === idOrSlug || t.slug === idOrSlug))
        )
      )
    );
  }

  getProfile(): Observable<UserProfile | null> {
    return this.http.get<unknown>(`${this.baseUrl}/profile/me/`).pipe(
      map(raw => this.normaliseProfile(raw)),
      catchError(error => {
        if (error?.status === 401) {
          return of(null);
        }
        return throwError(() => error);
      })
    );
  }

  updateProfile(payload: ProfileUpdatePayload): Observable<UserProfile> {
    const body = this.serialiseProfileUpdate(payload);
    return this.http.patch<unknown>(`${this.baseUrl}/profile/me/`, body).pipe(
      map(raw => this.normaliseProfile(raw))
    );
  }

  requestPasswordReset(email: string): Observable<void> {
    return this.http
      .post(`${this.baseUrl}/auth/password-reset/`, { email })
      .pipe(map(() => void 0));
  }

  confirmPasswordReset(token: string, password: string): Observable<void> {
    return this.http
      .post(`${this.baseUrl}/auth/password-reset/confirm/`, { token, password })
      .pipe(map(() => void 0));
  }

  addReview(identifier: string, input: ReviewInput): Observable<Review> {
    const encoded = encodeURIComponent(identifier);
    return this.http.post<Review>(`${this.baseUrl}/trails/${encoded}/reviews/`, input).pipe(
      catchError(() => {
        const review: Review = {
          id: Math.random().toString(36).slice(2),
          user: 'You',
          rating: input.rating,
          comment: input.comment,
          created_at: new Date().toISOString(),
          conditions: input.conditions
        };
        return of(review);
      })
    );
  }

  // New comment API methods
  getComments(trailId: number | string, sort: 'newest' | 'helpful' = 'helpful'): Observable<{ results: Comment[], count: number }> {
    const encoded = encodeURIComponent(String(trailId));
    const url = `${this.baseUrl}/trails/${encoded}/comments/`;
    return this.http.get<{ results: Comment[], count: number }>(url, {
      params: new HttpParams().set('sort', sort)
    }).pipe(
      catchError(() => of({ results: [], count: 0 }))
    );
  }

  createComment(trailId: number | string, body: string, rating?: number, parentId?: number): Observable<Comment> {
    const encoded = encodeURIComponent(String(trailId));
    const payload: Record<string, unknown> = { body };
    if (rating !== undefined) payload['rating'] = rating;
    if (parentId !== undefined) payload['parent'] = parentId;
    return this.http.post<Comment>(`${this.baseUrl}/trails/${encoded}/comments/`, payload);
  }

  updateComment(commentId: number, body?: string, rating?: number): Observable<Comment> {
    const payload: any = {};
    if (body !== undefined) payload.body = body;
    if (rating !== undefined) payload.rating = rating;
    return this.http.patch<Comment>(`${this.baseUrl}/comments/${commentId}/`, payload);
  }

  deleteComment(commentId: number): Observable<void> {
    return this.http.delete<void>(`${this.baseUrl}/comments/${commentId}/`);
  }

  toggleReaction(commentId: number, kind: 'like' = 'like'): Observable<Comment> {
    return this.http.post<Comment>(`${this.baseUrl}/comments/${commentId}/reaction/`, { kind });
  }

  submitTrail(payload: TrailSubmissionPayload): Observable<TrailSubmissionResponse> {
    const body = this.serialiseTrailSubmission(payload);
    return this.http
      .post<unknown>(`${this.baseUrl}/trail-submissions/`, body)
      .pipe(map(raw => this.normaliseTrailSubmission(raw)));
  }

  submitTrailWithPhotos(payload: TrailSubmissionPayload, photos: File[]): Observable<TrailSubmissionResponse> {
    const formData = new FormData();

    // Append trail data
    const trailData = this.serialiseTrailSubmission(payload);
    Object.entries(trailData).forEach(([key, value]) => {
      if (key === 'segments' || key === 'start') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    });

    // Append photos
    photos.forEach((photo, index) => {
      formData.append('photos', photo, photo.name);
    });

    return this.http
      .post<unknown>(`${this.baseUrl}/trail-submissions/`, formData)
      .pipe(map(raw => this.normaliseTrailSubmission(raw)));
  }

  getMyTrailSubmissions(): Observable<TrailSubmissionResponse[]> {
    return this.http
      .get<unknown[]>(`${this.baseUrl}/trail-submissions/`)
      .pipe(map(list => list.map(raw => this.normaliseTrailSubmission(raw))));
  }

  getTrailSubmission(id: number): Observable<TrailSubmissionResponse> {
    return this.http
      .get<unknown>(`${this.baseUrl}/trail-submissions/${id}/`)
      .pipe(map(raw => this.normaliseTrailSubmission(raw)));
  }

  updateTrailSubmission(id: number, payload: TrailSubmissionPayload): Observable<TrailSubmissionResponse> {
    const body = this.serialiseTrailSubmission(payload);
    return this.http
      .patch<unknown>(`${this.baseUrl}/trail-submissions/${id}/`, body)
      .pipe(map(raw => this.normaliseTrailSubmission(raw)));
  }

  updateTrailSubmissionWithPhotos(id: number, payload: TrailSubmissionPayload, photos: File[]): Observable<TrailSubmissionResponse> {
    // If no photos, use JSON payload instead of FormData
    if (photos.length === 0) {
      return this.updateTrailSubmission(id, payload);
    }

    const formData = new FormData();

    // Append trail data
    const trailData = this.serialiseTrailSubmission(payload);
    Object.entries(trailData).forEach(([key, value]) => {
      if (key === 'segments' || key === 'start') {
        formData.append(key, JSON.stringify(value));
      } else {
        formData.append(key, String(value));
      }
    });

    // Append photos
    photos.forEach((photo, index) => {
      formData.append('photos', photo, photo.name);
    });

    return this.http
      .patch<unknown>(`${this.baseUrl}/trail-submissions/${id}/`, formData)
      .pipe(map(raw => this.normaliseTrailSubmission(raw)));
  }

  deleteTrailSubmission(id: number): Observable<{detail: string}> {
    return this.http.delete<{detail: string}>(`${this.baseUrl}/trail-submissions/${id}/`);
  }

  deleteTrailSubmissionPhoto(submissionId: number, photoId: number): Observable<{detail: string}> {
    return this.http.delete<{detail: string}>(`${this.baseUrl}/trail-submissions/${submissionId}/photos/${photoId}/`);
  }

  fitRoute(segments: LatLng[][]): Observable<{ segments: LatLng[][]; totalPoints: number; totalDistanceKm: number; start: LatLng }> {
    const payload = {
      segments: segments.map(segment => segment.map(point => ({ lat: point.lat, lng: point.lng })))
    };

    return this.http
      .post<any>(`${this.baseUrl}/trail-submissions/fit-route/`, payload)
      .pipe(
        map(response => ({
          segments: (response?.segments ?? []).map((segment: any[]) =>
            segment.map(point => ({ lat: Number(point?.lat), lng: Number(point?.lng) }))
          ),
          totalPoints: Number(response?.total_points ?? 0),
          totalDistanceKm: Number(response?.total_distance_km ?? 0),
          start: {
            lat: Number(response?.start?.lat ?? 0),
            lng: Number(response?.start?.lng ?? 0)
          }
        }))
      );
  }

  private normaliseTrail(raw: any): Trail {
    const slug = typeof raw?.slug === 'string' ? raw.slug : undefined;
    const id = this.pickIdentifier(raw, slug);
    const name = this.asString(raw?.name) || 'Unnamed trail';
    const difficultyRaw = this.asString(raw?.difficulty) || 'Moderate';
    const difficulty = this.normaliseDifficulty(difficultyRaw);

    const ratingAvg = this.asNumber(raw?.rating_avg) ?? 0;
    const ratingCount = this.asNumber(raw?.rating_count) ?? 0;
    const distanceKm = this.asNumber(raw?.distance_km) ?? 0;
    const durationMins = this.asNumber(raw?.duration_mins);
    const elevGainM = this.asNumber(raw?.elev_gain_m);

    // Parse segments
    const segments: LatLng[][] = Array.isArray(raw?.segments)
      ? raw.segments.map((segment: any) => {
          if (!Array.isArray(segment)) return [];
          return segment.map((point: any) => this.toLatLng(point)).filter(Boolean) as LatLng[];
        }).filter((seg: LatLng[]) => seg.length > 0)
      : [];

    // Parse start point
    let start: LatLng;
    if (raw?.start && typeof raw.start === 'object') {
      const candidate = this.toLatLng(raw.start);
      if (candidate) {
        start = candidate;
      } else {
        start = segments[0]?.[0] ?? { lat: 0, lng: 0 };
      }
    } else {
      start = segments[0]?.[0] ?? { lat: 0, lng: 0 };
    }

    const normalisedReviews = Array.isArray(raw?.reviews)
      ? raw.reviews.map((r: any) => this.normaliseReview(r))
      : undefined;

    const categories = Array.isArray(raw?.categories)
      ? raw.categories
      : undefined;
    const viewerHasCompleted = Boolean(raw?.viewer_has_completed);
    const viewerHasBookmarked = Boolean(raw?.viewer_has_bookmarked);
    const saveCount = this.asNumber(raw?.save_count) ?? 0;

    // Parse photos
    const photos: TrailPhoto[] = Array.isArray(raw?.photos)
      ? raw.photos
      : [];
    const primaryPhoto: TrailPhoto | null = raw?.primary_photo || null;

    // Parse submitted_by
    const submittedBy = raw?.submitted_by && typeof raw.submitted_by === 'object'
      ? {
          id: raw.submitted_by.id,
          username: raw.submitted_by.username,
          display_name: raw.submitted_by.display_name
        }
      : undefined;

    return {
      id,
      slug,
      name,
      description: this.asString(raw?.description) || 'No description provided.',
      difficulty,
      city: this.asString(raw?.city) || undefined,
      country: this.asString(raw?.country) || undefined,
      latitude: this.asNumber(raw?.latitude),
      longitude: this.asNumber(raw?.longitude),
      rating_avg: ratingAvg,
      rating_count: ratingCount,
      save_count: saveCount,
      distance_km: distanceKm,
      duration_mins: durationMins,
      elev_gain_m: elevGainM,
      segments,
      start,
      categories,
      reviews: normalisedReviews,
      viewer_has_completed: viewerHasCompleted,
      viewer_has_bookmarked: viewerHasBookmarked,
      photos,
      primary_photo: primaryPhoto,
      submitted_by: submittedBy
    };
  }

  public normaliseProfile(raw: any): UserProfile {
    const id = typeof raw?.id === 'number' ? raw.id : Number(raw?.id ?? 0);
    const username = this.asString(raw?.username) || this.asString(raw?.user?.username) || '';
    const displayName = this.asString(raw?.display_name) || this.asString(raw?.displayName) || 'Explorer';
    const bio = this.asString(raw?.bio);
    const experienceValue = this.normaliseExperience(raw?.experience);
    const experienceLabel = this.asString(raw?.experience_label) || this.toTitleCase(experienceValue);
    const roleValue = this.normaliseRole(raw?.role);
    const roleLabel = this.asString(raw?.role_label) || this.toTitleCase(roleValue);
    const avatarUrl = this.asString(raw?.avatar_url) || this.asString(raw?.avatarUrl) || undefined;
    const email = this.asString(raw?.email) || '';
    const updatedAt = this.asString(raw?.updated_at) || new Date().toISOString();

    return {
      id,
      username,
      displayName,
      bio: bio || undefined,
      experience: experienceValue,
      experienceLabel,
      role: roleValue,
      roleLabel,
      avatarUrl,
      email,
      updatedAt
    };
  }

  public normaliseAuthenticatedUser(raw: any): AuthenticatedUser {
    const id = typeof raw?.id === 'number' ? raw.id : Number(raw?.id ?? 0);
    const username = this.asString(raw?.username) || this.asString(raw?.user?.username) || '';
    const email = this.asString(raw?.email) || this.asString(raw?.user?.email) || '';
    const profileSource = raw?.profile || raw?.user?.profile || {};

    return {
      id,
      username,
      email,
      profile: this.normaliseProfile(profileSource)
    };
  }

  private serialiseProfileUpdate(payload: ProfileUpdatePayload): FormData | Record<string, unknown> {
    if (payload.avatarFile instanceof File) {
      const form = new FormData();
      if (payload.displayName !== undefined) form.append('display_name', payload.displayName);
      if (payload.bio !== undefined) form.append('bio', payload.bio ?? '');
      if (payload.experience !== undefined) form.append('experience', payload.experience);
      form.append('avatar', payload.avatarFile);
      return form;
    }

    const json: Record<string, unknown> = {};
    if (payload.displayName !== undefined) json['display_name'] = payload.displayName;
    if (payload.bio !== undefined) json['bio'] = payload.bio ?? '';
    if (payload.experience !== undefined) json['experience'] = payload.experience;
    if (payload.removeAvatar) json['avatar'] = null;
    return json;
  }

  private normaliseExperience(value: any): 'beginner' | 'intermediate' | 'advanced' {
    const experience = (this.asString(value) || 'beginner').toLowerCase();
    switch (experience) {
      case 'beginner':
      case 'intermediate':
      case 'advanced':
        return experience;
      default:
        return 'beginner';
    }
  }

  private normaliseRole(value: any): UserRole {
    const role = (this.asString(value) || 'standard').toLowerCase();
    return role === 'admin' ? 'admin' : 'standard';
  }

  private toTitleCase(value: string): string {
    if (!value) return '';
    return value
      .split(/[_\s-]+/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  }

  private pickIdentifier(raw: any, slug?: string): string {
    if (raw && typeof raw.id === 'string') return raw.id;
    if (raw && typeof raw.id === 'number') return String(raw.id);
    if (slug) return slug;
    if (typeof raw?.title === 'string') return raw.title.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    if (typeof raw?.name === 'string') return raw.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    return Math.random().toString(36).slice(2);
  }

  private resolveStart(raw: any, coords: LatLng[], center?: [number, number]): LatLng {
    if (raw?.start && typeof raw.start === 'object') {
      const candidate = this.toLatLng(raw.start);
      if (candidate) return candidate;
    }
    if (coords.length) return coords[0];
    if (center) {
      return { lat: Number(center[1]), lng: Number(center[0]) };
    }
    return this.fallbackCoords;
  }

  private normaliseReview(raw: any): Review {
    return {
      id: typeof raw?.id === 'string' ? raw.id : Math.random().toString(36).slice(2),
      user: this.asString(raw?.user) || this.asString(raw?.author) || 'Anonymous',
      rating: this.asNumber(raw?.rating) ?? 0,
      comment: this.asString(raw?.comment) || this.asString(raw?.body) || '',
      created_at: this.asString(raw?.created_at) || this.asString(raw?.createdAt) || new Date().toISOString(),
      conditions: Array.isArray(raw?.conditions) ? raw.conditions : undefined
    };
  }

  private normaliseDifficulty(value: string): 'Easy'|'Moderate'|'Hard' {
    const normalised = value.toLowerCase();
    switch (normalised) {
      case 'easy':
        return 'Easy';
      case 'hard':
        return 'Hard';
      default:
        return 'Moderate';
    }
  }

  private toLatLng(value: any): LatLng | undefined {
    if (!value) return undefined;
    if (typeof value.lat === 'number' && typeof value.lng === 'number') {
      return { lat: value.lat, lng: value.lng };
    }
    if (Array.isArray(value) && value.length >= 2) {
      const [lng, lat] = value;
      if (!isNaN(lat) && !isNaN(lng)) {
        return { lat: Number(lat), lng: Number(lng) };
      }
    }
    return undefined;
  }

  getPublicProfile(username: string): Observable<PublicUserProfileView> {
    return this.http.get<PublicUserProfileDto>(`${this.baseUrl}/profiles/${username}/`).pipe(
      map(dto => mapPublicProfileDto(dto))
    );
  }

  /**
   * Mark a trail as completed by the current user
   */
  markTrailComplete(trailSlug: string): Observable<{detail: string, completed_at: string}> {
    return this.http.post<{detail: string, completed_at: string}>(
      `${this.baseUrl}/trails/${trailSlug}/complete/`,
      {}
    );
  }

  /**
   * Remove trail completion for the current user
   */
  unmarkTrailComplete(trailSlug: string): Observable<{detail: string}> {
    return this.http.delete<{detail: string}>(
      `${this.baseUrl}/trails/${trailSlug}/complete/`
    );
  }

  /**
   * Toggle bookmark for a trail (bookmark if not bookmarked, unbookmark if already bookmarked)
   */
  toggleTrailBookmark(trailSlug: string): Observable<{bookmarked: boolean, total_saves: number}> {
    return this.http.post<{bookmarked: boolean, total_saves: number}>(
      `${this.baseUrl}/trails/${trailSlug}/bookmark/`,
      {}
    );
  }

  /**
   * Get list of bookmarked trails for the current user
   */
  getMyBookmarks(): Observable<Trail[]> {
    return this.http.get<any[]>(`${this.baseUrl}/profile/me/bookmarks/`)
      .pipe(
        map((rawList: any[]) => Array.isArray(rawList) ? rawList.map(raw => this.normaliseTrail(raw)) : [])
      );
  }

  /**
   * Track a view of a trail (deduplicates by user/IP per 24 hours)
   */
  trackTrailView(trailSlug: string): Observable<{view_count: number, counted: boolean}> {
    return this.http.post<{view_count: number, counted: boolean}>(
      `${this.baseUrl}/trails/${trailSlug}/track-view/`,
      {}
    );
  }

  /**
   * Upload a photo for a trail
   */
  uploadTrailPhoto(trailSlug: string, file: File, caption: string = '', isPrimary: boolean = false): Observable<TrailPhoto> {
    const formData = new FormData();
    formData.append('image', file);
    if (caption) {
      formData.append('caption', caption);
    }
    formData.append('is_primary', isPrimary.toString());

    return this.http.post<TrailPhoto>(
      `${this.baseUrl}/trails/${trailSlug}/photos/`,
      formData
    );
  }

  /**
   * Get all photos for a trail
   */
  getTrailPhotos(trailSlug: string): Observable<TrailPhoto[]> {
    return this.http.get<TrailPhoto[]>(`${this.baseUrl}/trails/${trailSlug}/photos/`);
  }

  /**
   * Update a trail photo (caption or primary status)
   */
  updateTrailPhoto(trailSlug: string, photoId: number, updates: {caption?: string, is_primary?: boolean}): Observable<TrailPhoto> {
    return this.http.patch<TrailPhoto>(
      `${this.baseUrl}/trails/${trailSlug}/photos/${photoId}/`,
      updates
    );
  }

  /**
   * Delete a trail photo
   */
  deleteTrailPhoto(trailSlug: string, photoId: number): Observable<{detail: string}> {
    return this.http.delete<{detail: string}>(
      `${this.baseUrl}/trails/${trailSlug}/photos/${photoId}/`
    );
  }

  private asString(value: any): string | undefined {
    return typeof value === 'string' && value.trim().length ? value : undefined;
  }

  private asNumber(value: any): number | undefined {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  private serialiseTrailSubmission(payload: TrailSubmissionPayload): Record<string, unknown> {
    const difficulty = typeof payload.difficulty === 'string' ? payload.difficulty.toLowerCase() : 'moderate';
    const segments = Array.isArray(payload.segments)
      ? payload.segments
          .map(segment => Array.isArray(segment)
            ? segment
                .filter(point => point && typeof point.lat === 'number' && typeof point.lng === 'number')
                .map(point => ({ lat: point.lat, lng: point.lng }))
            : [])
          .filter(segment => segment.length >= 2)
      : [];

    const start = this.toLatLng(payload.start) ?? segments[0]?.[0];
    const distance = Number(payload.distance_km ?? 0);
    const expectedTime = Number(payload.expected_time_h ?? 0);
    const elevation = Number(payload.elev_gain_m ?? 0);

    return {
      name: payload.name?.trim() ?? '',
      difficulty,
      distance_km: Math.round(distance * 100) / 100,
      elev_gain_m: Math.max(0, Math.round(Number.isFinite(elevation) ? elevation : 0)),
      expected_time_h: Math.max(0, Number.isFinite(expectedTime) ? expectedTime : 0),
      description: payload.description ?? '',
      start: start ?? this.fallbackCoords,
      segments
    };
  }

  private normaliseTrailSubmission(raw: any): TrailSubmissionResponse {
    const segments: LatLng[][] = Array.isArray(raw?.segments)
      ? raw.segments
          .map((segment: any) => {
            if (!Array.isArray(segment)) return [];
            return segment
              .map((point: any) => this.toLatLng(point))
              .filter((point): point is LatLng => !!point);
          })
          .filter((segment: LatLng[]) => segment.length >= 2)
      : [];

    const start = this.toLatLng(raw?.start) ?? segments[0]?.[0] ?? this.fallbackCoords;
    const totalPoints = this.asNumber(raw?.total_points) ?? segments.reduce((sum, segment) => sum + segment.length, 0);

    // Parse photos
    const photos: TrailPhoto[] = Array.isArray(raw?.photos)
      ? raw.photos
      : [];

    return {
      id: typeof raw?.id === 'number' ? raw.id : Number(raw?.id ?? 0),
      name: this.asString(raw?.name) || '',
      difficulty: this.normaliseDifficulty(this.asString(raw?.difficulty) || 'Moderate'),
      distance_km: this.asNumber(raw?.distance_km) ?? 0,
      elev_gain_m: this.asNumber(raw?.elev_gain_m) ?? 0,
      expected_time_h: this.asNumber(raw?.expected_time_h) ?? 0,
      description: this.asString(raw?.description) || '',
      start,
      segments,
      total_points: totalPoints,
      status: (this.asString(raw?.status) || 'pending').toLowerCase() as TrailSubmissionStatus,
      submitted_at: this.asString(raw?.submitted_at) || null,
      photos
    };
  }
}
