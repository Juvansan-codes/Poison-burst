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
  is_calibration?: boolean;
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

export interface HistoricalPreviewResponse {
  file_name: string;
  file_size_bytes: number;
  total_rows: number;
  columns: string[];
  sample_rows: Record<string, unknown>[];
  suggested_timestamp_column?: string | null;
  suggested_label_column?: string | null;
  detected_label_values: string[];
  timestamp_diagnostics?: string | null;
  warnings: string[];
}

export interface HistoricalAnalysisParams {
  file: File;
  timestamp_column: string;
  label_column?: string | null;
  benign_label_value?: string;
  window_seconds: number;
  baseline_mode?: 'ratio' | 'window_count' | 'timestamp_range';
  baseline_ratio?: number;
  baseline_window_count?: number;
  baseline_start_timestamp?: string;
  baseline_end_timestamp?: string;
  alpha: number;
}

export interface HistoricalAnalysisResponse {
  experiment_id: string;
  file_name: string;
  measurement_type: MeasurementType;
  measurement_unit_description: string;
  window_seconds: number;
  total_rows_processed: number;
  invalid_rows: number;
  total_windows: number;
  baseline_window_count: number;
  calibration_window_indices?: number[];
  lambda_window: number;
  baseline_rate_per_second: number;
  calibration_method: string;
  detected_burst_count: number;
  labeled_burst_count?: number | null;
  observations: TrafficObservation[];
  detections: DetectionResponse[];
  evaluation?: EvaluationMetrics | null;
  summary: string;
  model_limitation_note: string;
}

export type ExperimentType = 'simulation' | 'historical';

export interface ExperimentSummary {
  experiment_id: string;
  experiment_type: ExperimentType;
  created_at: string;
  title: string;
  scenario?: string | null;
  measurement_type: MeasurementType;
  window_seconds: number;
  baseline_lambda: number;
  baseline_rate_per_second: number;
  alpha: number;
  observation_count: number;
  detected_window_count: number;
  ground_truth_available: boolean;
  dataset_name?: string | null;
  summary?: string | null;
  evaluation?: EvaluationMetrics | null;
}

export interface ExperimentDetailResponse extends ExperimentSummary {
  model_limitation_note?: string | null;
  configuration: Record<string, unknown>;
  observations: TrafficObservation[];
  detections: DetectionResponse[];
}

export interface ExperimentListResponse {
  items: ExperimentSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface DashboardSummaryResponse {
  total_experiments: number;
  simulation_experiments_count: number;
  historical_experiments_count: number;
  available_measurement_types: string[];
  latest_experiment?: ExperimentSummary | null;
  latest_detected_count?: number | null;
  recent_experiments: ExperimentSummary[];
}

export interface ConfidenceIntervalSchema {
  confidence_level: number;
  sample_size: number;
  total_arrivals: number;
  point_estimate: number;
  lower_bound: number;
  upper_bound: number;
  method: string;
  interpretation: string;
  is_valid: boolean;
  explanation?: string | null;
}

export interface GoodnessOfFitBin {
  bin_label: string;
  k_min: number;
  k_max?: number | null;
  observed: number;
  expected: number;
  chi2_component?: number;
}

export interface GoodnessOfFitSchema {
  test_name: string;
  is_valid: boolean;
  chi2_statistic?: number | null;
  degrees_of_freedom?: number | null;
  p_value?: number | null;
  null_hypothesis: string;
  interpretation: string;
  bins_evaluated: number;
  minimum_expected_frequency: number;
  bin_details: GoodnessOfFitBin[];
  explanation?: string | null;
}

export interface DistributionFitPointSchema {
  k: number;
  observed_count: number;
  empirical_probability: number;
  theoretical_probability: number;
  upper_tail_probability: number;
}

export interface ExperimentStatisticsResponse {
  experiment_id: string;
  title: string;
  experiment_type: ExperimentType;
  measurement_type: MeasurementType;
  source: TrafficSource;
  observation_count: number;
  window_seconds: number;
  ground_truth_available: boolean;
  empirical_mean: number;
  sample_variance: number;
  variance_to_mean_ratio: number;
  dispersion_type: string;
  baseline_lambda: number;
  baseline_rate_per_second: number;
  calibration_window_count?: number | null;
  original_alpha: number;
  original_detected_count: number;
  confidence_interval: ConfidenceIntervalSchema;
  confidence_interval_empirical?: ConfidenceIntervalSchema | null;
  goodness_of_fit_baseline: GoodnessOfFitSchema;
  goodness_of_fit_empirical: GoodnessOfFitSchema;
  distribution_fit: DistributionFitPointSchema[];
  evaluation?: EvaluationMetrics | null;
  interpretation_summary: string;
}

export interface ThresholdSensitivityPoint {
  alpha: number;
  detected_window_count: number;
  evaluation?: EvaluationMetrics | null;
}

export interface ThresholdAnalysisRequest {
  alphas: number[];
}

export interface ThresholdAnalysisResponse {
  experiment_id: string;
  baseline_lambda: number;
  window_seconds: number;
  ground_truth_available: boolean;
  points: ThresholdSensitivityPoint[];
  original_alpha: number;
  original_detected_count: number;
  note: string;
}


