# PoissonBurst Lab

> **Traffic Burst Detection in Communication Networks Using Poisson Distribution**  
> **Course:** Probability and Statistics for Computer Science (25CS203)  
> **Institution:** Karunya Institute of Technology and Sciences  

---

## 1. Project Purpose

PoissonBurst Lab is a specialized network traffic monitoring and statistical experimentation platform. Its primary objective is to detect statistically unusual traffic arrivals in communication networks using the Poisson distribution, evaluate detection sensitivity and false alarms, and demonstrate the foundational mathematical concepts of probability and statistics in computer systems.

The platform is designed to process traffic arrivals from three primary sources:
1. **Historical Network Datasets:** Recorded CSV flow summaries and packet captures (e.g., CICIDS2017).
2. **Synthetic Traffic Simulation:** Reproducible, controlled experiments with known injected bursts and ground truth.
3. **Physical Hardware Testbed:** Local UDP datagram arrivals transmitted by four Arduino microcontrollers across a private network.

All three sources route their arrival counts through the **same authoritative Python statistical engine**.

---

## 2. Team Members & Page Ownership

| Member | Register Number | Role / Primary Ownership |
|---|---|---|
| **Juvansan H** | URK25CS1018 | Lead Full-Stack Engineer / Dashboard (`/`) |
| **Abishek Joseph E** | URK25CS1002 | Historical Traffic Replay (`/historical`) |
| **Naveen Kumar R V** | URK25CS1016 | Simulation Laboratory (`/simulation`) |
| **Shirley S** | URK25CS1081 | Statistical Analysis & Evaluation (`/analysis`) |

---

## 3. Technology Architecture

The system uses a clean full-stack architecture decoupling the frontend presentation layer from the mathematical core:

```
[ Browser / Client ]
        │
        ▼ (HTTP / JSON)
[ Next.js 16 + React 19 + TypeScript + Tailwind CSS ]
        │
        ▼ (REST API: /api/...)
[ FastAPI + Uvicorn Backend (Python 3.11+) ]
        │
        ├─────────────────────────────┐
        ▼                             ▼
[ Authoritative Poisson Engine ]  [ Simulation & Data Services ]
(SciPy poisson.sf, NumPy)        (Deterministic Generator, Metrics)
```

- **Frontend:** Next.js (App Router), React 19, TypeScript, Tailwind CSS, Recharts for charts, Lucide React for icons.
- **Backend:** Python 3.11+, FastAPI, Pydantic v2, SciPy (survival function `poisson.sf`), NumPy, Pandas, Uvicorn.
- **Testing:** Pytest & HTTPX for backend tests; TypeScript type checking, ESLint, and Next.js production build.

---

## 4. Mathematical Foundations

### 4.1 Poisson Model
For fixed-duration observation windows of length $W$ seconds:
$$X_t \sim \text{Poisson}(\lambda)$$
$$\mathbb{P}(X = k) = \frac{e^{-\lambda} \lambda^k}{k!}$$

### 4.2 Baseline Estimation
Given normal traffic observations $X_1, X_2, \dots, X_n$:
$$\hat{\lambda} = \frac{1}{n} \sum_{t=1}^n X_t$$
*Note:* $\hat{\lambda}$ is the expected count per observation window. The arrival rate per second is $\hat{\lambda} / W$.

### 4.3 Upper-Tail Detection Rule
For an observed arrival count $x$ and baseline $\hat{\lambda}$:
$$p = \mathbb{P}(X \ge x \mid \hat{\lambda}) = \sum_{k=x}^{\infty} \frac{e^{-\hat{\lambda}} \hat{\lambda}^k}{k!}$$
Evaluated via SciPy: `poisson.sf(x - 1, lambda_hat)`.

**Decision Rule:**
$$\text{Flag as Burst if } p < \alpha$$
*(Default significance level: $\alpha = 0.01$)*

