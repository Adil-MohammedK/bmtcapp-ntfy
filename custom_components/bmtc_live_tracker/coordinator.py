"""Coordinator for periodic BMTC snapshots."""

from __future__ import annotations

from datetime import timedelta
import logging

from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import BmtcApi, BmtcApiError
from .const import CONF_ROUTE, CONF_SCAN_INTERVAL, CONF_STOP_ID, DOMAIN


class BmtcDataUpdateCoordinator(DataUpdateCoordinator):
    """Keep all buses serving the configured stop on one snapshot."""

    def __init__(self, hass, entry, api: BmtcApi) -> None:
        super().__init__(
            hass,
            logger=logging.getLogger(__name__),
            name=DOMAIN,
            update_interval=timedelta(seconds=entry.options.get(CONF_SCAN_INTERVAL, 60)),
        )
        self.entry = entry
        self.api = api

    async def _async_update_data(self):
        try:
            return await self.api.stop_snapshot(self.entry.data[CONF_STOP_ID], self.entry.data.get(CONF_ROUTE, ""))
        except BmtcApiError as err:
            raise UpdateFailed(str(err)) from err
