import { GraphQLSchema } from "graphql";
import { createPublishFn } from "./createPublishFn";

/** Publish a payload to a topic. Automatically using waitUntil. */
export type ContextPublishFn = (topic: string, payload: any) => void | Promise<void>;

export type DefaultPublishableContext<Env extends {} = {}, TExecutionContext = ExecutionContext> = {
  env: Env;
  executionCtx: TExecutionContext;
  publish: ContextPublishFn;
};

/**
 * Creates a context with 3 keys: `env`, `executionCtx`, and `publish`.
 * The context used to resolve the subscriptions on publish also has these 3 keys.
 * If you want to change the context, you will have to copy this function code.
 */
export function createDefaultPublishableContext<Env extends {} = {}, TExecutionContext extends ExecutionContext | undefined  = ExecutionContext>({
  env,
  executionCtx,
  schema,
  wsConnectionPool,
  subscriptionsDb,
}: {
  env: Env;
  executionCtx: TExecutionContext
  schema: GraphQLSchema;
  wsConnectionPool: (env: Env) => DurableObjectNamespace;
  subscriptionsDb: (env: Env) => D1Database;
}) {
  const publishableCtx: DefaultPublishableContext<Env, TExecutionContext> = {
    env,
    executionCtx,
    publish: (topic, payload) => {
      const publishFn = createPublishFn(
        wsConnectionPool(env),
        subscriptionsDb(env),
        schema,
        publishableCtx
      );

      const promise = publishFn({ topic, payload });

      // this would happen inside a Durable Object
      if (!executionCtx) return promise;
      
      executionCtx?.waitUntil(promise);
    },
  };
  return publishableCtx;
}