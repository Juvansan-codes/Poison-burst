"""
PoissonBurst Lab - Authoritative Poisson Statistical Engine.

This module provides the independent mathematical foundation for baseline arrival-rate
estimation, upper-tail Poisson probability calculations, and statistical burst detection.
It is entirely decoupled from API frameworks and user interfaces to guarantee
identical, reproducible calculations across historical analysis, simulations,
and physical hardware monitoring.

Mathematical Foundations:
-------------------------
1. Poisson Probability Mass Function (PMF):
   For a discrete random variable X ~ Poisson(lambda):
       P(X = k) = (exp(-lambda) * lambda^k) / k!

2. Baseline Estimation:
   Given normal traffic arrival observations X_1, X_2, ..., X_n over fixed observation windows:
       lambda_hat = (1 / n) * sum(X_t)
   NOTE: lambda_hat represents the expected arrival count PER OBSERVATION WINDOW.
   If the observation window duration is W seconds, the arrival rate per second is:
       lambda_per_second = lambda_hat / W
   Do NOT assume that observation windows are always 1 second.

3. Upper-Tail Probability:
   For an observed count x and expected count lambda_hat:
       p = P(X >= x | lambda_hat) = sum_{k=x}^infinity P(X = k)
   Evaluated using SciPy's survival function:
       poisson.sf(x - 1, lambda_hat)
   since sf(k, lambda) = P(X > k) = P(X >= k + 1).

4. Burst Detection Rule:
   An observation x is flagged as a statistically unusual burst when:
       p < alpha
   where alpha in (0, 1) is the chosen significance level (default: alpha = 0.01).
"""

from __future__ import annotations

import math
from dataclasses import asdict, dataclass
from typing import Any, Dict, List, Optional, Sequence, Union

import numpy as np
from scipy.stats import chi2, poisson


@dataclass(frozen=True)
class BurstDetectionResult:
    """Structured result of a Poisson burst detection evaluation.

    Attributes:
        observed_count: The observed traffic arrival count in the window.
        expected_rate: The baseline expected arrival count per window (lambda_hat).
        p_value: The calculated upper-tail probability P(X >= observed_count | expected_rate).
        alpha: The significance threshold used for detection.
        is_burst: True if p_value < alpha, indicating a statistically unusual observation.
    """

    observed_count: int
    expected_rate: float
    p_value: float
    alpha: float
    is_burst: bool

    def to_dict(self) -> Dict[str, Any]:
        """Convert the result to a dictionary representation."""
        return asdict(self)


@dataclass(frozen=True)
class DispersionResult:
    """Dispersion evaluation for assessing Poisson assumption validity.

    Attributes:
        sample_mean: Sample mean count per window.
        sample_variance: Sample variance (unbiased, ddof=1 for n>1).
        variance_to_mean_ratio: D = sample_variance / sample_mean (1.0 for ideal Poisson).
        dispersion_type: 'equidispersed' (Poisson-like), 'overdispersed', or 'underdispersed'.
        sample_size: Number of observations evaluated.
    """

    sample_mean: float
    sample_variance: float
    variance_to_mean_ratio: float
    dispersion_type: str
    sample_size: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def estimate_baseline_rate(observations: Sequence[Union[int, float]]) -> float:
    """Estimate the baseline arrival rate (lambda_hat) from normal traffic observations.

    Calculates the sample mean count per observation window:
        lambda_hat = (1 / n) * sum_{t=1}^n X_t

    IMPORTANT UNIT DISTINCTION:
        lambda_hat is the expected arrival count PER OBSERVATION WINDOW.
        If each window spans W seconds, the rate per second is lambda_hat / W.
        Never assume that observation windows are always 1 second.

    Args:
        observations: A non-empty sequence of non-negative numeric arrival counts.

    Returns:
        float: The estimated baseline mean arrival count per observation window.

    Raises:
        ValueError: If observations is empty, contains negative values,
                    or contains non-finite values (NaN, infinity).
    """
    if observations is None or len(observations) == 0:
        raise ValueError("Observations sequence cannot be empty for baseline estimation.")

    total: float = 0.0
    count: int = 0

    for idx, val in enumerate(observations):
        if val is None or not isinstance(val, (int, float, np.number)):
            raise ValueError(f"Observation at index {idx} is not a valid numeric value: {val}")

        float_val = float(val)

        if not math.isfinite(float_val):
            raise ValueError(
                f"Observation at index {idx} is non-finite ({val}). Only finite numbers are permitted."
            )

        if float_val < 0.0:
            raise ValueError(
                f"Observation at index {idx} is negative ({val}). Traffic arrival counts must be non-negative."
            )

        total += float_val
        count += 1

    return float(total / count)


