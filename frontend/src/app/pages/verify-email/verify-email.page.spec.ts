import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { ActivatedRoute, ParamMap, convertToParamMap } from '@angular/router';
import { Subject, of, throwError } from 'rxjs';

import { VerifyEmailPage } from './verify-email.page';
import { AuthService } from '../../services/auth.service';
import { AuthenticatedUser } from '../../models/user';

describe('VerifyEmailPage', () => {
  let component: VerifyEmailPage;
  let fixture: ComponentFixture<VerifyEmailPage>;
  let authServiceSpy: jasmine.SpyObj<AuthService>;

  const mockUser: AuthenticatedUser = {
    id: 1,
    username: 'user',
    email: 'user@example.com',
    profile: {
      id: 1,
      username: 'user',
      displayName: 'User',
      experience: 'beginner',
      experienceLabel: 'Beginner',
      role: 'standard',
      roleLabel: 'Standard',
      email: 'user@example.com',
      updatedAt: '2024-01-01T00:00:00Z'
    }
  };

  class ActivatedRouteStub {
    private subject = new Subject<ParamMap>();
    readonly queryParamMap = this.subject.asObservable();

    emit(params: Record<string, string>) {
      this.subject.next(convertToParamMap(params));
    }
  }

  let routeStub: ActivatedRouteStub;

  beforeEach(async () => {
    authServiceSpy = jasmine.createSpyObj<AuthService>('AuthService', ['verifyEmail']);
    authServiceSpy.verifyEmail.and.returnValue(of(mockUser));
    routeStub = new ActivatedRouteStub();

    await TestBed.configureTestingModule({
      imports: [VerifyEmailPage, RouterTestingModule],
      providers: [
        { provide: AuthService, useValue: authServiceSpy },
        { provide: ActivatedRoute, useValue: routeStub },
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(VerifyEmailPage);
    component = fixture.componentInstance;
  });

  it('verifies the token on init', () => {
    fixture.detectChanges();
    routeStub.emit({ token: 'abc' });

    expect(authServiceSpy.verifyEmail).toHaveBeenCalledWith('abc');
    expect(component.status).toBe('success');
    expect(component.verifiedUser).toEqual(mockUser);
  });

  it('shows an error when the token is missing', () => {
    fixture.detectChanges();
    routeStub.emit({});

    expect(authServiceSpy.verifyEmail).not.toHaveBeenCalled();
    expect(component.status).toBe('error');
    expect(component.errorMessage).toContain('token');
  });

  it('handles verification failure', () => {
    authServiceSpy.verifyEmail.and.returnValue(throwError(() => ({ error: { detail: 'Expired token' } })));
    fixture.detectChanges();
    routeStub.emit({ token: 'abc' });

    expect(component.status).toBe('error');
    expect(component.errorMessage).toBe('Expired token');
  });
});
