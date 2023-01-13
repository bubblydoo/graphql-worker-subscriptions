import { parse } from "graphql";
import type { SubscribePseudoIterable, PubSubEvent } from "../types";
import { ENV } from "..";
import {
  buildExecutionContext,
  ExecutionContext,
} from "graphql/execution/execute";
import { getResolverAndArgs } from "../utils/getResolverAndArgs";
import { makeExecutableSchema } from "@graphql-tools/schema";
import { GraphQLSchema } from "graphql";
export const subscribe = (
  connectionId: string,
  schema: GraphQLSchema,
  data: any,
  state: DurableObjectState,
  env: ENV
) => {
  const execContext = buildExecutionContext({
    schema,
    document: parse(data.payload.query),
    variableValues: data.payload.variables,
    operationName: data.payload.operationName,
  }) as ExecutionContext;
  const { field, root, args, context, info } = getResolverAndArgs({
    execContext,
  });

  if (!field) {
    throw new Error("No field");
  }

  const { topic, filter, onSubscribe, onAfterSubscribe } =
    field.subscribe as SubscribePseudoIterable<PubSubEvent>;
  const filterData =
    typeof filter === "function" ? filter(root, args, context, info) : filter;

  state.waitUntil(
    env.SUBSCRIPTIONS_DEV.prepare(
      "INSERT INTO Subscriptions(connectionId, subscription, topic, filter) VALUES(?,?,?,?);"
    )
      .bind(
        connectionId,
        JSON.stringify({
          query: data.payload.query,
          variables: data.payload.variables,
          operationName: data.payload.operationName,
        }),
        topic,
        JSON.stringify(filterData)
      )
      .run()
      .then()
  );
};