def calculate_upper_tail_probability(observed_count: int, expected_rate: float) -> float:
    """Calculate the Poisson upper-tail probability P(X >= x | lambda).

    Calculates:
        p = P(X >= observed_count | expected_rate)
          = sum_{k=observed_count}^infinity (exp(-lambda) * lambda^k) / k!

    Semantics:
        This is an UPPER-TAIL probability (cumulative probability of observing
        a count at least as extreme as observed_count).
        It is NOT P(X = x) and NOT P(X > x).

    Evaluation:
        Using SciPy's survival function:
            poisson.sf(x - 1, lambda)
        since sf(k, lambda) = P(X > k) = P(X >= k + 1).

    Edge Cases:
        1. expected_rate == 0.0:
           - If observed_count == 0: P(X >= 0 | 0) = 1.0 (deterministic zero arrivals).
           - If observed_count > 0: P(X >= x | 0) = 0.0 (impossible under zero rate).
        2. observed_count == 0 (with expected_rate >= 0):
           - P(X >= 0) is always 1.0 because Poisson random variables take values in {0, 1, 2, ...}.

    Args:
        observed_count: Non-negative integer observed count in the window.
        expected_rate: Non-negative finite baseline expected count per window (lambda).

    Returns:
        float: Upper-tail probability in the closed interval [0.0, 1.0].

    Raises:
        ValueError: If observed_count is negative or not an integer, or if expected_rate
                    is negative, non-finite, or otherwise invalid.
    """
    # Validate expected_rate
    if expected_rate is None or not isinstance(expected_rate, (int, float, np.number)):
        raise ValueError(f"Expected rate must be a valid number, got {expected_rate}.")

    lambda_val = float(expected_rate)
    if not math.isfinite(lambda_val):
        raise ValueError(f"Expected rate must be finite, got {expected_rate}.")

    if lambda_val < 0.0:
        raise ValueError(f"Expected rate cannot be negative, got {expected_rate}.")

    # Validate observed_count
    if observed_count is None:
        raise ValueError("Observed count cannot be None.")

    if isinstance(observed_count, float):
        if not observed_count.is_integer():
            raise ValueError(f"Observed count must be an integer, got float {observed_count}.")
        obs_val = int(observed_count)
    elif isinstance(observed_count, (int, np.integer)):
        obs_val = int(observed_count)
    else:
        raise ValueError(f"Observed count must be an integer, got {type(observed_count).__name__}.")

    if obs_val < 0:
        raise ValueError(f"Observed count cannot be negative, got {observed_count}.")

    # Mathematical Edge Cases
    if obs_val == 0:
        # P(X >= 0) = 1.0 for any valid Poisson distribution
        return 1.0

    if lambda_val == 0.0:
        # If lambda = 0, P(X = 0) = 1.0, so P(X >= x) = 0.0 for all x >= 1
        return 0.0

    # General Case: P(X >= x) = poisson.sf(x - 1, lambda)
    p_val = float(poisson.sf(obs_val - 1, lambda_val))

    # Clamp to [0.0, 1.0] to handle any floating-point imprecision
    if p_val < 0.0:
        return 0.0
    if p_val > 1.0:
        return 1.0

    return p_val


