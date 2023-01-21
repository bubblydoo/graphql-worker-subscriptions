import { IFieldResolver } from "@graphql-tools/utils";
import { GraphQLResolveInfo } from "graphql";

export type MaybePromise<T> = T | Promise<T>;

export type SubscriptionFilter<
  TSource = any,
  TArgs = Record<string, any>,
  TContext = any,
  TReturn extends Record<string, any> = Record<string, any>
> = (
  root: TSource,
  args: TArgs,
  context: TContext,
  info: GraphQLResolveInfo
) => MaybePromise<Partial<TReturn> | void>;

export interface SubscribePseudoIterable<
  TEvent extends PubSubEvent,
  TSource = any,
  TArgs = Record<string, any>,
  TContext = any
> extends IFieldResolver<TSource, TContext, TArgs, TEvent["payload"]> {
  (
    root: TSource,
    args: TArgs,
    context: TContext,
    info: GraphQLResolveInfo
  ): AsyncGenerator<TEvent, never, unknown>;
  topic: string;
  filter?: SubscriptionFilter<TSource, TArgs, TContext, TEvent["payload"]>;
  // onSubscribe?: (
  //   ...args: TSubscribeArgs
  // ) => MaybePromise<void | GraphQLError[]>;
  // onAfterSubscribe?: (...args: TSubscribeArgs) => MaybePromise<void>;
  // onComplete?: (...args: TSubscribeArgs) => MaybePromise<void>;
}


export interface PubSubEvent {
  topic: string;
  payload: Record<string, any>;
}

export type CreateContextFn<Env extends {} = {}, TExecutionContext = ExecutionContext> = (
  request: Request,
  env: Env,
  executionContext: TExecutionContext
) => MaybePromise<Record<string, any>>;

export interface SubscribeOptions<
  // TSubscribeArgs extends SubscribeArgs = SubscribeArgs
  TEvent extends PubSubEvent,
  TSource = any,
  TArgs = Record<string, any>,
  TContext = any
> {
  /**
   * An object or a function that returns an object that will be matched against the `payload` of a published event. If the payload's field equals the filter the subscription will receive the event. If the payload is missing the filter's field the subscription will receive the event.
   */
  filter?: SubscriptionFilter<TSource, TArgs, TContext, TEvent["payload"]>;
  // /**
  //  * Gets resolver arguments to perform work before a subscription is allowed. This is useful for checking arguments or
  //  * validating permissions. Return an array of GraphqlErrors if you don't want the subscription to subscribe.
  //  */
  // onSubscribe?: (...args: TSubscribeArgs) => MaybePromise<void | GraphQLError[]>
  // /**
  //  * Gets resolver arguments to perform work after a subscription saved. This is useful for sending out initial events.
  //  */
  // onAfterSubscribe?: (...args: TSubscribeArgs) => MaybePromise<void>
  // /**
  //  * Called at least once. Gets resolver arguments to perform work after a subscription has ended. This is useful for bookkeeping or logging. This callback will fire
  //  *
  //  * If the client disconnects, sends a `complete` message, or the server sends a `complete` message via the pub/sub system. Because of the nature of aws lambda, it's possible for a client to send a "complete" message immediately disconnect and have those events execute on lambda out of order. Which why this function can be called up to twice.
  //  */
  // onComplete?: (...args: TSubscribeArgs) => MaybePromise<void>
}
