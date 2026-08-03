# Agent instructions

## Running the app

- Run the development server on the standard port with `pnpm dev` (port 3000).
- If port 3000 is occupied by an existing app process, stop that exact process and restart the current checkout on port 3000. Do not work around it with another port, a temporary project copy, or a separate deployment.
- Leave the development server running on port 3000 after implementation and verification so the user can inspect the app. Do not close the server as part of cleanup or handoff.
- Start the final handoff server as a process that survives the agent turn. A tool-managed terminal/PTY session is not sufficient because it may be terminated when the turn ends. Use a persistent process manager such as a transient user service (`systemd-run --user`) when available.
- Immediately before the final response, verify both that the persistent process is still active and that `http://localhost:3000` returns a successful response. Do not claim that the server is running based only on its startup output.

## UI animation consistency

- Treat related UI animations as one coordinated motion system. Unless a requirement explicitly says otherwise, all layers of one interaction must start together, finish together, and use the exact same duration and velocity curve.
- Define shared motion duration and easing values once and reuse them rather than repeating approximations. Keep forward and reverse animations symmetrical, including deliberate overshoot and settling behavior.
- When an interaction animates several visual properties (for example outline, background, fill, icon, progress, and handle), verify the complete sequence in the browser in both directions.
