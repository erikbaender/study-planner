# Security policy

## Supported versions

Until the project publishes versioned releases, only the current default branch receives security fixes.

## Report a vulnerability

Use the repository's private [GitHub security advisory form](https://github.com/erikbaender/study-planner/security/advisories/new). If private reporting is unavailable, contact a maintainer before sharing exploit details. Do not put credentials, personal planner data, or a working proof of concept in a public issue.

Include the affected revision, impact, reproduction conditions, and any suggested mitigation. Maintainers should acknowledge reports promptly, keep reporters informed, and coordinate disclosure after a fix is available.

## Security boundaries

- Convex functions authenticate the caller and derive ownership from the server-side user identity. Client-supplied entity IDs are never proof of ownership.
- Imported JSON is untrusted. The parser and local materializer validate bounds and semantic invariants; authenticated Convex import mutations repeat validation at the server boundary.
- OAuth credentials, Convex JWT material, and deployment secrets belong in provider-managed environment variables, never `NEXT_PUBLIC_*` variables or the repository.
- Browser-local plans and exports can contain sensitive educational or health-related information. Users should protect their browser profile and exported files accordingly.
- The installed Convex Auth client stores bearer tokens in browser `localStorage`. The content security policy reduces exposure but cannot give script-readable tokens the protections of HttpOnly cookies; treat any script injection as an authentication issue.

Historical project material indicates that an OAuth secret may previously have been disclosed. Its absence from the current tree does not prove revocation. Maintainers must rotate that credential and inspect repository history with an approved secret scanner before publication.

See [docs/authentication.md](docs/authentication.md) and [docs/quality-security-audit.md](docs/quality-security-audit.md) for design constraints and known residual risks.
