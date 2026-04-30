import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import { runDockerCommand } from "../Bundle/Docker.ts";

/**
 * Run `docker inspect --type=<type>` and parse the result.
 * Returns `null` when the resource doesn't exist (any non-zero exit treated as
 * "not found" — callers can re-run the underlying `docker` command for richer
 * errors when they need to differentiate).
 */
export const inspect = Effect.fn(function* <T>(
  type: "network" | "volume" | "container" | "image",
  ref: string,
) {
  const result = yield* Effect.result(
    runDockerCommand(["inspect", "--type", type, ref]),
  );
  if (Result.isFailure(result)) {
    return null;
  }
  const parsed = JSON.parse(result.success.stdout) as T[];
  return parsed[0] ?? null;
});

export interface InspectedNetwork {
  Id: string;
  Name: string;
  Driver: string;
  Scope: string;
  Internal: boolean;
  Attachable: boolean;
  Labels: Record<string, string> | null;
}

export interface InspectedVolume {
  Name: string;
  Driver: string;
  Mountpoint: string;
  Scope: string;
  Labels: Record<string, string> | null;
  Options: Record<string, string> | null;
}

export interface InspectedContainer {
  Id: string;
  Name: string;
  State: {
    Status: "created" | "running" | "exited" | "paused" | "dead";
    Running: boolean;
    StartedAt: string;
    Health?: { Status: "starting" | "healthy" | "unhealthy" };
  };
  NetworkSettings: {
    Networks: Record<string, { IPAddress: string }>;
    Ports: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
  Config: {
    Image: string;
    Labels: Record<string, string> | null;
  };
}
