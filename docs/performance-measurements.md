# Performance measurement definitions

PiTTy is a separate process from Pi. All client-side elapsed times below are observed at its RPC boundary, not the provider's network socket. These timestamps can include Pi initialization, transport buffering and UI event-loop delays.

- **Turn to first output**: first nonempty streamed text, thinking or tool-argument delta received minus Pi's turn-start event. This is an end-to-end proxy, **not provider HTTP time-to-first-token**. Missing turn starts are excluded.
- **Streamed output rate (estimated tokens/s)**: provider-reported output tokens divided by the time between first and last content-bearing deltas. It is approximate, especially when providers batch output, generate hidden reasoning, or report tokens that are not streamed. Short or burst-delivered responses are excluded (at least 1 second and 8 distinct output arrival timestamps).
- **Model turn**: Pi turn-start event to assistant message-end event, before tools finish. This excludes the later tool runtime, but may include Pi and RPC overhead.
- **Tool execution**: Pi-reported tool duration when present. Otherwise, the elapsed interval between observed tool-start and tool-end events. This is **not** the model's turn time divided by its tool count.
- **Tool first appearance to execution**: first streamed tool-call block to tool-execution-start. It includes generation of the tool arguments.
- **Tool dispatch**: final streamed tool-call arguments to tool-execution-start. Only matched tool IDs are included. Zero-millisecond intervals received in a single RPC chunk are omitted because the real delay cannot be resolved.

Measurement version 3 changes the first-output boundary and tool timing semantics. Prior versions remain on disk for inspection, but are excluded from new model speed medians. Raw RPC events are measured before UI update coalescing. Separate native Pi/provider instrumentation would be needed to measure exact HTTP request start, server prefill, and provider token emission independently.
