# PoissonBurst Lab — Project Context

> **Purpose of this file:** This document is the source of truth for coding assistants and all four team members working on the mathematics micro-project. Read it before proposing or implementing features. Preserve the project scope and terminology. Where decisions are marked **TBD**, do not assume they are finalized.

## 1. Project Overview

**Project title:** Traffic Burst Detection in Communication Networks Using Poisson Distribution  
**Software name:** PoissonBurst Lab  
**Course:** Probability and Statistics for Computer Science  
**Course code:** 25CS203  
**Institution:** Karunya Institute of Technology and Sciences  
**Team size:** 4 members

### Team

| Member | Register number | Main page ownership |
|---|---|---|
| Juvansan H | URK25CS1018 | Dashboard |
| Abishek Joseph E | URK25CS1002 | Historical Traffic Replay |
| Naveen Kumar R V | URK25CS1016 | Simulation Laboratory |
| Shirley S | URK25CS1081 | Statistical Analysis & Evaluation |

Page assignments are a working proposal and may be swapped by the team. Each member should deliver a working page, test it, and document its logic. Page ownership does not mean each page should implement its own independent version of the Poisson detector.

## 2. Project Objective

Build an interactive software system that detects statistically unusual traffic bursts in communication networks using a Poisson distribution. The software must make the mathematical process visible and support investigation of how the method behaves, how parameters affect results, and where its assumptions become unreliable.

The application has three traffic sources/modes:

1. **Historical Data Mode:** Analyze recorded network traffic and identify unusual intervals.
2. **Software Simulation Mode:** Generate artificial traffic, inject known bursts, and evaluate detection under controlled conditions.
3. **Physical Hardware Mode:** Use four Arduino boards to send traffic over a local network to a monitoring server on a laptop. Count received traffic in time windows and detect statistically unusual increases.

All three modes must use the **same shared Poisson detection engine** and a consistent observation/result schema.

The detector identifies statistically unusual traffic counts. It must not automatically claim that an alert proves a DDoS attack, malicious activity, or network congestion.

## 3. Intended Demonstration

A successful demonstration should allow the user to:

1. Open a professional monitoring dashboard.
2. Load historical network data and replay it over time.
3. Generate synthetic traffic and configure a controlled burst.
4. Receive traffic from four Arduino devices and observe the counts on the laptop dashboard.
5. Estimate a baseline arrival rate, calculate Poisson upper-tail probabilities, and inspect alert decisions.
6. Change the significance threshold or observation-window duration and see how results change.
7. Compare detector output with known injected bursts where ground truth is available.
8. Examine the mean/variance relationship and discuss the limitations of the Poisson assumption.
9. Export actual experiment results and graphs for the project report.

## 4. Mathematical Foundation

### 4.1 Poisson model

Let `X_t` be the number of arrivals observed in fixed-duration window `t`. Under a suitable Poisson model:

`X_t ~ Poisson(lambda)`

The probability mass function is:

`P(X = k) = exp(-lambda) * lambda^k / k!`

Here, `lambda` is the expected number of arrivals per observation window. For a one-second window it represents the expected count per second; when the window changes, the expected count must be expressed consistently with that duration.

### 4.2 Baseline estimation

Estimate the baseline from representative normal-traffic windows:

`lambda_hat = (1 / n) * sum(X_t for t = 1..n)`

Prefer a dedicated calibration period and freeze the baseline during a detection experiment. Do not blindly estimate the baseline from the entire dataset if it contains the very bursts being evaluated, because bursts can inflate the baseline and become harder to detect.

### 4.3 Upper-tail probability and detection rule

For an observed count `x`, calculate:

`p = P(X >= x | lambda_hat)`

Flag the observation when:

`p < alpha`

Initial threshold choices should include `alpha = 0.05`, `0.01`, and `0.001`. The app must show the actual computed probability and configured threshold. This is an upper-tail probability, not merely the probability of observing exactly `x` arrivals.

For Python, SciPy's Poisson survival function can calculate the upper tail; be careful that `P(X >= x)` is commonly evaluated as `poisson.sf(x - 1, lambda_hat)`. Handle zero-rate and invalid-input edge cases explicitly.

### 4.4 Mean, variance, and dispersion

For a Poisson random variable:

`E[X] = Var(X) = lambda`

