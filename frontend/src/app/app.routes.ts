import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', loadComponent: () => import('./pages/discover-map/discover-map.page').then(m => m.DiscoverMapPage) },
  { path: 'trail/:id', loadComponent: () => import('./pages/trail-detail/trail-detail.page').then(m => m.TrailDetailPage) },
  { path: 'trails/:slug', loadComponent: () => import('./pages/trail-detail/trail-detail.page').then(m => m.TrailDetailPage) },
  { path: 'submit', loadComponent: () => import('./pages/submit-trail/submit-trail.page').then(m => m.SubmitTrailPage) },
  { path: 'edit-trail-submission/:id', loadComponent: () => import('./pages/edit-trail-submission/edit-trail-submission.page').then(m => m.EditTrailSubmissionPage) },
  { path: 'profile/settings', loadComponent: () => import('./pages/profile-settings/profile-settings.page').then(m => m.ProfileSettingsPage) },
  { path: 'profile/bookmarks', loadComponent: () => import('./pages/bookmarks/bookmarks.page').then(m => m.BookmarksPage) },
  { path: 'profile/:username', loadComponent: () => import('./pages/profile/profile.page').then(m => m.ProfilePage) },
  { path: 'profile', loadComponent: () => import('./pages/profile/profile.page').then(m => m.ProfilePage) },
  { path: 'admin', loadComponent: () => import('./pages/admin-dashboard/admin-dashboard.page').then(m => m.AdminDashboardPage) },
  { path: 'admin/review-trail/:id', loadComponent: () => import('./pages/admin-review-trail/admin-review-trail.page').then(m => m.AdminReviewTrailPage) },
  { path: 'forgot-password', loadComponent: () => import('./pages/forgot-password/forgot-password.page').then(m => m.ForgotPasswordPage) },
  { path: 'reset-password', loadComponent: () => import('./pages/reset-password/reset-password.page').then(m => m.ResetPasswordPage) },
  { path: 'login', loadComponent: () => import('./pages/login/login.page').then(m => m.LoginPage) },
  { path: 'signup', loadComponent: () => import('./pages/signup/signup.page').then(m => m.SignupPage) },
  { path: 'verify-email', loadComponent: () => import('./pages/verify-email/verify-email.page').then(m => m.VerifyEmailPage) },
  { path: '**', redirectTo: '' }
];
