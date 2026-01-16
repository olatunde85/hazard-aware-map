from pydantic import BaseModel, EmailStr, Field, ConfigDict
from typing import List, Optional
from datetime import datetime
from enum import Enum


class HazardTypeEnum(str, Enum):
    POTHOLE = "pothole"
    SPEED_HUMP = "speed_hump"
    BUMP = "bump"
    ROUGH_ROAD = "rough_road"
    UNKNOWN = "unknown"


# Sensor Data Schemas
class AccelerometerDataSchema(BaseModel):
    x: float
    y: float
    z: float
    timestamp: datetime


class GyroscopeDataSchema(BaseModel):
    x: float
    y: float
    z: float
    timestamp: datetime


# Detection Schemas
class DetectionCreate(BaseModel):
    latitude: float = Field(..., ge=-90, le=90)
    longitude: float = Field(..., ge=-180, le=180)
    accuracy: float = Field(..., gt=0)
    magnitude: float = Field(..., gt=0)
    timestamp: datetime
    accelerometer: AccelerometerDataSchema
    gyroscope: GyroscopeDataSchema
    confirmed_type: Optional[str] = None  # Human-confirmed hazard type


class DetectionBatch(BaseModel):
    detections: List[DetectionCreate] = Field(..., min_length=1, max_length=100)


class DetectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    latitude: float
    longitude: float
    magnitude: float
    timestamp: datetime
    created_at: datetime


# Hazard Schemas
class HazardBase(BaseModel):
    latitude: float
    longitude: float
    hazard_type: HazardTypeEnum
    severity: float = Field(..., ge=0, le=10)
    confidence: float = Field(..., ge=0, le=1)


class HazardResponse(HazardBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    detection_count: int
    unique_user_count: int
    first_detected: datetime
    last_detected: datetime
    is_active: bool
    is_verified: bool


class HazardList(BaseModel):
    hazards: List[HazardResponse]
    count: int


# Verification Schemas
class VerificationCreate(BaseModel):
    is_valid: bool
    comment: Optional[str] = None


class VerificationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    hazard_id: int
    is_valid: bool
    created_at: datetime


# User Schemas
class UserCreate(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8)
    device_id: Optional[str] = None


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    is_active: bool
    created_at: datetime


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    user_id: Optional[int] = None


# Alert Schema
class AlertResponse(BaseModel):
    hazard_id: int
    distance: float
    severity: float
    confidence: float
    message: str
    latitude: float
    longitude: float
    hazard_type: HazardTypeEnum


# Statistics Schema
class StatisticsResponse(BaseModel):
    total_detections: int
    total_hazards: int
    active_hazards: int
    total_users: int
    detections_last_24h: int
    hazards_last_7d: int
