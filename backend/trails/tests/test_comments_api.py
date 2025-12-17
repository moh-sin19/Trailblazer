from django.contrib.auth import get_user_model
from django.urls import reverse
from rest_framework import status
from rest_framework.test import APITestCase

from trails.models import Comment, Trail


class CommentApiTests(APITestCase):
    def setUp(self) -> None:
        User = get_user_model()
        self.user = User.objects.create_user(username="alice", password="password")
        self.other = User.objects.create_user(username="bob", password="password")
        self.trail = Trail.objects.create(
            slug="coastal-walk",
            name="Coastal Walk",
            difficulty="moderate",
            distance_km=5.2,
            duration_mins=120,
            elev_gain_m=80,
            approval_state="approved",
        )

    def authenticate(self, user):
        self.client.force_authenticate(user=user)

    def test_create_comment_with_rating_updates_stats(self):
        self.authenticate(self.user)
        url = reverse("trail-list-comments", args=[self.trail.slug])
        payload = {"body": "Stunning views!", "rating": 5}

        response = self.client.post(url, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.trail.refresh_from_db()
        self.assertEqual(self.trail.comment_count, 1)
        self.assertEqual(self.trail.rating_count, 1)
        self.assertEqual(self.trail.rating_sum, 5)
        comment = Comment.objects.get(pk=response.data["id"])
        self.assertEqual(comment.author, self.user)
        self.assertEqual(comment.rating, 5)

    def test_second_rating_from_same_user_returns_conflict(self):
        self.authenticate(self.user)
        url = reverse("trail-list-comments", args=[self.trail.slug])
        self.client.post(url, {"body": "First", "rating": 4}, format="json")

        response = self.client.post(url, {"body": "Another", "rating": 3}, format="json")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_update_comment_rating_adjusts_aggregates(self):
        self.authenticate(self.user)
        create_url = reverse("trail-list-comments", args=[self.trail.slug])
        response = self.client.post(create_url, {"body": "Great", "rating": 2}, format="json")
        comment_id = response.data["id"]
        update_url = reverse("comment-detail", args=[comment_id])

        patch_response = self.client.patch(update_url, {"rating": 4}, format="json")

        self.assertEqual(patch_response.status_code, status.HTTP_200_OK)
        self.trail.refresh_from_db()
        self.assertEqual(self.trail.rating_sum, 4)
        self.assertEqual(self.trail.rating_count, 1)

    def test_soft_delete_comment(self):
        self.authenticate(self.user)
        create_url = reverse("trail-list-comments", args=[self.trail.slug])
        response = self.client.post(create_url, {"body": "Great", "rating": 3}, format="json")
        comment_id = response.data["id"]
        delete_url = reverse("comment-detail", args=[comment_id])

        delete_response = self.client.delete(delete_url)

        self.assertEqual(delete_response.status_code, status.HTTP_204_NO_CONTENT)
        self.trail.refresh_from_db()
        self.assertEqual(self.trail.comment_count, 0)
        self.assertEqual(self.trail.rating_count, 0)
        self.assertEqual(self.trail.rating_sum, 0)
        comment = Comment.objects.get(pk=comment_id)
        self.assertTrue(comment.is_deleted)

    def test_toggle_reaction(self):
        self.authenticate(self.user)
        create_url = reverse("trail-list-comments", args=[self.trail.slug])
        response = self.client.post(create_url, {"body": "Great", "rating": 4}, format="json")
        comment_id = response.data["id"]
        reaction_url = reverse("comment-toggle-reaction", args=[comment_id])

        first = self.client.post(reaction_url, {"kind": "like"}, format="json")
        self.assertEqual(first.status_code, status.HTTP_200_OK)
        self.assertEqual(first.data["viewer_reaction"], "like")
        self.assertEqual(first.data["helpful_count"], 1)

        second = self.client.post(reaction_url, {"kind": "like"}, format="json")
        self.assertEqual(second.status_code, status.HTTP_200_OK)
        self.assertIsNone(second.data["viewer_reaction"])
        self.assertEqual(second.data["helpful_count"], 0)

    def test_list_comments_sorting(self):
        self.authenticate(self.user)
        list_url = reverse("trail-list-comments", args=[self.trail.slug])
        comment_one = self.client.post(list_url, {"body": "No rating"}, format="json")
        self.client.force_authenticate(user=self.other)
        comment_two = self.client.post(list_url, {"body": "Has rating", "rating": 5}, format="json")

        response = self.client.get(list_url + "?sort=helpful")
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        ids = [item["id"] for item in response.data["results"]]
        self.assertEqual(ids, [comment_two.data["id"], comment_one.data["id"]])

        newest = self.client.get(list_url + "?sort=newest")
        self.assertEqual(newest.status_code, status.HTTP_200_OK)
        newest_ids = [item["id"] for item in newest.data["results"]]
        self.assertEqual(newest_ids[0], comment_two.data["id"])
