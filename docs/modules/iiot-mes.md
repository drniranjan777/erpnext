# Module spec: Industry 4.0 — IIoT, MES and digital twin (Phase 13)

| | |
|---|---|
| **Status** | In progress: 13.1 done |
| **Code** | `edge/` (edge agent), `backend/src/modules/iot/`, `database/src/schema/iot.ts`, `frontend/src/app/(app)/iot/` |

## Sprint plan

| Sprint | Scope |
|---|---|
| 13.1 | **IoT platform and edge agent**: edge gateways with device tokens, signal (tag) registry mapped to machines, stores and vehicles, idempotent batch ingestion with store-and-forward, time-series storage and charts, alarm thresholds with hold time, notifications and automatic maintenance requests; the edge agent with Modbus TCP, MQTT, HTTP JSON and simulator connectors |
| 13.2 | **Real-time production and OEE**: automatic part / reject counts into running job cards, machine states (running / idle / down / setup) from signals, automatic downtime capture with reason codes, shifts, OEE (availability × performance × quality) with the six big losses by machine, line and shift, Andon / TV board |
| 13.3 | **Energy, condition monitoring and cold chain**: energy meters per machine and line, kWh per unit, peak-demand alerts, Scope 2 carbon; anomaly detection on vibration, temperature and current with automatic maintenance requests; temperature / humidity loggers for stores and vehicles with excursion reports |
| 13.4 | **MES**: electronic work instructions, operator login at the machine, poka-yoke checks before start (tool, material and first-off), in-line quality capture, recipes downloaded to the PLC through the gateway with acknowledgement, batch parameter records |
| 13.5 | **Digital twin and edge AI**: plant layout with live status, schedule and capacity simulation (what-if), vision inspection results from the edge with model versions, defect rates and drift |

Exit target (from the phase plan): two pilot plants with at least 20 connected machines each; OEE within ±3 % of a manual study; one predictive-maintenance alert validated before an actual failure. These need pilot plants; the software provides the measurements (OEE by shift, alarm history linked to maintenance orders).

## 13.1 IoT platform and edge agent (done)

Migration 0054 adds `iot_gateways`, `iot_signals`, `iot_readings`, `iot_batches`, `iot_alarm_rules` and `iot_alarms`. Permissions: `iot.devices.manage` (register gateways and signals, set limits) and `iot.data.read` (live data, history, alarms, acknowledging). Notification event `iot.alarm` (in-app by default) in the new "Shop floor" group. Pages: `/iot` (live machines), `/iot/alarms`, `/iot/signals`, `/iot/signals/:id`, `/iot/gateways`.

**Gateways.** A gateway is registered with a code and gets a device token `<tenant id>.<secret>`, shown once and stored as a SHA-256 hash. A new token can be issued at any time (the old one stops working) and a gateway can be disabled. The list shows whether each gateway is online (a call in the last 2 minutes), its agent version, IP, how many readings are waiting in its buffer and how many batches arrived in the last hour.

**Signals.** One value from a machine or sensor, with a unique tag code, what it measures (part or reject counter, run state, temperature, humidity, vibration, current, pressure, energy meter, power, speed), unit, the machine, store or vehicle it belongs to, the gateway that reads it, how it is read (Modbus TCP register, MQTT topic and JSON path, HTTP JSON URL and path, simulator pattern, or "sent through the API"), scale and offset, and a deadband.

**Device API** (public, `x-device-token` header):
- `GET /iot/device/config`: the gateway's active signals with how to read them; counters are flagged so the agent sends every change.
- `POST /iot/device/ingest`: `{ batchId, agentVersion, buffered, readings: [{ s: tag, t: epoch ms or ISO, v: number | boolean }] }`, up to 5,000 readings. Tags are matched case-insensitively; a signal tied to another gateway is not accepted from this one. Readings more than 5 minutes in the future or more than 90 days old are rejected. A batch id already received returns the earlier result without applying it again, and a reading for a signal and timestamp already stored is ignored, so re-sending is always safe. The answer lists unknown tags so the agent can log them.

**Storage.** `iot_readings` holds one row per signal and timestamp (primary key signal + time). Charts read averages, minimum and maximum per bucket (`date_bin`), with the bucket chosen from 1 s to 1 day for about 240 points. Each signal keeps its last value for the live view; a value older than 5 minutes shows as stale.

**Alarms** (`rules.ts`, pure and unit tested). A limit is above, below, outside a band or equal to a value, with a hold time: the breach must last that long before the alarm opens (the first breach time is kept between batches). The alarm keeps the worst value while open and clears at the first reading back inside the limit. Opening an alarm can notify everyone with `iot.data.read` and, if chosen, raise a condition-based maintenance request (urgent for critical alarms) on the asset linked to the machine, as the person who registered the gateway. Alarms are acknowledged with a note; an alarm leaves the "needing attention" list once it is cleared and acknowledged.

**Edge agent** (`edge/`, Node.js 20+, no dependencies, Docker image provided):
- downloads its signal list from the ERP every 5 minutes;
- polls Modbus TCP (holding / input registers and coils; 16- and 32-bit integers and floats, optional word swap), HTTP JSON endpoints (SCADA systems that publish REST, such as Ignition or AVEVA web APIs) and the simulator every second, and subscribes to MQTT 3.1.1 topics (with + and # wildcards, QoS 0 / 1, user name and password);
- applies scale and offset, sends only changes beyond the deadband, re-sends unchanged values every minute as a heartbeat, and sends every change of a counter;
- appends every reading to a disk buffer and removes readings only after the ERP accepts them, so nothing is lost while the network or the ERP is down or across restarts. The batch id is a hash of the batch content, so a batch re-sent after a drop is recognised. The buffer is capped (2 million readings by default), dropping the oldest;
- readings the ERP refuses as invalid (HTTP 400) are dropped so they cannot block the buffer.

Not in this sprint: OPC UA, Sparkplug B, Siemens S7, EtherNet/IP and Mitsubishi MC connectors. They need protocol libraries on the gateway; until then, plants with these PLCs can publish through an OPC UA or S7-to-MQTT bridge (most SCADA systems and many PLCs have one) or post to the ingest API. TimescaleDB is not used; the readings table is a plain indexed table and can be converted to a hypertable later without changes to the API.
