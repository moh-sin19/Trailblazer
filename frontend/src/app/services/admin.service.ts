import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

import {
  AdminComment,
  AdminCommentDto,
  AdminDashboardDto,
  AdminDashboardSummary,
  AdminTrailSubmission,
  AdminTrailDto,
  AdminUser,
  AdminUserDto,
  mapAdminComment,
  mapAdminDashboard,
  mapAdminTrailSubmission,
  mapAdminUser,
} from '../models/admin';
import { API_BASE_URL } from '../config/api.config';
import { UserRole } from '../models/user';

@Injectable({ providedIn: 'root' })
export class AdminService {
  private readonly baseUrl = API_BASE_URL;

  constructor(private http: HttpClient) {}

  getDashboard(): Observable<AdminDashboardSummary> {
    return this.http
      .get<AdminDashboardDto>(`${this.baseUrl}/admin/dashboard/`)
      .pipe(map(mapAdminDashboard));
  }

  listUsers(search?: string): Observable<AdminUser[]> {
    let params = new HttpParams();
    if (search) {
      params = params.set('search', search);
    }
    return this.http
      .get<AdminUserDto[]>(`${this.baseUrl}/admin/users/`, { params })
      .pipe(map((rows) => rows.map(mapAdminUser)));
  }

  updateUser(
    userId: number,
    payload: { role?: UserRole; isActive?: boolean; displayName?: string }
  ): Observable<AdminUser> {
    const body: Record<string, unknown> = {};
    if (payload.role !== undefined) {
      body['role'] = payload.role;
    }
    if (payload.isActive !== undefined) {
      body['is_active'] = payload.isActive;
    }
    if (payload.displayName !== undefined) {
      body['display_name'] = payload.displayName;
    }

    return this.http
      .patch<AdminUserDto>(`${this.baseUrl}/admin/users/${userId}/`, body)
      .pipe(map(mapAdminUser));
  }

  listTrailSubmissions(status?: string): Observable<AdminTrailSubmission[]> {
    let params = new HttpParams();
    if (status) {
      params = params.set('status', status);
    }
    return this.http
      .get<AdminTrailDto[]>(`${this.baseUrl}/admin/trail-submissions/`, { params })
      .pipe(map((rows) => rows.map(mapAdminTrailSubmission)));
  }

  setTrailSubmissionStatus(
    submissionId: number,
    status: string
  ): Observable<AdminTrailSubmission> {
    return this.http
      .patch<AdminTrailDto>(
        `${this.baseUrl}/admin/trail-submissions/${submissionId}/`,
        { approval_state: status }
      )
      .pipe(map(mapAdminTrailSubmission));
  }

  approveTrailSubmission(submissionId: number): Observable<AdminTrailSubmission> {
    return this.http
      .post<AdminTrailDto>(
        `${this.baseUrl}/admin/trail-submissions/${submissionId}/approve/`,
        {}
      )
      .pipe(map(mapAdminTrailSubmission));
  }

  rejectTrailSubmission(submissionId: number): Observable<AdminTrailSubmission> {
    return this.http
      .post<AdminTrailDto>(
        `${this.baseUrl}/admin/trail-submissions/${submissionId}/reject/`,
        {}
      )
      .pipe(map(mapAdminTrailSubmission));
  }

  markTrailSubmissionReviewed(submissionId: number): Observable<AdminTrailSubmission> {
    return this.http
      .post<AdminTrailDto>(
        `${this.baseUrl}/admin/trail-submissions/${submissionId}/mark-reviewed/`,
        {}
      )
      .pipe(map(mapAdminTrailSubmission));
  }

  listComments(status?: 'active' | 'deleted'): Observable<AdminComment[]> {
    let params = new HttpParams();
    if (status) {
      params = params.set('status', status);
    }
    return this.http
      .get<AdminCommentDto[]>(`${this.baseUrl}/admin/comments/`, { params })
      .pipe(map((rows) => rows.map(mapAdminComment)));
  }

  updateComment(
    commentId: number,
    payload: { isDeleted: boolean }
  ): Observable<AdminComment> {
    return this.http
      .patch<AdminCommentDto>(`${this.baseUrl}/admin/comments/${commentId}/`, {
        is_deleted: payload.isDeleted,
      })
      .pipe(map(mapAdminComment));
  }
}
