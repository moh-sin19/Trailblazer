from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Iterable, List, Sequence

import requests
from django.conf import settings
from django.core.cache import cache

LatLngDict = dict[str, float]


class GraphhopperError(Exception):
    """Raised when the Graphhopper API cannot satisfy a request."""


@dataclass(frozen=True)
class GraphhopperConfig:
    base_url: str
    api_key: str
    profile: str = "foot"
    timeout: float = 10.0
    cache_seconds: int = 300


class GraphhopperClient:
    """Small wrapper around the Graphhopper routing API with caching."""

    def __init__(self, session: requests.Session | None = None):
        base_url = getattr(
            settings, "GRAPHHOPPER_BASE_URL", "https://graphhopper.com/api/1"
        )
        api_key = getattr(settings, "GRAPHHOPPER_API_KEY", None)
        profile = getattr(settings, "GRAPHHOPPER_PROFILE", "foot")
        timeout = float(getattr(settings, "GRAPHHOPPER_TIMEOUT", 10.0))
        cache_seconds = int(getattr(settings, "GRAPHHOPPER_CACHE_SECONDS", 300))

        self.config = GraphhopperConfig(
            base_url=base_url.rstrip("/"),
            api_key=api_key or "",
            profile=profile,
            timeout=timeout,
            cache_seconds=cache_seconds,
        )
        self.session = session or requests.Session()

    # ------------------------------------------------------------------
    def is_configured(self) -> bool:
        return bool(self.config.api_key)

    def fit_segments(
        self, segments: Sequence[Sequence[LatLngDict]]
    ) -> List[List[LatLngDict]]:
        return [self.fit_segment(segment) for segment in segments]

    def fit_segment(self, segment: Sequence[LatLngDict]) -> List[LatLngDict]:
        points = [self._normalise_point(p) for p in segment if self._is_valid_point(p)]
        if len(points) < 2:
            return list(points)

        cache_key = self._cache_key(points)
        cached = cache.get(cache_key)
        if cached:
            return cached

        payload = {
            "profile": self.config.profile,
            "points_encoded": False,
            "points": [[point["lng"], point["lat"]] for point in points],
        }

        url = f"{self.config.base_url}/route"
        headers = {"Content-Type": "application/json"}
        params = {"key": self.config.api_key}

        try:
            response = self.session.post(
                url,
                json=payload,
                headers=headers,
                params=params,
                timeout=self.config.timeout,
            )
        except requests.RequestException as exc:
            raise GraphhopperError("Unable to contact Graphhopper API") from exc

        if response.status_code >= 400:
            detail = self._extract_error(response)
            raise GraphhopperError(detail)

        try:
            data = response.json()
        except ValueError as exc:
            raise GraphhopperError("Invalid response from Graphhopper API") from exc

        try:
            path = data["paths"][0]
            coordinates = path["points"]["coordinates"]
        except (KeyError, IndexError, TypeError) as exc:
            raise GraphhopperError("Malformed Graphhopper response payload") from exc

        fitted = [
            {"lat": float(coord[1]), "lng": float(coord[0])} for coord in coordinates
        ]
        cache.set(cache_key, fitted, self.config.cache_seconds)
        return fitted

    # ------------------------------------------------------------------
    @staticmethod
    def _normalise_point(point: LatLngDict) -> LatLngDict:
        return {"lat": float(point["lat"]), "lng": float(point["lng"])}

    @staticmethod
    def _is_valid_point(point: LatLngDict) -> bool:
        try:
            lat = float(point["lat"])
            lng = float(point["lng"])
        except (KeyError, TypeError, ValueError):
            return False
        return -90.0 <= lat <= 90.0 and -180.0 <= lng <= 180.0

    @staticmethod
    def _cache_key(points: Iterable[LatLngDict]) -> str:
        payload = json.dumps(points, sort_keys=True)
        digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
        return f"graphhopper:fit:{digest}"

    @staticmethod
    def _extract_error(response: requests.Response) -> str:
        try:
            body = response.json()
        except ValueError:
            return f"Graphhopper responded with status {response.status_code}."
        if isinstance(body, dict):
            message = body.get("message")
            if message:
                return f"Graphhopper error: {message}"
        return f"Graphhopper responded with status {response.status_code}."


__all__ = ["GraphhopperClient", "GraphhopperError"]