def detect_burst(
    observed_count: int,
    expected_rate: float,
    alpha: float = 0.01,
) -> BurstDetectionResult:
    """Evaluate whether an observed traffic count constitutes a statistically unusual burst.

    Detection Rule:
        Compute upper-tail probability p = P(X >= observed_count | expected_rate).
        Flag as burst if p < alpha.

    Args:
        observed_count: Non-negative integer observed count in the window.
        expected_rate: Baseline arrival rate (lambda_hat) per window.
        alpha: Significance level threshold, strictly in (0, 1). Default: 0.01.

    Returns:
        BurstDetectionResult: Structured detection result.

    Raises:
        ValueError: If alpha is not strictly between 0 and 1, or if inputs are invalid.
    """
    if alpha is None or not isinstance(alpha, (int, float, np.number)):
        raise ValueError(f"Significance level alpha must be a numeric value, got {alpha}.")

    alpha_val = float(alpha)
    if not math.isfinite(alpha_val) or alpha_val <= 0.0 or alpha_val >= 1.0:
        raise ValueError(
            f"Significance level alpha must lie strictly between 0 and 1 (exclusive), got {alpha}."
        )

    p_value = calculate_upper_tail_probability(observed_count, expected_rate)
    is_burst = bool(p_value < alpha_val)

    return BurstDetectionResult(
        observed_count=int(observed_count),
        expected_rate=float(expected_rate),
        p_value=p_value,
        alpha=alpha_val,
        is_burst=is_burst,
    )


def detect_burst_batch(
    observations: Sequence[int],
    expected_rate: float,
    alpha: float = 0.01,
) -> List[BurstDetectionResult]:
    """Evaluate a sequence of traffic observations against a baseline rate.

    Args:
        observations: Sequence of observed arrival counts.
        expected_rate: Baseline arrival rate (lambda_hat).
        alpha: Significance level threshold, strictly in (0, 1).

    Returns:
        List[BurstDetectionResult]: Results for each observation in sequence.
    """
    if observations is None:
        raise ValueError("Observations sequence cannot be None.")

    results: List[BurstDetectionResult] = []
    for count in observations:
        result = detect_burst(observed_count=count, expected_rate=expected_rate, alpha=alpha)
        results.append(result)

    return results


def calculate_dispersion(observations: Sequence[Union[int, float]]) -> DispersionResult:
    """Calculate the sample mean, variance, and variance-to-mean ratio (index of dispersion).

    In an ideal Poisson process:
        E[X] = Var(X) = lambda
        Index of Dispersion D = sample_variance / sample_mean = 1.0

    Deviations:
        - D > 1.0: Overdispersion (greater variability than Poisson, e.g., clustered bursts).
        - D < 1.0: Underdispersion (more regular than Poisson).
        - D ~ 1.0: Consistent with Poisson assumption.

    Args:
        observations: A sequence of numeric observations (at least 1 element).

    Returns:
        DispersionResult: Summary of sample statistics and dispersion classification.

    Raises:
        ValueError: If observations is empty or contains invalid/negative values.
    """
    if observations is None or len(observations) == 0:
        raise ValueError("Observations sequence cannot be empty for dispersion calculation.")

    # Validate elements
    clean_vals: List[float] = []
    for idx, val in enumerate(observations):
        if val is None or not isinstance(val, (int, float, np.number)):
            raise ValueError(f"Observation at index {idx} is invalid: {val}")
        f_val = float(val)
        if not math.isfinite(f_val) or f_val < 0.0:
            raise ValueError(f"Observation at index {idx} must be non-negative and finite: {val}")
        clean_vals.append(f_val)

    n = len(clean_vals)
    arr = np.array(clean_vals, dtype=np.float64)
    sample_mean = float(np.mean(arr))

    if n > 1:
        sample_variance = float(np.var(arr, ddof=1))
    else:
        sample_variance = 0.0

    if sample_mean == 0.0:
        if sample_variance == 0.0:
            vmr = 1.0
            dispersion_type = "equidispersed"
        else:
            vmr = float("inf")
            dispersion_type = "overdispersed"
    else:
        vmr = float(sample_variance / sample_mean)
        if abs(vmr - 1.0) <= 0.15:
            dispersion_type = "equidispersed"
        elif vmr > 1.15:
            dispersion_type = "overdispersed"
        else:
            dispersion_type = "underdispersed"

    return DispersionResult(
        sample_mean=round(sample_mean, 6),
        sample_variance=round(sample_variance, 6),
        variance_to_mean_ratio=round(vmr, 6) if math.isfinite(vmr) else 0.0,
        dispersion_type=dispersion_type,
        sample_size=n,
    )