### 4.4 Index of Dispersion (Mean-Variance Relationship)
In a true Poisson process, $\mathbb{E}[X] = \text{Var}(X) = \lambda$.
The sample variance-to-mean ratio (VMR):
$$D = \frac{s^2}{\bar{X}}$$
- $D \approx 1.0$: Consistent with Poisson.
- $D > 1.0$: Overdispersed (traffic clustering / burstiness).
- $D < 1.0$: Underdispersed (uniformly spaced arrivals).

---

## 5. Project Directory Structure

```text
MicroProject/
├── context.md                    # Single source of truth for micro-project
├── README.md                     # Setup, running, and API documentation
├── .gitignore                    # Git ignore rules for Python and Node
├── pytest.ini                    # Root pytest configuration
│
├── backend/                      # Python FastAPI Statistical Backend
│   ├── requirements.txt          # Python dependencies
│   ├── .env.example              # Environment variables template
│   ├── pytest.ini                # Backend pytest configuration
│   ├── data/                     # Persistent storage (auto-created, git-ignored)
│   │   └── experiments.db        # SQLite database for completed experiments
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI application entry point
│       ├── api/
│       │   ├── __init__.py
│       │   └── routes.py         # REST endpoints for engine, simulation, history, experiments
│       ├── core/
│       │   ├── __init__.py
│       │   ├── poisson.py        # Authoritative, framework-independent Poisson math
│       │   └── schemas.py        # Pydantic data schemas and contracts
│       ├── services/
│       │   ├── __init__.py
│       │   ├── experiment_repository.py # Persistent SQLite storage layer (WAL mode)
│       │   ├── traffic_simulator.py  # Deterministic scenario generator
│       │   ├── evaluation.py     # Confusion matrix & performance evaluation
│       │   └── data_loader.py    # Historical CSV data loader & flow aggregator
│       └── tests/
│           ├── __init__.py
│           ├── test_poisson.py   # Unit tests for baseline, upper tail, edge cases
│           ├── test_traffic_simulator.py # Scenario & deterministic generation tests
│           ├── test_evaluation.py # Performance metric edge-case tests
│           ├── test_data_loader.py # CSV parser and aggregation tests
│           ├── test_experiments.py # Persistent storage, dashboard summary & API tests
│           └── test_api.py       # API integration tests
│
└── frontend/                     # Next.js App Router Web Interface
    ├── package.json              # Node dependencies and scripts
    ├── tsconfig.json             # TypeScript compiler configuration
    ├── next.config.ts            # Next.js configuration
    ├── .env.example              # Frontend environment template
    ├── .env.local                # Local API base URL configuration
    └── src/
        ├── app/
        │   ├── layout.tsx        # Persistent layout with Navbar and Footer
        │   ├── globals.css       # Dark charcoal & orange theme styles
        │   ├── page.tsx          # Page 1: Unified Dashboard (Juvansan H)
        │   ├── historical/
        │   │   └── page.tsx      # Page 2: Historical Traffic Replay (Abishek Joseph E)
        │   ├── simulation/
        │   │   └── page.tsx      # Page 3: Simulation Lab (Naveen Kumar R V)
        │   ├── analysis/
        │   │   └── page.tsx      # Page 4: Statistical Analysis (Shirley S)
        │   └── experiments/
        │       └── page.tsx      # Experiment History & Comparison Matrix
        ├── components/
        │   └── layout/
        │       ├── Navbar.tsx    # Responsive header with live backend status & nav links
        │       └── Footer.tsx    # Academic footer with team details
        └── lib/
            ├── api.ts            # Centralized typed HTTP API client
            ├── types.ts          # Shared TypeScript type definitions
            └── utils.ts          # Statistical formatters and UI utilities
```

---

## 6. Prerequisites

- **Python:** 3.11 or higher (`python --version`)
- **Node.js:** 18.x, 20.x, or 24.x (`node --version`)
- **NPM:** 10.x or 11.x (`npm --version`)
- **Operating System:** Windows PowerShell, macOS, or Linux

