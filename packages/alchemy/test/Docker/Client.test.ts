import { describe, expect, it } from "@effect/vitest";
import { parseDockerHost } from "../../src/Docker/Client.ts";

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
