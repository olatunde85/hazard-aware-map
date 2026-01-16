import numpy as np
from sklearn.cluster import DBSCAN
from typing import List, Tuple
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from app.db.models import Detection
from app.core.config import settings


class SpatialClusteringService:
    """Service for spatial clustering of detections using DBSCAN algorithm."""

    def __init__(self, eps_meters: float = None, min_samples: int = None):
        """
        Initialize clustering service.

        Args:
            eps_meters: Maximum distance between samples in meters (default from settings)
            min_samples: Minimum detections to form a cluster (default from settings)
        """
        self.eps_meters = eps_meters or settings.SPATIAL_CLUSTER_RADIUS_METERS
        self.min_samples = min_samples or settings.MIN_DETECTIONS_FOR_HAZARD

    def cluster_detections(
        self, detections: List[Tuple[float, float, int]]
    ) -> List[List[int]]:
        """
        Cluster detections using DBSCAN algorithm.

        Args:
            detections: List of (latitude, longitude, detection_id) tuples

        Returns:
            List of clusters, where each cluster is a list of detection IDs
        """
        if len(detections) < self.min_samples:
            return []

        # Extract coordinates and IDs
        coords = np.array([[lat, lon] for lat, lon, _ in detections])
        ids = [det_id for _, _, det_id in detections]

        # Convert eps from meters to approximate degrees
        # At equator: 1 degree ≈ 111km
        # We use a conservative approximation
        eps_degrees = self.eps_meters / 111000.0

        # Perform DBSCAN clustering
        clustering = DBSCAN(eps=eps_degrees, min_samples=self.min_samples, metric="haversine")

        # Convert coordinates to radians for haversine metric
        coords_rad = np.radians(coords)
        labels = clustering.fit_predict(coords_rad)

        # Group detection IDs by cluster
        clusters = {}
        for idx, label in enumerate(labels):
            if label == -1:  # Noise point
                continue

            if label not in clusters:
                clusters[label] = []
            clusters[label].append(ids[idx])

        return list(clusters.values())

    async def get_unprocessed_detections(
        self, session: AsyncSession, limit: int = 1000
    ) -> List[Tuple[float, float, int]]:
        """
        Fetch unprocessed detections from database.

        Args:
            session: Database session
            limit: Maximum number of detections to fetch

        Returns:
            List of (latitude, longitude, detection_id) tuples
        """
        query = (
            select(Detection.latitude, Detection.longitude, Detection.id)
            .where(Detection.processed == False)
            .limit(limit)
        )

        result = await session.execute(query)
        return [(lat, lon, det_id) for lat, lon, det_id in result.all()]

    def calculate_cluster_centroid(
        self, detections: List[Tuple[float, float, int]]
    ) -> Tuple[float, float]:
        """
        Calculate the centroid of a cluster of detections.

        Args:
            detections: List of (latitude, longitude, detection_id) tuples

        Returns:
            Tuple of (centroid_latitude, centroid_longitude)
        """
        if not detections:
            raise ValueError("Cannot calculate centroid of empty cluster")

        lats = [lat for lat, _, _ in detections]
        lons = [lon for _, lon, _ in detections]

        return np.mean(lats), np.mean(lons)

    def calculate_cluster_severity(
        self, magnitudes: List[float]
    ) -> float:
        """
        Calculate severity score for a cluster based on detection magnitudes.

        Args:
            magnitudes: List of detection magnitudes (in g's)

        Returns:
            Severity score on 0-10 scale
        """
        if not magnitudes:
            return 0.0

        # Use weighted average with emphasis on higher magnitudes
        avg_magnitude = np.mean(magnitudes)
        max_magnitude = np.max(magnitudes)

        # Weighted combination: 70% average, 30% max
        weighted_magnitude = 0.7 * avg_magnitude + 0.3 * max_magnitude

        # Convert to 0-10 scale
        # Based on field data: 0.2-0.5g typical range, 1.6g max for speed humps
        # Use 1.0g as reference for max severity (10/10)
        severity = min(10.0, (weighted_magnitude / 1.0) * 10.0)

        return round(severity, 2)

    @staticmethod
    def haversine_distance(
        lat1: float, lon1: float, lat2: float, lon2: float
    ) -> float:
        """
        Calculate the great circle distance between two points on Earth.

        Args:
            lat1, lon1: First point coordinates
            lat2, lon2: Second point coordinates

        Returns:
            Distance in meters
        """
        R = 6371000  # Earth's radius in meters

        lat1_rad = np.radians(lat1)
        lat2_rad = np.radians(lat2)
        delta_lat = np.radians(lat2 - lat1)
        delta_lon = np.radians(lon2 - lon1)

        a = (
            np.sin(delta_lat / 2) ** 2
            + np.cos(lat1_rad) * np.cos(lat2_rad) * np.sin(delta_lon / 2) ** 2
        )

        c = 2 * np.arctan2(np.sqrt(a), np.sqrt(1 - a))

        return R * c
