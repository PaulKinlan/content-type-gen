import { assert, assertEquals } from "std/assert/mod.ts";
import { startDeployment } from "../deploy.ts";

Deno.test("deploy startup creates media storage before serving and disables uploads", async () => {
  const parent = await Deno.makeTempDir();
  const mediaDir = `${parent}/nested/media`;
  let deployedHandler:
    | ((request: Request) => Promise<Response>)
    | undefined;
  try {
    const result = await startDeployment({
      mediaDir,
      publicDir: "./public",
      serveHandler(handler) {
        deployedHandler = handler;
        return "mock-server";
      },
    });
    assertEquals(result, "mock-server");
    assert((await Deno.stat(mediaDir)).isDirectory);
    assert(deployedHandler);

    const root = await deployedHandler(new Request("https://deploy.example/"));
    assertEquals(root.status, 200);
    const html = await root.text();
    assert(html.includes("Uploads are unavailable on this deployment"));
    assertEquals(html.includes('id="media-upload"'), false);

    const upload = await deployedHandler(
      new Request("https://deploy.example/api/upload", {
        method: "POST",
        body: "not parsed because uploads are disabled",
      }),
    );
    assertEquals(upload.status, 501);
    assertEquals(
      (await upload.json()).error,
      "uploads are not implemented here",
    );
  } finally {
    await Deno.remove(parent, { recursive: true });
  }
});