---

## 7. Running the Application Locally (Windows PowerShell)

Open two terminal windows:

### Terminal 1 — Backend (FastAPI + Uvicorn)

```powershell
cd backend

# Create virtual environment (if not already created)
python -m venv .venv

# Activate virtual environment
.venv\Scripts\Activate.ps1

# Install dependencies
python -m pip install -r requirements.txt

# Start backend server
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

The FastAPI backend will start at `http://127.0.0.1:8000`.
- API Health: `http://127.0.0.1:8000/api/health`
- Interactive Swagger UI: `http://127.0.0.1:8000/docs`
- ReDoc: `http://127.0.0.1:8000/redoc`

### Terminal 2 — Frontend (Next.js)

```powershell
cd frontend

# Install dependencies
npm install

# Start development server
npm run dev
```

The Next.js frontend will open at `http://localhost:3000`.

---

## 8. Running Automated Tests & Verification

### Backend Tests (Pytest)

Run from either the root or `backend/` directory:

```powershell
# From project root:
python -m pytest -v

# Or from backend directory:
cd backend
python -m pytest -v
```

All 84 unit and integration tests will execute, validating:
- Baseline estimation sample mean calculations.
- Rejection of empty sequences, negative arrival counts, and non-finite values (NaN / infinity).
- SciPy upper-tail probability calculations against reference values.
- Edge cases ($x=0$, $\lambda=0$).
- Upper-tail detection rule ($p < \alpha$) and rejection of invalid $\alpha$.
- Batch detection sequence processing.
- All four simulation scenarios (`poisson_normal`, `sudden_burst`, `rate_drift`, `overdispersed`).
- Deterministic simulation and exact reproducibility with fixed random seeds.
- Verified return to baseline after a sudden burst.
- Window scaling: $\lambda_{window} = \text{baseline\_rate\_per\_second} \times \text{window\_seconds}$.
- Evaluation metrics (TP, FP, TN, FN, Precision, Recall, F1, FPR, Detection Delay) under perfect, missed, false-alarm, and zero-division edge cases.
- Historical CSV upload validation, empty file and size limit checks (< 50 MB).
- Column mapping inference (timestamp and ground-truth label detection).
- Historical flow-count time-window aggregation ($W \in [1, 60]$s).
- Baseline calibration with automated exclusion of labeled attack windows.
- Ground truth flow mapping and evaluation computation.
- Historical API endpoints (`/api/historical/preview`, `/api/historical/analyze`).
- Persistent SQLite experiment repository (`experiments.db`) with WAL mode and atomic transactions.
- Auto-saving completed simulations and historical analyses with exact observation/detection records.
- Experiment retrieval, pagination, filtering by type, and 404 handling.
- Dashboard summary aggregation across actual stored experiment records.
- Result CSV export with observation metadata and clean experiment deletion.
- Dataset previews correctly verified as non-persistent.

### Frontend Typecheck, Lint, and Production Build

```powershell
cd frontend

# TypeScript type checking
npx tsc --noEmit

# ESLint validation (0 errors, 0 warnings)
npm run lint

# Production bundle build
npm run build
```

---

## 9. API Endpoints Reference