def calculate_poisson_pmf(
    expected_rate: float,
    max_k: int = 40,
) -> List[Dict[str, float]]:
    """Compute the Poisson PMF and upper-tail probability for k = 0, 1, ..., max_k.

    Used by interactive distribution explorers to visualize the theoretical distribution.

    Args:
        expected_rate: Mean arrival rate (lambda >= 0).
        max_k: Maximum arrival count to compute.

    Returns:
        List of dicts: [{'k': k, 'pmf': P(X=k), 'upper_tail': P(X>=k)}]
    """
    if expected_rate < 0.0 or not math.isfinite(expected_rate):
        raise ValueError(f"Expected rate must be non-negative and finite, got {expected_rate}.")
    if max_k < 0:
        raise ValueError(f"max_k must be non-negative, got {max_k}.")

    distribution = []
    lambda_val = float(expected_rate)

    for k in range(max_k + 1):
        if lambda_val == 0.0:
            pmf = 1.0 if k == 0 else 0.0
            upper_tail = 1.0 if k == 0 else 0.0
        else:
            pmf = float(poisson.pmf(k, lambda_val))
            upper_tail = float(poisson.sf(k - 1, lambda_val)) if k > 0 else 1.0

        distribution.append({
            "k": float(k),
            "pmf": round(pmf, 8),
            "upper_tail": round(upper_tail, 8),
        })

    return distribution


@dataclass(frozen=True)
class ConfidenceIntervalResult:
    """Exact Poisson confidence interval for lambda (Garwood chi-square method)."""
    confidence_level: float
    sample_size: int
    total_arrivals: int
    point_estimate: float
    lower_bound: float
    upper_bound: float
    method: str
    interpretation: str
    is_valid: bool
    explanation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class GoodnessOfFitResult:
    """Pearson Chi-Square Goodness-of-Fit test for Poisson distribution."""
    test_name: str
    is_valid: bool
    chi2_statistic: Optional[float]
    degrees_of_freedom: Optional[int]
    p_value: Optional[float]
    null_hypothesis: str
    interpretation: str
    bins_evaluated: int
    minimum_expected_frequency: float
    bin_details: List[Dict[str, Any]]
    explanation: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def calculate_poisson_confidence_interval(
    observations: Sequence[Union[int, float]],
    confidence_level: float = 0.95,
) -> ConfidenceIntervalResult:
    """Calculate the exact Garwood Poisson confidence interval for lambda.

    Based on the central chi-square distribution quantile relationship:
        Lower bound: 0.5 * chi2.ppf(alpha/2, 2*T) / n  (0 if T == 0)
        Upper bound: 0.5 * chi2.ppf(1 - alpha/2, 2*(T+1)) / n
    where T = sum(X_i) is the total arrival count across n observation windows.

    Args:
        observations: Representative calibration counts.
        confidence_level: Desired coverage, strictly in (0, 1). Default: 0.95.

    Returns:
        ConfidenceIntervalResult: Structured bounds and academic interpretation.
    """
    if observations is None or len(observations) == 0:
        return ConfidenceIntervalResult(
            confidence_level=confidence_level,
            sample_size=0,
            total_arrivals=0,
            point_estimate=0.0,
            lower_bound=0.0,
            upper_bound=0.0,
            method="Garwood Exact Poisson (Chi-Square)",
            interpretation="No baseline observations available for confidence interval estimation.",
            is_valid=False,
            explanation="Observation sequence is empty.",
        )

    if confidence_level <= 0.0 or confidence_level >= 1.0 or not math.isfinite(confidence_level):
        raise ValueError(f"Confidence level must be strictly between 0 and 1, got {confidence_level}.")

    clean: List[int] = []
    for idx, x in enumerate(observations):
        if x is None:
            raise ValueError(f"Observation at index {idx} is None.")
        fx = float(x)
        if not math.isfinite(fx) or fx < 0.0:
            raise ValueError(f"Observation at index {idx} ({x}) must be non-negative and finite.")
        clean.append(int(round(fx)))

    n = len(clean)
    T = sum(clean)
    point_est = float(T / n)
    alpha = 1.0 - confidence_level

    if T == 0:
        lower_bound = 0.0
        upper_bound = float(0.5 * chi2.ppf(1.0 - alpha / 2.0, 2)) / n
    else:
        lower_bound = float(0.5 * chi2.ppf(alpha / 2.0, 2 * T)) / n
        upper_bound = float(0.5 * chi2.ppf(1.0 - alpha / 2.0, 2 * (T + 1))) / n

    interpretation = (
        f"With {int(round(confidence_level * 100))}% confidence, the true baseline mean arrival count per observation "
        f"window lies within [{lower_bound:.4f}, {upper_bound:.4f}] (point estimate: {point_est:.4f}). "
        f"Computed from {n} representative calibration windows ({T} total observed arrivals) using the exact Garwood "
        f"chi-square method. Note: This parameter confidence interval measures uncertainty about lambda, distinct "
        f"from the upper-tail burst detection threshold."
    )

    return ConfidenceIntervalResult(
        confidence_level=confidence_level,
        sample_size=n,
        total_arrivals=T,
        point_estimate=round(point_est, 6),
        lower_bound=round(lower_bound, 6),
        upper_bound=round(upper_bound, 6),
        method="Garwood Exact Poisson (Chi-Square)",
        interpretation=interpretation,
        is_valid=True,
    )


