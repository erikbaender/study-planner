import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AnimationSpeedControl, AppearanceControl } from "./appearance";
import {
  ANIMATION_SPEED_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from "./theme";

function Probe() {
  const { appearance, resolved } = useTheme();
  return (
    <output>
      {appearance}/{resolved}
    </output>
  );
}

/** Always mounts `Probe`, so every test can assert on resolved state directly. */
function renderTheme(ui: React.ReactNode = null) {
  return render(
    <ThemeProvider>
      {ui}
      <Probe />
    </ThemeProvider>,
  );
}

function state() {
  return screen.getByRole("status").textContent;
}

/** Points `matchMedia` at a dark OS, the way a real dark-mode machine reports. */
function systemPrefersDark() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      media: query,
      matches: query.includes("dark"),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

describe("ThemeProvider", () => {
  it("defaults to following the system", () => {
    renderTheme();
    expect(state()).toBe("system/light");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves `system` against the OS rather than to a fixed value", () => {
    systemPrefersDark();
    renderTheme();
    expect(state()).toBe("system/dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("lets an explicit choice override a dark system", async () => {
    systemPrefersDark();
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "light");
    renderTheme();

    // The regression this guards: the previous implementation dropped the
    // setter, so an explicit preference could never beat the system.
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("writes the appearance through to the document and storage", async () => {
    const user = userEvent.setup();
    renderTheme(<AppearanceControl />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(window.localStorage.getItem(APPEARANCE_STORAGE_KEY)).toBe("dark");
  });

  it("restores a stored appearance on the next mount", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "dark");
    renderTheme();
    expect(state()).toBe("dark/dark");
  });

  it("ignores a stored value that is not an appearance", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "sepia");
    renderTheme();
    expect(state()).toBe("system/light");
  });

  it("survives localStorage throwing", () => {
    // Safari in private mode does this. A broken preference must not be a
    // broken app.
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => renderTheme()).not.toThrow();
    spy.mockRestore();
  });
});

describe("animation speed", () => {
  it("controls the shared motion timeline and persists the chosen multiplier", () => {
    renderTheme(<AnimationSpeedControl />);
    const slider = screen.getByRole("slider", { name: "Animation speed" });

    expect(slider).toHaveValue("0.5");
    expect(slider).toHaveAttribute("min", "0.25");
    expect(slider).toHaveAttribute("max", "0.75");
    expect(slider).toHaveAttribute("step", "0.25");
    expect(document.documentElement.style.getPropertyValue("--topic-motion-duration")).toBe(
      "480ms",
    );

    fireEvent.change(slider, { target: { value: "0.25" } });
    expect(slider).toHaveValue("0.25");
    expect(window.localStorage.getItem(ANIMATION_SPEED_STORAGE_KEY)).toBe("0.25");
    expect(document.documentElement.style.getPropertyValue("--topic-motion-duration")).toBe(
      "960ms",
    );
  });

  it("ignores an out-of-range stored multiplier", () => {
    window.localStorage.setItem(ANIMATION_SPEED_STORAGE_KEY, "2");
    renderTheme(<AnimationSpeedControl />);

    expect(screen.getByRole("slider", { name: "Animation speed" })).toHaveValue("0.5");
  });
});
