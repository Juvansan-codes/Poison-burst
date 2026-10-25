# PoissonBurst Lab — Arduino UNO R4 WiFi Traffic Node Firmware

> **Course:** Probability and Statistics for Computer Science (25CS203)  
> **Institution:** Karunya Institute of Technology and Sciences  
> **Target Hardware:** Arduino UNO R4 WiFi (Renesas RA4M1 48 MHz ARM Cortex-M4 + ESP32-S3 Wi-Fi Coprocessor)  
> **Protocol:** Compact JSON Telemetry over Wi-Fi UDP (Port 5005)  
> **Arrival Process:** Synthetic Continuous-Time Poisson Point Process ($T = -\ln(U)/\lambda$)  

---

## 1. Overview & Purpose

This firmware implements a synthetic network traffic generator for the physical hardware testbed of **PoissonBurst Lab**. Four physical Arduino UNO R4 WiFi boards act as distributed network traffic sources, transmitting application-level UDP datagrams to a centralized monitoring laptop over a local 2.4 GHz Wi-Fi network.

### Statistical Rigor: Exponential Inter-Arrival Times
Rather than transmitting at deterministic, periodic intervals (e.g. `delay(200)`), the firmware models a true **homogeneous Poisson arrival process** by drawing successive inter-arrival intervals from an exponential distribution:

$$T = -\frac{\ln(U)}{\lambda}$$

where:
* $U \sim \text{Uniform}(0, 1)$ is sampled using hardware-seeded pseudorandom entropy.
* $\lambda$ is the arrival rate parameter (events per second):
  * **Normal Mode ($\lambda = 5.0$ events/s):** Mean inter-arrival time $\mathbb{E}[T] = 0.20\text{ s} = 200{,}000\ \mu\text{s}$.
  * **Burst Mode ($\lambda = 50.0$ events/s):** Mean inter-arrival time $\mathbb{E}[T] = 0.02\text{ s} = 20{,}000\ \mu\text{s}$.
* Every generated event corresponds to **exactly one UDP datagram** sent immediately to the monitoring receiver.

> [!NOTE]
> The firmware generates synthetic traffic arrival events rather than measuring physical network packets on the wire. The arrival count per observation window $W$ is classified under the existing application schema as `MeasurementType.UDP_DATAGRAM_COUNT`.

---

## 2. Hardware and Software Prerequisites

### Hardware
* **4x Arduino UNO R4 WiFi boards** (Do not use standard Uno R3 or generic ESP32 DevKits).
* **4x USB-C cables** (for power, firmware flashing, and Serial Monitor command input).
* **Dedicated 2.4 GHz Local Wi-Fi Access Point** (e.g. a smartphone Wi-Fi hotspot or portable router).
* **Windows Development Laptop** running the PoissonBurst backend.

### Software
* **Arduino IDE 2.x** (or `arduino-cli` v0.35+).
* **Board Package:** `Arduino UNO R4 Boards` (`arduino:renesas_uno`) version `1.5.3` or higher.
* **Core Library:** Official bundled `WiFiS3` library (automatically included with the UNO R4 board package).

---

## 3. Wi-Fi & Network Configuration

### Critical Campus Network Notice
University and enterprise Wi-Fi networks (such as Karunya campus Wi-Fi) typically enable **Client Isolation** (AP isolation) and block peer-to-peer UDP broadcast/unicast traffic between wireless clients.

**Requirement:** Configure a **private 2.4 GHz mobile hotspot** (e.g., from an Android/iPhone smartphone) or a private travel router. Connect both the monitoring laptop and all four Arduino boards to this same private network.

### Finding Your Laptop's Local IP Address on Windows
1. Open PowerShell or Command Prompt on your laptop.
2. Run:
   ```powershell
   ipconfig
   ```
3. Locate your active Wi-Fi network adapter:
   ```text
   Wireless LAN adapter Wi-Fi:
      Connection-specific DNS Suffix  . :
      IPv4 Address. . . . . . . . . . . : 192.168.43.150
      Subnet Mask . . . . . . . . . . . : 255.255.255.0
      Default Gateway . . . . . . . . . : 192.168.43.1
   ```
4. Note your **IPv4 Address** (e.g., `192.168.43.150`). This will be the `RECEIVER_IP_STR` in your node configuration.
   > [!CAUTION]
   > Never use `127.0.0.1` (loopback) as the receiver IP! The Arduino runs on a separate processor and must address the laptop's LAN IP address.

---

## 4. Node Configuration Setup

The firmware uses a local header file `node_config.h` to store network credentials and node parameters. This file is excluded from Git via `.gitignore` to prevent credential leaks.

