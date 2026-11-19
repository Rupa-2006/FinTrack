"""Isolation Forest (Liu, Ting and Zhou, 2008), implemented with NumPy.

The idea: build many random trees that split the data at random values of random features.
Unusual points are isolated in few splits, so their average path length is short.

    score(x) = 2 ** (-mean_path_length(x) / c(sample_size))     # near 1 = anomalous, ~0.5 = normal

Written here instead of importing scikit-learn because a Windows application-control policy
on the development machine blocks one of scikit-learn's compiled libraries. The algorithm is
small, deterministic for a given seed, and covered by tests/test_iforest.py.
"""
from __future__ import annotations

import math

import numpy as np

EULER = 0.5772156649015329


def average_path(n: int) -> float:
    """c(n): the average path length of an unsuccessful search in a binary search tree of n points."""
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2.0 * (math.log(n - 1) + EULER) - 2.0 * (n - 1) / n


class _Node:
    __slots__ = ("feature", "split", "left", "right", "size")

    def __init__(self, size, feature=None, split=None, left=None, right=None):
        self.size, self.feature, self.split, self.left, self.right = size, feature, split, left, right


def _grow(points: np.ndarray, depth: int, limit: int, rng: np.random.Generator) -> _Node:
    n = len(points)
    if depth >= limit or n <= 1:
        return _Node(n)
    spread = points.max(axis=0) - points.min(axis=0)
    usable = np.flatnonzero(spread > 0)
    if usable.size == 0:
        return _Node(n)  # all points identical
    feature = int(rng.choice(usable))
    low, high = points[:, feature].min(), points[:, feature].max()
    split = rng.uniform(low, high)
    mask = points[:, feature] < split
    return _Node(n, feature, split, _grow(points[mask], depth + 1, limit, rng), _grow(points[~mask], depth + 1, limit, rng))


def _path_length(point: np.ndarray, node: _Node, depth: int = 0) -> float:
    while node.feature is not None:
        node = node.left if point[node.feature] < node.split else node.right
        depth += 1
    return depth + average_path(node.size)


class IsolationForest:
    def __init__(self, n_trees: int = 200, sample_size: int = 256, contamination: float = 0.02, seed: int = 42):
        self.n_trees, self.sample_size, self.contamination, self.seed = n_trees, sample_size, contamination, seed

    def fit(self, data) -> "IsolationForest":
        points = np.asarray(data, dtype=float)
        rng = np.random.default_rng(self.seed)
        self._psi = min(self.sample_size, len(points))
        limit = math.ceil(math.log2(max(self._psi, 2)))
        self._trees = [_grow(points[rng.choice(len(points), self._psi, replace=False)], 0, limit, rng) for _ in range(self.n_trees)]
        scores = self.score(points)
        self.threshold_ = float(np.quantile(scores, 1 - self.contamination))
        return self

    def score(self, data) -> np.ndarray:
        """Anomaly score per point, between 0 and 1; higher is more unusual."""
        points = np.asarray(data, dtype=float)
        norm = average_path(self._psi) or 1.0
        mean_paths = np.array([np.mean([_path_length(p, tree) for tree in self._trees]) for p in points])
        return np.power(2.0, -mean_paths / norm)

    def fit_predict(self, data) -> tuple[np.ndarray, np.ndarray]:
        """(is_outlier booleans, scores) for the training data."""
        self.fit(data)
        scores = self.score(data)
        return scores > self.threshold_, scores
