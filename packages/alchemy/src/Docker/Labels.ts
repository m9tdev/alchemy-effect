import * as Effect from "effect/Effect";
import { Stack } from "../Stack.ts";
import { Stage } from "../Stage.ts";

/**
 * Compose-compatible labels applied to every Docker.* resource so
 * `docker compose ps -p alchemy_<app>_<stage>` recognizes the deployment.
 *
 * Returns a flat string→string map suitable for `--label key=value` flags.
 */
export const dockerLabels = Effect.fn(function* (id: string) {
  const stack = yield* Stack;
  const stage = yield* Stage;
  const project = `alchemy_${stack.name}_${stage}`;
  return {
    "com.docker.compose.project": project,
    "com.docker.compose.service": id,
    "alchemy.app": stack.name,
    "alchemy.stage": stage,
    "alchemy.id": id,
  } satisfies Record<string, string>;
});
