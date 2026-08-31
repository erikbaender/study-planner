import { afterEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SNAPSHOT } from "@/domain/types";
import { indexedDbStorage } from "./local-repository";

type FakeIndexedDb = {
  openRequest: IDBOpenDBRequest;
  transaction: IDBTransaction;
};

function installFakeIndexedDb(): FakeIndexedDb {
  const request = {
    error: null,
    onerror: null,
    result: undefined,
  } as unknown as IDBRequest<undefined>;
  const store = {
    put: vi.fn(() => request),
  } as unknown as IDBObjectStore;
  const transaction = {
    error: null,
    onabort: null,
    oncomplete: null,
    onerror: null,
    objectStore: vi.fn(() => store),
  } as unknown as IDBTransaction;
  const database = {
    objectStoreNames: { contains: vi.fn(() => true) },
    transaction: vi.fn(() => transaction),
  } as unknown as IDBDatabase;
  const openRequest = {
    error: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
    result: database,
  } as unknown as IDBOpenDBRequest;

  vi.stubGlobal("indexedDB", {
    open: vi.fn(() => openRequest),
  });

  return { openRequest, transaction };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("indexedDbStorage", () => {
  it("resolves a save only after the transaction commits", async () => {
    const { openRequest, transaction } = installFakeIndexedDb();
    const saving = indexedDbStorage().save(EMPTY_SNAPSHOT);
    let settled = false;
    void saving.then(() => {
      settled = true;
    });

    openRequest.onsuccess?.(new Event("success"));
    await Promise.resolve();
    await Promise.resolve();

    expect(settled).toBe(false);
    transaction.oncomplete?.(new Event("complete"));
    await saving;
    expect(settled).toBe(true);
  });

  it("rejects an aborted transaction", async () => {
    const { openRequest, transaction } = installFakeIndexedDb();
    const saving = indexedDbStorage().save(EMPTY_SNAPSHOT);

    openRequest.onsuccess?.(new Event("success"));
    await Promise.resolve();
    await Promise.resolve();
    transaction.onabort?.(new Event("abort"));

    await expect(saving).rejects.toThrow("Local database transaction failed");
  });
});
