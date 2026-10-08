# Security Policy

## Reporting a vulnerability

Please do not open a public issue for security vulnerabilities.

Use GitHub's private vulnerability reporting for this repository: open the
**Security** tab and choose **Report a vulnerability**. That sends the report
privately to the maintainer.

Reports are reviewed and addressed as soon as is reasonably possible.

## Code scanning: intentional translation data flows

The kit handles translation text, not credentials or confidential application data.
Review widget strings before opting in to a third-party translation endpoint.

- **CLDR cache (CodeQL js/http-to-file-access)**: `lib/cldr.js` fetches
  the Unicode CLDR package from the official npm registry over HTTPS without
  redirects, limits the download to 32 MiB, verifies the npm SHA-512 integrity
  metadata, limits decompression to 128 MiB, and caches reduced unit names
  in the configured local cache directory. This network-to-disk flow is required
  for the on-demand language data feature.
- **LibreTranslate (CodeQL js/file-access-to-http)**: `lib/mt.js` sends the
  English strings developers explicitly select for translation to their
  configured LibreTranslate endpoint. HTTP is permitted only for loopback,
  other endpoints require HTTPS, and redirects are rejected. Secrets are not
  read from arbitrary widget files, and the service receives translation strings
  by design. Developers should use a trusted server and must not submit
  sensitive widget text to untrusted endpoints.

If CodeQL continues flagging only these reviewed and intentional flows,
triage those individual alerts as **Used in tests** (only when applicable)
or **False positive** only if the alert itself is inaccurate. Otherwise use
**Won't fix** with a link to this documented security review. Do not mark
unreviewed reports resolved.
