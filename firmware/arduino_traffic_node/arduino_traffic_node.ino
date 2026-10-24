/**
 * =============================================================================
 * PoissonBurst Lab - Hardware Traffic Node Firmware
 * Target Microcontroller: Arduino UNO R4 WiFi (Renesas RA4M1 + ESP32-S3)
 * Course: Probability and Statistics for Computer Science (25CS203)
 * Institution: Karunya Institute of Technology and Sciences
 * =============================================================================
 *
 * PURPOSE:
 * Generates synthetic traffic arrival events according to a continuous-time
 * homogeneous Poisson point process by drawing successive inter-arrival times
 * from an exponential distribution:
 *
 *     T = -ln(U) / lambda
 *
 * where U ~ Uniform(0, 1) and lambda is the target event arrival rate.
 * Each generated arrival event triggers the transmission of exactly one
 * compact UDP datagram over a 2.4 GHz local Wi-Fi network to the monitoring
 * laptop running the PoissonBurst backend receiver.
 *
 * PROTOCOL TELEMETRY SCHEMA (Compact JSON):
 * {
 *   "version": 1,
 *   "node_id": "node_1",
 *   "seq": 1042,
 *   "uptime_ms": 128450,
 *   "mode": "normal"
 * }
 *
 * USB SERIAL COMMAND INTERFACE (115200 Baud, Non-Blocking):
 *   'n' or 'N' : Switch node to NORMAL mode (default: 5.0 events/sec)
 *   'b' or 'B' : Switch node to BURST mode (default: 50.0 events/sec; rejected if !IS_BURST_CAPABLE)
 *   's' or 'S' : Print diagnostic status and transmission statistics
 *   'h' or '?' : Print command menu and statistical explanation
 * =============================================================================
 */

#include <WiFiS3.h>
#include <math.h>

// =============================================================================
// Configuration Header Inclusion
// =============================================================================
#if __has_include("node_config.h")
  #include "node_config.h"
#else
  #error "Configuration file 'node_config.h' not found! Please copy 'node_config.h.example' to 'node_config.h' and configure your Wi-Fi credentials and node parameters."
#endif

// =============================================================================
// Compile-Time Configuration Sanity Checks
// =============================================================================
#ifndef NODE_ID
  #error "NODE_ID is required (e.g. 'node_1', 'node_2', 'node_3', 'node_4')."
#endif

#ifndef WIFI_SSID
  #error "WIFI_SSID must be defined in node configuration."
#endif

#ifndef WIFI_PASSWORD
  #error "WIFI_PASSWORD must be defined in node configuration."
#endif

#ifndef RECEIVER_IP_STR
  #error "RECEIVER_IP_STR must be defined in node configuration."
#endif

#ifndef RECEIVER_UDP_PORT
  #define RECEIVER_UDP_PORT 5005
#endif

#ifndef NORMAL_RATE_HZ
  #define NORMAL_RATE_HZ 5.0f
#endif

#ifndef BURST_RATE_HZ
  #define BURST_RATE_HZ 50.0f
#endif

#ifndef IS_BURST_CAPABLE
  #define IS_BURST_CAPABLE false
#endif

// =============================================================================
// Operational Modes and Node State
// =============================================================================
enum TrafficMode {
  MODE_NORMAL,
  MODE_BURST
};

// Current operating mode
TrafficMode current_mode = MODE_NORMAL;

// Monotonically increasing sequence number (increments on every transmission attempt)
uint32_t sequence_number = 0;

// Lifetime packet transmission counters
uint32_t packets_transmitted = 0;
uint32_t packets_failed = 0;

// Inter-arrival timing state (microsecond resolution)
unsigned long last_event_us = 0;
unsigned long next_interval_us = 0;

// Wi-Fi connection and non-blocking retry timing
unsigned long last_reconnect_attempt_ms = 0;
const unsigned long RECONNECT_INTERVAL_MS = 5000;

// UDP Client and destination IP
WiFiUDP udp_client;
IPAddress receiver_ip;

// =============================================================================
// Statistical Engine: Exponential Inter-Arrival Time Generator
// =============================================================================

