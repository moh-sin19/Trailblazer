from django.urls import path, include
from rest_framework.routers import DefaultRouter
from .views import CommentViewSet, TrailSubmissionViewSet, TrailViewSet

router = DefaultRouter()
router.register(r"trails", TrailViewSet, basename="trail")
router.register(r"comments", CommentViewSet, basename="comment")
router.register(r"trail-submissions", TrailSubmissionViewSet, basename="trail-submission")

urlpatterns = [path("", include(router.urls))]
