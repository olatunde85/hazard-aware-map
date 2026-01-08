# Trip Mode Feature - Implementation Summary

**Branch**: `feature/trip-mode-alerts`
**Status**: Ready for Testing
**Date**: January 8, 2026

---

## Overview

Implemented **Option B: Hazard Alert Overlay** - a trip-based monitoring system that alerts drivers about hazards ahead without full turn-by-turn navigation. Users can continue using their preferred navigation app (Google Maps, Waze) while Bump Aware provides hazard intelligence.

## Key Principle

> **Hazard alerts are valuable even without full navigation**. Users already have navigation apps they trust—our app's unique value is road hazard intelligence, not turn-by-turn directions.

---

## What Was Implemented

### 1. TripService (`mobile/src/services/TripService.ts`)

A new service managing trip state and hazard monitoring:

**Key Features**:
- **Trip State Management**: Start/stop trips, track statistics
- **Hazard Loading**: Queries hazards within route corridor (bounding box)
- **Location Monitoring**: Watches user location every 50 meters
- **Distance-Based Alerts**: Triggers alerts when within 300m of hazards
- **Alert Cooldown**: Prevents alert fatigue (2 min cooldown, max 1 per 500m)
- **Statistics Tracking**: Distance traveled, hazards avoided

**Alert Configuration**:
```typescript
ALERT_DISTANCE_METERS = 300     // Alert when 300m from hazard
ALERT_COOLDOWN_MS = 120000      // 2 minutes cooldown per hazard
MIN_ALERT_SEVERITY = 3.0        // Only alert for severity >= 3
HAZARD_QUERY_RADIUS_KM = 5      // Query hazards within 5km
```

**Core Algorithm**:
```
1. User sets destination (coordinates)
2. Calculate bounding box from current location to destination
3. Query all hazards in bounding box (severity >= 3)
4. Start location monitoring (updates every 50m)
5. For each location update:
   - Calculate distance to each hazard
   - If distance <= 300m and not recently alerted:
     - Trigger alert with hazard details
     - Mark as alerted for 2 minutes
6. Track statistics: distance, hazards avoided
7. Stop trip: Show final statistics
```

### 2. Enhanced MapScreen (`mobile/src/screens/MapScreen.tsx`)

Added trip mode UI and controls to the map screen:

**New UI Components**:

1. **Destination Modal** (with two modes):
   - **Search Place (Default)**: Google Places Autocomplete
     - Search any place in Nigeria (e.g., "Victoria Island", "Ikeja Mall")
     - Auto-suggestions as you type
     - Shows place details and coordinates
   - **Coordinates (Fallback)**: Manual coordinate entry
     - Enter coordinates (lat, lon format)
     - Example: `7.3775, 3.9470`
     - Validates input format
   - Easy toggle between modes
   - Sets destination marker on map

2. **Trip Control Buttons**:
   - "Set Destination" - Opens coordinate input modal
   - "Start Trip" - Begins monitoring (appears after destination set)
   - "Stop Trip" - Ends monitoring, shows statistics

3. **Trip Stats Overlay**:
   - Replaces "X hazards nearby" when trip active
   - Shows: "🚗 Trip Active"
   - Live updates: Distance traveled, Hazards avoided

4. **Map Visualization**:
   - Green destination marker
   - Dashed line from user to destination
   - Existing hazard markers (red/orange/yellow)

**Alert Flow**:
```
User starts trip → TripService monitors location → Hazard detected within 300m
→ Alert dialog shown:
   "🕳️ Hazard Ahead!"
   "HIGH pothole in 250m"
   "Severity: 8.5/10"
   "Confidence: 95%"
→ User dismisses → Continues driving → Next hazard alert
```

---

## How to Test

### Prerequisites

1. **Backend running** with hazards in database:
   ```bash
   docker-compose up -d
   curl -X POST http://localhost:8080/api/v1/admin/process-detections
   ```

2. **Ngrok tunnel active** (for physical device):
   ```bash
   ngrok http 8080
   # Configure API URL in app: https://YOUR_URL.ngrok.io/api/v1
   ```

3. **Know hazard locations** from database:
   ```bash
   docker compose exec postgres psql -U postgres -d bump_aware -c \
     "SELECT id, latitude, longitude, severity FROM hazards WHERE is_active = true;"
   ```

### Test Scenario 1: Simple Trip with Known Hazards

