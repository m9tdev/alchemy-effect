import { runDockerCommand } from "@/Bundle/Docker";
import * as Docker from "@/Docker";
import { destroy, test } from "@/Test/Vitest";
import { describe, expect } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import { spawnSync } from "node:child_process";

const dockerDaemonOk =
  spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0;

describe.skipIf(!dockerDaemonOk)("Docker smoke test", () => {
  test(
    "app + postgres on a shared network with a named volume",
    { providers: false, timeout: 240_000 },
    Effect.gen(function* () {
      yield* destroy();

      const result = yield* test.deploy(
        Effect.gen(function* () {
          const network = yield* Docker.Network("net", {});
          const pgData = yield* Docker.Volume("pg-data", {});

          const pgImage = yield* Docker.Image("pg-image", {
            image: "postgres:16-alpine",
          });
          const pg = yield* Docker.Container("postgres", {
            image: pgImage,
            network,
            env: { POSTGRES_PASSWORD: "secret", POSTGRES_DB: "app" },
            volumes: [{ source: pgData, target: "/var/lib/postgresql/data" }],
            healthcheck: {
              test: ["CMD-SHELL", "pg_isready -U postgres"],
              interval: Duration.seconds(2),
              timeout: Duration.seconds(2),
              retries: 30,
            },
            waitForHealthy: true,
          });

          // Verify pg is reachable from another container on the same network.
          // Use a one-shot alpine container with psql via apk.
          // (We don't make it an alchemy resource since it's a probe.)
          return { network, pg };
        }),
      );

      // Probe: docker run --network <net> --rm postgres:16-alpine psql ...
      const { stdout } = yield* runDockerCommand([
        "run",
        "--rm",
        "--network",
        result.network.networkName,
        "-e",
        "PGPASSWORD=secret",
        "postgres:16-alpine",
        "psql",
        "-h",
        result.pg.containerName,
        "-U",
        "postgres",
        "-d",
        "app",
        "-tAc",
        "select 1",
      ]);
      expect(stdout.trim()).toBe("1");

      yield* destroy();
    }).pipe(Effect.provide(Docker.providers())),
  );
});
