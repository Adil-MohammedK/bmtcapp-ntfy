"""Small client for the BMTC tracker HTTP API."""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError


class BmtcApiError(Exception):
    """Raised when the tracker service cannot provide a snapshot."""


class BmtcApi:
    """Fetch transit data from a running bmtc-live-tracker instance."""

    def __init__(self, session, base_url: str) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")

    async def search_stops(self, query: str) -> list[dict[str, str]]:
        try:
            async with self._session.get(
                f"{self._base_url}/api/stops",
                params={"q": query},
                timeout=20,
            ) as response:
                if response.status != 200:
                    raise BmtcApiError(f"Tracker returned HTTP {response.status}")
                data = await response.json()
        except (ClientError, TimeoutError, ValueError) as err:
            raise BmtcApiError("Cannot reach the BMTC tracker service") from err
        if not isinstance(data, list) or not all(
            isinstance(item, dict)
            and isinstance(item.get("stationId"), str)
            and isinstance(item.get("stationName"), str)
            for item in data
        ):
            raise BmtcApiError("Tracker returned invalid stop search results")
        return data

    async def stop_snapshot(self, stop_id: str, route: str = "") -> dict[str, Any]:
        try:
            async with self._session.get(
                f"{self._base_url}/api/stop",
                params={"stop": stop_id, "route": route},
                timeout=20,
            ) as response:
                if response.status != 200:
                    raise BmtcApiError(f"Tracker returned HTTP {response.status}")
                data = await response.json()
        except (ClientError, TimeoutError, ValueError) as err:
            raise BmtcApiError("Cannot reach the BMTC tracker service") from err
        if not isinstance(data, dict):
            raise BmtcApiError("Tracker returned an invalid snapshot")
        return data
