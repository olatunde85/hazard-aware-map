from sqlalchemy import Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Index, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from geoalchemy2 import Geography
from app.db.base import Base
import enum


class HazardType(str, enum.Enum):
    POTHOLE = "pothole"
    SPEED_BUMP = "speed_bump"
    ROUGH_ROAD = "rough_road"
    UNKNOWN = "unknown"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    device_id = Column(String, index=True)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    detections = relationship("Detection", back_populates="user")
    verifications = relationship("HazardVerification", back_populates="user")


class Detection(Base):
    __tablename__ = "detections"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Location data (stored as Geography for spatial queries)
    location = Column(Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)
    accuracy = Column(Float, nullable=False)

    # Detection data
    magnitude = Column(Float, nullable=False)
    timestamp = Column(DateTime(timezone=True), nullable=False)

    # Sensor data
    accelerometer_x = Column(Float, nullable=False)
    accelerometer_y = Column(Float, nullable=False)
    accelerometer_z = Column(Float, nullable=False)
    accelerometer_timestamp = Column(DateTime(timezone=True), nullable=False)

    gyroscope_x = Column(Float, nullable=False)
    gyroscope_y = Column(Float, nullable=False)
    gyroscope_z = Column(Float, nullable=False)
    gyroscope_timestamp = Column(DateTime(timezone=True), nullable=False)

    # Processing flags
    processed = Column(Boolean, default=False, index=True)
    hazard_id = Column(Integer, ForeignKey("hazards.id"), nullable=True)

    # Human confirmation (optional)
    confirmed_type = Column(String, nullable=True)  # Human-confirmed hazard type

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="detections")
    hazard = relationship("Hazard", back_populates="detections")

    # Spatial index created automatically by GeoAlchemy2 Geography type


class Hazard(Base):
    __tablename__ = "hazards"

    id = Column(Integer, primary_key=True, index=True)

    # Location (centroid of clustered detections)
    location = Column(Geography(geometry_type="POINT", srid=4326, spatial_index=False), nullable=False)
    latitude = Column(Float, nullable=False)
    longitude = Column(Float, nullable=False)

    # Classification
    hazard_type = Column(String, nullable=False, default="unknown")
    severity = Column(Float, nullable=False)  # 0.0-10.0 scale
    confidence = Column(Float, nullable=False)  # 0.0-1.0 scale

    # Validation metrics
    detection_count = Column(Integer, default=0)
    unique_user_count = Column(Integer, default=0)
    verification_count = Column(Integer, default=0)
    positive_verifications = Column(Integer, default=0)

    # Temporal tracking
    first_detected = Column(DateTime(timezone=True), nullable=False)
    last_detected = Column(DateTime(timezone=True), nullable=False)
    last_updated = Column(DateTime(timezone=True), onupdate=func.now())

    # Status
    is_active = Column(Boolean, default=True, index=True)
    is_verified = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    detections = relationship("Detection", back_populates="hazard")
    verifications = relationship("HazardVerification", back_populates="hazard")

    # Spatial index created automatically by GeoAlchemy2 Geography type


class HazardVerification(Base):
    __tablename__ = "hazard_verifications"

    id = Column(Integer, primary_key=True, index=True)
    hazard_id = Column(Integer, ForeignKey("hazards.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    is_valid = Column(Boolean, nullable=False)
    comment = Column(String, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    hazard = relationship("Hazard", back_populates="verifications")
    user = relationship("User", back_populates="verifications")

    # Indexes created automatically by foreign keys
