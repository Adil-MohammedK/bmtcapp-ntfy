"""Next-arrival sensor for a BMTC stop."""

import math
import re
from datetime import datetime, time
from zoneinfo import ZoneInfo

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription
from homeassistant.const import UnitOfTime
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_ROUTE, CONF_STOP_ID, DOMAIN
from .coordinator import BmtcDataUpdateCoordinator

_ETA_TIME_ZONE = ZoneInfo("Asia/Kolkata")


def _minutes(value: object) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None

    text = str(value).strip().lower()
    if not text:
        return None
    try:
        number = float(text)
    except ValueError:
        number = None
    if number is not None:
        return number if math.isfinite(number) else None

    now = datetime.now(_ETA_TIME_ZONE)
    arrival = None
    try:
        if re.fullmatch(r"\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}", text):
            arrival = datetime.strptime(text, "%d-%m-%Y %H:%M:%S").replace(
                tzinfo=_ETA_TIME_ZONE
            )
        elif re.fullmatch(r"\d{1,2}:\d{2}", text):
            arrival = datetime.combine(
                now.date(),
                time.fromisoformat(text),
                tzinfo=_ETA_TIME_ZONE,
            )
        elif "t" in text or re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", text):
            arrival = datetime.fromisoformat(text.replace("z", "+00:00"))
            if arrival.tzinfo is None:
                arrival = arrival.replace(tzinfo=_ETA_TIME_ZONE)
    except ValueError:
        return None
    if arrival is not None:
        return max(0, math.ceil((arrival - now).total_seconds() / 60))

    clock = re.fullmatch(r"(\d+):([0-5]?\d):([0-5]?\d)", text)
    if clock:
        hours, minutes, seconds = map(float, clock.groups())
        return hours * 60 + minutes + seconds / 60

    hours = re.search(r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b", text)
    minutes = re.search(r"(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m)\b", text)
    if hours or minutes:
        return (float(hours.group(1)) * 60 if hours else 0) + (
            float(minutes.group(1)) if minutes else 0
        )
    return None


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = entry.runtime_data
    added: set[str] = set()

    def add_bus_sensors():
        entities = []
        for bus in coordinator.data.get("buses", []):
            vehicle_id = str(bus.get("vehicleId") or "")
            if vehicle_id and vehicle_id not in added:
                added.add(vehicle_id)
                entities.append(BmtcBusEtaSensor(coordinator, vehicle_id))
        if entities:
            async_add_entities(entities)

    async_add_entities([BmtcNextBusSensor(coordinator)])
    add_bus_sensors()
    entry.async_on_unload(coordinator.async_add_listener(add_bus_sensors))


class BmtcNextBusSensor(CoordinatorEntity[BmtcDataUpdateCoordinator], SensorEntity):
    """Expose ETA of the next bus and details for every following bus."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:bus-clock"
    entity_description = SensorEntityDescription(key="next_bus", name="Next bus ETA", native_unit_of_measurement=UnitOfTime.MINUTES, device_class=SensorDeviceClass.DURATION)

    def __init__(self, coordinator):
        super().__init__(coordinator)
        entry = coordinator.entry
        self._attr_unique_id = f"{entry.entry_id}_next_bus"
        stop_id = entry.options.get(CONF_STOP_ID, entry.data[CONF_STOP_ID])
        route = entry.options.get(CONF_ROUTE, entry.data.get(CONF_ROUTE, ""))
        filter_name = route or "all routes"
        self._attr_device_info = {"identifiers": {(DOMAIN, entry.entry_id)}, "name": f"BMTC stop {stop_id} ({filter_name})", "manufacturer": "BMTC", "model": "Live stop tracker"}

    @property
    def native_value(self):
        next_bus = self.coordinator.data.get("nextBus")
        return _minutes(next_bus.get("eta")) if next_bus else None

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data
        next_bus = data.get("nextBus") or {}
        return {
            "stop_id": data.get("stopId"),
            "route_filter": data.get("routeFilter"),
            "arrival_time": next_bus.get("arrivalTime"),
            "arrival_time_timezone": "Asia/Kolkata",
            "next_bus": next_bus or None,
            "buses": data.get("buses", []),
            "last_updated": data.get("refreshedAt"),
        }


class BmtcBusEtaSensor(CoordinatorEntity[BmtcDataUpdateCoordinator], SensorEntity):
    """Expose the current ETA for one vehicle."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:bus-clock"
    _attr_native_unit_of_measurement = UnitOfTime.MINUTES
    _attr_device_class = SensorDeviceClass.DURATION

    def __init__(self, coordinator, vehicle_id: str) -> None:
        super().__init__(coordinator)
        self._vehicle_id = vehicle_id
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{vehicle_id}_eta"
        bus = self._bus()
        self._attr_name = f"{bus.get('vehicleNumber', vehicle_id)} ETA"
        self._attr_device_info = {
            "identifiers": {(DOMAIN, coordinator.entry.entry_id)},
            "name": f"BMTC stop {coordinator.entry.options.get(CONF_STOP_ID, coordinator.entry.data[CONF_STOP_ID])}",
            "manufacturer": "BMTC",
            "model": "Live stop tracker",
        }

    def _bus(self):
        return next(
            (
                bus
                for bus in self.coordinator.data.get("buses", [])
                if str(bus.get("vehicleId")) == self._vehicle_id
            ),
            {},
        )

    @property
    def native_value(self):
        return _minutes(self._bus().get("eta"))

    @property
    def extra_state_attributes(self):
        bus = self._bus()
        return {
            "vehicle_id": self._vehicle_id,
            "vehicle_number": bus.get("vehicleNumber"),
            "route": bus.get("routeNo"),
            "direction": bus.get("direction"),
            "stop_id": self.coordinator.data.get("stopId"),
            "arrival_time": bus.get("arrivalTime"),
            "arrival_time_timezone": "Asia/Kolkata",
            "next_stop": bus.get("nextStop"),
            "position": bus.get("position"),
            "refreshed_at": self.coordinator.data.get("refreshedAt"),
        }
