import { GraphQLSchema } from "graphql";
import { createPublishFn } from "./createPublishFn";
import { createDefaultPublishableContext } from "./publishableContext";
import { v4 as uuid } from "uuid";
import { MaybePromise } from "./types";
import { log } from "./log";

export function handleSubscriptions<
  Env extends {} = {},
  T extends ExportedHandlerFetchHandler<Env> = any
>({
  fetch,
  schema,
  wsConnectionPool,
  subscriptionsDb,
  isAuthorized,
  context: createContext = (request, env, executionCtx, requestBody) =>
    createDefaultPublishableContext({
      env,
      executionCtx,
      schema,
      wsConnectionPool,
      subscriptionsDb,
    }),
  publishPathName = "/publish",
  wsConnectPathName = "/graphql",
  pooling = "continent",
}: {
  fetch?: T;
  schema: GraphQLSchema;
  wsConnectionPool: (env: Env) => DurableObjectNamespace;
  subscriptionsDb: (env: Env) => D1Database;
  isAuthorized?: (
    request: Request,
    env: Env,
    executionCtx: ExecutionContext
  ) => boolean | Promise<boolean>;
  context?: (
    request: Request,
    env: Env,
    executionCtx: ExecutionContext,
    requestBody: any
  ) => any;
  publishPathName?: string;
  wsConnectPathName?: string;
  pooling?:
    | "global"
    | "colo"
    | "continent"
    | "none"
    | ((req: Request, env: Env) => MaybePromise<string>);
}): T {
  const wrappedFetch = (async (request, env, executionCtx) => {
    const authorized =
      typeof isAuthorized === "function"
        ? await isAuthorized(request.clone(), env, executionCtx)
        : true;
    if (!authorized) return new Response("unauthorized", { status: 400 });

    const WS_CONNECTION_POOL = wsConnectionPool(env);
    const SUBSCRIPTIONS_DB = subscriptionsDb(env);

    const upgradeHeader = request.headers.get("Upgrade");
    const path = new URL(request.url).pathname;

    if (path === publishPathName && request.method === "POST") {
      log("Received publish request");
      const reqBody: { topic: string; payload?: any } = await request.json();
      if (!reqBody.topic)
        return new Response("missing_topic_from_request", { status: 400 });
      const publish = createPublishFn(
        WS_CONNECTION_POOL,
        SUBSCRIPTIONS_DB,
        schema,
        createContext(request, env, executionCtx, reqBody)
      );
      executionCtx.waitUntil(publish(reqBody));

      return new Response("ok");
    } else if (path === wsConnectPathName && upgradeHeader === "websocket") {
      log("Received new websocket connection");
      const poolingStrategyFn =
        typeof pooling === "function" ? pooling : poolingStrategies[pooling];
      const stubName = await poolingStrategyFn(request, env);
      log("Using pool", stubName);
      const stubId = WS_CONNECTION_POOL.idFromName(stubName);
      const stub = WS_CONNECTION_POOL.get(stubId);
      const connectionId = uuid();
      return stub.fetch(
        `https://ws-connection-durable-object.internal/connect/${connectionId}`,
        request
      );
    }

    if (typeof fetch === "function") {
      return await fetch(request, env, executionCtx);
    }
    return new Response("not_found", { status: 404 });
  }) as T;
  return wrappedFetch;
}

const poolingStrategies: Record<
  "global" | "colo" | "continent" | "none",
  (req: Request, env: any) => MaybePromise<string>
> = {
  none: () => uuid(),
  colo: (req) => {
    const cf: IncomingRequestCfProperties = (req as any).cf;
    return cf && "colo" in cf && cf.colo ? cf.colo : "global";
  },
  continent: (req) => {
    const cf: IncomingRequestCfProperties = (req as any).cf;
    return cf && "continent" in cf && cf.continent ? cf.continent : "global";
  },
  global: () => "global",
};
