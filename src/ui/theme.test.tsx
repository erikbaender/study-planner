import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AccentPicker, AppearanceControl } from "./appearance";
import {
  ACCENT_STORAGE_KEY,
  APPEARANCE_STORAGE_KEY,
  ThemeProvider,
  useTheme,
} from "./theme";

function Probe() {
  const { appearance, resolved, accent } = useTheme();
  return (
    <output>
      {appearance}/{resolved}/{accent}
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
    expect(state()).toBe("system/light/#007aff");
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves `system` against the OS rather than to a fixed value", () => {
    systemPrefersDark();
    renderTheme();
    expect(state()).toBe("system/dark/#007aff");
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
    expect(state()).toBe("dark/dark/#007aff");
  });

  it("ignores a stored value that is not an appearance", () => {
    window.localStorage.setItem(APPEARANCE_STORAGE_KEY, "sepia");
    renderTheme();
    expect(state()).toBe("system/light/#007aff");
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

describe("accent colour", () => {
  it("applies the accent and its stated foreground together", async () => {
    const user = userEvent.setup();
    renderTheme(<AccentPicker />);

    // Yellow is the case a luminance heuristic gets wrong: it needs black text.
    await user.click(screen.getByRole("radio", { name: "Yellow" }));

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--mac-accent")).toBe("#ffcc00");
    expect(style.getPropertyValue("--mac-on-accent")).toBe("#000000");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("#ffcc00");
  });

  it("falls back when the stored colour is not in the palette", () => {
    // An arbitrary colour has no stated `onColor`, so text on it could be
    // illegible; the default is used instead of guessing.
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "#123456");
    renderTheme();
    expect(document.documentElement.style.getPropertyValue("--mac-accent")).toBe("#007aff");
  });

  it("moves selection and focus together with the arrow keys", async () => {
    const user = userEvent.setup();
    renderTheme(<AccentPicker />);

    await user.click(screen.getByRole("radio", { name: "Red" }));
    await user.keyboard("{ArrowRight}");

    const orange = screen.getByRole("radio", { name: "Orange" });
    expect(orange).toBeChecked();
    // Roving focus: without this the arrow key selects a swatch the user can no
    // longer see focus on.
    expect(orange).toHaveFocus();
  });

  it("wraps around at the end of the palette", async () => {
    const user = userEvent.setup();
    renderTheme(<AccentPicker />);

    await user.click(screen.getByRole("radio", { name: "Red" }));
    await user.keyboard("{ArrowLeft}");

    expect(screen.getByRole("radio", { name: "Gray" })).toBeChecked();
  });

  it("keeps only the selected swatch in the tab order", async () => {
    const user = userEvent.setup();
    renderTheme(<AccentPicker />);
    await user.click(screen.getByRole("radio", { name: "Green" }));

    const swatches = screen.getAllByRole("radio");
    const tabbable = swatches.filter((swatch) => swatch.getAttribute("tabindex") === "0");
    expect(tabbable).toHaveLength(1);
    expect(tabbable[0]).toHaveAccessibleName("Green");
  });
});
