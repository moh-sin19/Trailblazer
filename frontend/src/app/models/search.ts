import { Trail } from './trail';

export interface TrailSearchParams {
  q?: string;
  difficulty?: 'easy' | 'moderate' | 'hard' | 'Easy' | 'Moderate' | 'Hard';
  distance_km_min?: number;
  distance_km_max?: number;
  category_ids?: number[];
  city?: string;
  country?: string;
  page?: number;
  page_size?: number;
}

export interface TrailSearchResponse {
  results: Trail[];
  total_count: number;
  next?: string | null;
  previous?: string | null;
}

export interface MapFeaturePathPoint {
  lat: number;
  lng: number;
}

export interface MapFeature {
  id: string;
  slug?: string;
  name: string;
  lat: number;
  lng: number;
  is_cluster: boolean;
  cluster_count: number;
  difficulty?: string;
  distance_km?: number;
  segments?: MapFeaturePathPoint[][];  // Array of segments (each segment is an array of points)
  start?: MapFeaturePathPoint | null;
}

export interface MapBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

export interface MapResponse {
  features: MapFeature[];
  map_bounds: MapBounds;
  total_in_bbox: number;
}

export interface MapQueryParams extends TrailSearchParams {
  bbox: string;
  zoom: number;
  cluster?: boolean;
  max_markers?: number;
}

export interface TrailCategoryOption {
  id: number;
  name: string;
  slug: string;
}

export interface FilterOptions {
  difficulties: { value: 'easy' | 'moderate' | 'hard'; label: string }[];
  distance_range: { min: number; max: number };
  categories: TrailCategoryOption[];
  cities: string[];
  countries: string[];
}