Compute the observed sample mean, sample variance, and variance-to-mean ratio:

`D = sample_variance / sample_mean`

A ratio above 1 indicates overdispersion relative to the ideal Poisson mean/variance relationship; below 1 indicates underdispersion. This ratio alone does not establish the cause or prove whether the model is suitable. Handle a zero sample mean safely and explain the result.

### 4.5 Evaluation metrics

Where ground-truth labels exist, calculate a confusion matrix and metrics such as:

- True positives, false positives, true negatives, false negatives.
- Precision.
- Recall.
- F1-score.
- False-positive rate.
- Detection delay (time from a known burst start to the first corresponding detection).

Synthetic simulation can use injected burst windows as ground truth. Historical labels must be aligned carefully to the exact measurement being counted. Flow labels do not automatically establish packet-window ground truth. For hardware, the commanded burst interval can serve as an experimental reference, but evaluation should use the actual received observations and clearly state how the reference labels were defined. If suitable ground truth is unavailable, do not fabricate performance metrics.

## 5. Four Main Pages and Ownership

### Page 1 — Dashboard
**Primary owner:** Juvansan H

Purpose: Main landing page showing current or selected experiment status and an overview of traffic and alerts.

Features:
- Summary cards: observations analyzed, detected burst windows/events, estimated baseline rate, and false-positive rate only when valid ground truth is available.
- Interactive traffic timeline showing observed counts and highlighted detections.
- Recent-events table with timestamp, observed count, expected count/baseline, upper-tail probability, and decision.
- Live monitoring display when the hardware receiver is running.
- Navigation to Historical Replay, Simulation Lab, and Statistical Analysis.
- Experiment summary and link/export action where appropriate.

Requirements:
- Read actual data and results from shared modules/state.
- Do not hardcode results or implement a separate detector.
- Distinguish packet counts, flow counts, and UDP datagram counts in labels.

### Page 2 — Historical Traffic Replay
**Primary owner:** Abishek Joseph E

Purpose: Analyze recorded historical network data and replay it chronologically.

Features:
- CSV import first; PCAP processing is a subsequent enhancement if time and resources permit.
- Validate required columns, timestamps, and data quality.
- Configure observation-window duration (initial examples: 1 s, 5 s, 10 s, 60 s).
- Aggregate observations into fixed windows.
- Playback controls: play, pause, reset, and speed.
- Timeline visualization with flagged intervals.
- Event inspection: timestamp, observed count, baseline, p-value, alpha, decision.
- Compare results with appropriate historical labels if available.

Dataset starting point: CICIDS2017, available at https://www.unb.ca/cic/datasets/ids-2017.html. Start with a manageable file. Dataset suitability, file format, labels, and timestamps must be checked before use.

Measurement distinction:
- **PCAP mode:** Count packets using recorded packet timestamps.
- **Flow CSV mode:** Count newly observed flows using their recorded start timestamps, if those columns are available and appropriate.
- Clearly label the measurement; packet counts and flow counts are not interchangeable. Process large PCAPs incrementally rather than loading huge files all at once.

### Page 3 — Simulation Laboratory
**Primary owner:** Naveen Kumar R V

Purpose: Let users configure repeatable experiments and observe detector behavior under controlled conditions.

Initial controls:
- Baseline arrival rate.
- Simulation duration.
- Observation-window size.
- Burst start time.
- Burst duration.
- Burst intensity or alternate burst rate.
- Significance threshold `alpha`.
- Random seed.

Scenarios:
1. Normal Poisson traffic.
2. Sudden elevated-rate burst.
3. Changing background traffic rate.
4. Overdispersed/bursty traffic that differs from an ideal Poisson process.

Visualizations:
- Generated counts over time.
- Expected baseline.
- Ground-truth injected-burst intervals.
- Predicted detection intervals.
- Missed and falsely flagged windows.
- Experiment summary.

Reproducibility:
- The same software-simulation parameters and random seed should reproduce the same observations.
- Hardware experiments should save actual measured observations and configuration; physical runs may vary.

Hardware experiment mode:
- Display received observations from the Arduino experiment.
- Provide experiment controls/configuration where firmware and a control mechanism support them.
- If remote trigger control is not ready, support a preconfigured Arduino burst mode first.

### Page 4 — Statistical Analysis & Evaluation
**Primary owner:** Shirley S

