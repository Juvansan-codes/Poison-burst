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
  DetectionRequest,
  DetectionResponse,
  DispersionRequest,
  DispersionResponse,
  DistributionRequest,
  DistributionResponse,
  HealthResponse,
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
  const headers = {
    'Content-Type': 'application/json',
    ...(options?.headers || {}),
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
};

export { ApiClientError };
