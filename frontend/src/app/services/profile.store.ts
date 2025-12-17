import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { catchError, shareReplay, tap } from 'rxjs/operators';

import { ApiService } from './api.service';
import { UserProfile } from '../models/user';

@Injectable({ providedIn: 'root' })
export class ProfileStore {
  private readonly profileSubject = new BehaviorSubject<UserProfile | null>(null);
  private loaded = false;

  readonly profile$ = this.profileSubject.asObservable();

  constructor(private api: ApiService) {}

  load(force = false): Observable<UserProfile | null> {
    if (this.loaded && !force) {
      return this.profile$;
    }

    const request$ = this.api.getProfile().pipe(
      catchError(() => of(null)),
      tap(profile => {
        this.profileSubject.next(profile);
        this.loaded = true;
      }),
      shareReplay(1)
    );

    request$.subscribe();
    return request$;
  }

  set(profile: UserProfile | null): void {
    this.profileSubject.next(profile);
    this.loaded = true;
  }

  setProfile(profile: UserProfile | null): void {
    this.set(profile);
  }

  get snapshot(): UserProfile | null {
    return this.profileSubject.value;
  }
}