Purpose: Explain the mathematical reasoning and evaluate the model and detector.

Features:
- Poisson distribution explorer: vary `lambda` and plot the PMF.
- Baseline estimator: show observations used and estimated mean.
- Upper-tail probability calculator: show `P(X >= x | lambda_hat)`, alpha, and decision.
- Detection explanation panel based on actual computed values.
- Sample mean, sample variance, and variance-to-mean ratio.
- Confusion matrix and precision/recall/F1/false-positive rate/detection delay when ground truth is valid.
- Comparison of different alpha values.
- Export statistical summaries, evaluation metrics, and graphs for the report.

All numbers must be computed from actual experiment data or clearly marked as illustrative. Do not present illustrative values as experimental findings.

## 6. Arduino Hardware Testbed

### 6.1 Proposed setup

Four Arduino devices send traffic on a local Wi-Fi/Ethernet network to a Python server running on a laptop. The laptop counts incoming observations in fixed windows and passes the resulting counts to the shared detection engine.

Conceptual flow:

`Arduino devices -> local router/access point -> laptop UDP receiver -> time-window counts -> Poisson detector -> evaluation -> dashboard`

### 6.2 Traffic pattern

The initial experiment may configure three devices to continue normal traffic and one device to increase its sending rate. Example values for a demonstration (not fixed limits or measured results):

| Device | Normal rate | During burst |
|---|---:|---:|
| Arduino 1 | 5 messages/s | 5 messages/s |
| Arduino 2 | 5 messages/s | 5 messages/s |
| Arduino 3 | 5 messages/s | 5 messages/s |
| Arduino 4 | 5 messages/s | 50 messages/s |

The aggregate expected rate in the example would be approximately 20 messages/s normally and 65 messages/s during the burst, but the system must use actual received counts. Wi-Fi scheduling, device timing, packet loss, and other behavior can cause observed traffic to differ from configured sending rates.

### 6.3 Transport and measurement

- Start with UDP over a private local network.
- Each message may contain a device ID, sequence number, operating mode, and experiment ID.
- Timestamp messages when the laptop receives them.
- The initial hardware metric is **UDP datagrams received per time window**.
- Do not call application-level datagram counts actual IP packet counts. Add PCAP capture/analysis if packet-level measurement is required.
- Count each received datagram once at the chosen measurement layer.
- Use a dedicated local router/access point if practical; do not depend on unrestricted college Wi-Fi.

### 6.4 Hardware compatibility — TBD

The exact Arduino board models have **not yet been confirmed**. Determine whether the devices have Wi-Fi/Ethernet support built in or require network modules before choosing firmware libraries. Do not assume every Arduino model supports Wi-Fi directly.

### 6.5 Control mechanism — TBD

Preferred experience: Dashboard controls such as Start Monitoring, Calibrate Baseline, Start Burst, Stop Burst, and Reset Experiment. These require appropriate firmware and a control path from the laptop to the devices. A simpler first version can use a preconfigured burst mode triggered at the device or through a basic control message. Do not pretend that dashboard-to-Arduino control works before it has been implemented and tested.

### 6.6 Safety and scope

This is a controlled local testbed intended to study traffic counts, not to overwhelm a network. Start with modest rates and increase gradually while inspecting received counts and losses. Do not claim actual congestion or DDoS detection unless the experiment specifically measures and validates those conditions.

## 7. Shared Data Contract

All modes should convert their observations into a common representation. A Pandas DataFrame is suitable for the initial version.

Suggested columns:

| Field | Meaning |
|---|---|
| `timestamp` | Timestamp for the observation/window; document whether it is window start or end |
| `count` | Number of arrivals during the window |
| `source` | `historical`, `simulation`, or `hardware` |
| `measurement_type` | e.g. `packet_count`, `flow_count`, or `udp_datagram_count` |
| `ground_truth` | Known burst label where valid; missing/nullable when unknown |
| `experiment_id` | Identifier for the experiment/run |

Additional fields may include `window_seconds`, `device_id`, `sequence_count`, or raw metadata, as long as definitions are documented.

Ensure timestamps are parsed consistently, windows use a documented boundary convention, missing intervals are handled deliberately, and measurement types are not silently mixed.

## 8. Shared Modules and Full-Stack Architecture

The application adopts a clean, decoupled full-stack architecture separating the Next.js frontend, FastAPI backend, shared statistical engine, and future data ingestors:

