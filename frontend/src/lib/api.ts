/**
 * PoissonBurst Lab - Centralized Typed API Client.
 *
 * Connects the Next.js frontend to the authoritative FastAPI backend.
 * Never fabricates results or silently swallows connection errors.
 */

import {
  BaselineEstimateRequest,
  BaselineEstimateResponse,
  BatchDetectionRequest,
  BatchDetectionResponse,
  DashboardSummaryResponse,
  DetectionRequest,
  DetectionResponse,
  DispersionRequest,
  DispersionResponse,
  DistributionRequest,
  DistributionResponse,
  ExperimentDetailResponse,
  ExperimentListResponse,
  ExperimentStatisticsResponse,
  HealthResponse,
  HistoricalAnalysisParams,
  HistoricalAnalysisResponse,
  HistoricalPreviewResponse,
  SimulationRequest,
  SimulationResponse,
  ThresholdAnalysisResponse,
  HardwareStartRequest,
  HardwareStartResponse,
  HardwareCalibrationFinalizeResponse,
  HardwareStatusResponse,
  HardwareLiveWindowsResponse,
  HardwareStopResponse,
  DatasetListResponse,
  DatasetSummaryResponse,
  TimeSeriesResponse,
  SeriesStatistics,
  AllSeriesStatisticsResponse,
  UniversitySpikesResponse,
} from './types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL || 'http://127.0.0.1:8000';

class ApiClientError extends Error {
  public statusCode?: number;
  public details?: unknown;

  constructor(message: string, statusCode?: number, details?: unknown) {
    super(message);
    this.name = 'ApiClientError';
    this.statusCode = statusCode;
    this.details = details;
  }
}

