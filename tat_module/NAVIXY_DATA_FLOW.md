# Navixy Data Flow: What We Get vs What We Derive

## 🔍 How to Use the Data Inspector

I've added a **floating blue button** (</> icon) in the bottom-right of your **Live Dashboard** (`/live`). Click it to open the **Navixy Data Inspector** which shows:

1. **Raw data from Navixy API** (marked in GREEN)
2. **Computed values by our code** (marked in PURPLE)
3. **Full JSON payload** for each tracker

---

## 📡 Data Sources

### 1. FROM NAVIXY (Real-time WebSocket: `state_batch` events)

Navixy sends us a **complete tracker state object** every ~1 second via WebSocket:

```typescript
{
  // Tracker Identity
  source_id: 10329559,

  // GPS Data (ALWAYS PROVIDED)
  gps: {
    location: {
      lat: -7.6774,
      lng: 36.1902
    },
    heading: 180,        // Direction in degrees (0-359)
    speed: 5,            // km/h - CURRENT INSTANTANEOUS SPEED
    updated: "2025-01-29 22:52:20"  // GPS fix timestamp
  },

  // Digital Inputs (ALWAYS PROVIDED)
  inputs: [true, false, false, ...],  // inputs[0] = ignition sensor

  // Connection Tracking (ALWAYS PROVIDED)
  last_update: "2025-01-29 22:52:20",  // Last data received from tracker

  // Advanced Fields (MAY BE PROVIDED - depends on Navixy plan/tracker)
  movement_status: "moving" | "stopped" | "parked",  // ⭐ SOPHISTICATED DETECTION
  movement_status_update: "2025-01-29 22:46:15",    // When movement status last changed
  ignition: true | false,                            // Dedicated ignition field
  ignition_update: "2025-01-29 22:45:00",           // When ignition last changed
  connection_status: "active" | "idle" | "offline"   // Device connection health
}
```

---

## 🧠 What Navixy Computes (Already Done for Us)

### 1. `movement_status` (Navixy's Algorithm)

**How Navixy determines this:**
- **NOT just speed threshold!**
- Analyzes GPS points over **time window** (typically 30-60 seconds)
- Checks **distance traveled** vs time elapsed
- Compensates for **GPS drift** (stationary vehicle wobbling 1-3 meters)
- Considers **heading changes** (turning vs straight line)
- Accounts for **parking lot movements** (slow maneuvering)

**Values:**
- `"moving"` → Vehicle is in transit (even if crawling at 2 km/h in traffic)
- `"stopped"` → Vehicle halted temporarily (red light, traffic jam stop-and-go)
- `"parked"` → Vehicle parked for extended period (engine off, stationary)

**Why trust this?**
✅ Prevents false positives from GPS jitter
✅ Detects slow-moving traffic jams correctly
✅ Better than simple speed threshold

---

### 2. `connection_status` (Navixy's Algorithm)

**How Navixy determines this:**
- Monitors **last communication** from tracker device
- Checks **signal strength** and data packet integrity

**Values:**
- `"active"` → Device sending data regularly (< 1 min since last update)
- `"idle"` → Device connected but infrequent updates (1-10 mins)
- `"offline"` → No communication for extended period (> 10 mins)

---

## 🔧 What WE Compute (Derived Logic)

### 1. **Final Vehicle Status** (Our `getVehicleStatus()` function)

**Location:** `src/hooks/useTrackerStatusDuration.ts:78-101`

**Logic Priority:**
```typescript
// PRIORITY 1: Check if device is offline
if (connection_status === 'offline') return 'offline';

// PRIORITY 2: Trust Navixy's movement detection
if (movement_status === 'moving') return 'moving';
if (movement_status === 'parked') return 'stopped';
if (movement_status === 'stopped') {
    return ignition ? 'idle' : 'stopped';
}

// PRIORITY 3: Fallback (if movement_status not provided)
if (speed > 5) return 'moving';
if (ignition) return 'idle';
return 'stopped';
```

**Our 4 Status Categories:**
| Status | Definition | Display Color |
|--------|-----------|---------------|
| `moving` | Vehicle in transit (trusts Navixy or speed > 5) | 🟢 Green |
| `idle` | Engine on, not moving (ignition=true, speed=0) | 🟡 Yellow |
| `stopped` | Parked with engine off (ignition=false, speed=0) | 🔴 Red |
| `offline` | No GPS signal for 10+ mins | ⚫ Gray |

---

### 2. **Status Duration Tracking** (Our `useTrackerStatusDuration()` hook)

