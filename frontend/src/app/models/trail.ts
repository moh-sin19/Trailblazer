export interface LatLng { lat: number; lng: number; }

export interface CommentAuthor {
  id: number;
  username: string;
  display_name: string;
}

export interface Comment {
  id: number;
  trail: number;
  parent: number | null;
  body: string;
  rating: number | null;
  created_at: string;
  updated_at: string;
  edited_at: string | null;
  is_deleted: boolean;
  author: CommentAuthor;
  replies: Comment[];
  helpful_count: number;
  viewer_reaction: 'like' | null;
  is_owner: boolean;
}

export interface Review {
  id: string;
  user: string;
  rating: number;
  comment: string;
  created_at: string;
  conditions?: string[];
}

export interface TrailPhoto {
  id: number;
  trail: number;
  uploader: CommentAuthor;
  image_url: string;
  caption: string;
  is_primary: boolean;
  uploaded_at: string;
}

export interface Trail {
  id: string;
  slug?: string;
  name: string;
  description: string;
  difficulty: 'Easy'|'Moderate'|'Hard';
  city?: string;
  country?: string;
  latitude?: number;
  longitude?: number;
  rating_avg?: number;
  rating_count?: number;
  save_count?: number;
  view_count?: number;
  distance_km: number;
  duration_mins?: number;
  elev_gain_m?: number;
  segments: LatLng[][]; // Array of segments, each segment is an array of points
  start: LatLng;
  categories?: { id: number; name: string; slug: string }[];
  reviews?: Review[];
  viewer_has_completed?: boolean;
  viewer_has_bookmarked?: boolean;
  photos?: TrailPhoto[];
  primary_photo?: TrailPhoto | null;
  submitted_by?: CommentAuthor | null;
}
