import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import { isResolved } from "../Diff.ts";
import type { Input } from "../Input.ts";
import { createPhysicalName } from "../PhysicalName.ts";
import * as Provider from "../Provider.ts";
import { Resource } from "../Resource.ts";
import { runDockerCommand } from "../Bundle/Docker.ts";
import { inspect, type InspectedNetwork } from "./Inspect.ts";
import { dockerLabels } from "./Labels.ts";
import type { Providers } from "./Providers.ts";
import { assertAlchemyOwned, isStderrMatch, recordKey } from "./util.ts";

export interface NetworkProps {
  readonly name?: string;
  readonly driver?: "bridge" | "host" | "overlay" | "macvlan" | "none";
  readonly internal?: boolean;
  readonly attachable?: boolean;
  readonly labels?: Record<string, Input<string>>;
}

export interface Network extends Resource<
  "Docker.Network",
  NetworkProps,
  {
    networkId: string;
    networkName: string;
    driver: string;
    scope: string;
  },
  never,
  Providers
> {}

export const Network = Resource<Network>("Docker.Network");

const computeName = (id: string, props: NetworkProps) =>
  Effect.gen(function* () {
    if (props.name) return props.name;
    return yield* createPhysicalName({
      id,
      maxLength: 63,
      lowercase: true,
    });
  });

const NO_SUCH_NETWORK = /no such network/i;
const HAS_ACTIVE_ENDPOINTS = /has active endpoints/i;

export const NetworkProvider = () =>
  Provider.effect(
    Network,
    Effect.gen(function* () {
      return {
        stables: ["networkId", "networkName", "driver", "scope"],
        diff: Effect.fn(function* ({ id, news, olds = {} }) {
          if (!isResolved(news)) return undefined;
          const oldName = yield* computeName(id, olds);
          const newName = yield* computeName(id, news);
          if (oldName !== newName) return { action: "replace" } as const;
          if ((olds.driver ?? "bridge") !== (news.driver ?? "bridge")) {
            return { action: "replace" } as const;
          }
          if ((olds.internal ?? false) !== (news.internal ?? false)) {
            return { action: "replace" } as const;
          }
          if ((olds.attachable ?? true) !== (news.attachable ?? true)) {
            return { action: "replace" } as const;
          }
          if (recordKey(olds.labels) !== recordKey(news.labels)) {
            return { action: "replace" } as const;
          }
          return undefined;
        }),
        create: Effect.fn(function* ({ id, news = {} }) {
          const name = yield* computeName(id, news);
          const driver = news.driver ?? "bridge";

          // Idempotent create: if a network with this name already exists
          // (e.g. partial state-persistence failure on a previous run),
          // adopt it — but only if it carries our alchemy ownership labels.
          // Otherwise refuse, so we never silently destroy a user-managed
          // network on `destroy()`.
          const existing = yield* inspect<InspectedNetwork>("network", name);
          if (existing) {
            yield* assertAlchemyOwned({
              id,
              kind: "Network",
              name,
              existingLabels: existing.Labels,
            });
            return {
              networkId: existing.Id,
              networkName: existing.Name,
              driver: existing.Driver,
              scope: existing.Scope,
            };
          }

          const expectedLabels = yield* dockerLabels(id);
          const labels = { ...expectedLabels, ...(news.labels ?? {}) };

          const args: string[] = ["network", "create", "--driver", driver];
          if (news.internal) args.push("--internal");
          if (news.attachable !== false) args.push("--attachable");
          for (const [k, v] of Object.entries(labels)) {
            args.push("--label", `${k}=${v}`);
          }
          args.push(name);

          yield* runDockerCommand(args);

          const created = yield* inspect<InspectedNetwork>("network", name);
          if (!created) {
            return yield* Effect.fail(
              new Error(
                `Docker.Network: created network ${name} but inspect returned null`,
              ),
            );
          }
          return {
            networkId: created.Id,
            networkName: created.Name,
            driver: created.Driver,
            scope: created.Scope,
          };
        }),
        update: Effect.fn(function* () {
          return yield* Effect.die(
            "Docker.Network has no in-place update path; diff should return replace for any meaningful change",
          );
        }),
        delete: Effect.fn(function* ({ output }) {
          yield* runDockerCommand(["network", "rm", output.networkId]).pipe(
            // Retry while attached endpoints are still draining.
            // 30-second wall-clock cap.
            Effect.retry({
              while: (e) =>
                e._tag === "DockerCommandError" &&
                isStderrMatch(e, HAS_ACTIVE_ENDPOINTS),
              schedule: Schedule.exponential("100 millis").pipe(
                Schedule.both(Schedule.during("30 seconds")),
              ),
            }),
            // Treat "no such network" as already-deleted (idempotent).
            Effect.catchTag("DockerCommandError", (e) =>
              isStderrMatch(e, NO_SUCH_NETWORK)
                ? Effect.void
                : Effect.fail(e),
            ),
          );
        }),
      };
    }),
  );
