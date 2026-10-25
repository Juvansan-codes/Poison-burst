# PoissonBurst Lab — Hardware Integration Handover

**For:** Hardware integration teammate  
**System:** Four Arduino UNO R4 WiFi traffic nodes + FastAPI backend + Next.js dashboard  
**Protocol target:** Telemetry Protocol V2  
**UDP telemetry port:** `5005`  
**Status:** Backend/simulator are software-validated; physical boards still need to be flashed and tested.

## 1. Goal

Connect the four physical Arduino UNO R4 WiFi boards to the PoissonBurst Lab computer, verify live telemetry, prove reboot recovery with `boot_id`, and demonstrate normal traffic, burst traffic, detection, and experiment saving.

Do the first test with **one board only**. Add the remaining boards only after one board is sending valid telemetry.

## 2. What is already implemented

- Arduino firmware source: `firmware/arduino_traffic_node/arduino_traffic_node.ino`
- Local configuration template: `firmware/arduino_traffic_node/node_config.h.example`
- Hardware receiver: `backend/app/services/hardware_receiver.py`
- Hardware simulator: `backend/app/services/hardware_simulator.py`
- Hardware observation-window processor and session manager
- FastAPI hardware endpoints and `/hardware` UI
- Protocol V1 backward compatibility and Protocol V2 `boot_id` handling
- SQLite experiment persistence and CSV/PDF reports

The Phase 8 report records 288 passing backend tests, passing reconciliation, TypeScript and lint checks, and a successful production build. Those results are software-only; they do **not** prove the firmware has been flashed or that real Wi-Fi transport works.

## 3. Protocol V2 at a glance

Each node sends compact UTF-8 JSON datagrams over UDP. A V2 packet has these fields:

```json
{
  "version": 2,
  "node_id": "node_1",
  "seq": 1,
  "uptime_ms": 1420,
  "mode": "normal",
  "boot_id": "c47a9e2f"
}
```

- `node_id`: unique name per physical board (`node_1` through `node_4`).
- `seq`: increases during a boot session and restarts after a reboot.
- `boot_id`: identifies that particular boot session. It should change after a reset/reboot.
- `mode`: expected to be `normal` or `burst`.
- Destination: the backend computer's **LAN IPv4 address**, UDP port **5005**.

`boot_id` is an operational session identifier, **not** an authentication secret. The firmware's current generation method does not guarantee cryptographic randomness or mathematically collision-free identifiers.

## 4. Before connecting the boards

1. Obtain the same project version as the software teammate. Do not use an older Protocol V1-only firmware copy.
2. In Arduino IDE, select **Arduino UNO R4 WiFi** and ensure the board package and `WiFiS3` dependencies are installed.
3. Compile the current firmware once before flashing. The Phase 8 report does not list a firmware compilation result, so record whether this passes. If it fails, capture the first compiler error and resolve it before attempting network debugging.
4. Copy `node_config.h.example` to `node_config.h` using the repository's documented setup. Keep the local file out of version control.
5. Configure the Wi-Fi SSID/password, backend destination IP, UDP port `5005`, `PROTOCOL_VERSION 2`, and the board's unique `NODE_ID`. Check the exact macro names in the example configuration; do not invent new ones.
6. Use a trusted **2.4 GHz Wi-Fi network** that permits device-to-device traffic. Avoid guest Wi-Fi or AP/client isolation.
7. Find the backend PC's LAN IPv4 address with `ipconfig`. Do not enter `127.0.0.1` or `localhost` as the board's destination; those refer to the board itself, not the PC.
8. If Windows Firewall blocks telemetry, allow the backend process / inbound UDP port `5005` on the private network only. Keep the application on a trusted local network.

## 5. Start the software

Start the FastAPI backend using the project's existing README/startup instructions. If the backend application is exposed as `app` in `backend/app/main.py`, the usual command from the `backend` directory is:

```powershell
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

If the repository defines a different entry point, use that entry point instead. The `0.0.0.0` bind lets devices on the local subnet reach the host; the browser UI can still be opened on the PC.

In a second terminal, start the frontend using its existing package scripts:

```powershell
cd frontend
npm run dev
```

Open the local frontend address shown in the terminal, then navigate to **Hardware Lab** (`/hardware`). Use the UI to start a hardware session and begin calibration according to the existing on-screen workflow. Start the session before expecting the backend's session-managed UDP receiver to collect telemetry.

## 6. Physical integration sequence

### A. One-board smoke test

1. Configure one board as `node_1`, Protocol V2.
2. Flash the firmware and open Serial Monitor at the baud rate specified in the firmware/README.
3. Confirm successful Wi-Fi association and that the node reports its boot identifier / telemetry state, if logged by the firmware.
4. Start the backend session from `/hardware`.
5. Confirm `node_1` appears as active and its observation counts increase.
6. Confirm the reported protocol is accepted and no malformed-packet errors appear.

Do not proceed to all four nodes if the first board cannot send telemetry.

### B. Add the remaining boards (up to 4 nodes)

1. Assign distinct IDs: `node_2`, `node_3`, and optionally `node_4`.
2. **Note on 3-board setups:** If testing with 3 physical boards (`node_1`, `node_2`, `node_3`), simply toggle off `node_4` in the `/hardware` dashboard under **Expected Nodes** before starting the session. Designate one of your boards (e.g. `node_3`) as burst-capable (`#define IS_BURST_CAPABLE true`).
3. Keep the Wi-Fi credentials and backend destination consistent.
4. Flash each board and verify all configured nodes appear separately in the dashboard.
5. Check that their counts and sequence numbers progress independently.

