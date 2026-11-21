# Cache-aware compaction and account-bound usage

## Problem
Claude usage can describe the saved account for future tabs instead of the running tab. Cached numbers lose their age and the footer does not identify the quota window. Compaction settings expose only an extension's model controls.

## Changes
- Bind provider usage to the running tab and preserve its account, source, measurement time, unknown values, and fetch failures.
- Apply saved account choices when each new tab starts. Existing tabs retain their account.
- Label five-hour and weekly quotas and show stale or unavailable data.
- Expose the core compaction method and cache-maintenance policy. Defaults are cache-aware compaction and compaction before cache expiry. Preserve explicit older preferences.
- Offer the two-model extension when loaded, retain its existing model settings, and show unavailable capabilities explicitly.
- Report active prompt editing to the runtime so automatic maintenance can defer.

## Validation
Use offline fixtures for profile changes, stale data, quota windows, RPC settings, and terminal layouts. Do not query paid providers in tests. Runtime routing and release packaging are integrated separately.