**Setup**:
- You have 2 hazards in database (from previous testing):
  - Hazard 1: 37.422, -122.084 (severity 3.06)
  - Hazard 2: 6.564, 3.264 (severity 8.46)

**Test Steps**:

1. **Open app, go to Map tab**
2. **Tap "Set Destination"**
   - Enter coordinates of a hazard: `6.564, 3.264`
   - Tap "Set"
   - Green marker appears on map
   - Dashed line from your location to destination

3. **Tap "Start Trip"**
   - Alert: "Trip Started - You will be alerted about hazards ahead"
   - Stats overlay changes to "🚗 Trip Active"
   - Button changes to "Stop Trip"

4. **Simulate movement** (if testing from same location):
   - Unfortunately, real movement needed for proper testing
   - TripService monitors location every 50m
   - Alert triggers when within 300m of hazard

5. **Stop trip**:
   - Tap "Stop Trip"
   - Confirm dialog
   - See final stats: Distance, Hazards Avoided

### Test Scenario 2: Physical Device with Real Movement

**Best Test Method**:

1. **Find route with known hazards**:
   - Check database for hazard locations
   - Plan a short drive (e.g., around your neighborhood)
   - Note hazard coordinates

2. **Start trip before driving**:
   - Enter destination coordinates
   - Tap "Start Trip"
   - Place phone in holder

3. **Drive toward hazards**:
   - App monitors in background
   - When within 300m: Alert dialog appears
   - Note: First version uses foreground monitoring (app must be open)

4. **Expected behavior**:
   - Alert appears 300m before hazard
   - At 30 km/h: ~36 seconds advance notice
   - At 60 km/h: ~18 seconds advance notice
   - Alert includes hazard type, severity, confidence

### Test Scenario 3: Alert Cooldown & Suppression

**Test**:
1. Start trip to location with multiple nearby hazards
2. First hazard: Alert appears
3. Drive past hazard
4. Second hazard (within 500m of first): Should NOT alert immediately
5. Wait 2 minutes or drive >500m: Alerts resume

**Purpose**: Prevent alert fatigue

---

## Current Limitations & Future Enhancements

### Recent Updates

**v2 - Autocomplete + UI Fixes**:
1. ✅ Added Google Places Autocomplete for destination search
2. ✅ Toggle between "Search Place" and "Coordinates" modes
3. ✅ Fixed button positioning to not cover center/pin button
4. ✅ Improved modal UI with full-screen experience
5. ✅ Country filter for Nigeria (can be changed)

### Current Limitations

1. **Foreground monitoring**: App must be open/active during trip
   - **Why**: React Native Geolocation.watchPosition requires foreground
   - **Future**: Implement background geolocation with proper permissions

3. **Straight-line distance**: Not route-aware
   - **Why**: No routing engine integrated yet
   - **Impact**: May alert about hazards not on actual route
   - **Acceptable**: User is in general area, hazard awareness still valuable

4. **No turn-by-turn**: Not a full navigation replacement
   - **By Design**: Users continue using Google Maps/Waze
   - **Our Value**: Complementary hazard intelligence

### Phase 2 Enhancements (Future)

1. **Address Search**:
   ```typescript
   // Using Mapbox Geocoding (free tier: 100k requests/month)
   const response = await fetch(
     `https://api.mapbox.com/geocoding/v5/mapbox.places/Victoria Island.json?access_token=${key}`
   );
   const {features} = await response.json();
   const [lon, lat] = features[0].center;
   ```

2. **Route-Aware Alerts**:
   ```typescript
   // Using Mapbox Directions API
   const route = await getRoute(start, end);
   const routeBuffer = createBuffer(route, 500); // 500m corridor
   const hazardsOnRoute = filterHazardsInBuffer(allHazards, routeBuffer);
   ```

3. **Background Geolocation**:
   ```bash
   npm install react-native-background-geolocation
   # iOS: Request "always" location permission
   # Android: Foreground service notification
   ```

4. **Voice Alerts**:
   ```bash
   npm install react-native-tts
   # "Pothole ahead in 300 meters. Slow down."
   ```

5. **Speed-Based Alert Distance**:
   ```typescript
   // Dynamic alert distance based on speed
   const alertDistance = currentSpeed * ALERT_LEAD_TIME_SECONDS;
   // 60 km/h × 20s = 333m
   // 30 km/h × 20s = 167m
   ```

---

## Testing Checklist

- [ ] Backend has processed hazards (check database)
- [ ] App connects to backend (Settings → API URL)
- [ ] Map loads with hazard markers visible
- [ ] "Set Destination" button visible at bottom
- [ ] Can enter coordinates in modal
- [ ] Destination marker appears after setting
- [ ] "Start Trip" button appears after destination set
- [ ] Tapping "Start Trip" shows confirmation
- [ ] Stats overlay changes to "Trip Active"
- [ ] (With movement) Alert appears near hazard
- [ ] "Stop Trip" shows final statistics
- [ ] Can start new trip after stopping

---

## Code Structure

```
mobile/src/
├── services/
│   └── TripService.ts          # NEW: Trip management & hazard monitoring
└── screens/
    └── MapScreen.tsx           # MODIFIED: Added trip mode UI with autocomplete