### Step 1: Create Local Configuration from Example
In the `firmware/arduino_traffic_node/` directory, copy the template:

```powershell
# In PowerShell:
Copy-Item node_config.h.example node_config.h
```

### Step 2: Configure Node Parameters
Open `node_config.h` in an editor:

```c
#ifndef NODE_CONFIG_H
#define NODE_CONFIG_H

// 1. Wi-Fi Credentials
#define WIFI_SSID             "MyHotspot"          // Your 2.4 GHz Hotspot SSID
#define WIFI_PASSWORD         "mypassword123"      // Your Wi-Fi Password

// 2. Monitoring Laptop Destination
#define RECEIVER_IP_STR       "192.168.43.150"     // Laptop IPv4 from ipconfig
#define RECEIVER_UDP_PORT     5005                 // Destination UDP port

// 3. Node Identification & Modes
#define NODE_ID               "node_1"             // Change for each board: "node_1", "node_2", "node_3", "node_4"
#define NORMAL_RATE_HZ        5.0f                 // Baseline rate (5 events/sec)
#define BURST_RATE_HZ         50.0f                // Burst rate (50 events/sec)
#define IS_BURST_CAPABLE      false                // 'false' for nodes 1-3; 'true' for node 4

#endif
```

### Step 3: Multi-Node Configuration Matrix
Flash each board with its corresponding identity:

| Physical Board | `NODE_ID` | `IS_BURST_CAPABLE` | Normal Rate | Burst Rate | Role in Experiment |
|---|---|---|---|---|---|
| **Board 1** | `"node_1"` | `false` | 5.0 Hz | 50.0 Hz | Background normal Poisson traffic |
| **Board 2** | `"node_2"` | `false` | 5.0 Hz | 50.0 Hz | Background normal Poisson traffic |
| **Board 3** | `"node_3"` | `false` | 5.0 Hz | 50.0 Hz | Background normal Poisson traffic |
| **Board 4** | `"node_4"` | `true` | 5.0 Hz | 50.0 Hz | **Injected Burst Node** (switchable via Serial) |

---

## 5. Compiling and Uploading

### Option A: Using Arduino IDE 2.x (Recommended for GUI)
1. Launch Arduino IDE.
2. Open `firmware/arduino_traffic_node/arduino_traffic_node.ino`.
3. In the top board selector dropdown, choose:  
   **Arduino UNO R4 WiFi**
4. Select the corresponding USB Serial Port (e.g. `COM5`).
5. Click **Verify** (`Ctrl+R`) to compile.
6. Click **Upload** (`Ctrl+U`) to flash the microcontroller.

### Option B: Using `arduino-cli` (Command Line)
If using the bundled Arduino IDE CLI on Windows:

```powershell
$cli = "$env:LOCALAPPDATA\Programs\Arduino IDE\resources\app\lib\backend\resources\arduino-cli.exe"

# 1. Compile the sketch for UNO R4 WiFi
& $cli compile --fqbn arduino:renesas_uno:unor4wifi "firmware/arduino_traffic_node"

# 2. Upload to board on COM5 (adjust COM port for your board)
& $cli upload -p COM5 --fqbn arduino:renesas_uno:unor4wifi "firmware/arduino_traffic_node"
```

**Resource Utilization on Arduino UNO R4 WiFi:**
* **Program Storage (Flash):** ~70,560 bytes (26% of 256 KB).
* **Dynamic Memory (SRAM):** ~9,204 bytes (28% of 32 KB), leaving over 23 KB for stack safety.

---

## 6. USB Serial Command Interface

Open the Arduino IDE **Serial Monitor** at **115200 baud** (with "Newline" or "No line ending" enabled).

The firmware processes commands **non-blockingly**; command inspection never delays or stalls the Poisson arrival scheduler.

### Available Commands

| Command | Action | Description |
|---|---|---|
| `n` or `N` | **Normal Mode** | Sets arrival intensity to baseline ($\lambda = 5.0\text{ Hz}$). Allowed on all nodes. |
| `b` or `B` | **Burst Mode** | Elevates arrival intensity to $\lambda = 50.0\text{ Hz}$. **Rejected** on `node_1`–`node_3`; **accepted** on `node_4`. |
| `s` or `S` | **Status Report** | Displays current mode, sequence count, packets sent/failed, local IP, and uptime. |
| `h` or `?` | **Help Menu** | Displays the command menu and theoretical formulations. |

### Example Serial Monitor Output

