#!/usr/bin/env python3
"""
Import bump detections from exported JSON files into the database.

Usage:
    python import_detections.py <json_file> [--user-email EMAIL]

Example:
    python import_detections.py bump_detections_1234567890.json --user-email user@example.com
"""

import json
import sys
import asyncio
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from geoalchemy2.elements import WKTElement

from app.db.base import AsyncSessionLocal
from app.db.models import User, Detection
from app.core.config import settings


async def find_or_create_user(session: AsyncSession, email: str) -> User:
    """Find existing user or create a new one for imports."""
    # Try to find existing user
    result = await session.execute(
        select(User).where(User.email == email)
    )
    user = result.scalar_one_or_none()

    if user:
        print(f"✓ Found existing user: {email}")
        return user

    # Create new user for imports
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

    user = User(
        email=email,
        hashed_password=pwd_context.hash("imported_user_password"),
        device_id=f"import_{datetime.utcnow().timestamp()}",
        is_active=True,
    )
    session.add(user)
    await session.flush()
    print(f"✓ Created new user: {email}")
    return user


async def import_detections_from_file(file_path: Path, user_email: str) -> Dict[str, Any]:
    """Import detections from a JSON file."""

    print(f"\n{'='*60}")
    print(f"Importing detections from: {file_path.name}")
    print(f"{'='*60}\n")

    # Read JSON file
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"✗ Error reading file: {e}")
        return {"success": False, "error": str(e)}

    # Validate JSON structure
    if 'detections' not in data:
        print("✗ Invalid file format: missing 'detections' field")
        return {"success": False, "error": "Invalid file format"}

    detections_data = data['detections']
    total_count = len(detections_data)

    print(f"File contains {total_count} detections")
    print(f"Exported at: {data.get('exported_at', 'unknown')}\n")

    # Import to database
    async with AsyncSessionLocal() as session:
        try:
            # Find or create user
            user = await find_or_create_user(session, user_email)

            # Import detections
            imported_count = 0
            skipped_count = 0

            print("Importing detections...")

            for idx, det_data in enumerate(detections_data, 1):
                try:
                    # Validate required fields
                    required_fields = ['latitude', 'longitude', 'magnitude', 'timestamp']
                    if not all(field in det_data for field in required_fields):
                        print(f"  ✗ Detection {idx}: Missing required fields")
                        skipped_count += 1
                        continue

                    # Get sensor data
                    accel = det_data.get('accelerometer', {})
                    gyro = det_data.get('gyroscope', {})

                    # Create WKT point for PostGIS
                    point = f"POINT({det_data['longitude']} {det_data['latitude']})"

                    # Create detection
                    detection = Detection(
                        user_id=user.id,
                        location=WKTElement(point, srid=4326),
                        latitude=det_data['latitude'],
                        longitude=det_data['longitude'],
                        accuracy=det_data.get('accuracy', 5.0),
                        magnitude=det_data['magnitude'],
                        timestamp=datetime.fromtimestamp(det_data['timestamp'] / 1000),  # Convert ms to seconds
                        accelerometer_x=accel.get('x', 0.0),
                        accelerometer_y=accel.get('y', 0.0),
                        accelerometer_z=accel.get('z', 0.0),
                        accelerometer_timestamp=datetime.fromtimestamp(accel.get('timestamp', det_data['timestamp']) / 1000),
                        gyroscope_x=gyro.get('x', 0.0),
                        gyroscope_y=gyro.get('y', 0.0),
                        gyroscope_z=gyro.get('z', 0.0),
                        gyroscope_timestamp=datetime.fromtimestamp(gyro.get('timestamp', det_data['timestamp']) / 1000),
                        confirmed_type=det_data.get('confirmed_type'),
                    )

                    session.add(detection)
                    imported_count += 1

                    # Show progress every 10 detections
                    if idx % 10 == 0:
                        print(f"  Processed {idx}/{total_count}...")

                except Exception as e:
                    print(f"  ✗ Detection {idx}: {e}")
                    skipped_count += 1
                    continue

            # Commit all detections
            await session.commit()

            print(f"\n{'='*60}")
            print(f"Import Summary:")
            print(f"  Total in file: {total_count}")
            print(f"  ✓ Imported: {imported_count}")
            print(f"  ✗ Skipped: {skipped_count}")
            print(f"  User: {user_email}")
            print(f"{'='*60}\n")

            return {
                "success": True,
                "total": total_count,
                "imported": imported_count,
                "skipped": skipped_count,
                "user_email": user_email,
            }

        except Exception as e:
            await session.rollback()
            print(f"\n✗ Import failed: {e}")
            return {"success": False, "error": str(e)}


async def main():
    """Main entry point."""

    # Parse arguments
    if len(sys.argv) < 2:
        print("Usage: python import_detections.py <json_file> [--user-email EMAIL]")
        print("\nExample:")
        print("  python import_detections.py bump_detections_1234567890.json --user-email user@example.com")
        sys.exit(1)

    file_path = Path(sys.argv[1])

    # Get user email from args or use default
    user_email = "imported@bumpaware.local"
    if "--user-email" in sys.argv:
        email_idx = sys.argv.index("--user-email")
        if email_idx + 1 < len(sys.argv):
            user_email = sys.argv[email_idx + 1]

    # Validate file exists
    if not file_path.exists():
        print(f"✗ File not found: {file_path}")
        sys.exit(1)

    # Import detections
    result = await import_detections_from_file(file_path, user_email)

    # Exit with appropriate code
    if result["success"]:
        print("✓ Import completed successfully!")
        sys.exit(0)
    else:
        print("✗ Import failed!")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
