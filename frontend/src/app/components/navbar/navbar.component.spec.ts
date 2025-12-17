import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of, throwError } from 'rxjs';

import { NavbarComponent } from './navbar.component';
import { ProfileStore } from '../../services/profile.store';
import { AuthService } from '../../services/auth.service';

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['logout']);
    const profileStoreStub = {
      profile$: of(null)
    };

    await TestBed.configureTestingModule({
      imports: [NavbarComponent, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: ProfileStore, useValue: profileStoreStub }
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('should invoke logout and reset flags on success', () => {
    authServiceSpy.logout.and.returnValue(of(void 0));

    component.onLogout();

    expect(authServiceSpy.logout).toHaveBeenCalledTimes(1);
    expect(component.loggingOut).toBeFalse();
    expect(component.logoutError).toBeUndefined();
  });

  it('should surface logout errors', () => {
    authServiceSpy.logout.and.returnValue(throwError(() => new Error('fail')));

    component.onLogout();

    expect(component.logoutError).toBe('Failed to sign out. Please try again.');
    expect(component.loggingOut).toBeFalse();
  });
});
