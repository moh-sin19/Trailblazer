from __future__ import annotations

import math
from dataclasses import dataclass
from typing import List, Sequence

from django.contrib.gis.geos import LineString, MultiLineString

LatLngDict = dict[str, float]

# Align with GPX bootstrap constraints to avoid storing overly dense polylines.
MAX_SIMPLIFIED_POINTS = 500


@dataclass(frozen=True)
class PreparedRoute:
    segments: List[List[LatLngDict]]
    geometry: MultiLineString | None
    total_points: int
    total_distance_km: float
    start_point: LatLngDict | None


def prepare_route(
    raw_segments: Sequence[Sequence[LatLngDict]],
    *,
    max_points: int = MAX_SIMPLIFIED_POINTS,
) -> PreparedRoute:
    """
    Clean, simplify, and convert raw route segments into the structures expected by the Trail model.
    """
    cleaned_segments = [_normalise_segment(segment) for segment in raw_segments]
    filtered_segments = [segment for segment in cleaned_segments if len(segment) >= 2]

    if not filtered_segments:
        raise ValueError("At least one segment with two or more points is required.")

    simplified = simplify_segments(filtered_segments, max_points=max_points)
    total_points = count_points(simplified)
    total_distance = compute_total_distance_km(filtered_segments)
    start_point = first_point(simplified)
    geometry = build_geometry(simplified)

    return PreparedRoute(
        segments=simplified,
        geometry=geometry,
        total_points=total_points,
        total_distance_km=total_distance,
        start_point=start_point,
    )


def simplify_segment(
    segment: Sequence[LatLngDict],
    *,
    max_points: int = MAX_SIMPLIFIED_POINTS,
) -> List[LatLngDict]:
    if len(segment) <= max_points:
        return list(segment)
    step = max(1, math.ceil(len(segment) / max_points))
    reduced = list(segment[::step])
    if reduced[-1] != segment[-1]:
        reduced.append(segment[-1])
    return reduced


def simplify_segments(
    segments: Sequence[Sequence[LatLngDict]],
    *,
    max_points: int = MAX_SIMPLIFIED_POINTS,
) -> List[List[LatLngDict]]:
    return [
        simplify_segment(segment, max_points=max_points)
        for segment in segments
        if len(segment) >= 2
    ]


def build_geometry(segments: Sequence[Sequence[LatLngDict]]) -> MultiLineString | None:
    if not segments:
        return None

    linestrings: list[LineString] = []
    for segment in segments:
        if len(segment) < 2:
            continue
        coords = [(point["lng"], point["lat"]) for point in segment]
        linestrings.append(LineString(coords, srid=4326))

    if not linestrings:
        return None

    return MultiLineString(linestrings, srid=4326)


def compute_total_distance_km(segments: Sequence[Sequence[LatLngDict]]) -> float:
    return sum(
        haversine_km(segment[index - 1], segment[index])
        for segment in segments
        for index in range(1, len(segment))
    )


def count_points(segments: Sequence[Sequence[LatLngDict]]) -> int:
    return sum(len(segment) for segment in segments)


def first_point(segments: Sequence[Sequence[LatLngDict]]) -> LatLngDict | None:
    for segment in segments:
        if segment:
            return segment[0]
    return None


def haversine_km(a: LatLngDict, b: LatLngDict) -> float:
    radius = 6371.0
    lat1 = math.radians(a["lat"])
    lat2 = math.radians(b["lat"])
    dlat = lat2 - lat1
    dlon = math.radians(b["lng"] - a["lng"])
    sin_dlat = math.sin(dlat / 2) ** 2
    sin_dlon = math.sin(dlon / 2) ** 2
    h = sin_dlat + math.cos(lat1) * math.cos(lat2) * sin_dlon
    return 2 * radius * math.asin(min(1.0, math.sqrt(h)))


def _normalise_segment(segment: Sequence[LatLngDict]) -> List[LatLngDict]:
    normalised: list[LatLngDict] = []
    for point in segment:
        try:
            lat = float(point["lat"])
            lng = float(point["lng"])
        except (KeyError, TypeError, ValueError):
            continue
        if -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0:
            normalised.append({"lat": lat, "lng": lng})
    return normalised


__all__ = [
    "MAX_SIMPLIFIED_POINTS",
    "PreparedRoute",
    "prepare_route",
    "simplify_segment",
    "simplify_segments",
    "build_geometry",
    "compute_total_distance_km",
    "count_points",
    "first_point",
    "haversine_km",
]
