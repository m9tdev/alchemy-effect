import * as Effect from "effect/Effect";
import type { DockerCommandError } from "../Bundle/Docker.ts";
import type { Input } from "../Input.ts";
import { dockerLabels } from "./Labels.ts";

/**
 * Stable-stringify an order-insensitive `Record<string, Input<string>>` so
 * the diff is stable across deploys. Used for `labels`, `driverOpts`, etc.
 */
export const recordKey = (map?: Record<string, Input<string>>): string =>
  Object.entries(map ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join(",");

/** Test whether a DockerCommandError's stderr matches a given regex. */
export const isStderrMatch = (
  e: DockerCommandError,
  pattern: RegExp,
): boolean => pattern.test(e.stderr);

/**
 * Verify a pre-existing Docker resource carries the alchemy ownership labels
 * (alchemy.app + alchemy.stage) for this stack/stage. Returns `Effect.void`
 * on match, fails with a clear error otherwise. Used by adoption paths in
 * create handlers to refuse silently taking ownership of user-managed
 * resources.
 */
export const assertAlchemyOwned = (params: {
  id: string;
  kind: string;
  name: string;
  existingLabels: Record<string, string> | null | undefined;
}) =>
  Effect.gen(function* () {
    const expected = yield* dockerLabels(params.id);
    const labels = params.existingLabels ?? {};
    const ours =
      labels["alchemy.app"] === expected["alchemy.app"] &&
      labels["alchemy.stage"] === expected["alchemy.stage"];
    if (!ours) {
      return yield* Effect.fail(
        new Error(
          `Docker.${params.kind}: "${params.name}" already exists but is not owned by this alchemy stack/stage; refusing to adopt`,
        ),
      );
    }
    return expected;
  });