/**
 * Samples an inter-arrival interval from an Exponential distribution:
 *
 *     T = -ln(U) / lambda
 *
 * Mathematical Properties:
 * - A counting process {N(t), t >= 0} with independent, identically distributed
 *   Exponential(lambda) inter-arrival times is mathematically a homogeneous
 *   Poisson process with rate parameter lambda arrivals per unit time.
 * - E[T] = 1 / lambda
 * - Var(T) = 1 / lambda^2
 *
 * Implementation Details:
 * - Generates uniform pseudorandom U strictly in the open interval (0, 1).
 * - Avoids division-by-zero and log(0) domain errors.
 * - Converts the sampled time T (seconds) to microseconds for hardware scheduling.
 * - Floored at 100 microseconds to prevent zero-duration lockups under high rates.
 *
 * @param lambda Target arrival rate in events per second (e.g. 5.0 or 50.0).
 * @return Sampled inter-arrival time in microseconds.
 */
unsigned long sample_exponential_interval_us(float lambda) {
  if (lambda <= 0.001f) {
    lambda = 1.0f; // Defensive safety floor
  }

  // Draw pseudorandom integer r in [1, 1000000]
  // Note: random(min, max) in Arduino returns values in [min, max - 1]
  long r = random(1, 1000001);

  // Map to U strictly in (0, 1)
  float u = (float)r / 1000001.0f;

  // Numerical safeguard against extreme floating point underflow
  if (u <= 0.0f) u = 1e-6f;
  if (u >= 1.0f) u = 0.999999f;

  // Inverse Transform: t_seconds = -ln(U) / lambda
  float t_seconds = -logf(u) / lambda;

  // Convert to microseconds
  float t_us = t_seconds * 1000000.0f;

  // Hardware timing safety floor (100 us)
  if (t_us < 100.0f) {
    t_us = 100.0f;
  }

  return (unsigned long)(t_us + 0.5f);
}

/**
 * Seeds the pseudorandom number generator with physical hardware entropy.
 *
 * Combines:
 * 1. FNV-1a 32-bit hash of the NODE_ID string (ensuring different boards
 *    configured with node_1..node_4 do not share identical pseudo-random seeds).
 * 2. Unconnected floating analog pin voltages (A0, A1, A2).
 * 3. Microsecond jitter from the Wi-Fi connection handshake duration.
 */
void seed_random_generator() {
  // 1. FNV-1a hash of NODE_ID
  uint32_t id_hash = 2166136261u;
  const char* id_str = NODE_ID;
  while (*id_str) {
    id_hash ^= (uint8_t)(*id_str++);
    id_hash *= 16777619u;
  }

  // 2. Sample floating analog input noise
  uint32_t analog_noise = 0;
  analog_noise |= (analogRead(A0) & 0x3FF);
  analog_noise |= ((analogRead(A1) & 0x3FF) << 10);
  analog_noise |= ((analogRead(A2) & 0x3FF) << 20);

  // 3. Combine with high-resolution microsecond timer tick
  uint32_t seed = id_hash ^ analog_noise ^ (uint32_t)micros();
  randomSeed(seed);
}

// =============================================================================
// UDP Transmission Handler
// =============================================================================

/**
 * Constructs and transmits a single telemetry UDP datagram for the current event.
 *
 * Each generated Poisson event triggers exactly one UDP datagram transmission.
 * The payload is formatted in compact JSON using a fixed stack buffer to avoid
 * dynamic heap fragmentation in high-frequency loops.
 */
void transmit_event() {
  sequence_number++;
  unsigned long uptime_ms = millis();
  const char* mode_str = (current_mode == MODE_BURST) ? "burst" : "normal";

  // Format compact JSON payload into a static buffer
  char payload[160];
  int len = snprintf(
    payload,
    sizeof(payload),
    "{\"version\":1,\"node_id\":\"%s\",\"seq\":%lu,\"uptime_ms\":%lu,\"mode\":\"%s\"}",
    NODE_ID,
    (unsigned long)sequence_number,
    uptime_ms,
    mode_str
  );

  if (len < 0 || len >= (int)sizeof(payload)) {
    Serial.println(F("[ERROR] Payload formatting buffer overflow."));
    return;
  }

  // Transmit over UDP if Wi-Fi is currently connected
  if (WiFi.status() == WL_CONNECTED) {
    int begin_ok = udp_client.beginPacket(receiver_ip, RECEIVER_UDP_PORT);
    if (begin_ok) {
      udp_client.write((const uint8_t*)payload, len);
      int end_ok = udp_client.endPacket();
      if (end_ok == 1) {
        packets_transmitted++;
      } else {
        packets_failed++;
      }
    } else {
      packets_failed++;
    }
  } else {
    // Wi-Fi offline - record packet failure without blocking event timeline
    packets_failed++;
  }

  // Sample next exponential inter-arrival interval for the current rate
  float active_rate = (current_mode == MODE_BURST) ? BURST_RATE_HZ : NORMAL_RATE_HZ;
  next_interval_us = sample_exponential_interval_us(active_rate);
  last_event_us = micros();
}

