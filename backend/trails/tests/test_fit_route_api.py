from __future__ import annotations

from unittest import mock

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from trails.services.graphhopper import GraphhopperError

User = get_user_model()


@override_settings(GRAPHHOPPER_API_KEY="test-key")
class FitRouteAPITests(APITestCase):
    def setUp(self) -> None:
        self.user = User.objects.create_user(
            username="route-user",
            email="route@example.com",
            password="Password123",
        )
        self.client.force_authenticate(self.user)
        self.url = reverse("trail-submission-fit-route")
        self.payload = {
            "segments": [
                [
                    {"lat": -33.9, "lng": 151.0},
                    {"lat": -33.91, "lng": 151.02},
                ]
            ]
        }

    @mock.patch("trails.views.submissions.GraphhopperClient")
    def test_successful_fit_route(self, graphhopper_cls):
        instance = graphhopper_cls.return_value
        instance.is_configured.return_value = True
        instance.fit_segments.return_value = [
            [
                {"lat": -33.9, "lng": 151.0},
                {"lat": -33.905, "lng": 151.015},
                {"lat": -33.91, "lng": 151.02},
            ]
        ]

        response = self.client.post(self.url, self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()
        self.assertEqual(body["total_points"], 3)
        self.assertAlmostEqual(body["total_distance_km"], 2, delta=2)
        self.assertEqual(len(body["segments"][0]), 3)
        instance.fit_segments.assert_called_once()

    @mock.patch("trails.views.submissions.GraphhopperClient")
    def test_returns_503_when_not_configured(self, graphhopper_cls):
        instance = graphhopper_cls.return_value
        instance.is_configured.return_value = False

        response = self.client.post(self.url, self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_503_SERVICE_UNAVAILABLE)
        graphhopper_cls.return_value.fit_segments.assert_not_called()

    @mock.patch("trails.views.submissions.GraphhopperClient")
    def test_returns_502_on_graphhopper_error(self, graphhopper_cls):
        instance = graphhopper_cls.return_value
        instance.is_configured.return_value = True
        instance.fit_segments.side_effect = GraphhopperError("graphhopper unhappy")

        response = self.client.post(self.url, self.payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_502_BAD_GATEWAY)

    def test_requires_authentication(self):
        self.client.force_authenticate(user=None)
        response = self.client.post(self.url, self.payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_validates_input_segments(self):
        response = self.client.post(self.url, {"segments": [[]]}, format="json")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
