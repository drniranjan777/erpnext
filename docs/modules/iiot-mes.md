# Module spec: Industry 4.0 — IIoT, MES and digital twin (Phase 13)

| | |
|---|---|
| **Status** | In progress: 13.1–13.4 done |
| **Code** | `edge/` (edge agent), `backend/src/modules/iot/`, `backend/src/modules/mes/`, `backend/src/modules/plant/`, `database/src/schema/iot.ts`, `mes.ts`, `plant.ts`, `frontend/src/app/(app)/iot/` |

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

## 13.3 Energy, condition monitoring and cold chain (done)

Migration 0056 adds `energy_settings`, `energy_minutes`, `cm_models` and `cm_anomalies`. Code: `backend/src/modules/plant/` (`analytics.ts` is pure and unit tested). Counter handling is shared in `iot/counters.ts`. Reading needs `iot.data.read`; settings need `iot.devices.manage`. Notification events `plant.peak_demand` and `plant.anomaly`. Pages: `/plant/energy`, `/plant/condition`, `/plant/cold-chain`; trips show "Temperatures on the way".

**Energy** (`GET /plant/energy`, `GET/PUT /plant/energy/settings`)
- kWh meters are signals measuring "energy meter (kWh)"; their counter readings become kWh per minute per meter, with the machine they belong to.
- Settings: contract demand (kW), the utility's demand interval (15 or 30 minutes), the warning level (% of contract demand), the tariff (₹/kWh), the grid emission factor (0.716 kg CO₂/kWh by default, India's grid average) and which meters are the incoming ones. Totals and demand use the incoming meters (or all meters when none is marked), so machine sub-meters are not counted twice.
- Peak demand: after the first 3 minutes of an interval, the demand it will reach at the current rate is projected; at the warning level everyone with `iot.data.read` is told once per interval to hold back large loads.
- The report gives consumption, cost, Scope 2 carbon (location-based), maximum demand of the period (by complete intervals) against the contract, kWh per day, per meter, per machine with kWh and CO₂ per good part (from the counted parts of 13.2), and per product (the machine's kWh in the minutes it was counting a job card's parts, per good unit).

**Condition monitoring** (`/plant/condition/models`, `/plant/condition/anomalies`)
- Any measured signal (vibration, temperature, current, pressure, speed, power) can be monitored. The model first learns the signal's normal mean and spread from a set number of readings (200 by default), then keeps that baseline fixed so slow wear is not absorbed into "normal"; it is relearnt on request after maintenance or a process change.
- A spike is a reading more than 4 standard deviations from normal for 3 readings in a row (settable). Drift is the recent average (which ignores spikes) moving more than 2.5 standard deviations away. Either raises an anomaly with the value, the score and the baseline, and (by default) a condition-based maintenance request on the machine's asset; maintenance staff are notified. It clears when readings are back to normal.
- Each anomaly can be marked "confirmed" (with what was found) or "false alarm"; the page shows the hit rate. This is how the phase's exit criterion (a predictive alert validated before an actual failure) is evidenced: a confirmed anomaly with its maintenance request.

**Cold chain** (`/plant/cold-chain`, `/plant/cold-chain/report`, `/plant/cold-chain/trips/:id`)
- Loggers are temperature or humidity signals linked to a store or a vehicle number. The acceptable range is the logger's first active "outside" alarm limit (so the same limit also raises alarms), or a range given in the report.
- The overview shows each logger's current value, whether it is in range or has gone quiet (15 minutes), and the last 24 hours: minimum, maximum, mean kinetic temperature and excursions.
- The report gives readings, minimum / average / maximum, mean kinetic temperature (ICH method, ΔH/R = 10,000 K), time outside the range and each excursion with its start, length and worst value. A reading holds until the next, so an excursion runs from the first reading outside to the first reading back inside.
- A transport trip shows the loggers whose vehicle number matches the trip's (ignoring spaces and dashes) between dispatch and completion.

