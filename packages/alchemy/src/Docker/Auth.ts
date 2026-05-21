import * as Data from "effect/Data";
import * as Effect from "effect/Effect";

export interface RegistryAuth {
  readonly username: string;
  readonly password: string;
  readonly serveraddress: string;
}

export class AuthResolveError extends Data.TaggedError("AuthResolveError")<{
  readonly registry: string;
  readonly reason: string;
  readonly cause?: unknown;
}> {}

export interface ResolveAuthExplicit {
  readonly username?: string;
  readonly password?: string;
}

export const resolveAuth: (
  registry: string,
  explicit?: ResolveAuthExplicit,
) => Effect.Effect<RegistryAuth | undefined, AuthResolveError> = Effect.fn(
  function* (registry, explicit) {
    if (explicit?.username && explicit?.password) {
      return {
        username: explicit.username,
        password: explicit.password,
        serveraddress: registry,
      };
    }
    return undefined;
  },
);
