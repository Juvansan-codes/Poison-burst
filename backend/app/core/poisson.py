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
from typing import Any, Dict, List, Sequence, Union

import numpy as np
from scipy.stats import poisson


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
