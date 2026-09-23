---
name: Vehicle service interval
description: The confirmed rule for the standard vehicle service-due mileage.
---

For the standard vehicle service schedule, store a service interval and calculate `next service due km` as `current odometer + service interval`. Recalculate that due mileage whenever the current odometer changes.

**Why:** The user explicitly requested interval-based entry instead of manually entering an absolute due odometer.

**How to apply:** Keep this separate from flexible maintenance items, whose absolute deadlines remain anchored to their recorded last-change mileage.