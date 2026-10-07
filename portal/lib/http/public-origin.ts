/**
 * The origin the browser used to reach the portal, for building redirects.
 *
 * Next's standalone server (started with HOSTNAME=0.0.0.0 in the control
 * image) builds `req.url` from its bind address, not from the Host header, so
 * `new URL("/admin/users", req.url)` is https://0.0.0.0:3000/admin/users and
 * no browser can follow it (seen on the demo on 2026-10-07 after the Next 16
 * upgrade). Northflank's ingress forwards the real Host and X-Forwarded-Proto;
 * build from those. PORTAL_PUBLIC_URL overrides both when set.
 */
export function publicOrigin(req: Request): string {
  const fixed = process.env.PORTAL_PUBLIC_URL?.trim();
  if (fixed) return new URL(fixed).origin;
  const fromUrl = new URL(req.url);
  const host =
    req.headers.get("x-forwarded-host")?.split(",")[0].trim() ||
    req.headers.get("host")?.trim();
  if (!host) return fromUrl.origin;
  const proto =
    req.headers.get("x-forwarded-proto")?.split(",")[0].trim() ||
    fromUrl.protocol.replace(/:$/, "");
  return `${proto}://${host}`;
}

/** `new URL(path, req.url)` done right: an absolute URL on the public origin. */
export function publicUrl(path: string, req: Request): URL {
  return new URL(path, publicOrigin(req));
}
