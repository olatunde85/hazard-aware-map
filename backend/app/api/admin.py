"""
Admin API endpoints for manual system operations.

This module provides administrative endpoints for:
- Manual processing of detections into hazards
- System statistics and monitoring

These endpoints are intended for manual triggering during development/testing.
In production, detection processing should be automated via background workers.
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, delete
from typing import List, Dict, Any
from datetime import datetime

from app.db.base import get_db
from app.db.models import Detection, Hazard, HazardType
from app.services.clustering import SpatialClusteringService
from geoalchemy2.elements import WKTElement

router = APIRouter()


@router.post("/process-detections")
async def process_detections(
    db: AsyncSession = Depends(get_db),
) -> Dict[str, Any]:
    """
    Manually trigger processing of unprocessed detections into hazards.

    This endpoint performs the following operations:
    1. Fetches all unprocessed detections (processed=false) from the database
    2. Separates human-confirmed detections from algorithm-only detections
    3. Human-confirmed detections:
       - Each creates its own hazard immediately (no clustering required)
       - Uses the human-confirmed hazard type
       - Higher confidence score (0.9 base for human confirmation)
    4. Algorithm-only detections:
       - Clusters using DBSCAN spatial clustering algorithm
       - Default radius: configured in settings (typically 15 meters)
       - Minimum detections per cluster: configured in settings (typically 3)
    5. For each cluster/detection, creates a Hazard record with:
       - Location (from detection or cluster centroid)
       - Severity score (0-10 scale):
         * Calculated as: 70% average magnitude + 30% max magnitude
         * Normalized assuming max realistic magnitude of 5g
       - Confidence score (0-1 scale):
         * Human-confirmed: 0.9 base
         * Clustered: Based on detection count and unique user count
         * Formula: min(1.0, detection_count * 0.1 + unique_users * 0.2)
       - is_active=true (hazard is visible to users)
    6. Links all detections to their hazards
    7. Marks all processed detections as processed=true
    8. Marks "noise" detections (not in any cluster, no human confirmation) as processed=true

    Returns:
        Dictionary with processing statistics:
        - message: Success message
        - detections_total: Total unprocessed detections found
        - human_confirmed_hazards: Hazards created from human-confirmed detections
        - clustered_hazards: Hazards created from clustered algorithm detections
        - detections_processed: Total detections processed
        - detections_marked_noise: Detections excluded as noise

    Example Response:
        {
            "message": "Successfully processed 82 detections into 80 hazards (80 human-confirmed, 0 clustered)",
            "detections_total": 82,
            "human_confirmed_hazards": 80,
            "clustered_hazards": 0,
            "detections_processed": 80,
            "detections_marked_noise": 2
        }

    Note:
        - This is a manual endpoint for development/testing
        - In production, use a background worker or scheduled task
        - Running this multiple times is safe (only processes unprocessed detections)
    """
    clustering_service = SpatialClusteringService()

    # Get all unprocessed detections
    query = select(Detection).where(Detection.processed == False)
    result = await db.execute(query)
    all_unprocessed = result.scalars().all()

    if not all_unprocessed:
        return {
            "message": "No unprocessed detections found",
            "detections_total": 0,
            "human_confirmed_hazards": 0,
            "clustered_hazards": 0,
            "detections_processed": 0,
            "detections_marked_noise": 0,
        }

    # Separate human-confirmed from algorithm-only detections
    human_confirmed = [d for d in all_unprocessed if d.confirmed_type]
    algorithm_only = [d for d in all_unprocessed if not d.confirmed_type]

    human_confirmed_hazards = 0
    clustered_hazards = 0
    detections_processed = 0
    processed_detection_ids = set()

    # Process human-confirmed detections individually (no clustering needed)
    for detection in human_confirmed:
        # Calculate severity from magnitude
        severity = clustering_service.calculate_cluster_severity([detection.magnitude])

        # Create WKT point for PostGIS
        point = f"POINT({detection.longitude} {detection.latitude})"

        # Ensure lowercase
        hazard_type = detection.confirmed_type.lower() if detection.confirmed_type else "unknown"

        # Create hazard from single human-confirmed detection
        hazard = Hazard(
            location=WKTElement(point, srid=4326),
            latitude=detection.latitude,
            longitude=detection.longitude,
            hazard_type=hazard_type,
            severity=severity,
            confidence=0.9,  # High confidence for human confirmation
            detection_count=1,
            unique_user_count=1,
            verification_count=0,
            positive_verifications=0,
            first_detected=detection.timestamp,
            last_detected=detection.timestamp,
            is_active=True,
            is_verified=False,
        )

        db.add(hazard)
        await db.flush()  # Get hazard ID

        # Mark detection as processed and link to hazard
        detection.processed = True
        detection.hazard_id = hazard.id
        processed_detection_ids.add(detection.id)

        human_confirmed_hazards += 1
        detections_processed += 1

        print(f"Created hazard from human-confirmed detection: {hazard_type} at ({detection.latitude:.6f}, {detection.longitude:.6f}), magnitude={detection.magnitude:.2f}g")

    # Process algorithm-only detections with clustering
    if algorithm_only:
        # Convert to format expected by clustering service
        unprocessed_coords = [
            (d.latitude, d.longitude, d.id) for d in algorithm_only
        ]
        clusters = clustering_service.cluster_detections(unprocessed_coords)

        # Process each cluster
        for cluster_detection_ids in clusters:
            # Fetch full detection data for this cluster
            cluster_detections = [d for d in algorithm_only if d.id in cluster_detection_ids]

            if not cluster_detections:
                continue

            # Calculate cluster properties
            cluster_coords = [
                (d.latitude, d.longitude, d.id) for d in cluster_detections
            ]
            centroid_lat, centroid_lon = clustering_service.calculate_cluster_centroid(
                cluster_coords
            )

            magnitudes = [d.magnitude for d in cluster_detections]
            severity = clustering_service.calculate_cluster_severity(magnitudes)

            # Get unique users
            unique_users = len(set(d.user_id for d in cluster_detections))

            # Get temporal bounds
            timestamps = [d.timestamp for d in cluster_detections]
            first_detected = min(timestamps)
            last_detected = max(timestamps)

            # Calculate confidence based on detection count and unique users
            detection_count = len(cluster_detections)
            confidence = min(1.0, (detection_count * 0.1) + (unique_users * 0.2))
            confidence = round(confidence, 2)

            # Algorithm-based classification
            avg_magnitude = sum(magnitudes) / len(magnitudes)
            max_magnitude = max(magnitudes)

            if max_magnitude >= 1.0:
                # Speed hump: high magnitude events (>=1.0g)
                hazard_type = "speed_hump"
            elif avg_magnitude >= 0.3 and detection_count >= 8:
                # Rough road: many consecutive moderate bumps
                hazard_type = "rough_road"
            elif avg_magnitude >= 0.2:
                # Could be pothole or speed bump
                if avg_magnitude <= 0.31:
                    hazard_type = "speed_bump"
                else:
                    hazard_type = "pothole"
            else:
                hazard_type = "unknown"

            print(f"Using algorithm-based type: {hazard_type} (avg_mag={avg_magnitude:.2f}g, max_mag={max_magnitude:.2f}g, count={detection_count})")

            # Create WKT point for PostGIS
            point = f"POINT({centroid_lon} {centroid_lat})"

            # Create hazard
            hazard = Hazard(
                location=WKTElement(point, srid=4326),
                latitude=centroid_lat,
                longitude=centroid_lon,
                hazard_type=hazard_type,
                severity=severity,
                confidence=confidence,
                detection_count=detection_count,
                unique_user_count=unique_users,
                verification_count=0,
                positive_verifications=0,
                first_detected=first_detected,
                last_detected=last_detected,
                is_active=True,
                is_verified=False,
            )

            db.add(hazard)
            await db.flush()  # Get hazard ID

            # Mark detections as processed and link to hazard
            for detection in cluster_detections:
                detection.processed = True
                detection.hazard_id = hazard.id
                processed_detection_ids.add(detection.id)

            clustered_hazards += 1
            detections_processed += len(cluster_detections)

        # Mark noise detections (not in any cluster) as processed
        all_algorithm_ids = {d.id for d in algorithm_only}
        noise_detection_ids = all_algorithm_ids - processed_detection_ids

        if noise_detection_ids:
            noise_detections = [d for d in algorithm_only if d.id in noise_detection_ids]
            for detection in noise_detections:
                detection.processed = True
                # hazard_id remains None for noise
    else:
        noise_detection_ids = set()

    await db.commit()

    total_hazards = human_confirmed_hazards + clustered_hazards
    message = f"Successfully processed {detections_processed} detections into {total_hazards} hazards"
    if human_confirmed_hazards > 0 or clustered_hazards > 0:
        message += f" ({human_confirmed_hazards} human-confirmed, {clustered_hazards} clustered)"

    return {
        "message": message,
        "detections_total": len(all_unprocessed),
        "human_confirmed_hazards": human_confirmed_hazards,
        "clustered_hazards": clustered_hazards,
        "detections_processed": detections_processed,
        "detections_marked_noise": len(noise_detection_ids),
    }


@router.get("/stats")
async def get_stats(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Get system statistics about detections and hazards.

    Provides an overview of the current state of the system including:
    - Detection counts (total, processed, unprocessed)
    - Hazard counts (total, active, inactive)

    Returns:
        Dictionary with two main sections:
        - detections: Detection statistics
          * total: All detections in the system
          * processed: Detections that have been clustered/analyzed
          * unprocessed: Detections waiting to be processed
        - hazards: Hazard statistics
          * total: All hazards in the system
          * active: Hazards visible to users (is_active=true)
          * inactive: Hazards that have been deactivated

    Example Response:
        {
            "detections": {
                "total": 40,
                "processed": 40,
                "unprocessed": 0
            },
            "hazards": {
                "total": 2,
                "active": 2,
                "inactive": 0
            }
        }

    Use Cases:
        - Monitor system health
        - Check if detections need processing
        - Verify processing pipeline is working
        - Dashboard metrics
    """
    # Count unprocessed detections
    unprocessed_query = select(func.count()).select_from(Detection).where(
        Detection.processed == False
    )
    unprocessed_result = await db.execute(unprocessed_query)
    unprocessed_count = unprocessed_result.scalar()

    # Count total detections
    total_detections_query = select(func.count()).select_from(Detection)
    total_detections_result = await db.execute(total_detections_query)
    total_detections = total_detections_result.scalar()

    # Count active hazards
    active_hazards_query = select(func.count()).select_from(Hazard).where(
        Hazard.is_active == True
    )
    active_hazards_result = await db.execute(active_hazards_query)
    active_hazards = active_hazards_result.scalar()

    # Count total hazards
    total_hazards_query = select(func.count()).select_from(Hazard)
    total_hazards_result = await db.execute(total_hazards_query)
    total_hazards = total_hazards_result.scalar()

    return {
        "detections": {
            "total": total_detections,
            "processed": total_detections - unprocessed_count,
            "unprocessed": unprocessed_count,
        },
        "hazards": {
            "total": total_hazards,
            "active": active_hazards,
            "inactive": total_hazards - active_hazards,
        },
    }


