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
│   └── app/
│       ├── __init__.py
│       ├── main.py               # FastAPI application entry point
│       ├── api/
│       │   ├── __init__.py
│       │   └── routes.py         # REST endpoints for Poisson engine & simulation
│       ├── core/
│       │   ├── __init__.py
│       │   ├── poisson.py        # Authoritative, framework-independent Poisson math
│       │   └── schemas.py        # Pydantic data schemas and contracts
│       ├── services/
│       │   ├── __init__.py
│       │   ├── traffic_simulator.py  # Deterministic scenario generator
│       │   ├── evaluation.py     # Confusion matrix & performance evaluation
│       │   └── data_loader.py    # Historical data loader (Phase 2 preparation)
│       └── tests/
│           ├── __init__.py
│           ├── test_poisson.py   # Unit tests for baseline, upper tail, edge cases
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
        │   ├── page.tsx          # Page 1: Dashboard (Juvansan H)
        │   ├── historical/
        │   │   └── page.tsx      # Page 2: Historical Traffic Replay (Abishek Joseph E)
        │   ├── simulation/
        │   │   └── page.tsx      # Page 3: Simulation Lab (Naveen Kumar R V)
        │   └── analysis/
        │       └── page.tsx      # Page 4: Statistical Analysis (Shirley S)
        ├── components/
        │   └── layout/
        │       ├── Navbar.tsx    # Responsive header with live backend status
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

All 34 unit and integration tests will execute, validating:
- Baseline estimation sample mean calculations.
- Rejection of empty sequences, negative arrival counts, and non-finite values (NaN / infinity).
- SciPy upper-tail probability calculations against reference values.
- Edge cases ($x=0$, $\lambda=0$).
- Upper-tail detection rule ($p < \alpha$) and rejection of invalid $\alpha$.
- Batch detection sequence processing.
- Simulation determinism and reproducibility with fixed seeds.
- API validation and HTTP 422 / 400 responses.

### Frontend Typecheck, Lint, and Production Build

```powershell
cd frontend

# TypeScript type checking
npx tsc --noEmit

# ESLint validation
npm run lint

# Production bundle build
npm run build
```

---

## 9. API Endpoints Reference

| Method | Endpoint | Description | Request Body |
|---|---|---|---|
| `GET` | `/api/health` | Service health status | None |
| `POST` | `/api/poisson/estimate` | Estimate baseline mean count per window ($\hat{\lambda}$) | `{"observations": [10, 12, ...], "window_seconds": 1.0}` |
| `POST` | `/api/poisson/detect` | Evaluate single arrival count for burst | `{"observed_count": 25, "expected_rate": 10.0, "alpha": 0.01}` |
| `POST` | `/api/poisson/detect-batch` | Evaluate sequence of arrival counts | `{"observations": [...], "expected_rate": 10.0, "alpha": 0.01}` |
| `POST` | `/api/poisson/dispersion` | Compute sample mean, variance, and VMR ($D$) | `{"observations": [10, 12, 9, ...]}` |
| `POST` | `/api/poisson/distribution` | Generate PMF and upper-tail curve points | `{"expected_rate": 10.0, "max_k": 35}` |
| `POST` | `/api/simulation/generate` | Run deterministic synthetic simulation | `{"scenario": "sudden_burst", "baseline_rate": 15.0, ...}` |
| `GET` | `/api/historical/formats` | List supported historical formats | None |

---

## 10. Critical Domain Rules

1. **Upper-Tail Semantics:** Burst detection strictly evaluates $\mathbb{P}(X \ge x)$, calculated as `poisson.sf(x - 1, lambda)`. Point probabilities $\mathbb{P}(X = x)$ must never be used for burst decisions.
2. **Measurement Unit Separation:**
   - `packet_count`: Physical packets on the wire (PCAP).
   - `flow_count`: Aggregated connection records (NetFlow, CICIDS2017 summaries).
   - `udp_datagram_count`: Application-layer datagrams received by the hardware listener.
   These units represent fundamentally distinct arrival processes and must never be conflated.
3. **Unlabeled Semantics:** Historical records without confirmed attack labels must remain classified as unlabeled; they must not be assumed to be benign.
4. **No Fabricated Operational Metrics:** All statistics displayed in the dashboard and analysis pages derive from actual backend responses.

---

## 11. Current Milestone Status & Future Work

### Implemented in Milestone 1:
- [x] Full-stack architecture with Next.js App Router and FastAPI.
- [x] Authoritative Poisson engine (`poisson.py`) with complete edge-case handling.
- [x] Pydantic data schemas enforcing common traffic contracts.
- [x] All required FastAPI endpoints with local development CORS.
- [x] 34 automated unit and integration tests passing in Pytest.
- [x] Next.js frontend with dark charcoal & orange visual design.
- [x] Page 1: Dashboard with live calibration runner, timeline, recent events, and empty state.
- [x] Page 2: Historical Replay layout with file upload dropzone, schema preview, and unit selectors.
- [x] Page 3: Simulation Lab with scenario controls, random seed reproducibility, and confusion matrix.
- [x] Page 4: Statistical Analysis with live Poisson calculator, PMF explorer, and dispersion analyzer.
- [x] Centralized typed API client (`api.ts`).
- [x] Frontend production build and ESLint passing cleanly with 0 errors.

### Planned for Subsequent Phases:
- **Phase 2 (Historical Data Ingestion):** Chunked CSV file streaming and optional Scapy-based PCAP packet counting.
- **Phase 3 (Physical Hardware Testbed):** Python UDP socket server listening on local network port to aggregate incoming datagrams from 4 Arduino microcontrollers once hardware boards are confirmed.
- **Phase 4 (Experiment Reporting):** Automated PDF/CSV export of experimental curves and confusion matrices for the project report.