```text
PoissonBurstLab/
├── context.md
├── README.md
├── .gitignore
├── pytest.ini
│
├── frontend/                     # Next.js App Router Frontend
│   ├── package.json
│   ├── tsconfig.json
│   ├── next.config.ts
│   ├── .env.example
│   ├── src/
│   │   ├── app/
│   │   │   ├── layout.tsx        # Persistent shell with Navbar and Footer
│   │   │   ├── page.tsx          # Page 1: Dashboard (Juvansan H)
│   │   │   ├── globals.css       # Dark charcoal & orange theme
│   │   │   ├── historical/
│   │   │   │   └── page.tsx      # Page 2: Historical Traffic Replay (Abishek Joseph E)
│   │   │   ├── simulation/
│   │   │   │   └── page.tsx      # Page 3: Simulation Lab (Naveen Kumar R V)
│   │   │   └── analysis/
│   │   │       └── page.tsx      # Page 4: Statistical Analysis (Shirley S)
│   │   ├── components/
│   │   │   └── layout/           # Navbar, Footer, shared widgets
│   │   └── lib/
│   │       ├── api.ts            # Centralized typed HTTP API client
│   │       ├── types.ts          # Shared TypeScript interfaces
│   │       └── utils.ts          # Statistical and UI formatters
│
└── backend/                      # Python FastAPI Statistical Backend
    ├── requirements.txt
    ├── .env.example
    ├── pytest.ini
    └── app/
        ├── __init__.py
        ├── main.py               # FastAPI application entry point
        ├── api/
        │   ├── __init__.py
        │   └── routes.py         # REST endpoints for detection & analysis
        ├── core/
        │   ├── __init__.py
        │   ├── poisson.py        # Independent, authoritative Poisson engine
        │   └── schemas.py        # Pydantic data contracts and models
        ├── services/
        │   ├── __init__.py
        │   ├── traffic_simulator.py  # Deterministic scenario generator
        │   ├── evaluation.py     # Confusion matrix & performance metrics
        │   └── data_loader.py    # Historical dataset loader (Phase 2)
        └── tests/
            ├── __init__.py
            ├── test_poisson.py   # Mathematical engine unit tests
            └── test_api.py       # API integration tests
```

Responsibilities of shared backend modules:
- `poisson.py`: estimate baseline arrival rate, calculate Poisson upper-tail probability via SciPy survival function, and evaluate burst decisions. Completely independent of frameworks.
- `schemas.py`: Pydantic models enforcing common observation schema and distinct measurement types.
- `traffic_simulator.py`: generate reproducible synthetic scenarios with ground truth.
- `evaluation.py`: calculate confusion matrix, precision, recall, F1, FPR, and detection delay against ground truth.
- `data_loader.py`: prepare historical CSV flow records and future PCAP packet captures.

Every API endpoint, simulation, and hardware-monitoring feature must use the same authoritative `poisson.py` implementation. The frontend never duplicates statistical calculations in TypeScript.

## 9. Finalized Technology Stack

- **Frontend:** Next.js 16+ (React 19, TypeScript, Tailwind CSS, App Router).
- **Frontend Visualization:** Recharts for responsive, interactive probability and time-series charts.
- **Frontend Icons:** Lucide React.
- **Backend:** Python 3.11+, FastAPI, Uvicorn (ASGI server).
- **Statistical & Scientific Computing:** SciPy (Poisson PMF and survival function `poisson.sf`), NumPy (numerical arrays and random state generation), Pandas (dataset manipulation).
- **Data Validation & Schemas:** Pydantic v2.
- **Testing:** Pytest and HTTPX for backend unit and integration tests; ESLint, TypeScript compiler (`tsc`), and Next.js build for frontend validation.
- **Transport / Hardware Testbed:** Python `socket` UDP receiver (Phase 3).
- **Network Boundaries:** CORS configured strictly for local development origins (`http://127.0.0.1:3000`, `http://localhost:3000`).

## 10. Experiments to Run

Run and document at least these experiments:

### Experiment A — Significance level
Compare `alpha = 0.05`, `0.01`, and `0.001` on identical data. Compare alerts, false-positive rate, and recall where ground truth exists.

### Experiment B — Burst intensity
Vary the burst magnitude/rate and compare detection results.

