import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { resolveAuth } from "../../src/Docker/Auth.ts";

describe("resolveAuth", () => {
  it.effect("returns explicit credentials when provided", () =>
    Effect.gen(function* () {
      const result = yield* resolveAuth("ghcr.io", {
        username: "explicit-user",
        password: "explicit-pass",
      });
      expect(result).toEqual({
        username: "explicit-user",
        password: "explicit-pass",
        serveraddress: "ghcr.io",
      });
    }),
  );
});