```text
=================================================================
 PoissonBurst Lab - Hardware Traffic Node (Arduino UNO R4 WiFi)  
 Course: 25CS203 Probability and Statistics for Computer Science 
=================================================================
[CONFIG] Node Identity      : node_4
[CONFIG] Burst Capable      : YES (Permitted to burst)
[CONFIG] Normal Rate (lambda): 5.0 events/sec
[CONFIG] Burst Rate (lambda) : 50.0 events/sec
[CONFIG] Receiver Target    : 192.168.43.150:5005
-----------------------------------------------------------------
[STATISTICS] Modeled Process: Homogeneous Poisson arrival stream 
             Inter-arrival time distribution: Exponential(lambda)
             T = -ln(U) / lambda, U ~ Uniform(0, 1)              
=================================================================
[WIFI] Connecting to SSID 'MyHotspot'...
.......
[WIFI] Connected successfully! Node IP: 192.168.43.84
[WIFI] Target Receiver: 192.168.43.150:5005
[SYSTEM] Traffic generator started. Type 'h' in Serial Monitor for commands.

> b
[CONTROL] Node 'node_4' switched to BURST mode (lambda = 50.0 events/sec)!

> s
--- [NODE STATUS REPORT] ---
Node ID            : node_4
Operating Mode     : BURST (50 Hz)
Burst Capable      : YES
Wi-Fi Status       : CONNECTED
Local Node IP      : 192.168.43.84
Receiver Target    : 192.168.43.150:5005
Current Sequence   : 142
Packets Sent (UDP) : 142
Packets Failed     : 0
Uptime             : 18 seconds
----------------------------
```

---

## 7. UDP Telemetry Specification

Each arrival event transmits **exactly one UDP datagram** containing a compact UTF-8 JSON payload. The firmware supports both Protocol V1 and Protocol V2:

### Protocol V1 (Legacy Schema)
```json
{"version":1,"node_id":"node_1","seq":1042,"uptime_ms":128450,"mode":"normal"}
```

### Protocol V2 (Boot-Aware Reboot Recovery Schema)
```json
{"version":2,"node_id":"node_1","seq":1042,"uptime_ms":128450,"mode":"normal","boot_id":"3a8f1b2c"}
```

### Field Definitions

| Field | Type | Protocol | Description |
|---|---|---|---|
| `version` | `integer` | V1, V2 | Protocol schema version (`1` or `2`). |
| `node_id` | `string` | V1, V2 | Stable board identity (`"node_1"`, `"node_2"`, `"node_3"`, `"node_4"`). |
| `seq` | `unsigned long` | V1, V2 | Monotonically increasing sequence number per node/boot session ($1, 2, 3, \dots$). |
| `uptime_ms` | `unsigned long` | V1, V2 | Microcontroller elapsed runtime in milliseconds (`millis()`). |
| `mode` | `string` | V1, V2 | Current operational traffic state: `"normal"` or `"burst"`. |
| `boot_id` | `string` | V2 | 8-character hexadecimal string identifying this specific microcontroller boot session. |

### Boot Identifier Generation & Limitations

* **Entropy Sources:** `boot_id` is derived in `generate_boot_identifier()` by combining high-resolution `micros()`/`millis()` jitter after the non-deterministic 802.11 handshake, floating analog ADC noise on `A0`–`A2`, the FNV-1a hash of `NODE_ID`, and the Arduino `random()` LCG output.
* **Limitations:** The Renesas RA4M1 microcontroller hardware True Random Number Generator (TRNG) is not exposed via standard Arduino APIs. Floating analog readings may be correlated across rapid cold reboots. While `boot_id` provides excellent practical collision resistance across reboots in laboratory sessions, it is **not** cryptographically secure or mathematically guaranteed to be globally unique.
* **Security Notice:** `boot_id` is an operational session disambiguator, **not a security credential or authentication token**.

### Important Architectural Distinctions
* **Reboot Recovery:** Under Protocol V2, when an Arduino reboots and resets its sequence number to 1, the backend receiver recognizes the new `boot_id`, records the boot transition in session diagnostics, safely resets the sequence high-water mark, and accepts the post-reboot packets rather than classifying them as duplicates.
* **Delayed Packet Immunity:** If delayed packets from a retired `boot_id` arrive after a reboot, the backend classifies them as duplicates without thrashing or switching back to the old boot session.
* **No Time Sync Needed:** Microcontroller clocks and laptop clocks do not require NTP synchronization. Arrival timestamps for tumbling observation windows are recorded by the backend upon receipt.
* **Zero Heap Allocation:** Payloads are formatted using `snprintf()` into a fixed stack buffer, eliminating dynamic memory fragmentation during high-rate 50 Hz burst intervals.