**What we compute:**
- **How long** a vehicle has been in current status
- **Start time** of current status (from Navixy's `movement_status_update` or real-time detection)

**Example:**
```
Vehicle #10329559
Status: IDLE
Duration: 14m 10s  ← WE CALCULATE THIS
Start Time: 22:38:37  ← From Navixy's "ignition_update" field
```

---

### 3. **Fleet Statistics** (Our `useFleetAnalysis()` hook)

**What we compute:**
- Total counts: `moving`, `idle`, `stopped`, `offline`
- Average fleet speed
- Geofence occupancy (how many vehicles in each zone)
- **Traffic congestion clusters** using DBSCAN algorithm

**DBSCAN Clustering:**
```typescript
// Find clusters of slow-moving vehicles (< 15 km/h)
const slowMovingPoints = vehicles.filter(v => v.speed < 15);
const clusters = turf.clustersDbscan(slowMovingPoints, 2.0 km radius);
// → Detects traffic jams, port queues, border delays
```

---

## 📊 Data Flow Diagram

```
┌─────────────────────────────────────────┐
│  Navixy Tracker Device (GPS + Sensors)  │
└───────────────┬─────────────────────────┘
                │
                │ (Cellular/Satellite)
                ▼
┌─────────────────────────────────────────┐
│      Navixy Cloud (api.navixy.com)      │
│  ┌─────────────────────────────────┐    │
│  │  Computes:                      │    │
│  │  • movement_status (algorithm)  │    │
│  │  • connection_status            │    │
│  │  • ignition state               │    │
│  └─────────────────────────────────┘    │
└───────────────┬─────────────────────────┘
                │
                │ (WebSocket: state_batch events)
                ▼
┌─────────────────────────────────────────┐
│   Our Frontend (React + Hooks)          │
│  ┌─────────────────────────────────┐    │
│  │  useNavixyRealtime              │    │
│  │  → Receives raw state objects   │    │
│  └────────────┬────────────────────┘    │
│               ▼                          │
│  ┌─────────────────────────────────┐    │
│  │  getVehicleStatus()             │    │
│  │  → Derives final status         │    │
│  └────────────┬────────────────────┘    │
│               ▼                          │
│  ┌─────────────────────────────────┐    │
│  │  useFleetAnalysis()             │    │
│  │  → Computes fleet stats         │    │
│  │  → DBSCAN clustering            │    │
│  └─────────────────────────────────┘    │
└───────────────┬─────────────────────────┘
                │
                ▼
      ┌─────────────────────┐
      │  UI Components      │
      │  • Fleet Pulse      │
      │  • Fleet Status     │
      │  • Real-time Map    │
      └─────────────────────┘
```

---

## 🎯 Key Insights

### What Navixy Does Well:
✅ **Sophisticated movement detection** (better than simple speed threshold)
✅ **GPS drift compensation** (ignores jitter from stationary vehicles)
✅ **Real-time streaming** (1-second updates via WebSocket)
✅ **Connection monitoring** (detects offline devices)

### What We Add:
✅ **Fleet-level aggregation** (total counts, percentages)
✅ **Traffic analysis** (DBSCAN clustering for congestion detection)
✅ **Geofence monitoring** (occupancy tracking for ports/borders)
✅ **Duration tracking** (how long in current status)
✅ **Business logic** (4 status categories: moving/idle/stopped/offline)

---

## 🔍 Inspecting Your Data

### Using the Data Inspector:

1. Go to **Live Dashboard** (`/live`)
2. Click the **blue </> button** (bottom-right corner)
3. Select any vehicle from the list
4. See:
   - **Raw Navixy data** (what they send)
   - **Our derived values** (what we compute)
   - **Status determination logic** (step-by-step decision tree)
   - **Full JSON payload** (complete state object)

### What to Look For:

**If you see:**
```json
"movement_status": "moving",
"speed": 3
```
→ ✅ **Good!** Navixy detected slow-moving traffic, we trust it

**If you see:**
```json
"movement_status": null,
"speed": 25
```
→ ⚠️ **Fallback mode** - Using speed-based detection (tracker may not support advanced fields)

**If you see:**
```json
"connection_status": "offline",
"last_update": "2025-01-29 20:15:00"
```
→ 🔴 **Device offline** - No GPS data for 2+ hours

---

## 📈 Significance for Fleet Operations

### Accurate Status = Better Decisions

| Scenario | Navixy Detects | We Derive | Business Impact |
|----------|---------------|-----------|-----------------|
| **Traffic Jam** | `movement_status: "moving"` @ 2 km/h | Status: MOVING | ✅ ETA adjusted, no false alarm |
| **Port Queue** | `movement_status: "moving"` @ 3 km/h | DBSCAN cluster detected | ✅ Alert: "7 vehicles delayed at port" |
| **Driver Break** | `movement_status: "parked"`, ignition=false | Status: STOPPED | ✅ Compliance: rest period tracked |
| **Engine Idling** | `movement_status: "stopped"`, ignition=true | Status: IDLE | ✅ Fuel waste alert after 10 mins |
| **GPS Malfunction** | `connection_status: "offline"` | Status: OFFLINE | ✅ Maintenance alert triggered |

---

## 🚀 Next Steps

1. **Test the Data Inspector** - Click through 10+ vehicles to see data patterns
2. **Verify Navixy Plan** - Check if your subscription includes `movement_status` field
3. **Monitor Fallback Usage** - If many trackers lack `movement_status`, contact Navixy support
4. **Customize Thresholds** - Adjust slow-moving detection (currently 15 km/h) for your operations

---

## ❓ Common Questions

**Q: Why do some vehicles show `movement_status: null`?**
A: Older tracker models or basic Navixy plans may not support this field. We automatically fall back to speed-based detection.

**Q: Is speed-based fallback good enough?**
A: For high-speed highway driving, yes. For urban/port operations with slow traffic, `movement_status` is much better.

**Q: Can we change the 5 km/h threshold?**
A: Yes, but only affects fallback mode. If Navixy provides `movement_status`, we trust it regardless of speed.

**Q: How often does Navixy update data?**
A: WebSocket sends updates every 1 second when vehicle is moving, every 5-10 seconds when stopped.

---

## 🔗 Related Files

- **WebSocket Client**: `src/services/navixy-socket.ts`
- **Status Logic**: `src/hooks/useTrackerStatusDuration.ts`
- **Fleet Analysis**: `src/hooks/useFleetAnalysis.ts`
- **Data Inspector**: `src/components/NavixyDataInspector.tsx`
- **Type Definitions**: `src/services/navixy.ts`
