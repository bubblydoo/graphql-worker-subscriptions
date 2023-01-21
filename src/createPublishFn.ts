import { Subscription } from "@/subscription";
import { GraphQLSchema, parse, execute } from "graphql";
import { MessageType, NextMessage } from "graphql-ws";
import groupBy from "lodash/groupBy";
import * as db from "./db";
import { log } from "./log";

type PublishFn = (event: { topic: string; payload?: any }) => Promise<void>;

/**
 * Creates a publish function that will query the database for applicable subscriptions,
 * and publish to each of them
 */
export const createPublishFn =
  (
    WS_CONNECTION_POOL: DurableObjectNamespace,
    SUBSCRIPTIONS_DB: D1Database,
    schema: GraphQLSchema,
    graphqlContext: any
  ): PublishFn =>
  async (event: { topic: string; payload?: any }) => {
    const subscriptions = await db.querySubscriptions(
      SUBSCRIPTIONS_DB,
      event.topic,
      event.payload
    );

    await publishToConnections(
      subscriptions,
      WS_CONNECTION_POOL,
      schema,
      event.payload,
      graphqlContext
    );
  };

async function publishToConnections(
  subscriptions: Subscription[],
  WS_CONNECTION_POOL: DurableObjectNamespace,
  schema: GraphQLSchema,
  eventPayload: any,
  graphqlContext: any
) {
  log("Publishing to", subscriptions.length, "subscriptions");
  // group subscriptions by connection pool
  const connectionPoolSubscriptionsMap = groupBy(
    subscriptions,
    (sub) => sub.connectionPoolId
  );
  log(
    "Grouped into",
    Object.keys(connectionPoolSubscriptionsMap).length,
    "pools"
  );
  // promises of sent subscription messages
  const promises = Object.entries(connectionPoolSubscriptionsMap).map(
    async ([connectionPoolId, subscriptions]) => {
      const messagesAndConnectionIds = await Promise.all(
        subscriptions.map(async (sub) => {
          // execution of subscription with payload as the root (can be modified within the resolve callback defined in schema)
          // will return the payload as is by default
          const payload = await execute({
            schema: schema,
            document: parse(sub.subscription.query),
            rootValue: eventPayload,
            contextValue: graphqlContext,
            variableValues: sub.subscription.variables,
            operationName: sub.subscription.operationName,
          });

          // transform it into ws message (id is not specific to connection but to subscription)
          const message: NextMessage = {
            id: sub.id,
            type: MessageType.Next,
            payload,
          };

          return { message, connectionId: sub.connectionId };
        })
      );
      // request to already existing DO
      const stubId = WS_CONNECTION_POOL.idFromString(connectionPoolId);
      const stub = WS_CONNECTION_POOL.get(stubId);
      await stub.fetch(
        `https://ws-connection-durable-object.internal/publish`,
        {
          method: "POST",
          body: JSON.stringify(messagesAndConnectionIds),
          headers: { "content-type": "application/json" },
        }
      );
    }
  );
  return await Promise.all(promises);
}