```

**Lines of Code**:
- TripService: ~350 lines
- MapScreen changes: ~400 lines added
- Total: ~750 lines new/modified

**New Dependencies**:
```bash
npm install react-native-google-places-autocomplete
```

**Google Places API Requirements**:
- Uses same Google Maps API key (configured in Settings)
- Must enable "Places API" in Google Cloud Console
- Free tier: 500 requests/day (sufficient for most users)
- Each place search = 1 request

---

## API Endpoints Used

1. **GET /api/v1/hazards/bounds** (used by TripService):
   ```
   GET /api/v1/hazards/bounds?min_lat=6.5&max_lat=7.5&min_lon=3.0&max_lon=4.0
   Returns: All hazards in bounding box
   ```

2. **GET /api/v1/hazards/nearby** (existing, used by MapScreen):
   ```
   GET /api/v1/hazards/nearby?lat=6.564&lon=3.264&radius=5000
   Returns: Hazards within 5km radius
   ```

---

## Real-World Usage Example

**Scenario**: Daily commute from Ibadan to office

1. **Morning**:
   - Open Bump Aware
   - Set destination: Office coordinates
   - Start trip
   - Open Google Maps for navigation
   - Switch back to Bump Aware (or minimize)

2. **During Drive**:
   - Follow Google Maps directions
   - Bump Aware alerts about hazards ahead
   - "🕳️ Pothole ahead in 250m - Severity: HIGH"
   - Driver slows down, avoids damage

3. **Arrival**:
   - Stop trip in Bump Aware
   - See statistics: "5.2 km traveled, 3 hazards avoided"

**Value Proposition**:
- No need to switch from trusted navigation app
- Get hazard intelligence Google Maps doesn't provide
- Avoid vehicle damage and passenger discomfort
- Contribute detection data while driving

---

## Performance Considerations

**Battery Impact**:
- Location monitoring every 50m: ~3-4% per hour (same as navigation apps)
- Alert checks: Negligible (in-memory distance calculations)
- Network: Only loads hazards once at trip start

**Memory**:
- Hazard list: ~500 hazards × 200 bytes = 100KB
- Acceptable for most devices

**Network**:
- Initial hazard load: 1 request (typically <50KB)
- No ongoing requests during trip
- Works with flaky connections

---

## Next Steps After Testing

1. **If working well**:
   - Merge to main branch
   - Document in README
   - Add screenshots/video
   - Share with beta testers

2. **If issues found**:
   - Fix bugs in feature branch
   - Re-test
   - Iterate

3. **Future enhancements**:
   - Implement address search (Phase 2)
   - Add background geolocation
   - Integrate routing API for route-aware alerts
   - Voice alerts for hands-free operation

---

## Commit Message

```
feat: Add trip mode with destination-based hazard alerts

Implements Option B (Hazard Alert Overlay) for trip-based monitoring:

- Add TripService for trip management and hazard monitoring
- Add destination search modal with coordinate input
- Add trip control buttons (Set Destination, Start/Stop Trip)
- Implement distance-based hazard alerts (300m threshold)
- Add trip statistics overlay (distance, hazards avoided)
- Display destination marker and route line on map
- Alert cooldown and suppression to prevent fatigue

Users can now:
1. Set destination by entering coordinates
2. Start trip monitoring
3. Receive alerts when approaching hazards (300m ahead)
4. See live trip statistics
5. Use alongside Google Maps/Waze for navigation

Technical details:
- Location monitoring every 50m
- Alerts for hazards with severity >= 3
- 2-minute cooldown per hazard
- Query hazards in route corridor bounding box
- Haversine distance calculations
```

---

**Ready to test! Let me know if you encounter any issues or need adjustments.**