@router.post("/reset-processed")
async def reset_processed(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Reset all detections to unprocessed state and delete all hazards.

    This allows reprocessing of existing detections with updated logic.
    Useful for:
    - Testing new processing algorithms
    - Reprocessing after bug fixes
    - Re-evaluating human-confirmed detections

    This endpoint:
    1. Deletes all hazards
    2. Sets all detections to processed=False
    3. Clears hazard_id from all detections

    Returns:
        Dictionary with reset statistics:
        - message: Success message
        - detections_reset: Number of detections reset to unprocessed
        - hazards_deleted: Number of hazards deleted

    Example Response:
        {
            "message": "Successfully reset 82 detections for reprocessing",
            "detections_reset": 82,
            "hazards_deleted": 1
        }
    """
    # First, reset all detections to unprocessed and clear hazard_id
    # This removes the foreign key references before deleting hazards
    query = select(Detection)
    result = await db.execute(query)
    all_detections = result.scalars().all()

    for detection in all_detections:
        detection.processed = False
        detection.hazard_id = None

    await db.flush()  # Flush changes to remove foreign key references

    # Now we can safely delete all hazards
    hazards_result = await db.execute(delete(Hazard))
    hazards_deleted = hazards_result.rowcount

    await db.commit()

    return {
        "message": f"Successfully reset {len(all_detections)} detections for reprocessing",
        "detections_reset": len(all_detections),
        "hazards_deleted": hazards_deleted,
    }


@router.delete("/clear-database")
async def clear_database(db: AsyncSession = Depends(get_db)) -> Dict[str, Any]:
    """
    Clear all detections and hazards from the database.

    WARNING: This is a destructive operation that permanently deletes all data.
    Use this endpoint with caution, typically for:
    - Testing/development data cleanup
    - Resetting the system to fresh state
    - Clearing test data after algorithm calibration

    Returns:
        Dictionary with deletion statistics:
        - message: Success message
        - detections_deleted: Number of detection records deleted
        - hazards_deleted: Number of hazard records deleted

    Example Response:
        {
            "message": "Successfully cleared database",
            "detections_deleted": 150,
            "hazards_deleted": 12
        }
    """
    # Delete all detections using SQLAlchemy ORM
    detections_result = await db.execute(delete(Detection))
    detections_deleted = detections_result.rowcount

    # Delete all hazards using SQLAlchemy ORM
    hazards_result = await db.execute(delete(Hazard))
    hazards_deleted = hazards_result.rowcount

    await db.commit()

    return {
        "message": "Successfully cleared database",
        "detections_deleted": detections_deleted,
        "hazards_deleted": hazards_deleted,
    }
