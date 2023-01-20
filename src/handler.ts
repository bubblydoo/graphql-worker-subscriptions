import { GraphQLSchema } from "graphql";
import { createPublishFn } from "./createPublishFn";
import { createDefaultPublishableContext } from "./publishableContext";
import { v4 as uuid } from "uuid";

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
  pooling = "global",
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
  pooling?: "global" | "regional" | "none";
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
      const stubName = {
        none: () => uuid(),
        regional: () =>
          ((request as any).cf as IncomingRequestCfProperties)?.colo ||
          "global",
        global: () => "global",
      }[pooling]();
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
