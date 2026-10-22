/**
 * PoissonBurst Lab - TypeScript Shared Type Definitions.
 *
 * Models strictly mirror the FastAPI backend schemas to guarantee contract integrity.
 */

export type TrafficSource = 'historical' | 'simulation' | 'hardware';

export type MeasurementType = 'packet_count' | 'flow_count' | 'udp_datagram_count';

export interface TrafficObservation {
  timestamp: string;
  time_seconds?: number;
  count: number;
  source: TrafficSource;
  measurement_type: MeasurementType;
  ground_truth?: boolean | null;
  experiment_id?: string | null;
  window_seconds?: number;
  expected_baseline_count?: number;
}

export interface HealthResponse {
  status: string;
  app_name: string;
  version: string;
  timestamp: string;
}

export interface BaselineEstimateRequest {
  observations: number[];
  window_seconds?: number;
}

export interface BaselineEstimateResponse {
  baseline_rate: number;
  observation_count: number;
  window_seconds: number;
  rate_per_second: number;
  unit_explanation: string;
}

export interface DetectionRequest {
  observed_count: number;
  expected_rate: number;
  alpha?: number;
}

export interface DetectionResponse {
  observed_count: number;
  expected_rate: number;
  p_value: number;
  alpha: number;
  is_burst: boolean;
  interpretation: string;
  ground_truth?: boolean | null;
  timestamp?: string | null;
  time_seconds?: number | null;
}

export interface BatchDetectionRequest {
  observations: number[];
  expected_rate: number;
  alpha?: number;
}

export interface BatchDetectionResponse {
  results: DetectionResponse[];
  total_observations: number;
  detected_bursts: number;
  expected_rate: number;
  alpha: number;
}

export interface DispersionRequest {
  observations: number[];
}

export interface DispersionResponse {
  sample_mean: number;
  sample_variance: number;
  variance_to_mean_ratio: number;
  dispersion_type: 'equidispersed' | 'overdispersed' | 'underdispersed';
  sample_size: number;
  explanation: string;
}

export interface DistributionRequest {
  expected_rate: number;
  max_k?: number;
}

export interface DistributionPoint {
  k: number;
  pmf: number;
  upper_tail: number;
}

export interface DistributionResponse {
  expected_rate: number;
  points: DistributionPoint[];
}

export type SimulationScenario =
  | 'poisson_normal'
  | 'sudden_burst'
  | 'rate_drift'
  | 'overdispersed';

export interface SimulationRequest {
  scenario: SimulationScenario;
  baseline_rate_per_second?: number;
  baseline_rate?: number;
  duration_seconds: number;
  window_seconds: number;
  burst_start_second?: number;
  burst_duration_seconds?: number;
  burst_rate_per_second?: number;
  burst_rate?: number;
  rate_drift_end_per_second?: number;
  dispersion_factor?: number;
  alpha: number;
  random_seed?: number;
}

export interface EvaluationMetrics {
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  precision: number;
  recall: number;
  f1_score: number;
  false_positive_rate: number;
  detection_delay_seconds?: number | null;
}

export interface SimulationResponse {
  experiment_id: string;
  scenario: string;
  baseline_rate_per_second: number;
  lambda_window: number;
  baseline_rate: number;
  window_seconds: number;
  duration_seconds: number;
  total_windows: number;
  detected_burst_count: number;
  injected_burst_count: number;
  observations: TrafficObservation[];
  detections: DetectionResponse[];
  evaluation?: EvaluationMetrics | null;
  summary?: string | null;
  model_limitation_note?: string | null;
}
