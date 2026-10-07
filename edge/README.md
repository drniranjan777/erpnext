# NextGen edge agent

Reads machines on the plant network and sends the readings to NextGen ERP. Node.js 20 or later; no other dependencies.

## Set up

1. In the ERP, open **Smart factory → Edge gateways**, register a gateway and copy its token (shown once).
2. Add the gateway's signals under **Smart factory → Signals**: for each, how it is read (Modbus TCP register, MQTT topic, HTTP JSON URL or simulator), scaling and deadband.
3. Copy `edge.config.example.json` to `edge.config.json` and fill in `server` (the ERP API address ending in `/api/v1`) and `token`.
4. Run `node agent.mjs edge.config.json`.

Or with Docker (keep the buffer on a volume):

```
docker build -t nextgen-edge .
docker run -d --restart unless-stopped -v /opt/nextgen-edge:/data nextgen-edge
```

with `/opt/nextgen-edge/edge.config.json` containing `"bufferFile": "/data/buffer.jsonl"`. `NEXTGEN_SERVER` and `NEXTGEN_DEVICE_TOKEN` override the file.

## What it does

- Downloads its signal list from the ERP at start and every 5 minutes.
- Polls Modbus TCP, HTTP JSON and simulated signals every `pollMs` (1 s); subscribes to MQTT topics.
- Sends a value only when it moves beyond the signal's deadband (counters: every change), and re-sends unchanged values every `heartbeatMs` (1 min).
- Writes every reading to `buffer.jsonl` first and removes it only after the ERP accepts it. While the network or the ERP is down, readings wait on disk (up to 2 million) and are sent in order when it is back. A re-sent batch is applied once.
- Logs a status line every minute: buffered, sent, failed sends, read errors.

## Connectors

| Protocol | Signal settings |
|---|---|
| Modbus TCP | PLC `host:port`, register (zero-based), table (holding, input, coil), data type (uint16, int16, uint32, int32, float32), unit id, `swap` for low-word-first devices |
| MQTT 3.1.1 | broker URL `mqtt://host:port`, topic (+ and # allowed), JSON path for JSON payloads; `username` / `password` in the source if the broker needs them |
| HTTP JSON | URL and JSON path, for SCADA / MES systems that publish values over REST |
| Simulator | `sine:min:max:periodSec`, `counter:perMinute`, `state:runPct`, `noise:mean:spread` |

OPC UA, Sparkplug B, Siemens S7, EtherNet/IP and Mitsubishi MC are not built in; use the PLC's or SCADA's MQTT / REST bridge, or post readings to `POST /iot/device/ingest` with the gateway token.
