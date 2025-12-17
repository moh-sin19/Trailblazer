import { ExperienceLevel, UserRole } from './user';

export interface AdminUserDto {
  id: number;
  username: string;
  email: string;
  display_name: string;
  role: string;
  role_label: string;
  email_verified: boolean;
  is_active: boolean;
  experience: string;
  experience_label: string;
  date_joined: string;
  last_login: string | null;
}

export interface AdminUser {
  id: number;
  username: string;
  email: string;
  displayName: string;
  role: UserRole;
  roleLabel: string;
  emailVerified: boolean;
  isActive: boolean;
  experience: ExperienceLevel;
  experienceLabel: string;
  dateJoined: string;
  lastLogin?: string | null;
}

export interface AdminUserReference {
  id: number;
  username: string;
  displayName: string;
}

export interface AdminTrailDto {
  id: number;
  name: string;
  slug: string;
  difficulty: string;
  distance_km: number;
  elev_gain_m: number;
  duration_mins: number;
  description: string | null;
  approval_state: string;
  submitted_by: { id: number; username: string; display_name: string } | null;
  submitted_at: string | null;
  total_points: number;
  segments: unknown;
  start: { lat: number; lng: number } | null;
}

export interface AdminTrailSubmission {
  id: number;
  name: string;
  slug: string;
  difficulty: string;
  distanceKm: number;
  elevationGainM: number;
  durationMins: number;
  description?: string | null;
  approvalState: string;
  submittedBy?: AdminUserReference | null;
  submittedAt?: string | null;
  totalPoints: number;
  segments: unknown;
  start: { lat: number; lng: number } | null;
}

export interface AdminCommentDto {
  id: number;
  trail: number;
  trail_name: string;
  trail_slug: string;
  author: number;
  author_username: string;
  author_display_name: string;
  body: string;
  rating: number | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface AdminComment {
  id: number;
  trailId: number;
  trailName: string;
  trailSlug: string;
  authorId: number;
  authorUsername: string;
  authorDisplayName: string;
  body: string;
  rating?: number | null;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AdminDashboardDto {
  stats: {
    total_users: number;
    new_users_last_7_days: number;
    pending_trail_submissions: number;
    published_trails: number;
    active_comments: number;
  };
  permissions: {
    can_manage_users: boolean;
    can_moderate_comments: boolean;
    can_review_trail_submissions: boolean;
  };
  recent: {
    new_users: AdminUserDto[];
    trail_submissions: AdminTrailDto[];
    comments: AdminCommentDto[];
  };
}

export interface AdminDashboardStats {
  totalUsers: number;
  newUsersLast7Days: number;
  pendingTrailSubmissions: number;
  publishedTrails: number;
  activeComments: number;
}

export interface AdminDashboardPermissions {
  canManageUsers: boolean;
  canModerateComments: boolean;
  canReviewTrailSubmissions: boolean;
}

export interface AdminDashboardSummary {
  stats: AdminDashboardStats;
  permissions: AdminDashboardPermissions;
  recent: {
    newUsers: AdminUser[];
    trailSubmissions: AdminTrailSubmission[];
    comments: AdminComment[];
  };
}

export function mapAdminUser(dto: AdminUserDto): AdminUser {
  return {
    id: dto.id,
    username: dto.username,
    email: dto.email,
    displayName: dto.display_name,
    role: dto.role === 'admin' ? 'admin' : 'standard',
    roleLabel: dto.role_label,
    emailVerified: dto.email_verified,
    isActive: dto.is_active,
    experience: normaliseExperience(dto.experience),
    experienceLabel: dto.experience_label,
    dateJoined: dto.date_joined,
    lastLogin: dto.last_login,
  };
}

export function mapAdminTrailSubmission(dto: AdminTrailDto): AdminTrailSubmission {
  return {
    id: dto.id,
    name: dto.name,
    slug: dto.slug,
    difficulty: dto.difficulty,
    distanceKm: dto.distance_km,
    elevationGainM: dto.elev_gain_m,
    durationMins: dto.duration_mins,
    description: dto.description ?? undefined,
    approvalState: dto.approval_state,
    submittedBy: dto.submitted_by
      ? {
          id: dto.submitted_by.id,
          username: dto.submitted_by.username,
          displayName: dto.submitted_by.display_name,
        }
      : undefined,
    submittedAt: dto.submitted_at,
    totalPoints: dto.total_points,
    segments: dto.segments,
    start: dto.start || null,
  };
}

export function mapAdminComment(dto: AdminCommentDto): AdminComment {
  return {
    id: dto.id,
    trailId: dto.trail,
    trailName: dto.trail_name,
    trailSlug: dto.trail_slug,
    authorId: dto.author,
    authorUsername: dto.author_username,
    authorDisplayName: dto.author_display_name,
    body: dto.body,
    rating: dto.rating,
    isDeleted: dto.is_deleted,
    createdAt: dto.created_at,
    updatedAt: dto.updated_at,
  };
}

export function mapAdminDashboard(dto: AdminDashboardDto): AdminDashboardSummary {
  return {
    stats: {
      totalUsers: dto.stats.total_users,
      newUsersLast7Days: dto.stats.new_users_last_7_days,
      pendingTrailSubmissions: dto.stats.pending_trail_submissions,
      publishedTrails: dto.stats.published_trails,
      activeComments: dto.stats.active_comments,
    },
    permissions: {
      canManageUsers: dto.permissions.can_manage_users,
      canModerateComments: dto.permissions.can_moderate_comments,
      canReviewTrailSubmissions: dto.permissions.can_review_trail_submissions,
    },
    recent: {
      newUsers: dto.recent.new_users.map(mapAdminUser),
      trailSubmissions: dto.recent.trail_submissions.map(mapAdminTrailSubmission),
      comments: dto.recent.comments.map(mapAdminComment),
    },
  };
}

function normaliseExperience(value: string): ExperienceLevel {
  const normalised = (value ?? '').toLowerCase();
  if (normalised === 'intermediate' || normalised === 'advanced') {
    return normalised as ExperienceLevel;
  }
  return 'beginner';
}
