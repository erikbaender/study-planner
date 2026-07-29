export const ONEDRIVE_SCOPES = ["Files.Read"] as const;

export type OneDriveItem = {
  id: string;
  name: string;
  webUrl: string;
  size?: number;
  lastModifiedDateTime?: string;
  file?: { mimeType?: string };
  folder?: { childCount?: number };
};

export type OneDriveConnection = {
  accountName: string;
  drive: {
    id: string;
    driveType: string;
    webUrl: string;
    ownerName?: string;
  };
  items: OneDriveItem[];
};

export interface OneDriveClient {
  prepare?: () => Promise<void>;
  connect: () => Promise<OneDriveConnection>;
  listChildren: (driveId: string, itemId?: string) => Promise<OneDriveItem[]>;
  search: (query: string) => Promise<OneDriveItem[]>;
}

type GraphCollection<T> = { value: T[] };

const GRAPH_ROOT = "https://graph.microsoft.com/v1.0";
const clientId = process.env.NEXT_PUBLIC_MICROSOFT_CLIENT_ID?.trim();

let applicationPromise:
  | Promise<import("@azure/msal-browser").PublicClientApplication>
  | undefined;

export function isOneDriveConfigured() {
  return Boolean(clientId);
}

async function getApplication() {
  if (!clientId) {
    throw new Error(
      "Microsoft sign-in is not configured. Set NEXT_PUBLIC_MICROSOFT_CLIENT_ID and restart the app.",
    );
  }

  applicationPromise ??= import("@azure/msal-browser").then(
    async ({ PublicClientApplication }) => {
      const application = new PublicClientApplication({
        auth: {
          clientId,
          authority: "https://login.microsoftonline.com/common",
          redirectUri: window.location.origin,
        },
        cache: {
          cacheLocation: "sessionStorage",
        },
      });

      await application.initialize();
      const redirectResult = await application.handleRedirectPromise();
      const account = redirectResult?.account ?? application.getAllAccounts()[0];
      if (account) application.setActiveAccount(account);
      return application;
    },
  );

  try {
    return await applicationPromise;
  } catch (cause) {
    applicationPromise = undefined;
    throw cause;
  }
}

async function getAccessToken() {
  const application = await getApplication();
  const account = application.getActiveAccount() ?? application.getAllAccounts()[0];

  if (!account) {
    const result = await application.loginPopup({
      scopes: [...ONEDRIVE_SCOPES],
      prompt: "select_account",
    });
    application.setActiveAccount(result.account);
    return { accessToken: result.accessToken, accountName: result.account.username };
  }

  try {
    const result = await application.acquireTokenSilent({
      account,
      scopes: [...ONEDRIVE_SCOPES],
    });
    return { accessToken: result.accessToken, accountName: account.username };
  } catch (cause) {
    const { InteractionRequiredAuthError } = await import("@azure/msal-browser");
    if (!(cause instanceof InteractionRequiredAuthError)) throw cause;

    const result = await application.acquireTokenPopup({
      account,
      scopes: [...ONEDRIVE_SCOPES],
    });
    return { accessToken: result.accessToken, accountName: account.username };
  }
}

async function graphRequest<T>(path: string, accessToken: string): Promise<T> {
  const response = await fetch(`${GRAPH_ROOT}${path}`, {
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      detail = [body.error?.code, body.error?.message].filter(Boolean).join(": ") || detail;
    } catch {
      // The HTTP status remains useful when Graph did not return JSON.
    }
    throw new Error(`Microsoft Graph request failed: ${detail}`);
  }

  return (await response.json()) as T;
}

function childrenPath(driveId: string, itemId?: string) {
  const path = itemId
    ? `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}/children`
    : "/me/drive/root/children";
  const query = new URLSearchParams({
    $orderby: "name",
    $select: "id,name,webUrl,size,lastModifiedDateTime,file,folder",
    $top: "50",
  });
  return `${path}?${query}`;
}

async function listChildren(driveId: string, itemId?: string) {
  const { accessToken } = await getAccessToken();
  const collection = await graphRequest<GraphCollection<OneDriveItem>>(
    childrenPath(driveId, itemId),
    accessToken,
  );
  return collection.value;
}

export const oneDriveBrowserClient: OneDriveClient = {
  prepare: async () => {
    await getApplication();
  },

  connect: async () => {
    const application = await getApplication();
    const loginResult = await application.loginPopup({
      scopes: [...ONEDRIVE_SCOPES],
      prompt: "select_account",
    });
    application.setActiveAccount(loginResult.account);

    const query = new URLSearchParams({
      $select: "id,driveType,webUrl,owner",
    });
    const [drive, items] = await Promise.all([
      graphRequest<{
        id: string;
        driveType: string;
        webUrl: string;
        owner?: { user?: { displayName?: string } };
      }>(`/me/drive?${query}`, loginResult.accessToken),
      graphRequest<GraphCollection<OneDriveItem>>(
        childrenPath("unused"),
        loginResult.accessToken,
      ).then((collection) => collection.value),
    ]);

    return {
      accountName: loginResult.account.username,
      drive: {
        id: drive.id,
        driveType: drive.driveType,
        webUrl: drive.webUrl,
        ownerName: drive.owner?.user?.displayName,
      },
      items,
    };
  },

  listChildren,

  search: async (query) => {
    const { accessToken } = await getAccessToken();
    const escapedQuery = encodeURIComponent(query.replaceAll("'", "''"));
    const parameters = new URLSearchParams({
      $select: "id,name,webUrl,size,lastModifiedDateTime,file,folder",
      $top: "50",
    });
    const collection = await graphRequest<GraphCollection<OneDriveItem>>(
      `/me/drive/root/search(q='${escapedQuery}')?${parameters}`,
      accessToken,
    );
    return collection.value;
  },
};
