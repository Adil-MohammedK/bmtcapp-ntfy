"""Next-arrival sensor for a BMTC stop."""

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity, SensorEntityDescription
from homeassistant.const import UnitOfTime
from homeassistant.helpers.update_coordinator import CoordinatorEntity

from .const import CONF_ROUTE, CONF_STOP_ID, DOMAIN
from .coordinator import BmtcDataUpdateCoordinator


def _minutes(value):
    if isinstance(value, (int, float)):
        return value
    try:
        return float(str(value).split()[0])
    except (ValueError, IndexError):
        return None


async def async_setup_entry(hass, entry, async_add_entities):
    async_add_entities([BmtcNextBusSensor(entry.runtime_data)])


class BmtcNextBusSensor(CoordinatorEntity[BmtcDataUpdateCoordinator], SensorEntity):
    """Expose ETA of the next bus and details for every following bus."""

    _attr_has_entity_name = True
    _attr_icon = "mdi:bus-clock"
    entity_description = SensorEntityDescription(key="next_bus", name="Next bus ETA", native_unit_of_measurement=UnitOfTime.MINUTES, device_class=SensorDeviceClass.DURATION)

    def __init__(self, coordinator):
        super().__init__(coordinator)
        entry = coordinator.entry
        self._attr_unique_id = f"{entry.entry_id}_next_bus"
        filter_name = entry.data.get(CONF_ROUTE) or "all routes"
        self._attr_device_info = {"identifiers": {(DOMAIN, entry.entry_id)}, "name": f"BMTC stop {entry.data[CONF_STOP_ID]} ({filter_name})", "manufacturer": "BMTC", "model": "Live stop tracker"}

    @property
    def native_value(self):
        next_bus = self.coordinator.data.get("nextBus")
        return _minutes(next_bus.get("eta")) if next_bus else None

    @property
    def extra_state_attributes(self):
        data = self.coordinator.data
        return {"stop_id": data.get("stopId"), "route_filter": data.get("routeFilter"), "next_bus": data.get("nextBus"), "buses": data.get("buses", []), "last_updated": data.get("refreshedAt")}
