# Parked vs Stopped: Understanding the Distinction

## 🎯 Summary of Changes

We've added **"Parked"** as a 5th vehicle status to better match Navixy's classification and provide clearer operational insights.

### Before (4 Statuses):
- 🟢 Moving
- 🟡 Idle
- 🔴 Stopped (included both temporary stops AND long-term parking)
- ⚫ Offline

### After (5 Statuses):
- 🟢 **Moving**
- 🟡 **Idle**
- 🔴 **Stopped** (temporary halt)
- 🔵 **Parked** (long-term parking) ✨ NEW
- ⚫ **Offline**

---

## 📊 Navixy's Classification Explained

### 1. **"stopped"** (Navixy field: `movement_status: "stopped"`)

**Definition:** Temporary halt (short-term)
- Duration: < 10-15 minutes typically
- Connection: Usually `"active"` (frequent updates)
- Engine: Usually OFF (but can be on during short stops)

**Examples:**
```json
{
  "movement_status": "stopped",
  "connection_status": "active",
  "movement_status_update": "23:49:35",  // Just stopped 2-4 min ago
  "ignition": false
}
```

**Real-World Scenarios:**
- 🚦 Traffic light / signal
- 📦 Loading/unloading (quick stop)
- ☕ Quick break (< 10 minutes)
- 🚗 Driver just parked (too early to be classified as "parked")

**Display:**
- Color: 🔴 **Red**
- Icon: ⏹️ Stop Circle
- Label: "Stopped"

---

### 2. **"parked"** (Navixy field: `movement_status: "parked"`)

**Definition:** Extended parking (long-term)
- Duration: > 15-30 minutes typically
- Connection: Usually `"idle"` (power-saving mode)
- Engine: Almost always OFF

**Examples:**
```json
{
  "movement_status": "parked",
  "connection_status": "idle",
  "movement_status_update": "19:38:40",  // Parked 4+ hours ago
  "ignition": false
}
```

**Real-World Scenarios:**
- 🌙 Overnight parking
- 🏁 End of shift
- 🍽️ Long break (lunch, rest period > 30 min)
- 🏭 Warehouse/depot parking
- 🏨 Hotel/accommodation parking

**Display:**
- Color: 🔵 **Blue**
- Icon: 🅿️ Parking Circle
- Label: "Parked"

---

## 🔍 How Navixy Determines "stopped" vs "parked"

### The Transition Timeline:

```
Vehicle Moving → Stops → Stopped (2 min) → Stopped (10 min) → Parked (30 min)
                   ↓           ↓                ↓                    ↓
              Ignition OFF   Still "stopped"   Still "stopped"   Becomes "parked"

Connection:     active         active           active →          idle (power save)
Status:         moving →       stopped          stopped →         parked
```

**Navixy's Algorithm:**
1. **GPS stops moving** → `movement_status: "stopped"`
2. **After 15-30 minutes** → Navixy analyzes:
   - Is ignition off?
   - Has vehicle not moved at all?
   - Is GPS still in same location?
3. **If all true** → `movement_status: "parked"`
4. **Power saving mode** → `connection_status: "active" → "idle"`

---

## 🎨 UI Changes Summary

### Fleet Pulse Card (Dashboard)
```
[Green] [Yellow] [Red] [Blue] [Gray]
  175     108    ~50   ~500   545

Moving  Idle   Stop   Park   Off
```

**Before:** 4 bars (Moving, Idle, Stopped, Off)
**After:** 5 bars (Moving, Idle, Stopped, **Parked**, Off) ✨

### Fleet Status Filters (Live Dashboard)
```
[All] [Moving (175)] [Idle (108)] [Stopped (50)] [Parked (500)] [Offline (545)]
                                                     ↑ NEW BLUE FILTER
```

### Vehicle Status Badge
```
Before:
[🔴 STOPPED] 2h 26m

After (short-term stop):
[🔴 STOPPED] 4m 23s

After (long-term):
[🔵 PARKED] 2h 26m
```

---

## 📈 Business Impact

### Better Operational Insights

**Stopped (Red) = Actionable**
- Temporary halt
- Driver may need assistance
- Check if delay is expected
- Monitor for extended stop → idle alert

**Parked (Blue) = Normal State**
- Expected end-of-shift
- Planned rest period
- No immediate action needed
- Part of normal operations

### Improved Reporting

**Before:**
```
Fleet Status: 653 Stopped
↑ Includes both 50 quick stops AND 500+ long-term parking
```

**After:**
```
Fleet Status:
- 50 Stopped (investigate if unexpected)
- 500 Parked (normal overnight/end-of-shift)
```

### Clearer Alerts

**Stopped → Parked Transition Alert:**
```
Vehicle #672070 has been stopped for 15 minutes
→ Classified as PARKED (normal long-term parking)
→ No fuel waste alert (engine confirmed off)
```

---

## 🔧 Implementation Details

### Files Modified:

