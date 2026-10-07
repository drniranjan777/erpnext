# Module spec: Industry 4.0 — IIoT, MES and digital twin (Phase 13)

| | |
|---|---|
| **Status** | In progress: 13.1–13.2 done |
| **Code** | `edge/` (edge agent), `backend/src/modules/iot/`, `backend/src/modules/mes/`, `database/src/schema/iot.ts`, `database/src/schema/mes.ts`, `frontend/src/app/(app)/iot/` |

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

## 13.2 Real-time production and OEE (done)

Migration 0055 adds `mes_shifts`, `mes_downtime_reasons`, `mes_machine_settings`, `mes_machine_states`, `mes_counters`, `mes_counts` and `mes_andon_calls`. Permissions: `mes.oee.read`, `mes.shopfloor.use` (set states, give reasons, Andon calls) and `mes.setup.manage`. Notification event `mes.andon_call`. Pages: `/mes/andon`, `/mes/oee`, `/mes/downtime`, `/mes/setup`; the shop-floor kiosk now starts the stop form from the machine's counts. The OEE engine (`mes/oee.ts`) is pure and unit tested.

**From signals to production.** `MesService` subscribes to new readings through `IotService.onIngest`. For each machine with a part counter, reject counter or run-state signal:
- Counters are turned into counts with the last value kept per signal; a lower value means the counter was reset and counts from zero. Readings older than the last one are ignored.
- Parts are counted per minute (`mes_counts`), with the ideal time they should have taken: the routing's run time per piece on the running job card, otherwise the machine's ideal cycle. A part counter counts shots; a mould with several cavities multiplies them. A reject counter counts rejects among the parts made (they move from good to rejected).
- Counts also go to the job card running on the machine (good, rejected, shots), so the kiosk shows them when the operator stops the card; the operator can correct them.
- The machine state comes from the run-state signal (1 running, 0 stopped) if there is one; otherwise it is running while parts are counted and stopped when no part has been counted for the machine's stop limit (2 minutes by default), from the last part.
- People can set a machine to setup, planned stop or stopped from the Andon board. A setup or planned stop set by hand stays until the machine produces again; an automatic "stopped" does not replace it.
- A machine with no signal for 5 minutes shows as "no signal".

**Downtime.** Stops at least as long as the machine's minor-stop limit (5 minutes by default), and setups, are listed for a reason. Reasons belong to a loss: breakdown, setup, minor stop, speed, defects, start-up, other or planned (not a loss). Twelve common reasons and three 8-hour shifts (06:00, 14:00, 22:00 with 30-minute breaks) are created on first use and can be changed.

**OEE** (`GET /mes/oee?from&to&by=machine|workCenter|shift|day`):
- time with data, less planned stops and shift breaks, is planned time; time without any state is shown as "no data" and left out;
- downtime is setups and stops of at least the minor-stop length; shorter stops are minor stops (a performance loss);
- availability = (planned − downtime) / planned; performance = ideal time of the parts made / operating time (at most 100 %); quality = good / (good + rejected); OEE is their product;
- the six big losses are reported in time: breakdowns, setup and adjustments, minor stops, reduced speed (running time beyond the ideal), defects and start-up rejects (rejects within 10 minutes after a setup), plus stops without a reason and other stops;
- shift breaks are spread over the part of the shift in the period and taken out of unexplained stops first;
- each machine is computed per shift occurrence and the results are added up for the grouping (ratios are recomputed from the totals, not averaged).

**Andon board** (`GET /mes/board`, refreshed every 5 seconds, with a full-screen mode for a TV): each machine's state and for how long, the reason, the job card running (work order, item, operation, good of ordered, operator), this shift's OEE against the machine's target, and open calls. From the board, people can call maintenance, quality, material or a supervisor (one open call of each kind per machine; everyone with `mes.shopfloor.use` is notified), answer ("coming") and close calls, and set the machine state. Call response times are kept.
