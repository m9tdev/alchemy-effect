import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

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

export class DockerConfigPath extends Context.Service<
  DockerConfigPath,
  string
>()("alchemy/Docker.ConfigPath") {}

export const DockerConfigPathLive: Layer.Layer<
  DockerConfigPath,
  never,
  Path.Path
> = Layer.effect(
  DockerConfigPath,
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    return path.join(home, ".docker", "config.json");
  }),
);

interface DockerConfig {
  readonly auths?: Record<string, { auth?: string; identitytoken?: string }>;
  readonly credsStore?: string;
  readonly credHelpers?: Record<string, string>;
}

const readConfig: Effect.Effect<
  DockerConfig | undefined,
  AuthResolveError,
  FileSystem.FileSystem | DockerConfigPath
> = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const configPath = yield* DockerConfigPath;
  const exists = yield* fs
    .exists(configPath)
    .pipe(Effect.catch(() => Effect.succeed(false)));
  if (!exists) return undefined;
  const text = yield* fs.readFileString(configPath).pipe(
    Effect.mapError(
      (cause) =>
        new AuthResolveError({
          registry: "<unknown>",
          reason: `Cannot read ${configPath}`,
          cause,
        }),
    ),
  );
  return yield* Effect.try({
    try: () => JSON.parse(text) as DockerConfig,
    catch: (cause) =>
      new AuthResolveError({
        registry: "<unknown>",
        reason: `Invalid JSON in ${configPath}`,
        cause,
      }),
  });
});

const decodeBase64Auth = (
  encoded: string,
): { username: string; password: string } | undefined => {
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const idx = decoded.indexOf(":");
  if (idx < 0) return undefined;
  return {
    username: decoded.slice(0, idx),
    password: decoded.slice(idx + 1),
  };
};

const findAuthEntry = (
  auths: NonNullable<DockerConfig["auths"]>,
  registry: string,
): { auth?: string } | undefined => {
  if (auths[registry]) return auths[registry];
  if (registry === "docker.io" || registry === "index.docker.io") {
    return auths["https://index.docker.io/v1/"];
  }
  return undefined;
};

export const resolveAuth = (
  registry: string,
  explicit?: ResolveAuthExplicit,
): Effect.Effect<
  RegistryAuth | undefined,
  AuthResolveError,
  FileSystem.FileSystem | DockerConfigPath
> =>
  Effect.gen(function* () {
    if (explicit?.username && explicit?.password) {
      return {
        username: explicit.username,
        password: explicit.password,
        serveraddress: registry,
      };
    }
    const config = yield* readConfig;
    if (!config) return undefined;

    if (config.auths) {
      const entry = findAuthEntry(config.auths, registry);
      if (entry?.auth) {
        const decoded = decodeBase64Auth(entry.auth);
        if (decoded) {
          return {
            username: decoded.username,
            password: decoded.password,
            serveraddress: registry,
          };
        }
      }
    }
    return undefined;
  });
