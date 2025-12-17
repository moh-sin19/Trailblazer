import { LatLng, TrailPhoto } from './trail';

export type TrailSubmissionDifficulty = 'Easy' | 'Moderate' | 'Hard';
export type TrailSubmissionStatus = 'pending' | 'reviewed' | 'approved' | 'rejected';

export interface TrailSubmissionPayload {
  name: string;
  difficulty: TrailSubmissionDifficulty;
  distance_km: number;
  elev_gain_m: number;
  expected_time_h: number;
  description: string;
  start: LatLng;
  segments: LatLng[][];
}

export interface TrailSubmissionResponse {
  id: number;
  name: string;
  difficulty: TrailSubmissionDifficulty;
  distance_km: number;
  elev_gain_m: number;
  expected_time_h: number;
  description: string;
  start: LatLng;
  segments: LatLng[][];
  total_points: number;
  status: TrailSubmissionStatus;
  submitted_at: string | null;
  photos?: TrailPhoto[];
}
