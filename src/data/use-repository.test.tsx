import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EMPTY_SNAPSHOT } from "@/domain/types";
import { createLocalRepository, memoryStorage } from "./local-repository";
import {
  LocalRepositoryProvider,
  RepositoryStoreProvider,
  usePlannerErrors,
  usePlannerRun,
  usePlannerState,
  useRepository,
} from "./use-repository";

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
  it("keeps one local repository instance across provider rerenders", async () => {
    const repositories = new Set<ReturnType<typeof useRepository>>();

    function LocalConsumer({ label }: { label: string }) {
      const repository = useRepository();
      const state = usePlannerState();
      repositories.add(repository);
      return <output>{label}:{state.status}</output>;
    }

    const view = render(
      <LocalRepositoryProvider>
        <LocalConsumer label="first" />
      </LocalRepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByText("first:ready")).toBeInTheDocument());

    view.rerender(
      <LocalRepositoryProvider>
        <LocalConsumer label="second" />
      </LocalRepositoryProvider>,
    );
    await waitFor(() => expect(screen.getByText("second:ready")).toBeInTheDocument());

    expect(repositories.size).toBe(1);
  });

  it("shares one live repository subscription across every consumer", async () => {
    const repository = createLocalRepository({ storage: memoryStorage(EMPTY_SNAPSHOT) });
    const subscribe = repository.subscribe.bind(repository);
    let activeSubscriptions = 0;
    let maximumActiveSubscriptions = 0;

    repository.subscribe = (listener) => {
      activeSubscriptions += 1;
      maximumActiveSubscriptions = Math.max(maximumActiveSubscriptions, activeSubscriptions);
      const unsubscribe = subscribe(listener);
      return () => {
        activeSubscriptions -= 1;
        unsubscribe();
      };
    };

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

  it("keeps repository data hidden while its host is resolving authentication", async () => {
    const repository = createLocalRepository({ storage: memoryStorage(EMPTY_SNAPSHOT) });
    const view = render(
      <RepositoryStoreProvider repository={repository} suspended>
        <Consumers />
      </RepositoryStoreProvider>,
    );

    expect(screen.getByText(/^loading:loading:/)).toBeInTheDocument();
    view.rerender(
      <RepositoryStoreProvider repository={repository} suspended={false}>
        <Consumers />
      </RepositoryStoreProvider>,
    );
    await waitFor(() => expect(screen.getByText(/^ready:ready:/)).toBeInTheDocument());
  });
});