### Experiment C — Window duration
Compare multiple observation-window sizes. Discuss the trade-off between time resolution and aggregated counts. Scale the expected Poisson count consistently for each duration.

### Experiment D — Historical data
Analyze recorded network activity and investigate flagged intervals. Compare with suitable labels only when their meaning and time alignment support it.

### Experiment E — Arduino testbed
Collect baseline measurements, trigger a known burst, save actual received counts and timestamps, and observe detector response. Repeat at multiple sending rates and significance thresholds.

### Additional investigation — Model suitability
Examine sample mean, sample variance, variance-to-mean ratio, changing rate, and overdispersion. Discuss how deviations from Poisson assumptions can affect alerts and false positives.

For each experiment, save the input/configuration, random seed when applicable, observations, detected intervals, plots, results, and conclusion. Clearly distinguish measured data from illustrative examples.

## 11. Validation and Quality Requirements

### Mathematical tests
- Verify Poisson upper-tail probabilities against known cases or SciPy reference calculations.
- Test zero expected rate, zero observed count, invalid negative values, invalid alpha values, and non-integer counts where relevant.
- Ensure `P(X >= x)` is implemented correctly.
- Ensure consistent decisions for the same data and parameters.

### Data and software tests
- Historical file validation and malformed inputs.
- Timestamp parsing and timezone handling where relevant.
- Time-window aggregation and empty windows.
- Reproducible synthetic simulations.
- Hardware receiver operation and received-count correctness.
- Missing ground truth.
- Shared results across all pages.
- Report exports matching the selected experiment.

### Statistical interpretation
- A high count is an alert candidate, not proof of an attack.
- A smaller alpha usually makes the decision more stringent; evaluate the actual change in performance rather than assuming a guaranteed outcome for every dataset.
- Testing many windows can produce some false alarms even under a suitable model.
- A burst contaminating the baseline can reduce sensitivity.
- Real communication traffic may not follow a constant-rate Poisson process.
- Do not invent results, performance percentages, or empirical findings.

## 12. Development Plan & Implementation Status

1. **Agree on contracts:** finalized shared data schema, module names, page inputs/outputs, and detection function signature. *(COMPLETED - Milestone 1)*
2. **Build the statistical engine:** implemented and tested baseline estimation, upper-tail probability, and the alert rule in `backend/app/core/poisson.py`. *(COMPLETED - Milestone 1)*
3. **Build software simulation (Milestone 2 - COMPLETED):**
   - Implemented synthetic traffic simulator with 4 reproducible scenarios (`poisson_normal`, `sudden_burst`, `rate_drift`, `overdispersed`).
   - Rate semantics strictly defined: $\lambda_{window} = \text{baseline\_rate\_per\_second} \times \text{window\_seconds}$. The Poisson detector receives expected counts per window.
   - Deterministic simulations using NumPy `default_rng(seed)`.
   - Independent ground-truth labeling for sudden burst windows $[t_{start}, t_{start} + t_{duration})$.
   - Negative Binomial dispersion parameterization: $p = 1/k, n = \mu / (k - 1)$, producing exact $\mathbb{E}[X] = \mu$ and $\text{Var}(X) = k \cdot \mu$.
   - Statistical evaluation service calculating TP, FP, TN, FN, Precision, Recall, F1, FPR, and detection delay.
   - Connected end-to-end to Next.js 16 Simulation Lab at `/simulation` with real FastAPI backend, Recharts visualization, parameter validation, and individual window inspector.
4. **Develop pages in parallel:** each member works on their assigned page against the agreed interfaces. *(IN PROGRESS)*
5. **Integrate historical processing (Milestone 3 - COMPLETED):**
   - Implemented `HistoricalDataLoader` in `backend/app/services/data_loader.py` for CSV flow summary ingestion (up to 50 MB).
   - Added `POST /api/historical/preview` for column inspection, sample preview, and auto-suggestion of timestamp and label columns.
   - Added `POST /api/historical/analyze` for time-window flow aggregation ($W \in [1, 60]$s), baseline calibration, and upper-tail Poisson detection.
   - Preserved strict measurement semantics: measurement type is `flow_count` ("Network flows per observation window").
   - Baseline calibration automatically excludes labeled attack windows to prevent baseline contamination.
   - Evaluation metrics (Precision, Recall, F1, FPR, Confusion Matrix) calculated when ground truth labels are provided; cleanly omitted for unlabeled datasets without fabrication.
   - Replay interface at `/historical` fully connected: timeline visualization, play/pause scrubber, window inspector, and aggregated results CSV export.
   - PCAP raw packet capture processing documented as future work.