async function request<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${endpoint}`;
  const isFormData = typeof FormData !== 'undefined' && options?.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
    ...((options?.headers as Record<string, string>) || {}),
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      let errorDetail = `HTTP ${res.status}: ${res.statusText}`;
      try {
        const errorJson = await res.json();
        if (errorJson.detail) {
          if (typeof errorJson.detail === 'string') {
            errorDetail = errorJson.detail;
          } else if (Array.isArray(errorJson.detail)) {
            errorDetail = errorJson.detail.map((d: { msg?: string }) => d.msg || JSON.stringify(d)).join(', ');
          } else {
            errorDetail = JSON.stringify(errorJson.detail);
          }
        }
      } catch {
        // If not JSON, use default statusText
      }
      throw new ApiClientError(errorDetail, res.status);
    }

    return (await res.json()) as T;
  } catch (error: unknown) {
    if (error instanceof ApiClientError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : 'Unknown network error';
    throw new ApiClientError(
      `Failed to connect to PoissonBurst backend at ${API_BASE_URL}: ${message}. Ensure the FastAPI server is running.`,
      0
    );
  }
}

export const api = {
  /**
   * Check backend health and connectivity.
   */
  async checkHealth(): Promise<HealthResponse> {
    return request<HealthResponse>('/api/health', { method: 'GET' });
  },

  /**
   * Estimate baseline arrival rate from normal observation counts.
   */
  async estimateBaseline(
    payload: BaselineEstimateRequest
  ): Promise<BaselineEstimateResponse> {
    return request<BaselineEstimateResponse>('/api/poisson/estimate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Evaluate a single observation for a statistically unusual burst.
   */
  async detectBurst(payload: DetectionRequest): Promise<DetectionResponse> {
    return request<DetectionResponse>('/api/poisson/detect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Evaluate a batch of observations against a baseline rate.
   */
  async detectBurstBatch(
    payload: BatchDetectionRequest
  ): Promise<BatchDetectionResponse> {
    return request<BatchDetectionResponse>('/api/poisson/detect-batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Calculate sample mean, variance, and variance-to-mean dispersion ratio.
   */
  async evaluateDispersion(
    payload: DispersionRequest
  ): Promise<DispersionResponse> {
    return request<DispersionResponse>('/api/poisson/dispersion', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Compute Poisson PMF and upper-tail distribution points for visualization.
   */
  async getPoissonDistribution(
    payload: DistributionRequest
  ): Promise<DistributionResponse> {
    return request<DistributionResponse>('/api/poisson/distribution', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Run a reproducible synthetic traffic simulation experiment.
   */
  async runSimulation(
    payload: SimulationRequest
  ): Promise<SimulationResponse> {
    return request<SimulationResponse>('/api/simulation/generate', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  /**
   * Get supported historical formats and domain notices.
   */
  async getHistoricalFormats(): Promise<{ supported_formats: unknown[]; guidelines: Record<string, string> }> {
    return request('/api/historical/formats', { method: 'GET' });
  },

  /**
   * Upload and preview a historical CSV dataset.
   */
  async previewHistoricalDataset(file: File): Promise<HistoricalPreviewResponse> {
    const formData = new FormData();
    formData.append('file', file);
    return request<HistoricalPreviewResponse>('/api/historical/preview', {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Run complete historical time-window flow aggregation, baseline calibration, and burst detection.
   */
  async analyzeHistoricalDataset(
    params: HistoricalAnalysisParams
  ): Promise<HistoricalAnalysisResponse> {
    const formData = new FormData();
    formData.append('file', params.file);
    formData.append('timestamp_column', params.timestamp_column);
    if (params.label_column) {
      formData.append('label_column', params.label_column);
    }
    if (params.benign_label_value) {
      formData.append('benign_label_value', params.benign_label_value);
    }
    formData.append('window_seconds', String(params.window_seconds));
    if (params.baseline_mode) {
      formData.append('baseline_mode', params.baseline_mode);
    }
    if (params.baseline_ratio !== undefined) {
      formData.append('baseline_ratio', String(params.baseline_ratio));
    }
    if (params.baseline_window_count !== undefined) {
      formData.append('baseline_window_count', String(params.baseline_window_count));
    }
    if (params.baseline_start_timestamp) {
      formData.append('baseline_start_timestamp', params.baseline_start_timestamp);
    }
    if (params.baseline_end_timestamp) {
      formData.append('baseline_end_timestamp', params.baseline_end_timestamp);
    }
    formData.append('alpha', String(params.alpha));

    return request<HistoricalAnalysisResponse>('/api/historical/analyze', {
      method: 'POST',
      body: formData,
    });
  },

  /**
   * Fetch live dashboard statistics calculated from persisted experiments.
   */
  async getDashboardSummary(): Promise<DashboardSummaryResponse> {
    return request<DashboardSummaryResponse>('/api/dashboard/summary', { method: 'GET' });
  },

  /**
   * List saved experiments with pagination, filtering, and search.
   */
  async listExperiments(params?: {
    page?: number;
    page_size?: number;
    type?: string;
    search?: string;
  }): Promise<ExperimentListResponse> {
    const query = new URLSearchParams();
    if (params?.page) query.append('page', String(params.page));
    if (params?.page_size) query.append('page_size', String(params.page_size));
    if (params?.type && params.type !== 'all') query.append('type', params.type);
    if (params?.search && params.search.trim()) query.append('search', params.search.trim());

    const queryString = query.toString();
    const endpoint = queryString ? `/api/experiments?${queryString}` : '/api/experiments';
    return request<ExperimentListResponse>(endpoint, { method: 'GET' });
  },

  /**
   * Retrieve full details of an experiment by ID.
   */
  async getExperimentDetail(experimentId: string): Promise<ExperimentDetailResponse> {
    return request<ExperimentDetailResponse>(`/api/experiments/${encodeURIComponent(experimentId)}`, {
      method: 'GET',
    });
  },

  /**
   * Delete a saved experiment by ID.
   */
  async deleteExperiment(experimentId: string): Promise<{ status: string; experiment_id: string }> {
    return request<{ status: string; experiment_id: string }>(
      `/api/experiments/${encodeURIComponent(experimentId)}`,
      { method: 'DELETE' }
    );
  },

  /**
   * Get direct download URL for experiment CSV export.
   */
  getExperimentExportUrl(experimentId: string): string {
    return `${API_BASE_URL}/api/experiments/${encodeURIComponent(experimentId)}/export`;
  },

  /**
   * Download experiment results as CSV directly from browser.
   */
  async downloadExperimentCsv(experimentId: string, fallbackFilename?: string): Promise<void> {
    const url = `${API_BASE_URL}/api/experiments/${encodeURIComponent(experimentId)}/export`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new ApiClientError(`Failed to download experiment CSV (HTTP ${res.status})`, res.status);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition');
    let filename = fallbackFilename || `experiment_${experimentId}.csv`;
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },

  /**
   * Retrieve advanced statistical summaries, exact Poisson confidence interval,
   * and Pearson Chi-Square goodness-of-fit diagnostics for a saved experiment.
   */
  async getExperimentStatistics(experimentId: string): Promise<ExperimentStatisticsResponse> {
    return request<ExperimentStatisticsResponse>(
      `/api/experiments/${encodeURIComponent(experimentId)}/statistics`,
      { method: 'GET' }
    );
  },

  /**
   * Run threshold sensitivity analysis across multiple significance levels
   * without mutating the saved experiment record.
   */
  async runThresholdAnalysis(
    experimentId: string,
    alphas: number[] = [0.10, 0.05, 0.01, 0.005, 0.001]
  ): Promise<ThresholdAnalysisResponse> {
    return request<ThresholdAnalysisResponse>(
      `/api/experiments/${encodeURIComponent(experimentId)}/threshold-analysis`,
      {
        method: 'POST',
        body: JSON.stringify({ alphas }),
      }
    );
  },

  /**
   * Get direct download URL for the experiment's publication-grade PDF report.
   */
  getExperimentReportUrl(experimentId: string): string {
    return `${API_BASE_URL}/api/experiments/${encodeURIComponent(experimentId)}/report.pdf`;
  },

  /**
   * Download a professional PDF experiment report directly in the browser.
   */
  async downloadExperimentReportPdf(experimentId: string, fallbackFilename?: string): Promise<void> {
    const url = `${API_BASE_URL}/api/experiments/${encodeURIComponent(experimentId)}/report.pdf`;
    const res = await fetch(url);
    if (!res.ok) {
      throw new ApiClientError(`Failed to generate PDF experiment report (HTTP ${res.status})`, res.status);
    }
    const blob = await res.blob();
    const disposition = res.headers.get('Content-Disposition');
    let filename = fallbackFilename || `PoissonBurst_Report_${experimentId}.pdf`;
    if (disposition && disposition.includes('filename=')) {
      const match = disposition.match(/filename="?([^"]+)"?/);
      if (match && match[1]) {
        filename = match[1];
      }
    }

    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(downloadUrl);
  },

  // ===========================================================================
  // Hardware Session & Monitoring Endpoints (Phase 5 / Phase 6)
  // ===========================================================================

  /**
   * Start a hardware telemetry session, bind UDP socket, and begin baseline calibration.
   */
  async startHardwareSession(
    payload?: HardwareStartRequest
  ): Promise<HardwareStartResponse> {
    return request<HardwareStartResponse>('/api/hardware/start', {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  /**
   * Finalize the baseline calibration phase, calculate lambda hat, and enter monitoring.
   */
  async finalizeHardwareCalibration(): Promise<HardwareCalibrationFinalizeResponse> {
    return request<HardwareCalibrationFinalizeResponse>('/api/hardware/calibration/finalize', {
      method: 'POST',
    });
  },

  /**
   * Inspect comprehensive real-time hardware status, packet counters, and node liveness.
   */
  async getHardwareStatus(): Promise<HardwareStatusResponse> {
    return request<HardwareStatusResponse>('/api/hardware/status', {
      method: 'GET',
    });
  },

  /**
   * Retrieve recent completed observation windows and burst detection decisions.
   */
  async getHardwareLive(
    limit: number = 50,
    afterWindowIndex?: number
  ): Promise<HardwareLiveWindowsResponse> {
    const params = new URLSearchParams();
    if (limit) params.append('limit', String(limit));
    if (afterWindowIndex !== undefined && afterWindowIndex !== null) {
      params.append('after_window_index', String(afterWindowIndex));
    }
    const qs = params.toString();
    const endpoint = qs ? `/api/hardware/live?${qs}` : '/api/hardware/live';
    return request<HardwareLiveWindowsResponse>(endpoint, {
      method: 'GET',
    });
  },

  /**
   * Cleanly terminate the active hardware session and retrieve in-memory summary.
   */
  async stopHardwareSession(): Promise<HardwareStopResponse> {
    return request<HardwareStopResponse>('/api/hardware/stop', {
      method: 'POST',
    });
  },

  /**
   * Retry persisting a stopped hardware session whose previous save failed.
   */
  async retryHardwarePersistence(sessionId?: string): Promise<HardwareStopResponse> {
    const qs = sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : '';
    return request<HardwareStopResponse>(`/api/hardware/persist/retry${qs}`, {
      method: 'POST',
    });
  },

  // =========================================================================
  // University Network Analytics Endpoints
  // =========================================================================

  /**
   * List available university network datasets and their metadata overview.
   */
  async getUniversityDatasets(): Promise<DatasetListResponse> {
    return request<DatasetListResponse>('/api/university-network/datasets', {
      method: 'GET',
    });
  },

  /**
   * Retrieve comprehensive summary metrics and data quality info for a dataset.
   */
  async getUniversityDatasetSummary(datasetId: string): Promise<DatasetSummaryResponse> {
    return request<DatasetSummaryResponse>(
      `/api/university-network/datasets/${encodeURIComponent(datasetId)}/summary`,
      { method: 'GET' }
    );
  },

  /**
   * Retrieve time-series telemetry observations for selected series.
   */
  async getUniversityTimeSeries(
    datasetId: string,
    params?: {
      series_ids?: string;
      include_boundary_rows?: boolean;
      start_time?: number;
      end_time?: number;
      limit?: number;
      offset?: number;
    }
  ): Promise<TimeSeriesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.series_ids) searchParams.append('series_ids', params.series_ids);
    if (params?.include_boundary_rows !== undefined) {
      searchParams.append('include_boundary_rows', String(params.include_boundary_rows));
    }
    if (params?.start_time !== undefined && params?.start_time !== null) {
      searchParams.append('start_time', String(params.start_time));
    }
    if (params?.end_time !== undefined && params?.end_time !== null) {
      searchParams.append('end_time', String(params.end_time));
    }
    if (params?.limit !== undefined && params?.limit !== null) {
      searchParams.append('limit', String(params.limit));
    }
    if (params?.offset !== undefined && params?.offset !== null) {
      searchParams.append('offset', String(params.offset));
    }
    const qs = searchParams.toString();
    const endpoint = `/api/university-network/datasets/${encodeURIComponent(datasetId)}/series${qs ? `?${qs}` : ''}`;
    return request<TimeSeriesResponse>(endpoint, { method: 'GET' });
  },

  /**
   * Retrieve statistics for an individual measurement series.
   */
  async getUniversitySeriesStatistics(
    datasetId: string,
    seriesId: string
  ): Promise<SeriesStatistics> {
    return request<SeriesStatistics>(
      `/api/university-network/datasets/${encodeURIComponent(datasetId)}/series/${encodeURIComponent(seriesId)}/statistics`,
      { method: 'GET' }
    );
  },

  /**
   * Retrieve statistics across all series in a dataset.
   */
  async getUniversityAllSeriesStatistics(
    datasetId: string,
    onlyActive: boolean = false
  ): Promise<AllSeriesStatisticsResponse> {
    const qs = onlyActive ? '?only_active=true' : '';
    return request<AllSeriesStatisticsResponse>(
      `/api/university-network/datasets/${encodeURIComponent(datasetId)}/statistics${qs}`,
      { method: 'GET' }
    );
  },

  /**
   * Detect robust historical traffic-spike candidates using median & MAD with IQR fallback.
   */
  async getUniversitySpikes(
    datasetId: string,
    params?: {
      series_ids?: string;
      threshold?: number;
      max_candidates?: number;
      start_time?: number;
      end_time?: number;
      sort_by?: 'score' | 'timestamp' | 'magnitude';
      sort_direction?: 'asc' | 'desc';
    }
  ): Promise<UniversitySpikesResponse> {
    const searchParams = new URLSearchParams();
    if (params?.series_ids) searchParams.append('series_ids', params.series_ids);
    if (params?.threshold !== undefined && params?.threshold !== null) {
      searchParams.append('threshold', String(params.threshold));
    }
    if (params?.max_candidates !== undefined && params?.max_candidates !== null) {
      searchParams.append('max_candidates', String(params.max_candidates));
    }
    if (params?.start_time !== undefined && params?.start_time !== null) {
      searchParams.append('start_time', String(params.start_time));
    }
    if (params?.end_time !== undefined && params?.end_time !== null) {
      searchParams.append('end_time', String(params.end_time));
    }
    if (params?.sort_by) searchParams.append('sort_by', params.sort_by);
    if (params?.sort_direction) searchParams.append('sort_direction', params.sort_direction);

    const qs = searchParams.toString();
    const endpoint = `/api/university-network/datasets/${encodeURIComponent(datasetId)}/spikes${qs ? `?${qs}` : ''}`;
    return request<UniversitySpikesResponse>(endpoint, { method: 'GET' });
  },
};

export { ApiClientError };
