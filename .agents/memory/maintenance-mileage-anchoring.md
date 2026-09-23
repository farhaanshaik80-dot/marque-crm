---
name: Maintenance mileage anchoring
description: The confirmed rule for calculating flexible maintenance mileage deadlines.
---

Flexible maintenance `next due km` is always `last changed km + change interval km`. Updating a vehicle’s current odometer only changes remaining distance and status; it must not move the deadline.

**Why:** The user explicitly confirmed this behavior to preserve the real maintenance interval from the recorded service point.

**How to apply:** Recalculate remaining distance whenever odometer data changes, but only recalculate the absolute due mileage when the last-change mileage or interval changes.