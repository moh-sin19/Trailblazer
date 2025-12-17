import { Component, OnInit } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { NavbarComponent } from './components/navbar/navbar.component';
import { AuthService } from './services/auth.service';
import { take } from 'rxjs/operators';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, NavbarComponent],
  template: `
    <app-navbar></app-navbar>
    <main class="px-2 md:px-4">
      <router-outlet></router-outlet>
    </main>
  `
})
export class AppComponent implements OnInit {
  constructor(private authService: AuthService) {}

  ngOnInit(): void {
    this.authService.ensureCsrf().pipe(take(1)).subscribe({
      next: () => {
        this.authService
          .loadSession()
          .pipe(take(1))
          .subscribe({
            error: () => {
              // Silent fallback: session state remains unauthenticated.
            }
          });
      },
      error: () => {
        this.authService
          .loadSession()
          .pipe(take(1))
          .subscribe({
            error: () => {
              // Silent fallback: session state remains unauthenticated.
            }
          });
      }
    });
  }
}