6. **Unified Dashboard & Cross-Page Integration (Milestone 4 - COMPLETED):**
   - Implemented persistent SQLite experiment repository at `backend/data/experiments.db` with WAL mode and atomic transactions via `backend/app/services/experiment_repository.py`.
   - Automatic persistence for every completed simulation (`POST /api/simulation/generate`) and historical analysis (`POST /api/historical/analyze`). Dataset preview operations are strictly non-persistent.
   - Experiment management REST endpoints: `GET /api/experiments`, `GET /api/experiments/{id}`, `DELETE /api/experiments/{id}`, `GET /api/experiments/{id}/export`, and `GET /api/dashboard/summary`.
   - Unified Dashboard (`frontend/src/app/page.tsx`) displaying real persisted metrics, empty state handling, latest experiment spotlight, detection timeline rendered from saved observation data, recent experiments table, and quick cross-page navigation.
   - Dedicated Experiment History page (`frontend/src/app/experiments/page.tsx`) with pagination, filtering by experiment type (`simulation`, `historical`), search by title or dataset name, creation date sorting, complete stored parameter/observation inspection, CSV result export, and side-by-side experiment comparison with semantic incompatibility warnings.
   - Statistical Analysis integration (`frontend/src/app/analysis/page.tsx`) featuring a saved experiment selector to inspect empirical parameters ($\hat{\lambda}, W, \bar{X}, s^2, D = s^2/\bar{X}$) and evaluation metrics while clearly differentiating interactive hypothetical calculations.
   - Strict measurement semantics preserved across all pages: simulated packet counts and historical flow counts remain segregated and never conflated into an artificial common rate.
   - Survives backend restarts and page reloads; 84 backend unit/integration tests and complete Next.js production build passing.
7. **Advanced Statistical Analysis & Experiment Report Generation (Milestone 5 - COMPLETED):**
   - Implemented exact Garwood Poisson confidence intervals for baseline parameter uncertainty using the central chi-square distribution: $\lambda \in \left[\frac{1}{2n}\chi^2_{2T, \alpha/2}, \frac{1}{2n}\chi^2_{2(T+1), 1-\alpha/2}\right]$.
   - Implemented Pearson Chi-Square Goodness-of-Fit test with dynamic category pooling ($E_i \ge 5.0$) against both calibrated baseline and empirical sample mean, with strict degrees-of-freedom validation ($df > 0$) and accessible non-misleading interpretations.
   - Built Empirical vs Theoretical Poisson Distribution Fit Explorer with relative frequencies and theoretical PMF points.
   - Implemented non-mutating Threshold Sensitivity Analysis (`POST /api/experiments/{id}/threshold-analysis`), evaluating detection outcomes across multiple significance levels without altering the saved experiment record.
   - Implemented publication-grade PDF report generator (`GET /api/experiments/{id}/report.pdf`) using ReportLab and Matplotlib, embedding time-series traffic plots, empirical distribution curves, sensitivity analyses, confusion matrices, and academic discussions.
   - Added PDF report download actions across Statistical Analysis (`/analysis`), Experiment History (`/experiments`), and Dashboard (`/`).
   - Extended backend automated test suite to 99 tests (100% passing) and verified all 17 end-to-end workflow steps.
8. **Software Stabilization, Correctness & Reliability (Phase 6A - COMPLETED):**
   - Conducted comprehensive software audit of mathematical edge cases, persistence integrity, API security, and resource lifecycle.
   - Fixed missing `Optional` typing import in `backend/app/core/poisson.py` preventing `NameError` during runtime type hint introspection.
   - Hardened `backend/app/services/pdf_report_generator.py` with `try...finally: plt.close(fig)` across all figure generators to eliminate memory leaks and replaced raw Unicode Greek symbols with MathText `$\lambda$` and `$\alpha$` to avoid headless font glyph warnings.
   - Fortified `backend/app/api/routes.py` with CRLF/quote sanitization in HTTP `Content-Disposition` attachment headers against header injection attacks.
   - Corrected frontend state management in `/analysis` to reset stale experiment statistics on fetch failure, and awaited experiment table reloading upon deletion in `/experiments`.
   - Verified exact mathematical properties: strict upper-tail inequality ($p < \alpha$), Garwood CI monotonicity across confidence levels, dynamic chi-square bin pooling ($df > 0$), and non-mutating threshold sensitivity.
   - Added `backend/app/tests/test_stability_and_correctness.py` with 14 unit and integration regression tests.
   - Expanded backend test suite to 113 passing tests (100% pass across all 9 modules) with 0 failures, 17/17 passing E2E verification steps, and clean Next.js production build (`tsc`, `lint`, `build`).
