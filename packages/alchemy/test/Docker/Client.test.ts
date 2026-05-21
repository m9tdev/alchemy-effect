import { describe, expect, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import {
  DockerClientLive,
  DockerCredentials,
  parseDockerHost,
} from "../../src/Docker/Client.ts";

describe("parseDockerHost", () => {
  it("accepts tcp://host:port", () => {
    expect(parseDockerHost("tcp://localhost:2375")).toEqual({
      host: "localhost",
      port: 2375,
      tls: false,
    });
  });

  it("accepts http://host:port", () => {
    expect(parseDockerHost("http://docker.example.com:2375")).toEqual({
      host: "docker.example.com",
      port: 2375,
      tls: false,
    });
  });

  it("accepts https://host:port and sets tls=true", () => {
    expect(parseDockerHost("https://docker.example.com:2376")).toEqual({
      host: "docker.example.com",
      port: 2376,
      tls: true,
    });
  });

  it("rejects unix:// with actionable error", () => {
    expect(() => parseDockerHost("unix:///var/run/docker.sock")).toThrow(
      /Unix socket transport is not yet supported/,
    );
  });

  it("rejects ssh://", () => {
    expect(() => parseDockerHost("ssh://user@host")).toThrow(/SSH transport/);
  });

  it("rejects npipe://", () => {
    expect(() => parseDockerHost("npipe:////./pipe/docker_engine")).toThrow(
      /Windows named pipe/,
    );
  });

  it("defaults tls=true on port 2376 (Docker convention)", () => {
    expect(parseDockerHost("tcp://localhost:2376")).toEqual({
      host: "localhost",
      port: 2376,
      tls: true,
    });
  });
});

const withDockerHost = (env: Record<string, string>) =>
  ConfigProvider.layer(ConfigProvider.fromEnv({ env }));

describe("DockerClientLive", () => {
  it.effect("builds apiBaseUrl from tcp:// DOCKER_HOST (no TLS)", () =>
    Effect.gen(function* () {
      const creds = yield* DockerCredentials;
      expect(creds.apiBaseUrl).toBe("http://localhost:2375");
      expect(creds.apiKey).toBe("");
    }).pipe(
      Effect.provide(DockerClientLive),
      Effect.provide(withDockerHost({ DOCKER_HOST: "tcp://localhost:2375" })),
    ),
  );

  it.effect("builds apiBaseUrl from https:// DOCKER_HOST (TLS)", () =>
    Effect.gen(function* () {
      const creds = yield* DockerCredentials;
      expect(creds.apiBaseUrl).toBe("https://docker.example.com:2376");
    }).pipe(
      Effect.provide(DockerClientLive),
      Effect.provide(
        withDockerHost({ DOCKER_HOST: "https://docker.example.com:2376" }),
      ),
    ),
  );

  it.effect("port 2376 implies https scheme", () =>
    Effect.gen(function* () {
      const creds = yield* DockerCredentials;
      expect(creds.apiBaseUrl).toBe("https://localhost:2376");
    }).pipe(
      Effect.provide(DockerClientLive),
      Effect.provide(withDockerHost({ DOCKER_HOST: "tcp://localhost:2376" })),
    ),
  );

  it.effect("defaults to tcp://localhost:2375 when DOCKER_HOST is unset", () =>
    Effect.gen(function* () {
      const creds = yield* DockerCredentials;
      expect(creds.apiBaseUrl).toBe("http://localhost:2375");
    }).pipe(
      Effect.provide(DockerClientLive),
      Effect.provide(withDockerHost({})),
    ),
  );
});