def calculate_poisson_goodness_of_fit(
    observations: Sequence[Union[int, float]],
    lambda_val: float,
    fit_parameter: bool = False,
    min_expected_frequency: float = 5.0,
) -> GoodnessOfFitResult:
    """Perform a Pearson Chi-Square Goodness-of-Fit test for the Poisson distribution.

    Categories are grouped dynamically to ensure expected cell frequencies E_i >= 5.0,
    ensuring the validity of the Chi-Square approximation.

    Args:
        observations: Observed arrival count sequence.
        lambda_val: Poisson parameter (mean arrival count per window).
        fit_parameter: True if lambda was fitted from the same sample (subtracts 1 df).
                       False if testing against a predetermined or frozen baseline.
        min_expected_frequency: Minimum expected count per bin (default: 5.0).

    Returns:
        GoodnessOfFitResult: Chi-square statistic, df, p-value, and diagnostic interpretation.
    """
    null_hypothesis = (
        f"H0: The observed arrival counts follow a Poisson distribution with parameter lambda = {lambda_val:.4f}."
    )

    if observations is None or len(observations) < 20:
        n_obs = len(observations) if observations else 0
        return GoodnessOfFitResult(
            test_name="Pearson Chi-Square Goodness-of-Fit",
            is_valid=False,
            chi2_statistic=None,
            degrees_of_freedom=None,
            p_value=None,
            null_hypothesis=null_hypothesis,
            interpretation="Test unavailable: Sample size is insufficient (n < 20). Chi-Square approximation requires larger sample sizes.",
            bins_evaluated=0,
            minimum_expected_frequency=min_expected_frequency,
            bin_details=[],
            explanation=f"Sample size n={n_obs} is less than the required minimum of 20 observations for a valid Chi-Square approximation.",
        )

    if lambda_val <= 0.0 or not math.isfinite(lambda_val):
        return GoodnessOfFitResult(
            test_name="Pearson Chi-Square Goodness-of-Fit",
            is_valid=False,
            chi2_statistic=None,
            degrees_of_freedom=None,
            p_value=None,
            null_hypothesis=null_hypothesis,
            interpretation="Test unavailable: Expected baseline rate must be strictly positive for distribution fitting.",
            bins_evaluated=0,
            minimum_expected_frequency=min_expected_frequency,
            bin_details=[],
            explanation="Baseline lambda must be > 0 to define a non-degenerate Poisson distribution.",
        )

    clean_obs: List[int] = []
    for idx, x in enumerate(observations):
        if x is None:
            raise ValueError(f"Observation at index {idx} is None.")
        fx = float(x)
        if not math.isfinite(fx) or fx < 0.0:
            raise ValueError(f"Observation at index {idx} is invalid: {x}")
        clean_obs.append(int(round(fx)))

    n = len(clean_obs)
    max_obs = max(clean_obs)
    counts_map: Dict[int, int] = {}
    for x in clean_obs:
        counts_map[x] = counts_map.get(x, 0) + 1

    bins: List[Dict[str, Any]] = []
    current_k_start = 0
    accumulated_p = 0.0
    accumulated_o = 0

    eval_max_k = max(max_obs + 10, int(lambda_val + 6.0 * math.sqrt(lambda_val)) + 15)
    sealed_with_tail = False

    for k in range(eval_max_k + 1):
        pk = float(poisson.pmf(k, lambda_val))
        accumulated_p += pk
        accumulated_o += counts_map.get(k, 0)
        expected = n * accumulated_p

        if expected >= min_expected_frequency:
            tail_p = float(poisson.sf(k, lambda_val))
            tail_expected = n * tail_p

            if tail_expected >= min_expected_frequency:
                # The remaining distribution can support at least one more bin.
                # Seal current bounded bin [current_k_start, k].
                bins.append({
                    "bin_label": f"{current_k_start}" if current_k_start == k else f"{current_k_start}-{k}",
                    "k_min": current_k_start,
                    "k_max": k,
                    "observed": accumulated_o,
                    "expected": expected,
                })
                current_k_start = k + 1
                accumulated_p = 0.0
                accumulated_o = 0
            else:
                # The remaining tail cannot support another bin on its own (tail_expected < min_expected_frequency).
                # Therefore, seal this final bin as an open-ended tail category: [current_k_start, infinity).
                final_p = float(poisson.sf(current_k_start - 1, lambda_val)) if current_k_start > 0 else 1.0
                final_expected = n * final_p
                final_observed = sum(c for val, c in counts_map.items() if val >= current_k_start)
                bins.append({
                    "bin_label": f">={current_k_start}",
                    "k_min": current_k_start,
                    "k_max": None,
                    "observed": final_observed,
                    "expected": final_expected,
                })
                sealed_with_tail = True
                break

    # If the loop finished without sealing an open tail (e.g. extreme numerical tail):
    if not sealed_with_tail and bins:
        last_bin = bins[-1]
        last_bin["k_max"] = None
        last_bin["bin_label"] = f">={last_bin['k_min']}"
        p_tail = float(poisson.sf(last_bin["k_min"] - 1, lambda_val)) if last_bin["k_min"] > 0 else 1.0
        last_bin["expected"] = n * p_tail
        last_bin["observed"] = sum(c for val, c in counts_map.items() if val >= last_bin["k_min"])

    if not bins:
        return GoodnessOfFitResult(
            test_name="Pearson Chi-Square Goodness-of-Fit",
            is_valid=False,
            chi2_statistic=None,
            degrees_of_freedom=None,
            p_value=None,
            null_hypothesis=null_hypothesis,
            interpretation="Test unavailable: Expected frequencies across categories are too small to pool into valid bins (E >= 5.0).",
            bins_evaluated=0,
            minimum_expected_frequency=min_expected_frequency,
            bin_details=[],
            explanation="Insufficient expected frequencies to form valid bins.",
        )

    p_params = 1 if fit_parameter else 0
    df = len(bins) - 1 - p_params

    if df <= 0 or len(bins) < 2:
        return GoodnessOfFitResult(
            test_name="Pearson Chi-Square Goodness-of-Fit",
            is_valid=False,
            chi2_statistic=None,
            degrees_of_freedom=max(0, df),
            p_value=None,
            null_hypothesis=null_hypothesis,
            interpretation=f"Test unavailable: After grouping categories to ensure E >= {min_expected_frequency}, only {len(bins)} bin(s) remained (df = {df} <= 0).",
            bins_evaluated=len(bins),
            minimum_expected_frequency=min_expected_frequency,
            bin_details=bins,
            explanation="Insufficient degrees of freedom after pooling bins.",
        )

    # Invariants: Every observation belongs to exactly one category, and expected totals match sample size
    total_obs = sum(b["observed"] for b in bins)
    total_exp = sum(b["expected"] for b in bins)
    assert total_obs == n, f"Category pooling error: observed count sum {total_obs} != total sample size {n}"
    assert abs(total_exp - n) < 1e-4, f"Category pooling error: expected frequency sum {total_exp} != total sample size {n}"

    chi2_stat = 0.0
    for b in bins:
        diff = b["observed"] - b["expected"]
        component = (diff * diff) / b["expected"] if b["expected"] > 0 else 0.0
        chi2_stat += component
        b["chi2_component"] = round(component, 4)
        b["expected"] = round(b["expected"], 4)

    chi2_stat = float(chi2_stat)
    p_val = float(chi2.sf(chi2_stat, df))

    if p_val < 0.05:
        decision = (
            f"Reject H0 at alpha=0.05 (chi2={chi2_stat:.3f}, df={df}, p={p_val:.4e}). "
            f"The observed traffic counts deviate significantly from the theoretical Poisson({lambda_val:.2f}) distribution. "
            f"This indicates overdispersion, traffic clustering, or non-stationary arrival rates."
        )
    else:
        decision = (
            f"Fail to reject H0 at alpha=0.05 (chi2={chi2_stat:.3f}, df={df}, p={p_val:.4f}). "
            f"The empirical traffic counts are statistically consistent with a Poisson({lambda_val:.2f}) distribution. "
            f"Important: Failure to reject does NOT prove the process is truly Poisson, nor does it establish that arrivals are independent over time."
        )

    return GoodnessOfFitResult(
        test_name="Pearson Chi-Square Goodness-of-Fit",
        is_valid=True,
        chi2_statistic=round(chi2_stat, 4),
        degrees_of_freedom=df,
        p_value=round(p_val, 6),
        null_hypothesis=null_hypothesis,
        interpretation=decision,
        bins_evaluated=len(bins),
        minimum_expected_frequency=min_expected_frequency,
        bin_details=bins,
    )


