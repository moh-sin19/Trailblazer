from __future__ import annotations

from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings

from trails.services.graphhopper import GraphhopperClient, GraphhopperError


@override_settings(
    GRAPHHOPPER_API_KEY="test-key",
    GRAPHHOPPER_BASE_URL="https://mock-graphhopper.local/api/1",
    GRAPHHOPPER_CACHE_SECONDS=60,
)
class GraphhopperClientTests(TestCase):
    def setUp(self) -> None:
        cache.clear()

    def test_fit_segment_uses_cache(self):
        response_payload = {
            "paths": [
                {
                    "points": {
                        "coordinates": [
                            [151.0, -33.9],
                            [151.05, -33.95],
                        ]
                    }
                }
            ]
        }

        session = mock.Mock()
        session.post.return_value = mock.Mock(
            status_code=200,
            json=mock.Mock(return_value=response_payload),
        )

        client = GraphhopperClient(session=session)
        self.assertTrue(client.is_configured())

        segment = [
            {"lat": -33.9, "lng": 151.0},
            {"lat": -33.95, "lng": 151.05},
        ]

        first = client.fit_segment(segment)
        second = client.fit_segment(segment)

        self.assertEqual(session.post.call_count, 1)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 2)

    def test_fit_segment_raises_on_http_error(self):
        session = mock.Mock()
        session.post.return_value = mock.Mock(
            status_code=500, json=mock.Mock(return_value={"message": "api down"})
        )

        client = GraphhopperClient(session=session)
        segment = [
            {"lat": -33.9, "lng": 151.0},
            {"lat": -33.95, "lng": 151.05},
        ]

        with self.assertRaises(GraphhopperError) as exc:
            client.fit_segment(segment)

        self.assertIn("Graphhopper", str(exc.exception))

    def test_fit_segment_returns_original_when_insufficient_points(self):
        session = mock.Mock()
        client = GraphhopperClient(session=session)
        result = client.fit_segment([{"lat": -33.9, "lng": 151.0}])
        self.assertEqual(result, [{"lat": -33.9, "lng": 151.0}])
        session.post.assert_not_called()
