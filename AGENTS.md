# Agent instructions

## Running the app

- Run the development server on the standard port with `pnpm dev` (port 3000).
- If port 3000 is occupied by an existing app process, stop that exact process and restart the current checkout on port 3000. Do not work around it with another port, a temporary project copy, or a separate deployment.
- Leave the development server running on port 3000 after implementation and verification so the user can inspect the app. Do not close the server as part of cleanup or handoff.
