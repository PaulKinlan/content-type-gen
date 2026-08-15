// Deno Deploy entrypoint for the read-only content-type-gen surface.
import { createHandler } from "./server.ts";

export interface DeploymentOptions {
  mediaDir?: string;
  publicDir?: string;
  serveHandler?: (
    handler: (request: Request) => Promise<Response>,
  ) => unknown;
}

export async function startDeployment(
  options: DeploymentOptions = {},
): Promise<unknown> {
  const mediaDir = options.mediaDir ?? "/tmp/content-type-gen-media";
  // The directory must exist before createHandler handles its first request.
  // It is ephemeral on Deploy and is not used for uploads, which are disabled.
  await Deno.mkdir(mediaDir, { recursive: true });
  const handler = createHandler({
    loopbackOnly: false,
    mediaDir,
    publicDir: options.publicDir ?? "./public",
    uploadsEnabled: false,
  });
  return (options.serveHandler ?? ((value) => Deno.serve({ hostname: "0.0.0.0", port: Number(Deno.env.get("PORT") ?? "8000") }, value)))(handler);
}

if (import.meta.main) await startDeployment();
