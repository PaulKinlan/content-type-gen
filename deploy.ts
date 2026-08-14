// Deno Deploy entrypoint for content-type-gen.
import { serve } from "std/http/server.ts";
import { createHandler } from "./server.ts";

serve(createHandler({ loopbackOnly: false, mediaDir: "/tmp/media", publicDir: "./public" }));
