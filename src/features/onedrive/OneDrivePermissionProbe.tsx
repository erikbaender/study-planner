"use client";

import {
  CheckCircle2,
  Cloud,
  ExternalLink,
  File,
  Folder,
  Search,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Separator,
  Sheet,
  Spinner,
  TextField,
} from "@/ui";
import {
  isOneDriveConfigured,
  oneDriveBrowserClient,
  type OneDriveClient,
  type OneDriveConnection,
  type OneDriveItem,
} from "./onedrive-client";

type Location = { id?: string; name: string };

function errorMessage(cause: unknown) {
  if (!(cause instanceof Error)) return String(cause);

  const errorCode =
    "errorCode" in cause && typeof cause.errorCode === "string"
      ? cause.errorCode
      : undefined;
  if (errorCode && !cause.message.includes(errorCode)) {
    return `${errorCode}: ${cause.message}`;
  }
  return cause.message;
}

function formatSize(bytes?: number) {
  if (bytes === undefined) return null;
  if (bytes < 1_000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1_000).toFixed(1)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function OneDrivePermissionProbe({
  client = oneDriveBrowserClient,
  configured = isOneDriveConfigured(),
}: {
  client?: OneDriveClient;
  configured?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<OneDriveConnection | null>(null);
  const [items, setItems] = useState<OneDriveItem[]>([]);
  const [locations, setLocations] = useState<Location[]>([{ name: "OneDrive" }]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !configured) return;
    void client.prepare?.().catch(() => {
      // The Connect action reports initialization errors with the full detail.
    });
  }, [client, configured, open]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const connect = () =>
    run(async () => {
      const result = await client.connect();
      setConnection(result);
      setItems(result.items);
      setLocations([{ name: "OneDrive" }]);
    });

  const openFolder = (item: OneDriveItem) => {
    if (!connection) return;
    void run(async () => {
      const children = await client.listChildren(connection.drive.id, item.id);
      setItems(children);
      setLocations((current) => [...current, { id: item.id, name: item.name }]);
    });
  };

  const navigateTo = (index: number) => {
    if (!connection) return;
    const location = locations[index];
    void run(async () => {
      const children = await client.listChildren(connection.drive.id, location.id);
      setItems(children);
      setLocations((current) => current.slice(0, index + 1));
    });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    const normalized = query.trim();
    if (!normalized) {
      navigateTo(0);
      return;
    }
    void run(async () => {
      setItems(await client.search(normalized));
      setLocations([{ name: `Search: ${normalized}` }]);
    });
  };

  return (
    <Sheet
      open={open}
      onOpenChange={setOpen}
      width="lg"
      title="Test Microsoft file access"
      description="Requests delegated Files.Read access for the Microsoft account you choose."
      trigger={
        <Button size="sm" leadingIcon={<Cloud />}>
          OneDrive test
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {!configured ? (
          <Card className="flex flex-col gap-2">
            <h2 className="text-body font-semibold">App registration required</h2>
            <p className="text-callout text-secondary">
              Add your Microsoft Entra application ID to{" "}
              <code>NEXT_PUBLIC_MICROSOFT_CLIENT_ID</code>, then restart the development server.
            </p>
            <p className="text-footnote text-secondary">
              The setup guide in <code>docs/onedrive-permission-spike.md</code> has the exact
              registration and redirect settings.
            </p>
          </Card>
        ) : connection ? (
          <>
            <Card className="flex flex-wrap items-center gap-2">
              <CheckCircle2 className="size-4 text-green" aria-hidden="true" />
              <strong className="text-body">Read permission confirmed</strong>
              <Badge tone="green" variant="outline">
                Files.Read
              </Badge>
              <span className="w-full text-callout text-secondary">
                {connection.accountName} · {connection.drive.driveType}
              </span>
              <Button asChild size="sm" variant="plain" leadingIcon={<ExternalLink />}>
                <a href={connection.drive.webUrl} target="_blank" rel="noreferrer">
                  Open OneDrive
                </a>
              </Button>
              <Button size="sm" variant="plain" onClick={() => void connect()} disabled={busy}>
                Test another account
              </Button>
            </Card>

            <form className="flex items-end gap-2" onSubmit={search}>
              <TextField
                label="Search this OneDrive"
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="e.g. biochemistry"
                fieldClassName="flex-1"
              />
              <Button
                type="submit"
                size="md"
                leadingIcon={<Search />}
                disabled={busy}
              >
                Search
              </Button>
            </form>

            <nav aria-label="OneDrive location" className="flex flex-wrap items-center gap-1">
              {locations.map((location, index) => (
                <span key={`${location.id ?? "root"}-${location.name}`} className="flex items-center gap-1">
                  {index > 0 ? <span className="text-tertiary">/</span> : null}
                  <Button
                    size="sm"
                    variant="plain"
                    disabled={busy || index === locations.length - 1}
                    onClick={() => navigateTo(index)}
                  >
                    {location.name}
                  </Button>
                </span>
              ))}
            </nav>

            <Separator />

            {busy ? (
              <div className="flex min-h-32 items-center justify-center">
                <Spinner label="Loading Microsoft files" />
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Folder />}
                title="No items found"
                description="Try another folder or search term."
                action={null}
              />
            ) : (
              <ul className="divide-y divide-separator" aria-label="Microsoft files">
                {items.map((item) => (
                  <li key={item.id} className="flex min-h-11 items-center gap-3 py-2">
                    {item.folder ? (
                      <Folder className="size-4 shrink-0 text-accent" aria-hidden="true" />
                    ) : (
                      <File className="size-4 shrink-0 text-secondary" aria-hidden="true" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium">{item.name}</span>
                      <span className="block text-footnote text-secondary">
                        {item.folder
                          ? `${item.folder.childCount ?? "Unknown number of"} items`
                          : formatSize(item.size) ?? item.file?.mimeType ?? "File"}
                      </span>
                    </span>
                    {item.folder ? (
                      <Button size="sm" onClick={() => openFolder(item)}>
                        Browse
                      </Button>
                    ) : (
                      <Button asChild size="sm" leadingIcon={<ExternalLink />}>
                        <a href={item.webUrl} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <Card className="flex flex-col items-start gap-3">
            <div>
              <h2 className="text-body font-semibold">Choose your university account</h2>
              <p className="mt-1 text-callout text-secondary">
                Microsoft will show the permissions requested by this app. If your university
                blocks user consent, the error shown here will include Microsoft&apos;s diagnostic
                code.
              </p>
            </div>
            <Button variant="accent" onClick={() => void connect()} disabled={busy}>
              {busy ? "Connecting…" : "Connect Microsoft account"}
            </Button>
          </Card>
        )}

        {error ? (
          <div role="alert" className="rounded-card bg-red/10 p-3 text-callout text-red">
            <strong>Microsoft access failed.</strong>
            <p className="mt-1 break-words">{error}</p>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