### C. Calibrate normal traffic

1. Put every node into normal mode.
2. Start calibration and wait for the UI to confirm that sufficient eligible, complete calibration windows have been collected.
3. Record the calibration baseline and number of completed windows.
4. Do not start calibration while a node is rebooting or while the dashboard reports incomplete/data-quality-contaminated windows.

### D. Verify reboot recovery

1. Keep a node transmitting during a session.
2. Record its current `boot_id`, sequence number, and boot-transition count.
3. Press the board's RESET button or briefly disconnect its USB power.
4. Wait for Wi-Fi reconnection and new telemetry.
5. Verify that `boot_id` changes, the sequence can restart at `1`, the backend accepts new packets, and the node's boot-transition diagnostic increments.
6. Confirm that delayed packets from the retired boot session do not switch the receiver back to the old boot session.
7. Check that the data-quality and unique/duplicate counters remain coherent.

Repeat once if needed. Record the outcome rather than assuming reboot recovery worked.

### E. Demonstrate burst detection

1. Complete a clean normal-traffic calibration first.
2. Keep the other nodes in normal mode.
3. Switch the designated node (the project has previously used `node_4`) to burst mode using the firmware's supported command or UI workflow. The firmware previously documented serial commands `n`, `b`, and `s`; verify the current README/firmware before using them.
4. Confirm telemetry shows burst mode and the observed arrival counts change.
5. Watch for a detection produced by the actual Poisson detector. Do not label a high count a detected burst unless the detector reports it.
6. Return the node to normal mode and stop the session cleanly.

### F. Save and verify the experiment

1. Stop the session using the `/hardware` UI.
2. Confirm the session summary shows total valid/accepted/filtered datagrams and any reboot transitions.
3. Confirm the experiment reports successful persistence and has an experiment ID.
4. Open Experiment History and locate the saved hardware experiment.
5. Export CSV and PDF, then verify the files contain the expected phase-specific statistics and any data-quality warnings.

## 7. Acceptance checklist

Mark each item only after observing it on physical hardware.

- [ ] Firmware compiles for Arduino UNO R4 WiFi.
- [ ] One physical board associates with the intended Wi-Fi network.
- [ ] One physical node sends accepted Protocol V2 UDP datagrams to the backend.
- [ ] All configured unique node IDs (e.g., 3 or 4 nodes) appear and send telemetry.
- [ ] Calibration completes with eligible normal-traffic windows.
- [ ] A burst is generated by the physical node and the detector result is shown.
- [ ] Reset produces a new `boot_id` and valid post-reset packets are accepted.
- [ ] Delayed retired-session packets do not cause a boot-session rollback.
- [ ] Session stop and SQLite persistence succeed.
- [ ] Experiment History, CSV export, and PDF export work with the physical run.

## 8. Troubleshooting quick checks

**Node does not appear:** Confirm session is started, PC LAN IP is correct, port is `5005`, both devices are on the same non-isolated network, the board's Wi-Fi credentials are correct, and Windows Firewall permits local UDP traffic.

**Board connects to Wi-Fi but no datagrams appear:** Recheck the configured backend IPv4 destination and UDP port; do not use `localhost`. Inspect serial logs and ensure the server session's receiver is running.

**Every packet is filtered after reset:** Inspect the incoming `boot_id`. If it did not change, troubleshoot firmware boot-ID generation. If it changed, inspect backend diagnostics to see whether the packet was accepted as a new boot session or matched a retired ID.

**Malformed packets:** Compare the actual UDP JSON with the Protocol V2 example above. Ensure `version` is integer `2`, `seq` is an integer, `mode` is supported, and `boot_id` is a non-empty string within the documented schema limit.

**Build failure:** Capture the complete first relevant compiler error and the selected board/core version. Do not debug Wi-Fi behavior until firmware compiles.

## 9. What to return to the software teammate

Send a short integration report containing:

- Board/core version and firmware compile result.
- Number of physical boards tested.
- Whether each node was visible and sending telemetry.
- One screenshot of the live Hardware Lab view.
- Before/after `boot_id` and sequence values from one physical reboot.
- Whether burst detection appeared during the physical traffic test.
- Whether the experiment was persisted and exports were generated.
- Exact errors and logs for any failed item.

**Important:** Keep Wi-Fi passwords and other credentials out of screenshots, exported reports, and shared source control. Do not mark any item as physically verified based only on simulator results.
