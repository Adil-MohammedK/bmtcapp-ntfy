"""Live bus locations as Home Assistant device trackers."""

from homeassistant.components.device_tracker import TrackerEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_ROUTE, DOMAIN
from .coordinator import BmtcDataUpdateCoordinator


async def async_setup_entry(hass, entry, async_add_entities):
    """Create a map entity for every bus, including buses that appear later."""
    coordinator = entry.runtime_data
    added: set[str] = set()

    def add_new_buses():
        entities = []
        for bus in coordinator.data.get("buses", []):
            vehicle_id = str(bus.get("vehicleId") or "")
            position = bus.get("position", [])
            if vehicle_id and len(position) == 2 and position != [0, 0] and vehicle_id not in added:
                added.add(vehicle_id)
                entities.append(BmtcBusTracker(coordinator, bus))
        if entities:
            async_add_entities(entities)

    add_new_buses()
    entry.async_on_unload(coordinator.async_add_listener(add_new_buses))


class BmtcBusTracker(CoordinatorEntity[BmtcDataUpdateCoordinator], TrackerEntity):
    _attr_has_entity_name = True
    _attr_icon = "mdi:bus"

    def __init__(self, coordinator, bus):
        super().__init__(coordinator)
        self._vehicle_id = str(bus["vehicleId"])
        self._attr_unique_id = f"{coordinator.entry.entry_id}_{self._vehicle_id}"
        self._attr_name = str(bus.get("vehicleNumber") or self._vehicle_id)
        self._attr_device_info = {"identifiers": {(DOMAIN, coordinator.entry.entry_id)}, "name": f"BMTC stop {coordinator.entry.data.get('stop_id')}", "manufacturer": "BMTC", "model": "Live stop tracker"}

    def _feature(self):
        return next((item for item in self.coordinator.data.get("buses", []) if str(item.get("vehicleId")) == self._vehicle_id), None)

    @property
    def latitude(self):
        feature = self._feature()
        return feature and feature.get("position", [None, None])[1]

    @property
    def longitude(self):
        feature = self._feature()
        return feature and feature.get("position", [None, None])[0]

    @property
    def extra_state_attributes(self):
        feature = self._feature()
        return feature if feature else {"unavailable": True}
