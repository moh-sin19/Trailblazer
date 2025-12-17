export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced';

export type UserRole = 'standard' | 'admin';

export interface UserProfile {
  id: number;
  username: string;
  displayName: string;
  bio?: string;
  experience: ExperienceLevel;
  experienceLabel: string;
  role: UserRole;
  roleLabel: string;
  avatarUrl?: string;
  email: string;
  updatedAt: string;
}

export interface ProfileUpdatePayload {
  displayName?: string;
  bio?: string;
  experience?: ExperienceLevel;
  avatarFile?: File | null;
  removeAvatar?: boolean;
}

export interface AuthenticatedUser {
  id: number;
  username: string;
  email: string;
  profile: UserProfile;
}

export interface RegistrationResult {
  user: AuthenticatedUser;
  detail?: string;
}

// Public profile types for badges and stats feature
export interface BadgeProgress {
  current: number;
  threshold: number;
  percent: number;
}

export interface PublicBadge {
  id: number;
  name: string;
  description: string;
  icon: string;
  awarded: boolean;
  awardedAt?: string;
  progress?: BadgeProgress;
}

export interface PublicUserStats {
  trailsCreated: number;
  trailsCompleted: number;
  commentsPosted: number;
  trailsBookmarked: number;
  distanceHikedKm: number;
}

export interface DistanceAnalytics {
  totalKm: number;
  averagePerTrailKm: number;
  longestTrailKm: number;
  completedTrails: number;
}

export interface DifficultyBreakdownEntry {
  difficulty: string;
  count: number;
  distanceKm: number;
}

export interface MonthlyProgressEntry {
  month: string;
  count: number;
  distanceKm: number;
}

export interface PublicTrailAnalytics {
  distance: DistanceAnalytics;
  difficultyBreakdown: DifficultyBreakdownEntry[];
  monthlyProgress: MonthlyProgressEntry[];
}

export interface PublicTrailSummary {
  id: number;
  title: string;
  distanceKm: number;
  difficulty: string;
  createdAt: string;
}

export interface PendingTrailSummary {
  id: number;
  title: string;
  distanceKm: number;
  difficulty: string;
  submittedAt: string;
  approvalState: string;
}

export interface PublicUserProfileView {
  username: string;
  displayName: string;
  avatarUrl?: string;
  homeSuburb?: string;
  stats: PublicUserStats;
  badges: PublicBadge[];
  recentTrails: PublicTrailSummary[];
  pendingTrails: PendingTrailSummary[];
  analytics: PublicTrailAnalytics;
}

// DTO mapping types (from backend API)
export interface PublicUserProfileDto {
  username: string;
  display_name: string;
  avatar_url?: string;
  home_suburb?: string;
  stats: {
    trails_created: number;
    trails_completed: number;
    comments_posted: number;
    trails_bookmarked: number;
    distance_hiked_km: number;
  };
  badges: Array<{
    id: number;
    name: string;
    description: string;
    icon: string;
    awarded: boolean;
    awarded_at?: string;
    progress?: {
      current: number;
      threshold: number;
      percent: number;
    };
  }>;
  recent_trails: Array<{
    id: number;
    title: string;
    distance_km: number;
    difficulty: string;
    created_at: string;
  }>;
  pending_trails: Array<{
    id: number;
    title: string;
    distance_km: number;
    difficulty: string;
    submitted_at: string;
    approval_state: string;
  }>;
  analytics: {
    distance: {
      total_km: number;
      average_per_trail_km: number;
      longest_trail_km: number;
      completed_trails: number;
    };
    difficulty_breakdown: Array<{
      difficulty: string;
      count: number;
      distance_km: number;
    }>;
    monthly_progress: Array<{
      month: string;
      count: number;
      distance_km: number;
    }>;
  };
}

// Helper to map DTO to view model
export function mapPublicProfileDto(dto: PublicUserProfileDto): PublicUserProfileView {
  const analyticsDto = dto.analytics ?? {
    distance: {
      total_km: 0,
      average_per_trail_km: 0,
      longest_trail_km: 0,
      completed_trails: 0,
    },
    difficulty_breakdown: [],
    monthly_progress: [],
  };

  return {
    username: dto.username,
    displayName: dto.display_name,
    avatarUrl: dto.avatar_url,
    homeSuburb: dto.home_suburb,
    stats: {
      trailsCreated: dto.stats.trails_created,
      trailsCompleted: dto.stats.trails_completed,
      commentsPosted: dto.stats.comments_posted,
      trailsBookmarked: dto.stats.trails_bookmarked,
      distanceHikedKm: dto.stats.distance_hiked_km,
    },
    badges: dto.badges.map(b => ({
      id: b.id,
      name: b.name,
      description: b.description,
      icon: b.icon,
      awarded: b.awarded,
      awardedAt: b.awarded_at ?? undefined,
      progress: b.progress ? {
        current: b.progress.current,
        threshold: b.progress.threshold,
        percent: b.progress.percent,
      } : undefined,
    })),
    recentTrails: dto.recent_trails.map(t => ({
      id: t.id,
      title: t.title,
      distanceKm: t.distance_km,
      difficulty: t.difficulty,
      createdAt: t.created_at,
    })),
    pendingTrails: dto.pending_trails.map(t => ({
      id: t.id,
      title: t.title,
      distanceKm: t.distance_km,
      difficulty: t.difficulty,
      submittedAt: t.submitted_at,
      approvalState: t.approval_state,
    })),
    analytics: {
      distance: {
        totalKm: analyticsDto.distance.total_km,
        averagePerTrailKm: analyticsDto.distance.average_per_trail_km,
        longestTrailKm: analyticsDto.distance.longest_trail_km,
        completedTrails: analyticsDto.distance.completed_trails,
      },
      difficultyBreakdown: analyticsDto.difficulty_breakdown.map(entry => ({
        difficulty: entry.difficulty,
        count: entry.count,
        distanceKm: entry.distance_km,
      })),
      monthlyProgress: analyticsDto.monthly_progress.map(entry => ({
        month: entry.month,
        count: entry.count,
        distanceKm: entry.distance_km,
      })),
    },
  };
}
