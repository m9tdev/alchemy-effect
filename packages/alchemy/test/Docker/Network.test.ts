import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { spawnSync } from "node:child_process";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.skipIf(!dockerDaemonOk)("Docker.Network", () => {
  test(
    "creates and deletes a bridge network",
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();

      const network = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Network("net", { name: "alchemy-test-net" });
        }),
      );

      expect(network.networkName).toBe("alchemy-test-net");
      expect(network.driver).toBe("bridge");

      const { stdout } = yield* runDockerCommand([
        "network",
        "inspect",
        network.networkId,
        "--format",
        "{{.Name}}",
      ]);
      expect(stdout.trim()).toBe(network.networkName);

      yield* destroy();

      const probe = yield* Effect.result(
        runDockerCommand(["network", "inspect", network.networkId]),
      );
      expect(Result.isFailure(probe)).toBe(true);
    }).pipe(Effect.provide(Docker.providers())),
  );

  test(
    "re-deploying with the same name is a no-op",
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();
      const a = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Network("net", {});
        }),
      );
      const b = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Network("net", {});
        }),
      );
      expect(b.networkId).toBe(a.networkId);
      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );

  test(
    "changing labels triggers replace",
    { providers: false },
    Effect.gen(function* () {
      yield* destroy();
      const a = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Network("net", { labels: { v: "1" } });
        }),
      );
      const b = yield* test.deploy(
        Effect.gen(function* () {
          return yield* Docker.Network("net", { labels: { v: "2" } });
        }),
      );
      expect(b.networkId).not.toBe(a.networkId);
      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );
});