| Method | Endpoint | Description | Request / Form Body |
|---|---|---|---|
| `GET` | `/api/health` | Service health status | None |
| `POST` | `/api/poisson/estimate` | Estimate baseline mean count per window ($\hat{\lambda}$) | `{"observations": [10, 12, ...], "window_seconds": 1.0}` |
| `POST` | `/api/poisson/detect` | Evaluate single arrival count for burst | `{"observed_count": 25, "expected_rate": 10.0, "alpha": 0.01}` |
| `POST` | `/api/poisson/detect-batch` | Evaluate sequence of arrival counts | `{"observations": [...], "expected_rate": 10.0, "alpha": 0.01}` |
| `POST` | `/api/poisson/dispersion` | Compute sample mean, variance, and VMR ($D$) | `{"observations": [10, 12, 9, ...]}` |
| `POST` | `/api/poisson/distribution` | Generate PMF and upper-tail curve points | `{"expected_rate": 10.0, "max_k": 35}` |
| `POST` | `/api/simulation/generate` | Run deterministic synthetic simulation & auto-save experiment | `{"scenario": "sudden_burst", "baseline_rate_per_second": 15.0, ...}` |
| `POST` | `/api/historical/preview` | Preview uploaded CSV headers, sample rows, and suggestions (non-persistent) | Multipart Form (`file: UploadFile`) |
| `POST` | `/api/historical/analyze` | Aggregate historical CSV into flow windows, detect bursts & auto-save | Multipart Form (`file`, `timestamp_column`, `label_column`, `window_seconds`, etc.) |
| `GET` | `/api/historical/formats` | List supported historical formats | None |
| `GET` | `/api/dashboard/summary` | Real dashboard summary aggregated across persistent experiments | None |
| `GET` | `/api/experiments` | List stored experiments with pagination, type filtering, and search | Query params (`offset`, `limit`, `experiment_type`, `search`) |
| `GET` | `/api/experiments/{id}` | Retrieve full experiment details, observations, and metrics | Path param (`id`) |
| `DELETE` | `/api/experiments/{id}` | Safely delete a stored experiment record | Path param (`id`) |
| `GET` | `/api/experiments/{id}/export` | Export saved experiment observations and metadata as CSV | Path param (`id`) |

---

## 10. Critical Domain Rules

1. **Upper-Tail Semantics:** Burst detection strictly evaluates $\mathbb{P}(X \ge x)$, calculated as `poisson.sf(x - 1, lambda)`. Point probabilities $\mathbb{P}(X = x)$ must never be used for burst decisions.
2. **Explicit Rate Semantics:** Expected arrival counts per observation window are $\lambda_{window} = \text{baseline\_rate\_per\_second} \times \text{window\_seconds}$. The Poisson detector strictly receives expected counts per window ($\lambda_{window}$).
3. **Ground Truth Independence:** Ground truth labels indicate physical experimental construction or recorded labels, never detector predictions. For historical datasets, flow labels represent connection intent; they do not automatically guarantee volumetric traffic surges.
4. **Measurement Unit Separation:**
   - `packet_count`: Physical packets on the wire (PCAP / simulation).
   - `flow_count`: Aggregated connection records (NetFlow, CICIDS2017 summaries).
   - `udp_datagram_count`: Application-layer datagrams received by the hardware listener.
   These units represent fundamentally distinct arrival processes and must never be conflated.
5. **No Fabricated Operational Metrics:** All statistics displayed in the dashboard, simulation lab, historical replay, and experiment history derive from actual backend responses. When ground truth is unavailable, performance metrics (precision, recall, FPR) are omitted rather than invented.
6. **Persistence Integrity:** Preview operations and failed requests are never stored. Only successfully completed simulations and historical analyses create immutable experiment records.

---

## 11. Project Milestone Status

### Completed: Milestone 1 — Core Architecture & Poisson Engine
- [x] Full-stack architecture with Next.js App Router and FastAPI.
- [x] Authoritative Poisson engine (`poisson.py`) with complete edge-case handling.
- [x] Pydantic data schemas enforcing common traffic contracts.
- [x] Shared TypeScript API client and error handling.
- [x] Application shell, responsive navigation, and initial 4 page layouts.

