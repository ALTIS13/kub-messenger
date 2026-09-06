import { existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { expect } from "@playwright/test";

/**
 * Serves `artifacts/kub/dist/public` — the bundle *this checkout* builds.
 *
 * The Windows shell QA has two different questions to answer and they need two
 * different origins. Whether the shell reaches the real deployment, mounts it
 * and hands over to it can only be asked of `https://app.letscube.ru`. Whether
 * the interface honours a contract cannot: production serves whatever was
 * deployed last, so a regression in the working tree stays green there and
 * another track's deploy can turn the gate red without anything here changing.
 *
 * That was measured rather than assumed. Removing `inert` from
 * `desktop-app-shell`, rebuilding, and re-running left `critical_update` green
 * while the SHA-256 of both the source and the built bundle had changed.
 *
 * A single-file static server rather than the dev server: the interface under
 * test is the built one, and any route falls back to `index.html` so the SPA
 * owns its own routing.
 */
export async function startLocalFrontendServer() {
  const publicRoot = path.resolve(process.cwd(), "artifacts", "kub", "dist", "public");
  const indexPath = path.join(publicRoot, "index.html");
  expect(existsSync(indexPath), "build the local frontend before Tauri QA").toBe(true);
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    const candidate = path.resolve(publicRoot, relative);
    if (
      candidate !== publicRoot &&
      candidate.startsWith(`${publicRoot}${path.sep}`) &&
      existsSync(candidate) &&
      statSync(candidate).isFile()
    ) {
      response.writeHead(200, { "Content-Type": contentTypeFor(candidate) });
      response.end(readFileSync(candidate));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(readFileSync(indexPath));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Local frontend server did not bind.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function contentTypeFor(filePath: string) {
  const extension = path.extname(filePath).toLowerCase();
  return (
    (
      {
        ".css": "text/css; charset=utf-8",
        ".html": "text/html; charset=utf-8",
        ".ico": "image/x-icon",
        ".jpeg": "image/jpeg",
        ".jpg": "image/jpeg",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".png": "image/png",
        ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".webp": "image/webp",
      } as Record<string, string>
    )[extension] ?? "application/octet-stream"
  );
}