// =============================================================================
// Wi-Fi Management (Non-Blocking Connection & Recovery)
// =============================================================================

/**
 * Connects to the configured 2.4 GHz Wi-Fi access point during startup.
 */
void connect_wifi_initial() {
  Serial.print(F("[WIFI] Connecting to SSID '"));
  Serial.print(WIFI_SSID);
  Serial.println(F("'..."));

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start_attempt = millis();
  const unsigned long TIMEOUT_MS = 15000;

  while (WiFi.status() != WL_CONNECTED && (millis() - start_attempt < TIMEOUT_MS)) {
    delay(500);
    Serial.print(F("."));
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("[WIFI] Connected successfully! Node IP: "));
    Serial.println(WiFi.localIP());
    Serial.print(F("[WIFI] Target Receiver: "));
    Serial.print(receiver_ip);
    Serial.print(F(":"));
    Serial.println(RECEIVER_UDP_PORT);
  } else {
    Serial.println(F("[WIFI] Initial connection attempt timed out."));
    Serial.println(F("[WIFI] Node will continue running and retry in background."));
  }
}

/**
 * Evaluates Wi-Fi status non-blockingly during the main loop.
 * If disconnected, retries connection at safe periodic intervals without
 * blocking the event scheduler or serial monitor commands.
 */
void check_wifi_connection_nonblocking() {
  if (WiFi.status() != WL_CONNECTED) {
    unsigned long now_ms = millis();
    if (now_ms - last_reconnect_attempt_ms >= RECONNECT_INTERVAL_MS) {
      last_reconnect_attempt_ms = now_ms;
      Serial.println(F("[WIFI] Reconnecting to access point..."));
      WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    }
  }
}

// =============================================================================
// USB Serial Command Interface (Non-Blocking)
// =============================================================================

void print_help() {
  Serial.println();
  Serial.println(F("========================================================="));
  Serial.println(F(" PoissonBurst Lab - Node Command Menu"));
  Serial.println(F("========================================================="));
  Serial.println(F("  'n' or 'N' : Switch to NORMAL mode (5.0 events/sec)"));
  Serial.println(F("  'b' or 'B' : Switch to BURST mode (50.0 events/sec)"));
  Serial.println(F("  's' or 'S' : Print node telemetry and transmission stats"));
  Serial.println(F("  'h' or '?' : Display this command menu"));
  Serial.println(F("========================================================="));
  Serial.println();
}

void print_status_report() {
  Serial.println();
  Serial.println(F("--- [NODE STATUS REPORT] ---"));
  Serial.print(F("Node ID            : ")); Serial.println(NODE_ID);
  Serial.print(F("Operating Mode     : ")); Serial.println((current_mode == MODE_BURST) ? F("BURST (50 Hz)") : F("NORMAL (5 Hz)"));
  Serial.print(F("Burst Capable      : ")); Serial.println(IS_BURST_CAPABLE ? F("YES") : F("NO"));
  Serial.print(F("Wi-Fi Status       : ")); Serial.println((WiFi.status() == WL_CONNECTED) ? F("CONNECTED") : F("DISCONNECTED"));
  if (WiFi.status() == WL_CONNECTED) {
    Serial.print(F("Local Node IP      : ")); Serial.println(WiFi.localIP());
  }
  Serial.print(F("Receiver Target    : ")); Serial.print(receiver_ip); Serial.print(F(":")); Serial.println(RECEIVER_UDP_PORT);
  Serial.print(F("Current Sequence   : ")); Serial.println(sequence_number);
  Serial.print(F("Packets Sent (UDP) : ")); Serial.println(packets_transmitted);
  Serial.print(F("Packets Failed     : ")); Serial.println(packets_failed);
  Serial.print(F("Uptime             : ")); Serial.print(millis() / 1000); Serial.println(F(" seconds"));
  Serial.println(F("----------------------------"));
  Serial.println();
}

/**
 * Handles incoming characters from the USB Serial Monitor.
 * Fully non-blocking: processes available bytes immediately without delays.
 */
