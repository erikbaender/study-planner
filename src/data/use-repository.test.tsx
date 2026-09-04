import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT } from "@/domain/types";
import type { PlannerRepository, RepositoryState } from "./repository";
import {
  RepositoryStoreProvider,
  usePlannerErrors,
  usePlannerRun,
  usePlannerState,
  useRepository,
} from "./use-repository";

function testRepository(onSubscribe?: () => void, onUnsubscribe?: () => void) {
  return {
    subscribe(listener: (state: RepositoryState) => void) {
      onSubscribe?.();
      listener({ status: "ready", snapshot: EMPTY_SNAPSHOT });
      return () => onUnsubscribe?.();
    },
  } as PlannerRepository;
}

function Consumers() {
  const first = usePlannerState();
  const second = usePlannerState();
  const { error } = usePlannerErrors();
  const repository = useRepository();
  const run = usePlannerRun();

  return (
    <output>
      {first.status}:{second.status}:{error?.message ?? "ok"}:
      {typeof repository.subscribe}:{typeof run}
    </output>
  );
}

describe("RepositoryStoreProvider", () => {
  it("shares one live repository subscription across every consumer and cleans it up", async () => {
    let activeSubscriptions = 0;
    let maximumActiveSubscriptions = 0;
    const repository = testRepository(
      () => {
        activeSubscriptions += 1;
        maximumActiveSubscriptions = Math.max(maximumActiveSubscriptions, activeSubscriptions);
      },
      () => {
        activeSubscriptions -= 1;
      },
    );

    const view = render(
      <RepositoryStoreProvider repository={repository}>
        <Consumers />
      </RepositoryStoreProvider>,
    );

    await waitFor(() => expect(screen.getByText(/^ready:ready:/)).toBeInTheDocument());
    expect(activeSubscriptions).toBe(1);
    expect(maximumActiveSubscriptions).toBe(1);

    view.unmount();
    expect(activeSubscriptions).toBe(0);
  });

  it("presents a mutation failure and clears it when a later action succeeds", async () => {
    const user = userEvent.setup();
    const actions = [
      () => Promise.reject(new Error("Connection interrupted")),
      () => Promise.resolve(),
    ];

    function MutationConsumer() {
      const { error, run } = usePlannerErrors();
      return (
        <>
          <output>{error?.message ?? "ok"}</output>
          <button type="button" onClick={() => run((actions.shift() ?? Promise.resolve)())}>
            Save
          </button>
        </>
      );
    }

    render(
      <RepositoryStoreProvider repository={testRepository()}>
        <MutationConsumer />
      </RepositoryStoreProvider>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByText("Connection interrupted")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("ok")).toBeInTheDocument();
  });
});
