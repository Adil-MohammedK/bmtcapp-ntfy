"""Stop-first configuration flow for BMTC Live Tracker."""

from __future__ import annotations

from typing import Any

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
)

from .api import BmtcApi, BmtcApiError
from .const import (
    CONF_ROUTE,
    CONF_SCAN_INTERVAL,
    CONF_STOP_ID,
    CONF_STOP_QUERY,
    CONF_TRACKER_URL,
    DEFAULT_SCAN_INTERVAL,
    DEFAULT_TRACKER_URL,
    DOMAIN,
)


class BmtcLiveTrackerConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure live buses at a selected stop."""

    VERSION = 2

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors = {}
        if user_input is not None:
            self._tracker_url = user_input[CONF_TRACKER_URL].rstrip("/")
            stop_query = user_input[CONF_STOP_QUERY].strip()
            if not stop_query:
                errors["base"] = "no_stops"
            else:
                try:
                    results = await self._api().search_stops(stop_query)
                except BmtcApiError:
                    errors["base"] = "cannot_connect"
                else:
                    self._stop_results = list(
                        {item["stationId"]: item for item in results}.values()
                    )
                    if not self._stop_results:
                        errors["base"] = "no_stops"
                    else:
                        return await self.async_step_select_stop()
        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({
                vol.Required(CONF_TRACKER_URL, default=DEFAULT_TRACKER_URL): TextSelector(),
                vol.Required(CONF_STOP_QUERY): TextSelector(),
            }),
            errors=errors,
        )

    async def async_step_select_stop(self, user_input: dict[str, Any] | None = None):
        errors = {}
        if user_input is not None:
            stop_id = user_input[CONF_STOP_ID]
            route = user_input.get(CONF_ROUTE, "").strip()
            try:
                await self._api().stop_snapshot(stop_id, route)
            except BmtcApiError:
                errors["base"] = "cannot_connect"
            else:
                await self.async_set_unique_id(f"{stop_id}:{route or 'all'}")
                self._abort_if_unique_id_configured()
                stop = next(
                    (item for item in self._stop_results if item["stationId"] == stop_id),
                    None,
                )
                title = stop["stationName"] if stop else f"Stop {stop_id}"
                if route:
                    title = f"{title} · {route}"
                data = {
                    CONF_TRACKER_URL: self._tracker_url,
                    CONF_STOP_ID: stop_id,
                    CONF_ROUTE: route,
                    CONF_SCAN_INTERVAL: DEFAULT_SCAN_INTERVAL,
                }
                return self.async_create_entry(title=title, data=data)

        options = [
            {"value": item["stationId"], "label": f'{item["stationName"]} ({item["stationId"]})'}
            for item in self._stop_results
        ]
        return self.async_show_form(
            step_id="select_stop",
            data_schema=vol.Schema({
                vol.Required(CONF_STOP_ID): SelectSelector(
                    SelectSelectorConfig(options=options)
                ),
                vol.Optional(CONF_ROUTE, default=""): TextSelector(),
            }),
            errors=errors,
        )

    def _api(self) -> BmtcApi:
        return BmtcApi(
            async_get_clientsession(self.hass),
            self._tracker_url,
        )

    @staticmethod
    def async_get_options_flow(config_entry):
        return BmtcLiveTrackerOptionsFlow(config_entry)


class BmtcLiveTrackerOptionsFlow(config_entries.OptionsFlow):
    """Search for and select the stop and route used by this entry."""

    def __init__(self, config_entry) -> None:
        self._config_entry = config_entry

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        errors = {}
        if user_input is not None:
            stop_query = user_input[CONF_STOP_QUERY].strip()
            self._route = user_input.get(CONF_ROUTE, "").strip()
            if not stop_query:
                errors["base"] = "no_stops"
            else:
                try:
                    results = await BmtcApi(
                        async_get_clientsession(self.hass),
                        self._config_entry.data[CONF_TRACKER_URL],
                    ).search_stops(stop_query)
                except BmtcApiError:
                    errors["base"] = "cannot_connect"
                else:
                    self._stop_results = list(
                        {item["stationId"]: item for item in results}.values()
                    )
                    if not self._stop_results:
                        errors["base"] = "no_stops"
                    else:
                        return await self.async_step_select_stop()

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema({
                vol.Required(
                    CONF_STOP_QUERY,
                    default=str(self._config_entry.options.get(
                        CONF_STOP_ID, self._config_entry.data[CONF_STOP_ID]
                    )),
                ): TextSelector(),
                vol.Optional(
                    CONF_ROUTE,
                    default=self._config_entry.options.get(
                        CONF_ROUTE, self._config_entry.data.get(CONF_ROUTE, "")
                    ),
                ): TextSelector(),
            }),
            errors=errors,
        )

    async def async_step_select_stop(self, user_input: dict[str, Any] | None = None):
        errors = {}
        if user_input is not None:
            stop_id = user_input[CONF_STOP_ID]
            try:
                await BmtcApi(
                    async_get_clientsession(self.hass),
                    self._config_entry.data[CONF_TRACKER_URL],
                ).stop_snapshot(stop_id, self._route)
            except BmtcApiError:
                errors["base"] = "cannot_connect"
            else:
                return self.async_create_entry(
                    title="",
                    data={
                        CONF_STOP_ID: stop_id,
                        CONF_ROUTE: self._route,
                        CONF_SCAN_INTERVAL: self._config_entry.options.get(
                            CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL
                        ),
                    },
                )

        options = [
            {"value": item["stationId"], "label": f'{item["stationName"]} ({item["stationId"]})'}
            for item in self._stop_results
        ]
        return self.async_show_form(
            step_id="select_stop",
            data_schema=vol.Schema({
                vol.Required(CONF_STOP_ID): SelectSelector(
                    SelectSelectorConfig(options=options)
                ),
            }),
            errors=errors,
        )