void handle_serial_commands() {
  while (Serial.available() > 0) {
    char c = (char)Serial.read();

    // Discard whitespace and carriage return / newline
    if (c == '\r' || c == '\n' || c == ' ') {
      continue;
    }

    if (c == 'n' || c == 'N') {
      current_mode = MODE_NORMAL;
      next_interval_us = sample_exponential_interval_us(NORMAL_RATE_HZ);
      Serial.print(F("[CONTROL] Node '"));
      Serial.print(NODE_ID);
      Serial.print(F("' switched to NORMAL mode (lambda = "));
      Serial.print(NORMAL_RATE_HZ, 1);
      Serial.println(F(" events/sec)."));
    }
    else if (c == 'b' || c == 'B') {
      if (!IS_BURST_CAPABLE) {
        Serial.print(F("[REJECTED] Node '"));
        Serial.print(NODE_ID);
        Serial.println(F("' is configured as NOT burst-capable. Burst mode request rejected."));
        Serial.println(F("[INFO] In this experiment, only node_4 is permitted to inject bursts."));
      } else {
        current_mode = MODE_BURST;
        next_interval_us = sample_exponential_interval_us(BURST_RATE_HZ);
        Serial.print(F("[CONTROL] Node '"));
        Serial.print(NODE_ID);
        Serial.print(F("' switched to BURST mode (lambda = "));
        Serial.print(BURST_RATE_HZ, 1);
        Serial.println(F(" events/sec)!"));
      }
    }
    else if (c == 's' || c == 'S') {
      print_status_report();
    }
    else if (c == 'h' || c == 'H' || c == '?') {
      print_help();
    }
    else {
      Serial.print(F("[WARN] Unrecognized command '"));
      Serial.print(c);
      Serial.println(F("'. Send 'h' for help."));
    }
  }
}

// =============================================================================
// Arduino Setup & Main Loop
// =============================================================================

void setup() {
  // Initialize USB Serial interface for diagnostic monitor
  Serial.begin(115200);

  // Brief pause to allow USB Serial enumeration if connected
  delay(1500);

  Serial.println();
  Serial.println(F("================================================================="));
  Serial.println(F(" PoissonBurst Lab - Hardware Traffic Node (Arduino UNO R4 WiFi)  "));
  Serial.println(F(" Course: 25CS203 Probability and Statistics for Computer Science "));
  Serial.println(F("================================================================="));

  Serial.print(F("[CONFIG] Node Identity      : ")); Serial.println(NODE_ID);
  Serial.print(F("[CONFIG] Burst Capable      : ")); Serial.println(IS_BURST_CAPABLE ? F("YES (Permitted to burst)") : F("NO (Background node)"));
  Serial.print(F("[CONFIG] Normal Rate (lambda): ")); Serial.print(NORMAL_RATE_HZ, 1); Serial.println(F(" events/sec"));
  Serial.print(F("[CONFIG] Burst Rate (lambda) : ")); Serial.print(BURST_RATE_HZ, 1); Serial.println(F(" events/sec"));
  Serial.print(F("[CONFIG] Receiver Target    : ")); Serial.print(RECEIVER_IP_STR); Serial.print(F(":")); Serial.println(RECEIVER_UDP_PORT);
  Serial.println(F("-----------------------------------------------------------------"));
  Serial.println(F("[STATISTICS] Modeled Process: Homogeneous Poisson arrival stream "));
  Serial.println(F("             Inter-arrival time distribution: Exponential(lambda)"));
  Serial.println(F("             T = -ln(U) / lambda, U ~ Uniform(0, 1)              "));
  Serial.println(F("================================================================="));

  // Parse destination receiver IP address
  if (!receiver_ip.fromString(RECEIVER_IP_STR)) {
    Serial.print(F("[ERROR] Failed to parse RECEIVER_IP_STR '"));
    Serial.print(RECEIVER_IP_STR);
    Serial.println(F("'. Check node_config.h."));
  }

  // Connect to Wi-Fi access point
  connect_wifi_initial();

  // Initialize pseudorandom number generator with physical entropy
  seed_random_generator();

  // Initialize initial arrival interval for normal mode
  next_interval_us = sample_exponential_interval_us(NORMAL_RATE_HZ);
  last_event_us = micros();

  Serial.println(F("[SYSTEM] Traffic generator started. Type 'h' in Serial Monitor for commands."));
  Serial.println();
}

void loop() {
  // 1. Process any incoming USB Serial Monitor commands (non-blocking)
  handle_serial_commands();

  // 2. Non-blocking Wi-Fi health check and periodic reconnection
  check_wifi_connection_nonblocking();

  // 3. Poisson Event Scheduler: Check if exponential interval has elapsed
  // Unsigned subtraction (now_us - last_event_us) safely handles 32-bit micros() rollover (~71.58 min)
  unsigned long now_us = micros();
  if ((unsigned long)(now_us - last_event_us) >= next_interval_us) {
    transmit_event();
  }
}
