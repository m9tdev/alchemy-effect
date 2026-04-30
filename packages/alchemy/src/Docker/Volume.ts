import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import type { Input } from "../Input.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { runDockerCommand } from "../Bundle/Docker.ts";
import { inspect, type InspectedVolume } from "./Inspect.ts";
import { dockerLabels } from "./Labels.ts";
import type { Providers } from "./Providers.ts";
import { assertAlchemyOwned, isStderrMatch, recordKey } from "./util.ts";

export interface VolumeProps {
  readonly name?: string;
  readonly driver?: string;
  readonly driverOpts?: Record<string, Input<string>>;
  readonly labels?: Record<string, Input<string>>;
}

export interface Volume extends Resource<
  "Docker.Volume",
  VolumeProps,
  {
    volumeName: string;
    driver: string;
    mountpoint: string;
    scope: string;
  },
  never,
  Providers
> {}

export const Volume = Resource<Volume>("Docker.Volume");

const computeName = (id: string, props: VolumeProps) =>
  Effect.gen(function* () {
    if (props.name) return props.name;
    return yield* createPhysicalName({
      id,
      maxLength: 63,
      lowercase: true,
    });
  });

const NO_SUCH_VOLUME = /no such volume/i;
const VOLUME_IN_USE = /volume is in use/i;

export const VolumeProvider = () =>
  Provider.effect(
    Volume,
    Effect.gen(function* () {
      return {
        stables: ["volumeName", "driver", "mountpoint", "scope"],
        diff: Effect.fn(function* ({ id, news, olds = {} }) {
          if (!isResolved(news)) return undefined;
          const oldName = yield* computeName(id, olds);
          const newName = yield* computeName(id, news);
          if (oldName !== newName) return { action: "replace" } as const;
          if ((olds.driver ?? "local") !== (news.driver ?? "local")) {
            return { action: "replace" } as const;
          }
          if (recordKey(olds.driverOpts) !== recordKey(news.driverOpts)) {
            return { action: "replace" } as const;
          }
          if (recordKey(olds.labels) !== recordKey(news.labels)) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        create: Effect.fn(function* ({ id, news = {} }) {
          const name = yield* computeName(id, news);
          const driver = news.driver ?? "local";

          // Idempotent create: if a volume with this name already exists
          // (e.g. partial state-persistence failure on a previous run),
          // adopt it — but only if it carries our alchemy ownership labels
          // AND the existing driverOpts match. driverOpts are immutable after
          // `docker volume create`, so a mismatch indicates the previous run
          // was attempting different mount options; refuse adoption rather
          // than silently using a volume with the wrong configuration.
          // Otherwise refuse, so we never silently destroy a user-managed
          // volume on `destroy()`.
          const existing = yield* inspect<InspectedVolume>("volume", name);
          if (existing) {
            yield* assertAlchemyOwned({
              id,
              kind: "Volume",
              name,
              existingLabels: existing.Labels,
            });
            const existingOpts = recordKey(existing.Options ?? {});
            const expectedOpts = recordKey(news.driverOpts);
            if (existingOpts !== expectedOpts) {
              return yield* Effect.fail(
                new Error(
                  `Docker.Volume: "${name}" already exists with mismatched driverOpts (existing: ${existingOpts || "<none>"}, desired: ${expectedOpts || "<none>"}); refusing to adopt`,
                ),
              );
            }
            return {
              volumeName: existing.Name,
              driver: existing.Driver,
              mountpoint: existing.Mountpoint,
              scope: existing.Scope,
            };
          }

          const expectedLabels = yield* dockerLabels(id);
          const labels = { ...expectedLabels, ...(news.labels ?? {}) };

          const args: string[] = ["volume", "create", "--driver", driver];
          for (const [k, v] of Object.entries(news.driverOpts ?? {})) {
            args.push("--opt", `${k}=${v}`);
          }
          for (const [k, v] of Object.entries(labels)) {
            args.push("--label", `${k}=${v}`);
          }
          args.push(name);

          yield* runDockerCommand(args);

          const created = yield* inspect<InspectedVolume>("volume", name);
          if (!created) {
            return yield* Effect.fail(
              new Error(
                `Docker.Volume: created volume ${name} but inspect returned null`,
              ),
            );
          }
          return {
            volumeName: created.Name,
            driver: created.Driver,
            mountpoint: created.Mountpoint,
            scope: created.Scope,
          };
        }),
        update: Effect.fn(function* () {
          return yield* Effect.die(
            "Docker.Volume has no in-place update path; diff should return replace for any meaningful change",
          );
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* runDockerCommand(["volume", "rm", output.volumeName]).pipe(
            // Retry while the volume is still attached to a container
            // that's draining. 30-second wall-clock cap.
            Effect.retry({
              while: (e) =>
                e._tag === "DockerCommandError" &&
                isStderrMatch(e, VOLUME_IN_USE),
              schedule: Schedule.exponential("100 millis").pipe(
                Schedule.both(Schedule.during("30 seconds")),
              ),
            }),
            // Treat "no such volume" as already-deleted (idempotent).
            Effect.catchTag("DockerCommandError", (e) =>
              isStderrMatch(e, NO_SUCH_VOLUME)
                ? Effect.void
                : Effect.fail(e),
            ),
          );
        }),
      };
    }),
  );
