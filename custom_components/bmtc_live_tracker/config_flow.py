"""Stop-first configuration flow for BMTC Live Tracker."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import TextSelector

from .api import BmtcApi, BmtcApiError
from .const import CONF_ROUTE, CONF_STOP_ID, CONF_TRACKER_URL, DEFAULT_TRACKER_URL, DOMAIN


class BmtcLiveTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure every live bus at a stop, optionally narrowed to one route."""

    VERSION = 2

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors = {}
        if user_input is not None:
            data = {
                CONF_TRACKER_URL: user_input[CONF_TRACKER_URL].rstrip("/"),
                CONF_STOP_ID: user_input[CONF_STOP_ID].strip(),
                CONF_ROUTE: user_input.get(CONF_ROUTE, "").strip(),
            }
            try:
                await BmtcApi(async_get_clientsession(self.hass), data[CONF_TRACKER_URL]).stop_snapshot(data[CONF_STOP_ID], data[CONF_ROUTE])
            except BmtcApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(f"{data[CONF_STOP_ID]}:{data[CONF_ROUTE] or 'all'}")
                self._abort_if_unique_id_configured()
                title = f"Stop {data[CONF_STOP_ID]}" + (f" · {data[CONF_ROUTE]}" if data[CONF_ROUTE] else " · all routes")
                return self.async_create_entry(title=title, data=data)
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_TRACKER_URL, default=DEFAULT_TRACKER_URL): TextSelector(),
                vol.Required(CONF_STOP_ID, default="21945"): TextSelector(),
                vol.Optional(CONF_ROUTE, default=""): TextSelector(),
            }),
            errors=errors,
        )
