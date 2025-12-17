import { of, throwError } from 'rxjs';
import { SubmitTrailPage } from './submit-trail.page';
import { LatLng } from '../../models/trail';
import { ApiService } from '../../services/api.service';
import { TrailSubmissionResponse } from '../../models/trail-submission';

describe('SubmitTrailPage', () => {
  let component: SubmitTrailPage;
  let logSpy: jasmine.Spy<(message?: any, ...optionalParams: any[]) => void>;
  let errorSpy: jasmine.Spy<(message?: any, ...optionalParams: any[]) => void>;
  let apiServiceSpy: jasmine.SpyObj<ApiService>;

  const dropPoint = (point: LatLng) => {
    (component as any).addPoint(point);
  };

  beforeEach(() => {
    apiServiceSpy = jasmine.createSpyObj<ApiService>('ApiService', ['submitTrail', 'submitTrailWithPhotos', 'fitRoute']);
    const mockResponse: TrailSubmissionResponse = {
      id: 1,
      name: '',
      difficulty: 'Moderate',
      distance_km: 0,
      elev_gain_m: 0,
      expected_time_h: 0,
      description: '',
      start: { lat: -33.86, lng: 151.21 },
      segments: [],
      total_points: 2,
      status: 'pending',
      submitted_at: new Date().toISOString()
    };
    apiServiceSpy.submitTrail.and.returnValue(of(mockResponse));
    apiServiceSpy.submitTrailWithPhotos.and.returnValue(of(mockResponse));
    apiServiceSpy.fitRoute.and.returnValue(of({
      segments: [
        [
          { lat: -33.86, lng: 151.21 },
          { lat: -33.855, lng: 151.215 },
          { lat: -33.85, lng: 151.22 }
        ]
      ],
      totalPoints: 3,
      totalDistanceKm: 1.2,
      start: { lat: -33.86, lng: 151.21 }
    }));

    component = new SubmitTrailPage(apiServiceSpy);
    logSpy = spyOn(console, 'log').and.stub();
    errorSpy = spyOn(console, 'error').and.stub();
  });

  it('blocks submission until a segment contains at least two points', () => {
    component.submit();
    expect(component.submissionNotice).toBeTruthy();
    expect(component.submissionNotice!.kind).toBe('error');
    expect(component.submissionNotice!.message).toBe('Please sketch the trail route on the map by dropping at least two points.');

    component.submissionNotice = null;
    dropPoint({ lat: -33.86, lng: 151.21 });
    component.submit();
    expect(component.submissionNotice).toBeTruthy();
    expect(component.submissionNotice!.kind).toBe('error');
    expect(apiServiceSpy.submitTrail).not.toHaveBeenCalled();
  });

  it('serialises the drawn segments into the submission payload', () => {
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });

    component.submit();

    expect(logSpy).toHaveBeenCalled();
    const payload = logSpy.calls.mostRecent().args[1];
    expect(payload.name).toBe('');
    expect(payload.segments.length).toBe(1);
    expect(payload.segments[0][0]).toEqual({ lat: -33.86, lng: 151.21 });
    expect(payload.start).toEqual({ lat: -33.86, lng: 151.21 });
    expect(apiServiceSpy.submitTrailWithPhotos).toHaveBeenCalledWith(jasmine.objectContaining({
      name: '',
      difficulty: 'Moderate',
      elev_gain_m: jasmine.any(Number),
      segments: jasmine.any(Array)
    }), jasmine.any(Array));
    expect(component.submissionNotice).toBeTruthy();
    expect(component.submissionNotice!.kind).toBe('success');
    expect(component.submissionNotice!.message).toContain('Trail submitted');
  });

  it('supports multiple segments with undo operations trimming empty segments', () => {
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });

    expect(component.canStartNewSegment).toBeTrue();
    component.startNewSegment();
    expect(component.routeSegments.length).toBe(2);

    dropPoint({ lat: -33.84, lng: 151.23 });
    dropPoint({ lat: -33.83, lng: 151.24 });
    expect(component.routeSegments[1].length).toBe(2);

    component.undoLastPoint();
    expect(component.routeSegments.length).toBe(2);
    expect(component.routeSegments[1].length).toBe(1);

    component.undoLastPoint();
    expect(component.routeSegments.length).toBe(1);
    expect(component.routeSegments[0].length).toBe(2);
  });

  it('resets route state when cleared', () => {
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });
    expect(component.totalPoints).toBe(2);

    component.clearRoute();

    expect(component.totalPoints).toBe(0);
    expect(component.totalDistanceKm).toBe(0);
    expect(component.routeSegments.length).toBe(1);
    expect(component.routeSegments[0].length).toBe(0);
    expect(component.hasRoute).toBeFalse();
  });

  it('shows an error notice when submission fails', () => {
    apiServiceSpy.submitTrailWithPhotos.and.returnValue(throwError(() => new Error('network error')));
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });

    component.submit();

    expect(component.submissionNotice).toBeTruthy();
    expect(component.submissionNotice!.kind).toBe('error');
    expect(component.submissionNotice!.message).toBe('Sorry, something went wrong while submitting your trail. Please try again.');
    expect(errorSpy).toHaveBeenCalled();
    expect(component.submitting).toBeFalse();
  });

  it('fits the route using the API and updates metrics', () => {
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });

    component.fitRoute();

    expect(apiServiceSpy.fitRoute).toHaveBeenCalled();
    expect(component.routeSegments[0].length).toBe(3);
    expect(component.totalPoints).toBe(3);
    expect(component.fittingRoute).toBeFalse();
  });

  it('shows success notice when trail is submitted successfully', () => {
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });

    component.submit();

    expect(component.submissionNotice).toBeTruthy();
    expect(component.submissionNotice!.kind).toBe('success');
    expect(component.submissionNotice!.message).toContain('Trail submitted with 2 points');
    expect(component.submitting).toBeFalse();
  });

  it('clears submission notice timer on destroy', () => {
    dropPoint({ lat: -33.86, lng: 151.21 });
    dropPoint({ lat: -33.85, lng: 151.22 });
    component.submit();

    expect(component.submissionNotice).toBeTruthy();

    const clearTimeoutSpy = spyOn(window, 'clearTimeout');
    component.ngOnDestroy();

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});