def calculate_empirical_vs_theoretical_distribution(
    observations: Sequence[Union[int, float]],
    lambda_val: float,
    max_k: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """Calculate empirical relative frequencies alongside theoretical Poisson PMF."""
    if observations is None or len(observations) == 0:
        return []

    clean = [int(round(float(x))) for x in observations]
    n = len(clean)
    counts_map: Dict[int, int] = {}
    for x in clean:
        counts_map[x] = counts_map.get(x, 0) + 1

    obs_max = max(clean) if clean else 0
    if max_k is None:
        theoretical_span = int(lambda_val + 4.0 * math.sqrt(max(1.0, lambda_val)))
        upper_k = min(150, max(obs_max + 2, theoretical_span + 2))
    else:
        upper_k = max_k

    points: List[Dict[str, Any]] = []
    for k in range(upper_k + 1):
        obs_count = counts_map.get(k, 0)
        emp_prob = float(obs_count / n)
        if lambda_val <= 0.0:
            theo_prob = 1.0 if k == 0 else 0.0
            tail_prob = 1.0 if k == 0 else 0.0
        else:
            theo_prob = float(poisson.pmf(k, lambda_val))
            tail_prob = float(poisson.sf(k - 1, lambda_val)) if k > 0 else 1.0

        points.append({
            "k": k,
            "observed_count": obs_count,
            "empirical_probability": round(emp_prob, 6),
            "theoretical_probability": round(theo_prob, 6),
            "upper_tail_probability": round(tail_prob, 6),
        })

    return points
