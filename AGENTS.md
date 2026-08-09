# Agent instructions

## Usage conservation

- Optimize for completing the requested task accurately and efficiently while conserving model, tool, and external-service usage.
- Before committing to a plan, consider the likely cost of executing it and prefer the smallest effective approach.
- Avoid exploratory, repetitive, or speculative work that is not needed for the task.
- Write tests, perform broad refactors, polish unrelated areas, and run other nonessential activities only when they are essential to accomplishing the given task or validating a consequential change.
- Before substantial work, run `pnpm usage -- --json` when the usage check is available. Treat `conservativeAction: "conserve"` or an unavailable/failed check as a reason to choose the smallest effective approach; do not make a model request solely to check usage.
- Use the usage record for the provider you are running on: Codex uses `checks[].provider == "openai"`, and Claude uses `checks[].provider == "anthropic"`. Do not use the other provider's limits as a substitute.
- Consider both `session.remainingPercent` and `weekly.remainingPercent`, along with their `reset` times, before choosing a plan. A `null` value or a `status` other than `available` means that limit is unknown; do not guess.
- OpenAI's session limit may have `status: "temporarily_removed"`; in that case use its weekly limit when available. If the weekly limit is also unavailable, conserve usage and choose the smallest viable approach.
- When remaining usage is low or the reset is distant, prioritize the requested outcome and omit exploratory work, broad refactors, polish, and nonessential tests.

## Running the app

- Port 3000 is shared across worktrees, and only one worktree can own the development server at a time. Do not start a second server on another port, use a temporary project copy, or create a separate deployment.
- The shared server is the `study-planner-dev.service` systemd user service. Do not run `pnpm dev` directly in a tool-managed terminal or PTY.
- Before browser work, check whether the service is active, its `WorkingDirectory` equals the current worktree, and `http://localhost:3000` responds successfully. A healthy service for a different worktree must not be reused.
- If the current worktree already owns a healthy service, leave it running. Otherwise claim port 3000 for the current worktree by stopping `study-planner-dev.service` and starting it again as a transient user service from the current worktree:

  ```bash
  systemctl --user stop study-planner-dev.service
  systemd-run --user --unit=study-planner-dev --collect --property="WorkingDirectory=$PWD" /bin/bash -lc 'exec pnpm dev'
  ```

- If port 3000 is held by an unmanaged process after stopping the service, identify that exact listener and its working directory. Stop it only when it is a development server for this repository; never kill an unidentified or unrelated process. Then run the claim command again.
- After claiming the server, wait until `http://localhost:3000` responds successfully. Use `journalctl --user -u study-planner-dev.service -n 100` to diagnose startup failures.
- Treat claiming the server as a transfer of ownership: another agent may subsequently claim it for another worktree. Re-check ownership and health immediately before browser verification and again immediately before the final response.
- Leave the service running after implementation and verification so the user can inspect the app. Do not stop it as part of cleanup or handoff.
- Do not claim that the server is running based only on startup output. At handoff, verify that `study-planner-dev.service` is active, that its `WorkingDirectory` is the current worktree, and that `http://localhost:3000` returns a successful response.

## UI animation consistency

- Treat related UI animations as one coordinated motion system. Unless a requirement explicitly says otherwise, all layers of one interaction must start together, finish together, and use the exact same duration and velocity curve.
- Define shared motion duration and easing values once and reuse them rather than repeating approximations. Keep forward and reverse animations symmetrical, including deliberate overshoot and settling behavior.
- When an interaction animates several visual properties (for example outline, background, fill, icon, progress, and handle), verify the complete sequence in the browser in both directions.
