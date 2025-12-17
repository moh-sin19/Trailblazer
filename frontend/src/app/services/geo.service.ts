import { Injectable } from '@angular/core';

export interface TrackPoint {
  lat: number;
  lng: number;
  t: number;
}

@Injectable({ providedIn: 'root' })
export class GeoService {
  private watchId?: number;
  public points: TrackPoint[] = [];

  startTracking() {
    this.points = [];
    if (!('geolocation' in navigator)) throw new Error('Geolocation not supported');
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        this.points.push({ lat: latitude, lng: longitude, t: Date.now() });
      },
      (err) => console.error(err),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    );
  }

  stopTracking() {
    if (this.watchId !== undefined) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = undefined;
  }

  getDistanceKm(): number {
    let d = 0;
    for (let i = 1; i < this.points.length; i++) {
      d += this.haversine(this.points[i-1], this.points[i]);
    }
    return d;
  }

  private haversine(a: TrackPoint, b: TrackPoint): number {
    const R = 6371;
    const dLat = this.toRad(b.lat - a.lat);
    const dLng = this.toRad(b.lng - a.lng);
    const s1 = Math.sin(dLat/2), s2 = Math.sin(dLng/2);
    const aa = s1*s1 + Math.cos(this.toRad(a.lat))*Math.cos(this.toRad(b.lat))*s2*s2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(aa)));
  }
  private toRad(x: number) { return x * Math.PI / 180; }
}
