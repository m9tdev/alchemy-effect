import * as Alchemy from "alchemy";
import * as Docker from "alchemy/Docker";
import * as Output from "alchemy/Output";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

export default Alchemy.Stack(
  "DockerApp",
  {
    providers: Docker.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const network = yield* Docker.Network("net", {});
    const pgData = yield* Docker.Volume("pg-data", {});

    const pgImage = yield* Docker.Image("pg-image", {
      image: "postgres:16-alpine",
    });
    const pg = yield* Docker.Container("postgres", {
      image: pgImage,
      network,
      env: {
        POSTGRES_PASSWORD: "secret",
        POSTGRES_DB: "appdb",
      },
      volumes: [{ source: pgData, target: "/var/lib/postgresql/data" }],
      healthcheck: {
        test: ["CMD-SHELL", "pg_isready -U postgres"],
        interval: Duration.seconds(2),
        timeout: Duration.seconds(2),
        retries: 30,
      },
      waitForHealthy: true,
    });

    const appImage = yield* Docker.Image("app-image", {
      main: "src/server.ts",
      runtime: "bun",
    });
    const app = yield* Docker.Container("app", {
      image: appImage,
      network,
      env: {
        DATABASE_URL: Output.interpolate`postgres://postgres:secret@${pg.containerName}:5432/appdb`,
        PORT: "3000",
      },
      ports: [{ host: 3000, container: 3000 }],
    });

    return {
      url: "http://localhost:3000",
      appContainer: app.containerName,
      postgresContainer: pg.containerName,
      network: network.networkName,
    };
  }),
);
