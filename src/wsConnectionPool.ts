import { GraphQLSchema } from "graphql";
import { handleProtocols } from "graphql-ws";
import * as db from "./db";
import { resolveSubscription } from "./resolveSubscription";
import { fixD1BetaEnv } from "./fixD1BetaEnv";
import { createDefaultPublishableContext } from "./publishableContext";
import { CreateContextFn } from "./types";
import { useWebsocket } from "./useWebsocket";

type ConstructableDurableObject<Env> = {
  new (state: DurableObjectState, env: Env): DurableObject;
};

/** Creates a WsConnection DurableObject class */
export function createWsConnectionPoolClass<Env extends {} = {}>({
  schema,
  subscriptionsDb,
  wsConnectionPool,
  context: createContext = (req, env) =>
    createDefaultPublishableContext<Env, undefined>({
      env,
      executionCtx: undefined,
      subscriptionsDb,
      wsConnectionPool,
      schema,
    }),
}: {
  schema: GraphQLSchema;
  subscriptionsDb: (env: Env) => D1Database;
  wsConnectionPool: (env: Env) => DurableObjectNamespace;
  context?: CreateContextFn<Env, ExecutionContext | undefined>;
}): ConstructableDurableObject<Env> {
  return class WsConnectionPool implements DurableObject {
    private connections = new Map<string, WebSocket>();
    private env: Env;
    private subscriptionsDb: D1Database;
    constructor(private state: DurableObjectState, env: Env) {
      this.env = fixD1BetaEnv(env);
      this.subscriptionsDb = subscriptionsDb(this.env);
    }
    async fetch(request: Request) {
      const path = new URL(request.url).pathname.slice(1);
      const pathParts = path.split("/");
      const [action] = pathParts;
      const connectionPoolId = this.state.id.toString();

      // DO router
      switch (action) {
        // connection will be established here
        case "connect": {
          const connectionId = pathParts[1];
          // creating ws pair (we use server to send to the client and we return the client in the response)
          const [client, connection] = Object.values(
            new WebSocketPair()
          ) as any[];
          this.connections.set(connectionId, connection);
          const protocol = handleProtocols(
            request.headers.get("Sec-WebSocket-Protocol")!
          );

          const context = await createContext(request, this.env, undefined);

          await useWebsocket(
            connection,
            request,
            protocol,
            schema,
            context,
            async (message) => {
              const subscription = await resolveSubscription(
                message,
                schema,
                connectionId,
                connectionPoolId
              );
              await db.insertSubscription(this.subscriptionsDb, subscription);
            },
            () => db.deleteSubscription(this.subscriptionsDb, connectionId)
          );
          return new Response(null, {
            status: 101,
            webSocket: client,
            headers: protocol
              ? {
                  // As per the WS spec, if the server does not accept any subprotocol - it should omit this header.
                  // Beware that doing so will have Chrome abruptly close the WebSocket connection with a 1006 code.
                  "Sec-WebSocket-Protocol": protocol,
                }
              : {},
          });
        }
        case "close": {
          const connectionId = pathParts[1];
          const connection = this.connections.get(connectionId);
          if (!connection) {
            await db.deleteSubscription(this.subscriptionsDb, connectionId);
            return new Response("ok");
          }
          // delete from D1 handled by `useWebsocket`
          connection.close();
          return new Response("ok");
        }
        case "publish": {
          // POST request with topic and payload transformed into a ws message via the publish handler
          const messagesAndConnectionIds: {
            message: any;
            connectionId: string;
          }[] = await request.json();

          for (const { message, connectionId } of messagesAndConnectionIds) {
            const connection = this.connections.get(connectionId);
            if (!connection || connection.readyState === connection.CLOSED) {
              // - if a connection is not found,
              // it's probably because the durable object was somehow destroyed,
              // in which case the websocket was closed and we can delete it from the database
              // - if it's already closed (maybe by the client) we can also delete it
              await db.deleteSubscription(this.subscriptionsDb, connectionId);
              continue;
            }
            connection.send(JSON.stringify(message));
          }
          return new Response("ok");
        }
        default:
          throw new Error("bad_request");
      }
    }
  };
}