9. **UI/UX Refactor & Design System (Phase 6B - COMPLETED):**
   - Transformed the full-stack web application into a cohesive, minimalist, high-contrast technical product aesthetic using a unified dark graphite and primary orange (`#FF6A00`) palette.
   - Implemented a coherent 3-font typography system via Next.js Google Fonts: `Space Grotesk` for headings, `Inter` for body/UI controls, and `JetBrains Mono` for numerical values, rates, p-values, $\lambda$, and $\alpha$.
   - Built a shared UI component architecture: `PageHeader` with contextual action slots, `MetricCard` with monospace metrics and subtle graphite borders, `StatusBadge` for semantics-driven tags, and `EmptyState` for missing datasets and experiments.
   - Refactored `Navbar` with responsive max-1600px width, live API status heartbeat with reconnect trigger, and accessible mobile slide-out navigation drawer with keyboard Escape dismissal.
   - Overhauled all 5 application routes (`/`, `/simulation`, `/historical`, `/analysis`, `/experiments`), utilizing full viewport width up to 1600px, responsive 2-column/1-column reflows, and zero horizontal page overflow.
   - Preserved all mathematical formulas, backend endpoints, database persistence schemas, and experiment result integrity without introducing fabricated data.
   - Verified via automated tools: `tsc --noEmit` (0 errors), `npm run lint` (0 errors, 0 warnings), `npm run build` (production Turbopack build passed), `pytest` (113/113 passed), and headless browser subagent visual verification across Desktop (1440x900), Tablet (768x1024), and Mobile (375x812) resolutions.
10. **Physical Hardware Testbed (Milestone 7 - FUTURE WORK):** Confirm Arduino microcontroller board models, implement UDP datagram listener service on the monitoring laptop, and test live arrival monitoring from 4 Arduino microcontrollers over a local private network. (Hardware integration has not been implemented yet).
11. **Final Micro-Project Submission & Viva Presentation:** Run comprehensive comparative experiments, export empirical figures and tables, and prepare project demonstration and viva defense.

Integrate early. Do not wait until every page is finished before testing the shared data contracts or detector.

## 13. Decisions Still Pending

The following are not finalized and must remain marked as pending until the team confirms them:

1. Exact Arduino board models and available networking hardware (Ethernet shields vs. Wi-Fi modules).
2. Whether CSV support alone is sufficient for the final delivery or PCAP packet capture processing is required.
3. Whether the laptop will remotely trigger Arduino burst modes or the devices will use preconfigured physical buttons/timers.
4. Experiment database storage: RESOLVED — lightweight SQLite repository implemented at `backend/data/experiments.db`.
5. Final visual styling and deployment approach.

## 14. Success Criteria

The project is considered functionally complete when:

- The four pages are integrated in one application.
- Historical observations can be loaded and analyzed with a clearly identified measurement type.
- Synthetic traffic and known bursts can be generated reproducibly.
- Four compatible Arduino devices can send traffic to the laptop receiver, or any hardware limitation is clearly documented if the physical setup cannot yet be completed.
- One shared Poisson engine is used by all modes.
- The detector displays the upper-tail probability, alpha threshold, and decision for observations.
- Results are evaluated against ground truth where valid labels exist.
- Mean/variance and model limitations are investigated.
- Reports and graphs contain actual outputs and reproducible configurations.
- The team can explain the mathematical method, assumptions, experiment design, and limitations during the presentation.

**Core design principle:** Historical traffic, synthetic simulation, and Arduino-generated traffic must share the same validated statistical detection engine, while keeping their measurement types distinct. The project should show not only how Poisson-based burst detection works, but also how well it performs and why its assumptions matter.
