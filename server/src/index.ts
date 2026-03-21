import { fileURLToPath } from "node:url";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import { Storage } from "./storage.js";
import { startCleanupScheduler } from "./cleanup.js";

const PORT = Number(process.env.PORT) || 3001;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIST = path.resolve(__dirname, "../../client/dist");

async function main(): Promise<void> {
  const storage = new Storage();
  await storage.init();

  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  await app.register(multipart, {
    limits: {
      fileSize: 500 * 1024 * 1024, // 500 MB
    },
  });

  // Serve the built React frontend as static files.
  await app.register(fastifyStatic, {
    root: CLIENT_DIST,
    wildcard: false,
  });

  // ── POST /api/store ────────────────────────────────────────────────
  app.post("/api/store", async (request, reply) => {
    const file = await request.file();

    if (!file) {
      return reply.code(400).send({ error: "No file uploaded" });
    }

    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk as Buffer);
    }
    const data = Buffer.concat(chunks);

    if (data.length === 0) {
      return reply.code(400).send({ error: "Uploaded file is empty" });
    }

    const { token, expiresAt } = await storage.storeFile(data);

    return reply.send({
      token,
      downloadUrl: `/api/download/${token}`,
      expiresAt: expiresAt.toISOString(),
    });
  });

  // ── GET /api/download/:token ───────────────────────────────────────
  app.get<{ Params: { token: string } }>(
    "/api/download/:token",
    async (request, reply) => {
      const { token } = request.params;
      const result = await storage.getFile(token);

      if (!result) {
        return reply.code(410).send({ error: "File not found or expired" });
      }

      return reply
        .header("Content-Type", "application/zip")
        .header(
          "Content-Disposition",
          `attachment; filename="${result.filename}"`,
        )
        .send(result.data);
    },
  );

  // SPA fallback: serve index.html for any non-API, non-static route.
  app.setNotFoundHandler(async (_request, reply) => {
    return reply.sendFile("index.html");
  });

  // Start periodic cleanup of expired files
  startCleanupScheduler(storage);

  await app.listen({ port: PORT, host: "0.0.0.0" });
}

main().catch((err) => {
  console.error("Fatal error starting server:", err);
  process.exit(1);
});
