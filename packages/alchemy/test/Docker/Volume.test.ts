import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { spawnSync } from "node:child_process";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.skipIf(!dockerDaemonOk)("Docker.Volume", () => {
  test(
    "creates and deletes a named volume",
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();

      const volume = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Volume("data", { name: "alchemy-test-data" });
        }),
      );

      expect(volume.volumeName).toBe("alchemy-test-data");
      expect(volume.driver).toBe("local");
      expect(volume.mountpoint).toContain(volume.volumeName);

      const { stdout } = yield* runDockerCommand([
        "volume",
        "inspect",
        volume.volumeName,
        "--format",
        "{{.Name}}",
      ]);
      expect(stdout.trim()).toBe(volume.volumeName);

      yield* destroy();

      const probe = yield* Effect.result(
        runDockerCommand(["volume", "inspect", volume.volumeName]),
      );
      expect(Result.isFailure(probe)).toBe(true);
    }).pipe(Effect.provide(Docker.providers())),
  );
});
