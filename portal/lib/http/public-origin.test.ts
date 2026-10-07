import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { publicOrigin, publicUrl } from "./public-origin";

const req = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers });

describe("publicOrigin", () => {
  const saved = process.env.PORTAL_PUBLIC_URL;
  afterEach(() => {
    if (saved === undefined) delete process.env.PORTAL_PUBLIC_URL;
    else process.env.PORTAL_PUBLIC_URL = saved;
  });

  it("uses the forwarded host and proto over the server's bind address", () => {
    delete process.env.PORTAL_PUBLIC_URL;
    const r = req("https://0.0.0.0:3000/api/portal/oauth/cpanel/callback?code=x", {
      host: "portal.example.com",
      "x-forwarded-proto": "https",
    });
    assert.equal(publicOrigin(r), "https://portal.example.com");
    assert.equal(
      publicUrl("/admin/users/u1", r).toString(),
      "https://portal.example.com/admin/users/u1",
    );
  });

  it("prefers X-Forwarded-Host (first value) to Host", () => {
    delete process.env.PORTAL_PUBLIC_URL;
    const r = req("http://0.0.0.0:3000/x", {
      host: "internal:3000",
      "x-forwarded-host": "portal.example.com, proxy.internal",
      "x-forwarded-proto": "https, http",
    });
    assert.equal(publicOrigin(r), "https://portal.example.com");
  });

  it("falls back to the request URL's scheme and, with no host header, its origin", () => {
    delete process.env.PORTAL_PUBLIC_URL;
    assert.equal(publicOrigin(req("http://localhost:3000/x", { host: "localhost:3000" })), "http://localhost:3000");
    assert.equal(publicOrigin(req("http://localhost:3000/x")), "http://localhost:3000");
  });

  it("PORTAL_PUBLIC_URL wins over every header", () => {
    process.env.PORTAL_PUBLIC_URL = "https://ai.kirk.example/";
    const r = req("https://0.0.0.0:3000/x", { host: "portal.example.com" });
    assert.equal(publicOrigin(r), "https://ai.kirk.example");
  });
});
