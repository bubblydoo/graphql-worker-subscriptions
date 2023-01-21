import { parse } from "graphql";
import type { SubscribePseudoIterable, PubSubEvent } from "./types";
import {
  buildExecutionContext,
  ExecutionContext,
} from "graphql/execution/execute";
import { getResolverAndArgs } from "./getResolverAndArgs";
import { GraphQLSchema } from "graphql";
import { SubscribeMessage } from "graphql-ws";
import { Subscription } from "./subscription";

export const resolveSubscription = async (
  message: SubscribeMessage,
  schema: GraphQLSchema,
  connectionId: string,
  connectionPoolId: string
): Promise<Subscription> => {
  // extract subscription related values based on schema
  const execContext = buildExecutionContext({
    schema,
    document: parse(message.payload.query),
    variableValues: message.payload.variables,
    operationName: message.payload.operationName,
  }) as ExecutionContext;
  const { field, root, args, context, info } = getResolverAndArgs({
    execContext,
  });

  if (!field) {
    throw new Error("No field");
  }

  const { topic, filter: filterFn } =
    field.subscribe as SubscribePseudoIterable<PubSubEvent>;
  // execute filter callback if defined (return filter data saved to D1)
  const filter =
    typeof filterFn === "function"
      ? filterFn(root, args, context, info)
      : filterFn;

  const subscription: Subscription = {
    id: message.id,
    connectionPoolId,
    connectionId,
    subscription: message.payload,
    topic,
    filter,
  };

  return subscription;
};