### Completed: Milestone 2 — End-to-End Traffic Simulation
- [x] Authoritative synthetic traffic generator with 4 distinct scenarios (`poisson_normal`, `sudden_burst`, `rate_drift`, `overdispersed`).
- [x] Deterministic reproducibility using NumPy `default_rng(seed)`.
- [x] Strict rate semantics ($\lambda_{window} = \text{baseline\_rate\_per\_second} \times \text{window\_seconds}$).
- [x] Ground-truth tracking independent of detector predictions.
- [x] Statistically parameterized Negative Binomial generator ($p = 1/k, n = \mu / (k - 1)$) for controlled overdispersion.
- [x] Zero-division-safe evaluation service computing TP, FP, TN, FN, Precision, Recall, F1, FPR, and detection delay.
- [x] Interactive Simulation Lab (`/simulation`) connecting directly to the FastAPI backend.
- [x] Recharts visualization with Injected Burst interval highlighting (`ReferenceArea`), actual counts, and red alert markers.
- [x] Observation inspector with exact p-value formatting and mathematical reasoning.

### Completed: Milestone 3 — Historical Traffic Analysis and Replay
- [x] Historical CSV flow summary parser (`HistoricalDataLoader`) supporting files up to 50 MB.
- [x] `POST /api/historical/preview` for column inspection, sample preview, and auto-suggestion of timestamp and label columns.
- [x] `POST /api/historical/analyze` for time-window flow aggregation ($W \in [1, 60]$s), baseline calibration, and upper-tail Poisson detection.
- [x] Strict measurement semantics: measurement type is `flow_count` ("Network flows per observation window").
- [x] Baseline calibration with automated exclusion of labeled attack windows to prevent baseline contamination.
- [x] Window-level ground truth mapping and performance evaluation (Precision, Recall, F1, FPR, Confusion Matrix).
- [x] Unlabeled dataset support with clean omission of fabricated evaluation metrics.
- [x] Interactive Historical Replay page (`/historical`) with Recharts timeline, play/pause scrubber, speed controls, window inspector, and aggregated CSV export.
- [x] 70 Pytest backend tests passing (100%).

### Completed: Milestone 4 — Unified Dashboard & Cross-Page Integration
- [x] Persistent SQLite experiment repository at `backend/data/experiments.db` with WAL mode and atomic transaction management.
- [x] Auto-saving completed simulations (`POST /api/simulation/generate`) and historical analyses (`POST /api/historical/analyze`) with exact observation and detection records.
- [x] Dataset preview operations strictly non-persistent; no incomplete or failed analyses stored.
- [x] Experiment REST API: `GET /api/experiments`, `GET /api/experiments/{id}`, `DELETE /api/experiments/{id}`, `GET /api/experiments/{id}/export`, and `GET /api/dashboard/summary`.
- [x] Unified Dashboard (`/`) displaying real persisted metrics, empty state handling, latest experiment spotlight, detection timeline from saved observation data, recent experiments table, and quick navigation.
- [x] Dedicated Experiment History page (`/experiments`) with pagination, filtering by experiment and measurement type, title/dataset search, sorting, full observation inspection, and CSV result download.
- [x] Side-by-side Experiment Comparison matrix with semantic incompatibility warnings (preventing invalid cross-measurement comparisons).
- [x] Statistical Analysis page (`/analysis`) integration with saved experiment selector, displaying empirical parameters ($\hat{\lambda}, W, \bar{X}, s^2, D = s^2/\bar{X}$) and evaluation metrics while clearly differentiating interactive hypothetical calculations.
- [x] Persistent experiment badges and cross-page navigation links added to Simulation Lab (`/simulation`) and Historical Replay (`/historical`).
- [x] 84 Pytest backend tests passing (100%).
- [x] Frontend TypeScript typecheck (`tsc`), ESLint (0 errors, 0 warnings), and Next.js production build passing with 0 errors.

### Upcoming: Subsequent Milestones
- **Milestone 5 (Arduino Hardware Testbed):** UDP listener service collecting live datagrams from 4 microcontrollers on a local network.
- **Milestone 6 (Comprehensive Reporting & Viva Preparation):** Final empirical report generation, defense presentation materials, and project documentation polish.


