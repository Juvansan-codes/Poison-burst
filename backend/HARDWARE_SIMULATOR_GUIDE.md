# PoissonBurst Lab — Four-Node UDP Traffic Simulator (Phase 3)

## 1. Overview and Purpose

The **Hardware Traffic Simulator** (`backend/app/services/hardware_simulator.py`) is an educational testing tool designed to generate realistic multi-node Poisson traffic telemetry across local UDP sockets to the `HardwareReceiver` service without requiring physical Arduino hardware.

In this project:
- **Software development** is handled on the primary workstation.
- **Physical Arduino UNO R4 WiFi implementation** is handled separately by the hardware teammate.

Because physical boards are not available on the software development machine, the simulator enables full end-to-end integration testing of:
1. Multi-node concurrent packet reception,
2. Ingestion pipelines and schema validation,
3. Monotonic sequence counter tracking and gap/loss detection,
4. Transition between normal rate (~5 Hz) and burst rate (~50 Hz),
5. Clean socket lifecycle management.

---

## 2. Telemetry Protocol Compatibility

The simulator adheres strictly to the **Phase 1 Arduino UNO R4 WiFi telemetry specification** and **Phase 2 closed schema**:

```json
{
  "version": 1,
  "node_id": "node_1",
  "seq": 1042,
  "uptime_ms": 128450,
  "mode": "normal"
}
```

- `version` (int): Must equal `1`.
- `node_id` (str): Must be one of `"node_1"`, `"node_2"`, `"node_3"`, `"node_4"`.
- `seq` (int): 32-bit unsigned monotonic sequence counter incremented per attempted transmission.
- `uptime_ms` (int): Elapsed monotonic time in milliseconds since node started.
- `mode` (str): Configured operational mode, either `"normal"` or `"burst"`.

Because `HardwareReceiver` enforces `ALLOW_EXTRA_FIELDS = False`, no extraneous fields are injected.

---

## 3. Arrival Process & Mathematical Modeling

The simulator models true Poisson arrivals using **exponentially distributed inter-arrival times**:

$$T = -\frac{\ln(U)}{\lambda}$$

where:
- $\lambda$ is the arrival rate in events per second (e.g., $\lambda = 5.0$ Hz in normal mode, $\lambda = 50.0$ Hz in burst mode).
- $U \sim \text{Uniform}(10^{-7}, 1 - 10^{-7})$ is sampled independently per node using Python's `random.Random(seed)` instances.

### Key Mathematical Characteristics:
- **No Fixed Sleeping:** Events are *not* generated at fixed $1/\lambda$ intervals. Inter-arrival gaps fluctuate stochastically according to the continuous memoryless Poisson process.
- **Accumulated Drift Compensation:** The simulation scheduler tracks `next_target_time += interval` rather than taking `now + interval`. This prevents systemic clock drift while avoiding busy-waiting via `threading.Event.wait(timeout)`.
- **Independent Random Streams:** Nodes 1 through 4 maintain completely separate PRNG states and seeds to eliminate cross-node statistical correlation.

---

## 4. Default Experiment Traffic Scenario

In the standard Phase 3 four-node experiment:

| Node ID  | Baseline Rate ($\lambda$) | Burst Permitted? | Default Burst Schedule |
| :------- | :-----------------------: | :--------------: | :--------------------- |
| `node_1` | 5.0 events/sec            | No               | Stays `normal`         |
| `node_2` | 5.0 events/sec            | No               | Stays `normal`         |
| `node_3` | 5.0 events/sec            | No               | Stays `normal`         |
| `node_4` | 5.0 events/sec            | **Yes**          | [T+15s to T+30s] 50 Hz |

- Nodes 1–3 strictly maintain `is_burst_capable = False` and will reject/ignore burst mode transitions.
- Node 4 transitions automatically from `normal` (5 Hz) $\to$ `burst` (50 Hz) during the scheduled window, then returns to `normal` (5 Hz).

---

## 5. Running the Simulator and Receiver

Both tools can be run simultaneously in separate console terminals.

### Step 1: Launch the HardwareReceiver
In terminal 1:
```powershell
cd "d:\College Files\Year 2\PS\MicroProject\backend"
python scripts/run_hardware_receiver.py --host 127.0.0.1 --port 5005
```

### Step 2: Launch the HardwareSimulator
In terminal 2:
```powershell
cd "d:\College Files\Year 2\PS\MicroProject\backend"

# Run default 4-node experiment for 60 seconds
python scripts/run_hardware_simulator.py --host 127.0.0.1 --port 5005 --duration 60

# Or customize nodes, burst delay, and rates
python scripts/run_hardware_simulator.py --nodes node_4 --burst-delay 5 --burst-duration 10 --duration 20
```

### Command-Line Arguments:
- `--host`: Target receiver host (default: `127.0.0.1`).
- `--port`: Target UDP port (default: `5005`).
- `--duration`: Total simulation duration in seconds (default: `60.0`, `0` for indefinite).
- `--nodes`: Subset of nodes to run (e.g. `--nodes node_1 node_4`).
- `--normal-rate`: Normal Poisson arrival rate (default: `5.0` Hz).
- `--burst-rate`: Burst Poisson arrival rate (default: `50.0` Hz).
- `--burst-delay`: Delay before node_4 begins burst (default: `15.0` seconds).
- `--burst-duration`: Duration of burst state (default: `15.0` seconds).
- `--seed`: Integer random seed for reproducible arrival times.
- `--verbose`: Detailed diagnostic logging.

---

## 6. Three-Tier Validation Hierarchy

To maintain academic and engineering integrity, test outcomes are organized into three distinct tiers:

```
+-------------------------------------------------------------------------+
| Tier 1: Unit Tests (test_hardware_receiver.py & test_hardware_simulator)|
| Validates individual functions, mathematical sampling, schema parsing,  |
| error rejections, and state machine transitions in memory.              |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Tier 2: Localhost UDP Integration Tests (Automated ephemeral sockets)   |
| Validates actual UDP socket sendto/recvfrom communication on 127.0.0.1. |
| Tests multi-node concurrency, thread isolation, and counter tracking.   |
+-------------------------------------------------------------------------+
                                    |
                                    v
+-------------------------------------------------------------------------+
| Tier 3: Physical Hardware Testing (PENDING TEAMMATE IMPLEMENTATION)     |
| Validates over-the-air Wi-Fi RF transmission, 802.11 b/g/n propagation, |
| physical router latency, packet drop under RF contention, and Arduino   |
| microcontroller watchdog stability.                                     |
+-------------------------------------------------------------------------+
```

### What Localhost Testing Establishes:
1. The receiver and simulator agree 100% on wire protocol serialization and schema validation.
2. The receiver correctly demultiplexes all four concurrent node IDs.
3. Sequence gaps, retransmissions, and out-of-order packets are correctly monitored.
4. Clean thread shutdown and resource deallocation occur on termination.

### What Remains PENDING until Physical Hardware is Connected:
1. Physical Wi-Fi signal attenuation, interference, and jitter.
2. Hardware clock drift on the Renesas RA4M1 microcontroller.
3. Packet drops induced by 802.11 contention when 4 physical radios broadcast simultaneously.
4. Network firewall and NAT traversal across physical Wi-Fi routers/hotspots.
