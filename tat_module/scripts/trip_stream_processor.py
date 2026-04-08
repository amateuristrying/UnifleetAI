"""
trip_stream_processor.py
========================
Stateful stream processor for the TAT v2 trip lifecycle.

Implements the hybrid historical-batch / live-stream join with the
correct closure priority chain:

    P1  Return to Origin     (conf 0.90) — first-to-occur wins
    P2  Next Loading Event   (conf 0.80) — hard boundary for previous trip
    P3  Inactivity Timeout   (conf 0.50) — 30-day idle fallback

Priority rule: if a Next_Loading event is detected BEFORE an Origin_Entry
event, the Next_Loading timestamp is the hard close boundary and any later
Origin_Entry belongs to the NEW trip.

Kurasini Zone is treated as a loading HUB: loading events may be triggered
from either an Origin Terminal OR the Kurasini Zone. All other Origin Zones
follow the same rule (generalised).

Usage (batch replay):
    processor = TripStreamProcessor()
    processor.load_historical(trip_facts_rows)
    for event in sorted(live_events, key=lambda e: e.ts):
        processor.ingest(event)
    active_trips = processor.active_trips()

Usage (streaming):
    processor = TripStreamProcessor(timeout_days=30)
    # call processor.ingest(event) for each incoming telemetry event
    # call processor.flush_timeouts() periodically (e.g. nightly)
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# ── Constants ──────────────────────────────────────────────────────────────

LOADING_DEBOUNCE_MINUTES = 30   # minimum dwell at origin to confirm loading
TIMEOUT_DAYS             = 30   # inactivity threshold for P3 closure
PROGRESSION_STATES       = {    # signals that confirm the truck left origin
    "corridor_entry",
    "border_entry",
    "destination_entry",
    "destination_region_entry",
    "origin_exit",
}

# Origin zone roles that qualify as loading hubs (Kurasini generalised).
LOADING_HUB_ROLES = {"origin_terminal", "origin_zone"}


# ── Enums ──────────────────────────────────────────────────────────────────

class TripStatus(str, enum.Enum):
    LOADING             = "loading"
    PRE_TRANSIT         = "pre_transit"
    IN_TRANSIT          = "in_transit"
    AT_DESTINATION      = "at_destination"
    RETURNING           = "returning"
    CLOSED              = "closed"


class ClosureReason(str, enum.Enum):
    RETURN_ORIGIN   = "closed_by_return_origin"    # P1
    NEXT_LOADING    = "closed_by_next_loading"      # P2
    TIMEOUT         = "closed_by_timeout"           # P3


class EventCode(str, enum.Enum):
    # Origin / loading
    ORIGIN_ENTRY         = "origin_entry"
    ORIGIN_EXIT          = "origin_exit"
    LOADING_START        = "loading_start"
    LOADING_END          = "loading_end"
    # Transit
    CORRIDOR_ENTRY       = "corridor_entry"
    BORDER_ENTRY         = "border_entry"
    BORDER_EXIT          = "border_exit"
    # Destination
    DESTINATION_ENTRY    = "destination_entry"
    DESTINATION_EXIT     = "destination_exit"
    DESTINATION_REGION_ENTRY = "destination_region_entry"
    DESTINATION_REGION_EXIT  = "destination_region_exit"
    # Closure
    RETURN_ORIGIN_ENTRY  = "return_origin_entry"
    TRIP_CLOSED          = "trip_closed"
    # Synthetic / live
    TELEMETRY_PING       = "telemetry_ping"


# ── Data classes ───────────────────────────────────────────────────────────

@dataclass
class GeofenceContext:
    name:       str
    role:       str           # e.g. "origin_terminal", "origin_zone", "destination"
    canonical:  Optional[str] = None

    @property
    def is_loading_zone(self) -> bool:
        return self.role in LOADING_HUB_ROLES


@dataclass
class TelemetryEvent:
    """A single event from either the historical batch or the live stream."""
    ts:           datetime               # UTC
    tracker_id:   int
    tracker_name: str
    code:         EventCode
    geofence:     Optional[GeofenceContext] = None
    source:       str = "live"           # "historical" | "live"
    raw:          dict = field(default_factory=dict)

    def __post_init__(self):
        if self.ts.tzinfo is None:
            self.ts = self.ts.replace(tzinfo=timezone.utc)


@dataclass
class TripStateEvent:
    """Emitted milestone attached to a specific trip."""
    trip_key:         str
    tracker_id:       int
    tracker_name:     str
    event_code:       EventCode
    event_time:       datetime
    event_confidence: float
    inference_rule:   str
    geofence:         Optional[GeofenceContext] = None
    meta:             dict = field(default_factory=dict)
    trip_stage:       str = ""


@dataclass
class TripState:
    """
    Mutable state for one trip window.

    Strict Continuity guarantee: a new TripState is initialised
    immediately when its predecessor is closed (see TripStreamProcessor).
    """
    trip_key:         str
    tracker_id:       int
    tracker_name:     str
    loading_terminal: Optional[str]
    status:           TripStatus
    loading_start:    datetime
    loading_end:      Optional[datetime]           = None
    origin_exit:      Optional[datetime]           = None
    first_progression: Optional[datetime]          = None    # earliest corridor/border/dest signal
    dest_entry:       Optional[datetime]           = None
    dest_exit:        Optional[datetime]           = None
    return_origin_entry: Optional[datetime]        = None
    return_origin_geofence: Optional[str]          = None
    trip_closed_at:   Optional[datetime]           = None
    closure_reason:   Optional[ClosureReason]      = None
    closure_confidence: float                      = 0.0
    last_event_time:  Optional[datetime]           = None
    source:           str                          = "batch"   # "batch" | "live"
    events:           list[TripStateEvent]         = field(default_factory=list)

    # ── Progression check ──────────────────────────────────────────────────

    @property
    def has_progressed(self) -> bool:
        """True once the truck has left the origin zone (for P2 guard)."""
        return self.first_progression is not None or self.origin_exit is not None

    # ── Eligibility checks for each closure branch ─────────────────────────

    def _p1_eligible(self) -> bool:
        return self.return_origin_entry is not None

    def _p2_eligible(self, next_loading_ts: datetime) -> bool:
        return self.has_progressed

    def _p3_eligible(self, now: datetime) -> bool:
        if self.last_event_time is None:
            return False
        return (now - self.last_event_time) >= timedelta(days=TIMEOUT_DAYS)

    # ── Close decision ─────────────────────────────────────────────────────

    def evaluate_closure(
        self,
        *,
        next_loading_ts: Optional[datetime] = None,
        now: Optional[datetime] = None,
    ) -> Optional[tuple[datetime, ClosureReason, float]]:
        """
        Return (close_ts, reason, confidence) for the highest-priority
        eligible closure trigger, or None if no trigger qualifies yet.

        Priority rule enforced here:
          - P1 fires only when return_origin_entry < next_loading_ts
            (or next_loading_ts is unknown).
          - P2 fires when next_loading_ts is known AND truck progressed.
          - P3 fires when window is open and truck is silent 30 days.

        Structural guarantee from _trip_context:
          return_origin_entry is always < next_loading_ts if both exist,
          because _trip_context's lateral join constrains the return-origin
          candidate to visit_start_utc < window_end (= next_loading_ts).
          This function makes that constraint EXPLICIT and fails-safe.
        """
        if now is None:
            now = datetime.now(tz=timezone.utc)

        # P1 — return to origin
        if self._p1_eligible():
            # Safety: if somehow return_origin was recorded AFTER next_loading,
            # discard it — next_loading is the hard boundary.
            if next_loading_ts is not None and self.return_origin_entry >= next_loading_ts:
                logger.warning(
                    "trip_key=%s: return_origin_entry (%s) >= next_loading_ts (%s) — "
                    "discarding late return_origin; P2 will close trip.",
                    self.trip_key, self.return_origin_entry, next_loading_ts,
                )
            else:
                return (self.return_origin_entry, ClosureReason.RETURN_ORIGIN, 0.90)

        # P2 — next loading is the hard boundary
        if next_loading_ts is not None and self._p2_eligible(next_loading_ts):
            return (next_loading_ts, ClosureReason.NEXT_LOADING, 0.80)

        # P3 — inactivity timeout
        if next_loading_ts is None and self._p3_eligible(now):
            close_ts = self.last_event_time + timedelta(days=TIMEOUT_DAYS)
            return (close_ts, ClosureReason.TIMEOUT, 0.50)

        return None

    def apply_closure(
        self,
        close_ts: datetime,
        reason: ClosureReason,
        confidence: float,
        geofence: Optional[GeofenceContext] = None,
    ) -> TripStateEvent:
        self.trip_closed_at    = close_ts
        self.closure_reason    = reason
        self.closure_confidence = confidence
        self.status            = TripStatus.CLOSED

        inference_map = {
            ClosureReason.RETURN_ORIGIN : "return_to_origin_priority_p75",
            ClosureReason.NEXT_LOADING  : "next_loading_hard_boundary_p75",
            ClosureReason.TIMEOUT       : "timeout_30d_p75",
        }
        meta = {"reason": reason.value, "priority": reason.name}
        if reason == ClosureReason.NEXT_LOADING and self.trip_closed_at:
            meta["hard_boundary"] = close_ts.isoformat()

        ev = TripStateEvent(
            trip_key         = self.trip_key,
            tracker_id       = self.tracker_id,
            tracker_name     = self.tracker_name,
            event_code       = EventCode.TRIP_CLOSED,
            event_time       = close_ts,
            event_confidence = confidence,
            inference_rule   = inference_map[reason],
            geofence         = geofence,
            meta             = meta,
            trip_stage       = "returning",
        )
        self.events.append(ev)
        return ev


# ── Main processor ─────────────────────────────────────────────────────────

class TripStreamProcessor:
    """
    Stateful stream processor implementing the TAT v2 trip state machine.

    State per tracker:
        _active: tracker_id → TripState (current open trip)
        _closed: list of fully closed TripState objects

    Strict Continuity:
        When a trip is closed (any reason), a new TripState is initialised
        for the same tracker_id immediately — trip IDs chain without gaps.
        If no loading signal immediately follows, the new trip stays in
        LOADING status until a loading_start event arrives.
    """

    def __init__(self, timeout_days: int = TIMEOUT_DAYS):
        self._timeout_days: int = timeout_days
        self._active: dict[int, TripState] = {}
        self._closed: list[TripState] = []

    # ── Helpers ────────────────────────────────────────────────────────────

    def _make_trip_key(self, tracker_id: int, loading_start: datetime) -> str:
        return f"{tracker_id}:{int(loading_start.timestamp())}"

    def _emit(self, trip: TripState, ev: TripStateEvent) -> None:
        """Attach event to trip and log for downstream consumption."""
        trip.events.append(ev)
        trip.last_event_time = ev.event_time
        logger.debug("EMIT  trip_key=%-35s  code=%-30s  t=%s", ev.trip_key, ev.event_code.value, ev.event_time.isoformat())

    def _close_trip(
        self,
        trip: TripState,
        close_ts: datetime,
        reason: ClosureReason,
        confidence: float,
        geofence: Optional[GeofenceContext] = None,
    ) -> TripState:
        """
        Close the current trip and immediately initialise the successor.

        Strict Continuity rule: successor starts exactly at close_ts.
        """
        ev = trip.apply_closure(close_ts, reason, confidence, geofence)
        self._closed.append(trip)
        logger.info(
            "CLOSE trip_key=%-35s  reason=%-25s  conf=%.2f  t=%s",
            trip.trip_key, reason.value, confidence, close_ts.isoformat(),
        )

        # ── Strict Continuity: open successor immediately ──────────────────
        successor = TripState(
            trip_key         = f"pending:{trip.tracker_id}:{int(close_ts.timestamp())}",
            tracker_id       = trip.tracker_id,
            tracker_name     = trip.tracker_name,
            loading_terminal = None,
            status           = TripStatus.LOADING,   # awaiting loading_start confirmation
            loading_start    = close_ts,
            source           = "live",
        )
        self._active[trip.tracker_id] = successor
        logger.debug("OPEN  trip_key=%s  (successor, awaiting loading_start)", successor.trip_key)
        return successor

    # ── Historical batch bootstrap ─────────────────────────────────────────

    def load_historical(self, trip_facts: list[dict]) -> None:
        """
        Seed the processor from tat_trip_facts_v2 rows (batch output).

        Only loads OPEN (non-closed) trips as the initial active state.
        Closed trips from history are recorded but do not seed _active.

        trip_facts columns expected (subset):
            tracker_id, tracker_name, trip_key, status, loading_start,
            loading_end, origin_exit, dest_entry, dest_exit,
            return_origin_entry, trip_closed_at, closure_reason,
            loading_terminal, source
        """
        for row in sorted(trip_facts, key=lambda r: r["loading_start"]):
            tracker_id = row["tracker_id"]
            trip = TripState(
                trip_key          = row["trip_key"],
                tracker_id        = tracker_id,
                tracker_name      = row.get("tracker_name", ""),
                loading_terminal  = row.get("loading_terminal"),
                status            = TripStatus(row.get("status", "loading")),
                loading_start     = _parse_ts(row["loading_start"]),
                loading_end       = _parse_ts_opt(row.get("loading_end")),
                origin_exit       = _parse_ts_opt(row.get("origin_exit")),
                dest_entry        = _parse_ts_opt(row.get("dest_entry")),
                dest_exit         = _parse_ts_opt(row.get("dest_exit")),
                return_origin_entry = _parse_ts_opt(row.get("return_origin_entry")),
                trip_closed_at    = _parse_ts_opt(row.get("trip_closed_at")),
                closure_reason    = ClosureReason(row["closure_reason"]) if row.get("closure_reason") else None,
                source            = "batch",
                last_event_time   = _parse_ts_opt(row.get("loading_end") or row.get("loading_start")),
            )
            if trip.trip_closed_at is not None:
                self._closed.append(trip)
            else:
                # Keep only the LATEST open trip per tracker
                existing = self._active.get(tracker_id)
                if existing is None or trip.loading_start > existing.loading_start:
                    self._active[tracker_id] = trip

        logger.info(
            "load_historical: %d open trips, %d closed trips seeded",
            len(self._active), len(self._closed),
        )

    # ── Main event ingestion ───────────────────────────────────────────────

    def ingest(self, event: TelemetryEvent) -> list[TripStateEvent]:
        """
        Process one telemetry event. Returns any TripStateEvents emitted.

        Handles the historical→live boundary transparently: if a tracker
        already has a batch-seeded open trip, live events continue that trip.
        If no open trip exists, a new one is initialised on loading_start.
        """
        emitted: list[TripStateEvent] = []
        tid = event.tracker_id
        now = event.ts

        trip = self._active.get(tid)

        # ── LOADING_START: new trip anchor ─────────────────────────────────
        if event.code == EventCode.LOADING_START:
            if trip is not None and not trip.trip_closed_at:
                # Existing open trip — this is the Next Loading signal (P2 trigger)
                result = trip.evaluate_closure(next_loading_ts=now)
                if result:
                    close_ts, reason, conf = result
                    successor = self._close_trip(trip, close_ts, reason, conf)
                    trip = successor  # fall through to update new trip below
                else:
                    # Truck started new load without sufficient progression —
                    # treat as continuation (e.g., reloading at same terminal)
                    logger.debug(
                        "trip_key=%s: new loading signal but no progression yet; "
                        "treating as reload continuation.", trip.trip_key
                    )

            if trip is None or trip.trip_closed_at:
                # No open trip or just closed → start fresh
                gf = event.geofence
                if gf is None or not gf.is_loading_zone:
                    logger.warning(
                        "tracker=%d: LOADING_START outside a loading zone (%s) — skipping anchor.",
                        tid, gf.role if gf else "None",
                    )
                    return emitted

                trip_key = self._make_trip_key(tid, now)
                trip = TripState(
                    trip_key         = trip_key,
                    tracker_id       = tid,
                    tracker_name     = event.tracker_name,
                    loading_terminal = gf.canonical or gf.name,
                    status           = TripStatus.LOADING,
                    loading_start    = now,
                    source           = event.source,
                    last_event_time  = now,
                )
                self._active[tid] = trip
                logger.info("INIT  trip_key=%s  terminal=%s", trip_key, trip.loading_terminal)

            # ── Kurasini / origin_zone loading hub special case ────────────
            # A zone-level loading start is valid but we degrade confidence
            # slightly until a terminal-level confirmation arrives.
            gf = event.geofence
            conf = 0.95 if (gf and gf.role == "origin_terminal") else 0.80
            ev = TripStateEvent(
                trip_key          = trip.trip_key,
                tracker_id        = tid,
                tracker_name      = event.tracker_name,
                event_code        = EventCode.LOADING_START,
                event_time        = now,
                event_confidence  = conf,
                inference_rule    = "loading_start_zone_hub_p75" if conf < 0.95 else "loading_start_terminal",
                geofence          = gf,
                meta              = {"is_zone_hub": conf < 0.95},
                trip_stage        = "loading",
            )
            self._emit(trip, ev)
            emitted.append(ev)
            return emitted

        # ── No open trip → nothing to update ──────────────────────────────
        if trip is None:
            return emitted

        # Touch last_event_time on every real event
        trip.last_event_time = now

        # ── State transitions ──────────────────────────────────────────────

        if event.code == EventCode.LOADING_END:
            trip.loading_end = now
            trip.status      = TripStatus.PRE_TRANSIT
            ev = TripStateEvent(
                trip_key=trip.trip_key, tracker_id=tid, tracker_name=event.tracker_name,
                event_code=EventCode.LOADING_END, event_time=now,
                event_confidence=0.95, inference_rule="loading_end_zone_exit",
                geofence=event.geofence, trip_stage="loading",
            )
            self._emit(trip, ev)
            emitted.append(ev)

        elif event.code == EventCode.ORIGIN_EXIT:
            trip.origin_exit = now
            trip.status = TripStatus.IN_TRANSIT
            if trip.first_progression is None:
                trip.first_progression = now
            ev = TripStateEvent(
                trip_key=trip.trip_key, tracker_id=tid, tracker_name=event.tracker_name,
                event_code=EventCode.ORIGIN_EXIT, event_time=now,
                event_confidence=0.90, inference_rule="origin_exit_p75",
                geofence=event.geofence, trip_stage="loading",
            )
            self._emit(trip, ev)
            emitted.append(ev)

        elif event.code in (EventCode.CORRIDOR_ENTRY, EventCode.BORDER_ENTRY):
            if trip.first_progression is None:
                trip.first_progression = now
            trip.status = TripStatus.IN_TRANSIT
            ev = TripStateEvent(
                trip_key=trip.trip_key, tracker_id=tid, tracker_name=event.tracker_name,
                event_code=event.code, event_time=now,
                event_confidence=0.80, inference_rule="progression_signal_p75",
                geofence=event.geofence, trip_stage="in_transit",
            )
            self._emit(trip, ev)
            emitted.append(ev)

        elif event.code in (EventCode.DESTINATION_ENTRY, EventCode.DESTINATION_REGION_ENTRY):
            if trip.first_progression is None:
                trip.first_progression = now
            trip.dest_entry = trip.dest_entry or now
            trip.status = TripStatus.AT_DESTINATION
            ev = TripStateEvent(
                trip_key=trip.trip_key, tracker_id=tid, tracker_name=event.tracker_name,
                event_code=event.code, event_time=now,
                event_confidence=0.90, inference_rule="destination_entry_p75",
                geofence=event.geofence, trip_stage="at_destination",
            )
            self._emit(trip, ev)
            emitted.append(ev)

        elif event.code in (EventCode.DESTINATION_EXIT, EventCode.DESTINATION_REGION_EXIT):
            trip.dest_exit = now
            trip.status    = TripStatus.RETURNING
            ev = TripStateEvent(
                trip_key=trip.trip_key, tracker_id=tid, tracker_name=event.tracker_name,
                event_code=event.code, event_time=now,
                event_confidence=0.85, inference_rule="destination_exit_p75",
                geofence=event.geofence, trip_stage="returning",
            )
            self._emit(trip, ev)
            emitted.append(ev)

        elif event.code == EventCode.RETURN_ORIGIN_ENTRY:
            # This event is only meaningful AFTER progression — enforce guard
            if not trip.has_progressed:
                logger.debug(
                    "trip_key=%s: RETURN_ORIGIN_ENTRY at %s before progression — ignored.",
                    trip.trip_key, now,
                )
                return emitted

            trip.return_origin_entry    = now
            trip.return_origin_geofence = event.geofence.name if event.geofence else None
            trip.status                 = TripStatus.RETURNING

            # Try P1 close immediately
            result = trip.evaluate_closure(now=now)
            if result:
                close_ts, reason, conf = result
                successor = self._close_trip(trip, close_ts, reason, conf, event.geofence)
                emitted.extend(trip.events[-1:])   # emit the trip_closed event
            else:
                ev = TripStateEvent(
                    trip_key=trip.trip_key, tracker_id=tid, tracker_name=event.tracker_name,
                    event_code=EventCode.RETURN_ORIGIN_ENTRY, event_time=now,
                    event_confidence=0.90, inference_rule="return_origin_entry_p75",
                    geofence=event.geofence, trip_stage="returning",
                )
                self._emit(trip, ev)
                emitted.append(ev)

        return emitted

    # ── Periodic timeout flush ─────────────────────────────────────────────

    def flush_timeouts(self, now: Optional[datetime] = None) -> list[TripStateEvent]:
        """
        Check all open trips for the P3 inactivity timeout.
        Call nightly (matches nightly-risk-learn.ts cadence).
        """
        if now is None:
            now = datetime.now(tz=timezone.utc)
        emitted: list[TripStateEvent] = []
        for tid, trip in list(self._active.items()):
            result = trip.evaluate_closure(now=now)
            if result:
                close_ts, reason, conf = result
                self._close_trip(trip, close_ts, reason, conf)
                emitted.extend(trip.events[-1:])
        return emitted

    # ── Accessors ──────────────────────────────────────────────────────────

    def active_trips(self) -> list[TripState]:
        return list(self._active.values())

    def closed_trips(self) -> list[TripState]:
        return list(self._closed)

    def get_trip(self, tracker_id: int) -> Optional[TripState]:
        return self._active.get(tracker_id)


# ── Utilities ──────────────────────────────────────────────────────────────

def _parse_ts(val) -> datetime:
    if isinstance(val, datetime):
        return val.replace(tzinfo=timezone.utc) if val.tzinfo is None else val
    return datetime.fromisoformat(str(val)).replace(tzinfo=timezone.utc)


def _parse_ts_opt(val) -> Optional[datetime]:
    if val is None:
        return None
    return _parse_ts(val)


# ── State transition table (for documentation / tests) ─────────────────────

STATE_TRANSITION_TABLE: dict[tuple[TripStatus, EventCode], TripStatus] = {
    (TripStatus.LOADING,         EventCode.LOADING_START):              TripStatus.LOADING,
    (TripStatus.LOADING,         EventCode.LOADING_END):                TripStatus.PRE_TRANSIT,
    (TripStatus.PRE_TRANSIT,     EventCode.ORIGIN_EXIT):                TripStatus.IN_TRANSIT,
    (TripStatus.PRE_TRANSIT,     EventCode.CORRIDOR_ENTRY):             TripStatus.IN_TRANSIT,
    (TripStatus.IN_TRANSIT,      EventCode.CORRIDOR_ENTRY):             TripStatus.IN_TRANSIT,
    (TripStatus.IN_TRANSIT,      EventCode.BORDER_ENTRY):               TripStatus.IN_TRANSIT,
    (TripStatus.IN_TRANSIT,      EventCode.DESTINATION_REGION_ENTRY):   TripStatus.AT_DESTINATION,
    (TripStatus.IN_TRANSIT,      EventCode.DESTINATION_ENTRY):          TripStatus.AT_DESTINATION,
    (TripStatus.AT_DESTINATION,  EventCode.DESTINATION_EXIT):           TripStatus.RETURNING,
    (TripStatus.AT_DESTINATION,  EventCode.DESTINATION_REGION_EXIT):    TripStatus.RETURNING,
    (TripStatus.RETURNING,       EventCode.RETURN_ORIGIN_ENTRY):        TripStatus.CLOSED,     # P1
    (TripStatus.RETURNING,       EventCode.LOADING_START):              TripStatus.CLOSED,     # P2
    (TripStatus.IN_TRANSIT,      EventCode.LOADING_START):              TripStatus.CLOSED,     # P2 early
    (TripStatus.LOADING,         EventCode.LOADING_START):              TripStatus.CLOSED,     # P2 (next cycle)
    # P3 timeout applies from any non-closed status after 30d silence
}
