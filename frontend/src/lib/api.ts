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
  HealthResponse,
  HistoricalAnalysisParams,
  HistoricalAnalysisResponse,
  HistoricalPreviewResponse,
  SimulationRequest,
  SimulationResponse,
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
};

export { ApiClientError };
