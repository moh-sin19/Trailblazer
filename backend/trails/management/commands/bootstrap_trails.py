from __future__ import annotations

from pathlib import Path
import xml.etree.ElementTree as ET

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils.text import slugify

from trails.models import Trail, TrailCategory
from trails.services.route_processing import (
    MAX_SIMPLIFIED_POINTS,
    build_geometry,
    compute_total_distance_km,
    first_point,
    simplify_segments,
)
from trails.services.geolookup import reverse_geocode

GPX_NAMESPACE = {"gpx": "http://www.topografix.com/GPX/1/1"}


def parse_gpx_segments(path: Path) -> list[list[dict[str, float]]]:
    """Parse GPX file and return list of track segments.

    Returns a list of segments, where each segment is a list of {lat, lng} points.
    Respects GPX track (<trk>) and track segment (<trkseg>) boundaries.
    """
    tree = ET.parse(path)
    root = tree.getroot()
    segments: list[list[dict[str, float]]] = []

    # Iterate through all tracks
    for track in root.findall(".//gpx:trk", GPX_NAMESPACE):
        # Iterate through all segments within each track
        for segment in track.findall("gpx:trkseg", GPX_NAMESPACE):
            points: list[dict[str, float]] = []
            for point in segment.findall("gpx:trkpt", GPX_NAMESPACE):
                lat = point.attrib.get("lat")
                lng = point.attrib.get("lon")
                if lat is None or lng is None:
                    continue
                points.append({"lat": float(lat), "lng": float(lng)})

            # Only add segments with at least 2 points
            if len(points) >= 2:
                segments.append(points)

    return segments


class Command(BaseCommand):
    help = "Load sample trail data from bundled GPX files"

    def _build_specs_from_files(
        self, gpx_files: list[str], base_path: Path
    ) -> list[dict]:
        """Build trail specifications from provided GPX file paths."""
        specs = []
        for file_path in gpx_files:
            path = Path(file_path)
            # If the path is relative, resolve it against base_path
            if not path.is_absolute():
                full_path = base_path / path
            else:
                full_path = path

            if not full_path.exists():
                self.stderr.write(
                    self.style.WARNING(f"GPX file not found: {full_path}")
                )
                continue

            # Extract name from filename (without extension) and create slug
            name = full_path.stem.replace("-", " ").replace("_", " ").title()
            slug = slugify(name)

            # Skip if trail with this slug already exists (avoids reverse geocoding)
            if Trail.objects.filter(slug=slug).exists():
                self.stdout.write(
                    self.style.WARNING(f"Trail with slug '{slug}' already exists; skipping {path.name}")
                )
                continue

            # Parse GPX to get the starting coordinates for geocoding
            try:
                raw_segments = parse_gpx_segments(full_path)
                if not raw_segments or not raw_segments[0]:
                    self.stderr.write(
                        self.style.WARNING(
                            f"No valid segments in {path.name}; skipping"
                        )
                    )
                    continue

                # Get the first point to use for reverse geocoding
                first_point_coords = raw_segments[0][0]
                lat = first_point_coords["lat"]
                lng = first_point_coords["lng"]

                # Perform reverse geocoding
                self.stdout.write(f"Geocoding {path.name}...")
                geo_data = reverse_geocode(lat, lng)

            except Exception as e:
                self.stderr.write(
                    self.style.WARNING(f"Error processing {path.name}: {e}")
                )
                continue

            # Create a spec with geocoded data
            specs.append({
                "file": path.name if not path.is_absolute() else str(full_path),
                "name": name,
                "slug": slug,
                "city": geo_data["city"],
                "country": geo_data["country"],
                "description": f"Trail imported from {path.name}",
                "rating_avg": 0.0,
                "rating_count": 0,
                "categories": [],
            })

        return specs

    def add_arguments(self, parser):
        parser.add_argument(
            "--base-path",
            default=None,
            help="Optional path containing GPX files. Defaults to the bundled trails/data/gpx directory.",
        )

    def handle(self, *args, **options):
        base_path_option = options.get("base_path")

        if base_path_option:
            base_path = Path(base_path_option).resolve()
        else:
            base_path = Path(__file__).resolve().parents[2] / "data" / "gpx"

        if not base_path.exists():
            self.stderr.write(self.style.ERROR(f"GPX directory not found: {base_path}"))
            return

        # Auto-discover all GPX files in the base_path directory
        gpx_file_paths = list(base_path.glob("*.gpx"))
        if not gpx_file_paths:
            self.stderr.write(self.style.WARNING(f"No GPX files found in {base_path}"))
            return

        self.stdout.write(
            self.style.SUCCESS(f"Found {len(gpx_file_paths)} GPX files in {base_path}")
        )

        # Convert Path objects to filenames for processing
        gpx_file_names = [path.name for path in gpx_file_paths]
        specs_to_process = self._build_specs_from_files(gpx_file_names, base_path)

        created = 0
        updated = 0

        with transaction.atomic():
            for spec in specs_to_process:
                # Handle both relative and absolute file paths
                file_spec = spec["file"]
                if Path(file_spec).is_absolute():
                    gpx_file = Path(file_spec)
                else:
                    gpx_file = base_path / file_spec

                if not gpx_file.exists():
                    self.stderr.write(
                        self.style.WARNING(f"Skipping missing GPX file: {gpx_file}")
                    )
                    continue

                raw_segments = parse_gpx_segments(gpx_file)
                if not raw_segments:
                    self.stderr.write(
                        self.style.WARNING(
                            f"No valid track segments in {gpx_file.name}; skipping"
                        )
                    )
                    continue

                # Simplify each segment independently
                simplified_segments = simplify_segments(
                    raw_segments, max_points=MAX_SIMPLIFIED_POINTS
                )

                distance = compute_total_distance_km(raw_segments)
                duration_mins = max(60, int(distance / 4.0 * 60))  # avg 4 km/h pace

                # Use the first point of the first segment as the trail marker location
                start = first_point(simplified_segments)
                if not start:
                    self.stderr.write(
                        self.style.WARNING(
                            f"No valid simplified segments in {gpx_file.name}; skipping"
                        )
                    )
                    continue
                geometry = build_geometry(simplified_segments)

                if distance < 5:
                    difficulty = "easy"
                elif 5 < distance < 10:
                    difficulty = "moderate"
                else:
                    difficulty = "hard"

                defaults = {
                    "name": spec["name"],
                    "description": spec["description"],
                    "difficulty": difficulty,
                    "distance_km": round(distance, 2),
                    "duration_mins": duration_mins,
                    "latitude": start["lat"],
                    "longitude": start["lng"],
                    "city": spec["city"],
                    "country": spec["country"],
                    "rating_avg": spec["rating_avg"],
                    "rating_count": spec["rating_count"],
                    "route_path": simplified_segments,  # Now an array of segments
                    "route_geometry": geometry,
                    "approval_state": "approved",
                }

                trail, created_flag = Trail.objects.update_or_create(
                    slug=spec["slug"], defaults=defaults
                )

                category_ids = []
                for label in spec.get("categories", []):
                    slug = slugify(label)
                    category, _ = TrailCategory.objects.get_or_create(
                        slug=slug, defaults={"name": label}
                    )
                    category_ids.append(category.id)
                if category_ids:
                    trail.categories.set(category_ids)

                if created_flag:
                    created += 1
                else:
                    updated += 1

        self.stdout.write(
            self.style.SUCCESS(
                f"Bootstrap complete: {created} created, {updated} updated from GPX"
            )
        )
