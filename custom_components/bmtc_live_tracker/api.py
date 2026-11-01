"""Small client for the BMTC tracker HTTP API."""

from __future__ import annotations

from typing import Any

from aiohttp import ClientError


class BmtcApiError(Exception):
    """Raised when the tracker service cannot provide a snapshot."""


class BmtcApi:
    """Fetch stop-first snapshots from a running bmtc-live-tracker instance."""

    def __init__(self, session, base_url: str) -> None:
        self._session = session
        self._base_url = base_url.rstrip("/")

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
        except (ClientError, TimeoutError) as err:
            raise BmtcApiError("Cannot reach the BMTC tracker service") from err
        if not isinstance(data, dict):
            raise BmtcApiError("Tracker returned an invalid snapshot")
        return data
