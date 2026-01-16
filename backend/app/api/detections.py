from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List
from datetime import datetime

from app.db.base import get_db
from app.db.models import Detection, User
from app.models.schemas import DetectionCreate, DetectionBatch, DetectionResponse
from app.api.auth import get_current_user
from geoalchemy2.elements import WKTElement

router = APIRouter()


@router.post("/batch", status_code=status.HTTP_201_CREATED)
async def create_detections_batch(
    batch: DetectionBatch,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload a batch of detections from mobile app.

    Batched uploads minimize battery drain and network usage.
    """
    created_detections = []

    for detection_data in batch.detections:
        # Create WKT point for PostGIS
        point = f"POINT({detection_data.longitude} {detection_data.latitude})"

        detection = Detection(
            user_id=current_user.id,
            location=WKTElement(point, srid=4326),
            latitude=detection_data.latitude,
            longitude=detection_data.longitude,
            accuracy=detection_data.accuracy,
            magnitude=detection_data.magnitude,
            timestamp=detection_data.timestamp,
            accelerometer_x=detection_data.accelerometer.x,
            accelerometer_y=detection_data.accelerometer.y,
            accelerometer_z=detection_data.accelerometer.z,
            accelerometer_timestamp=detection_data.accelerometer.timestamp,
            gyroscope_x=detection_data.gyroscope.x,
            gyroscope_y=detection_data.gyroscope.y,
            gyroscope_z=detection_data.gyroscope.z,
            gyroscope_timestamp=detection_data.gyroscope.timestamp,
            confirmed_type=detection_data.confirmed_type,  # Save human confirmation
            processed=False,
        )

        db.add(detection)
        created_detections.append(detection)

    await db.commit()

    return {
        "message": f"Successfully uploaded {len(created_detections)} detections",
        "count": len(created_detections),
    }


@router.get("/my", response_model=List[DetectionResponse])
async def get_my_detections(
    skip: int = 0,
    limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Get detections created by the current user."""
    query = (
        select(Detection)
        .where(Detection.user_id == current_user.id)
        .order_by(Detection.timestamp.desc())
        .offset(skip)
        .limit(limit)
    )

    result = await db.execute(query)
    detections = result.scalars().all()

    return detections