1. **Type Definitions:**
   - [src/hooks/useTrackerStatusDuration.ts](src/hooks/useTrackerStatusDuration.ts#L5)
   - Changed: `type VehicleStatus = 'moving' | 'idle' | 'stopped' | 'parked' | 'offline'`

2. **Status Logic:**
   - [src/hooks/useTrackerStatusDuration.ts](src/hooks/useTrackerStatusDuration.ts#L86-L94)
   - Now returns `'parked'` for Navixy's `movement_status: "parked"`

3. **Fleet Analysis:**
   - [src/hooks/useFleetAnalysis.ts](src/hooks/useFleetAnalysis.ts#L38-L47)
   - Added `parked: number` to interface
   - Counts parked vehicles separately

4. **UI Components:**
   - [src/components/RealtimeInsights.tsx](src/components/RealtimeInsights.tsx#L77-L88) - Fleet Pulse card
   - [src/components/LiveTracker.tsx](src/components/LiveTracker.tsx#L162-L167) - Filter buttons
   - [src/components/IdleStatusIndicator.tsx](src/components/IdleStatusIndicator.tsx#L33-L41) - Status badge
   - [src/components/NavixyDataInspector.tsx](src/components/NavixyDataInspector.tsx#L63-L68) - Data inspector

---

## 🎯 Status Determination Logic

### Priority Order:

```typescript
1. connection_status === 'offline' → OFFLINE

2. movement_status === 'moving' → MOVING

3. movement_status === 'parked' → PARKED ✨ (uses Navixy's classification)

4. movement_status === 'stopped':
   - If ignition ON → IDLE
   - If ignition OFF → STOPPED

5. Fallback (if movement_status not provided):
   - If speed > 5 km/h → MOVING
   - If ignition ON → IDLE
   - Else → STOPPED
```

---

## 📊 Real-World Example Analysis

### Your Data Samples:

**Sample 1: "stopped" (Short-term)**
```json
{
  "source_id": 10226075,
  "movement_status": "stopped",        // Navixy: temporary stop
  "movement_status_update": "23:49:35", // Just stopped 2-4 min ago
  "connection_status": "active",       // Still sending frequent updates
  "ignition": false
}
```
→ **Display:** 🔴 **STOPPED** (temporary halt)

**Sample 2: "parked" (Long-term)**
```json
{
  "source_id": 643505,
  "movement_status": "parked",         // Navixy: extended parking
  "movement_status_update": "19:38:40", // Parked 4+ hours ago!
  "connection_status": "idle",         // Power-saving mode
  "ignition": false
}
```
→ **Display:** 🔵 **PARKED** (long-term parking)

---

## ✅ Benefits of This Change

### 1. **Matches Navixy's Intent**
Navixy provides this distinction for a reason - we should use it!

### 2. **Clearer Operations View**
- Red (Stopped) = Investigate if unexpected
- Blue (Parked) = Normal end-of-shift, no action needed

### 3. **Better Fleet Reports**
```
Daily Summary:
- 50 temporary stops (avg 5 min each) ✅ Normal deliveries
- 500 vehicles parked overnight ✅ Normal operations
```

### 4. **Accurate Idle Alerts**
- Don't alert on long-term parking (engine off)
- Only alert on idling (engine on, not moving)

### 5. **Industry Standard**
- Motive/Samsara also distinguish parking from temporary stops
- Better alignment with fleet management best practices

---

## 🚀 User Experience

### Dashboard View:
- **Fleet Pulse:** 5-color bar clearly shows distribution
- **Moving:** Green (active trips)
- **Idle:** Yellow (fuel waste warning)
- **Stopped:** Red (temporary, may need attention)
- **Parked:** Blue (normal long-term parking)
- **Offline:** Gray (device issues)

### Live Tracking:
- **Filter by Parked:** See all overnight/end-of-shift vehicles
- **Filter by Stopped:** Investigate unexpected halts
- **Clear visual distinction:** Blue badge vs Red badge

### Reporting:
- **Stopped Time:** Cumulative time vehicle halted during trips
- **Parked Time:** Cumulative time vehicle in long-term parking
- **Operational Hours:** Stopped + Moving (excludes overnight parking)

---

## 📚 Comparison Table

| Metric | Stopped 🔴 | Parked 🔵 |
|--------|-----------|----------|
| **Duration** | < 15 minutes | > 15 minutes |
| **Connection** | Active | Idle (power save) |
| **Navixy Status** | `"stopped"` | `"parked"` |
| **Typical Cause** | Traffic, loading, quick break | Overnight, end-of-shift, long break |
| **Action Required** | Monitor for delays | No action (normal) |
| **Fuel Impact** | May idle (if engine on) | No fuel use (engine off) |
| **Included in Trip Time** | Yes | No (downtime) |

---

## 🎯 Conclusion

By adding "Parked" as a distinct status, we now:
- ✅ Trust Navixy's sophisticated classification
- ✅ Provide clearer operational insights
- ✅ Match industry standards (Motive/Samsara)
- ✅ Enable better reporting and alerts
- ✅ Distinguish actionable stops from normal parking

**The system now accurately reflects the real state of your fleet!** 🚛📍
