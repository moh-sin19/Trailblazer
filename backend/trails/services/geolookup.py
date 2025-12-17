import time
import requests


def reverse_geocode(lat: float, lng: float) -> dict[str, str]:
    """Use OpenStreetMap Nominatim API to reverse geocode coordinates.

    Returns a dict with 'city' and 'country' keys.
    Includes rate limiting to respect Nominatim usage policy (max 1 request per second).
    """
    url = "https://nominatim.openstreetmap.org/reverse"
    params = {
        "lat": lat,
        "lon": lng,
        "format": "json",
        "addressdetails": 1,
    }
    headers = {
        "User-Agent": "TrailBootstrapScript/1.0",  # Nominatim requires a User-Agent
    }

    try:
        # Rate limiting: wait 1 second between requests (Nominatim policy)
        time.sleep(1)

        response = requests.get(url, params=params, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        # Check if we got an error response
        if "error" in data:
            return {"city": "", "country": ""}

        address = data.get("address", {})

        # Try to extract city from various possible fields (in order of preference)
        city = (
            address.get("city")
            or address.get("town")
            or address.get("village")
            or address.get("municipality")
            or address.get("county")
            or ""
        )

        country = address.get("country", "")

        return {"city": city, "country": country}

    except requests.exceptions.RequestException:
        # Network or HTTP errors
        return {"city": "", "country": ""}
    except (KeyError, ValueError):
        # JSON parsing errors
        return {"city": "", "country": ""}
    except Exception:
        # Any other unexpected errors
        return {"city": "", "country": ""}
