import { describe, it, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { extract } from "tar-stream";
import { packBuildContext } from "../../src/Bundle/Docker.ts";

const collectEntries = (tar: Uint8Array): Promise<Map<string, string>> =>
  new Promise((resolve, reject) => {
    const ext = extract();
    const out = new Map<string, string>();
    ext.on("entry", (header, stream, next) => {
      const chunks: Uint8Array[] = [];
      stream.on("data", (c) => chunks.push(c));
      stream.on("end", () => {
        out.set(header.name, Buffer.concat(chunks).toString("utf8"));
        next();
      });
      stream.resume();
    });
    ext.on("finish", () => resolve(out));
    ext.on("error", reject);
    ext.end(Buffer.from(tar));
  });

describe("packBuildContext", () => {
  it.effect("packs all files when no .dockerignore is present", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({ prefix: "alchemy-tar-" });
      yield* fs.writeFileString(path.join(dir, "Dockerfile"), "FROM scratch\n");
      yield* fs.writeFileString(
        path.join(dir, "app.js"),
        "console.log('hi');\n",
      );

      const tar = yield* packBuildContext(dir);
      const entries = yield* Effect.promise(() => collectEntries(tar));
      expect(entries.get("Dockerfile")).toBe("FROM scratch\n");
      expect(entries.get("app.js")).toBe("console.log('hi');\n");
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("respects .dockerignore", () =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const dir = yield* fs.makeTempDirectory({
        prefix: "alchemy-tar-ignore-",
      });
      yield* fs.writeFileString(path.join(dir, "Dockerfile"), "FROM scratch\n");
      yield* fs.writeFileString(path.join(dir, "app.js"), "ok");
      yield* fs.makeDirectory(path.join(dir, "node_modules"), {
        recursive: true,
      });
      yield* fs.writeFileString(path.join(dir, "node_modules/x.js"), "skip");
      yield* fs.writeFileString(
        path.join(dir, ".dockerignore"),
        "node_modules\n",
      );

      const tar = yield* packBuildContext(dir);
      const entries = yield* Effect.promise(() => collectEntries(tar));
      expect(entries.has("Dockerfile")).toBe(true);
      expect(entries.has("app.js")).toBe(true);
      expect(entries.has("node_modules/x.js")).toBe(false);
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
