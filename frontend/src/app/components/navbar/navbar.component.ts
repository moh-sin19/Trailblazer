import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { take } from 'rxjs/operators';

import { ProfileStore } from '../../services/profile.store';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html'
})
export class NavbarComponent {
  readonly profile$ = this.profileStore.profile$;
  loggingOut = false;
  logoutError?: string;

  constructor(
    private profileStore: ProfileStore,
    private authService: AuthService
  ) {}

  onLogout(): void {
    if (this.loggingOut) {
      return;
    }

    this.loggingOut = true;
    this.logoutError = undefined;

    this.authService
      .logout()
      .pipe(take(1))
      .subscribe({
        next: () => {
          this.loggingOut = false;
        },
        error: () => {
          this.logoutError = 'Failed to sign out. Please try again.';
          this.loggingOut = false;
        }
      });
  }
}