## 13.4 MES at the machine (done)

Migration 0057 adds `mes_instructions`, `mes_skills`, `mes_machine_sessions`, `mes_recipes`, `mes_executions`, `mes_inline_checks` and `iot_commands`. Code: `backend/src/modules/mes/execution.service.ts`, `poka-yoke.ts` (pure and unit tested); the edge agent writes set-points (version 1.1.0). Permissions: `mes.instructions.manage` (instructions, recipes, skills) and `mes.firstoff.approve`; the terminal uses `mes.shopfloor.use` and starting a job also needs `manufacturing.shopfloor.record`. Pages: `/mes/terminal`, `/mes/instructions`, `/mes/recipes`, skills on `/mes/setup`, and the printable batch record `/print/batch-record/:id`.

**Work instructions** are written per item and operation number: a title, steps (text, a picture or drawing link, "confirm" for steps the operator must tick, "caution" for safety or quality warnings), the characteristics to measure (limits and, for in-line checks, how often), whether a first-off approval is needed and whether materials must be scanned. They are versioned: editing a released version starts a new draft, and releasing a draft retires the previous release. The terminal always shows the latest released version, and the batch record keeps which version was used.

**Recipes** hold an item's set-points (optionally for one machine, else any machine), each with limits, the signal that measures it and, optionally, where to write it: a Modbus holding register (data type, scaling) or an MQTT topic. Set-points outside their limits are refused. Versioning works as for instructions.

**Operators.** An operator logs in at the machine (one at a time; a new log-in closes the previous one). Skills record who may run a work centre's machines (trainee, qualified, expert, trainer) and until when. Once a work centre has any skill recorded, only qualified, unexpired operators can start jobs there.

**Starting a job (poka-yoke).** The terminal lists the released operations waiting at the machine's work centre. For the chosen one it shows the instructions and the recipe; the operator ticks the confirm steps, scans the tool and materials (item code and batch), checks and starts. The start is refused, with the reasons, when:
- no operator is named, or the operator is not qualified (no skill, trainee, expired);
- the machine is on another work centre, has an open breakdown, or needs cleaning;
- the scanned tool is not the operation's tool, the tool is in maintenance or retired, or its shot life is used up;
- a scanned material is unknown or not used in the operation, its batch does not exist, is held by quality (quarantine, under test, rejected) or has expired, or (when the instructions require scanning) a required material was not scanned;
- a confirm step was not ticked.
Warnings do not stop the start: another operator logged in, tool life above 90 %, a conditionally released batch, no released instructions.

**Recipe download.** When the job starts, the recipe's writable set-points are queued as a command for the gateway that serves the machine. The agent picks commands up after each send, writes each value (Modbus function 6, or 16 for 32-bit values, with scaling reversed; or an MQTT message `{"value", "name"}`), and reports success or the first failure; the result shows on the terminal and in the batch record.

**First-off and in-line quality.** When the instructions require it, the job starts with the first-off "waiting for approval": a person with `mes.firstoff.approve` records the readings of the first piece and approves (all readings within limits) or rejects it. Until it is approved, the job card cannot be stopped with good pieces. While the job runs, in-line readings are recorded against the characteristics; the terminal shows which checks are due by their frequency, and any reading out of limits calls quality on the Andon board.

**Batch record** (`GET /mes/executions/:id`, printable): work order, item, operation, machine, tool, operator, start and end, good and rejected quantities and shots; the instruction version and the steps confirmed; every start check with its result and the materials scanned; the first-off readings and who approved them; the in-line checks; the recipe's set-points with what the machine's signals measured during the job (minimum, average, maximum) and whether that stayed within the limits; and every other process signal of the machine over the job.

SCADA / MES systems that already run the line (Ignition, AVEVA, WinCC) connect through the same paths: they publish values over MQTT or REST (read by the agent) or post to the ingest API, and can take recipe set-points over MQTT.
