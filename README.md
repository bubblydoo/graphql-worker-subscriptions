# Cloudflare Workers Topic-based GraphQL Subscriptions

This library uses Cloudflare Workers, Durable Objects and D1 to provide powerful topic-based GraphQL subscriptions.

Features:

- 👀 Easy to integrate with your existing GraphQL stack
- 🙌 Almost no setup
- 🔍 In-database JSON filtering
- 🗺 Publish from anywhere
- 🎹 Great typings

```ts
// app.ts
import { makeExecutableSchema } from "@graphql-tools/schema";
import { createYoga } from "graphql-yoga";
import {
  handleSubscriptions,
  createWsConnectionPoolClass,
  subscribe,
  DefaultPublishableContext,
  createDefaultPublishableContext,
} from "graphql-worker-subscriptions";

export interface ENV {
  WS_CONNECTION_POOL: DurableObjectNamespace;
  SUBSCRIPTIONS: D1Database;
}

export const schema = makeExecutableSchema<DefaultPublishableContext<ENV>>({
  typeDefs: /* GraphQL */ `
    type Greeting {
      greeting: String
    }
    type Query {
      ping: String
    }
    type Subscription {
      greetings(greeting: String): Greeting
    }
    type Mutation {
      greet(greeting: String!): String
    }
  `,
  resolvers: {
    Query: {
      ping: () => "pong",
    },
    Mutation: {
      greet: async (root, args, context, info) => {
        context.publish("GREETINGS", {
          greetings: { greeting: args.greeting },
        });
        return "ok";
      },
    },
    Subscription: {
      greetings: {
        subscribe: subscribe("GREETINGS", {
          filter: (root, args, context, info) => {
            return args.greeting
              ? { greetings: { greeting: args.greeting } }
              : {};
          },
        }),
      },
    },
  },
});

const settings = {
  schema,
  wsConnectionPool: (env: ENV) => env.WS_CONNECTION_POOL,
  subscriptionsDb: (env: ENV) => env.SUBSCRIPTIONS,
};

const yoga = createYoga<DefaultPublishableContext<ENV>>({
  schema,
  graphiql: {
    // Use WebSockets in GraphiQL
    subscriptionsProtocol: "WS",
  },
});

const baseFetch: ExportedHandlerFetchHandler<ENV> = (
  request,
  env,
  executionCtx
) =>
  yoga.handleRequest(
    request,
    createDefaultPublishableContext({
      env,
      executionCtx,
      ...settings,
    })
  );

const fetch = handleSubscriptions({ fetch: baseFetch, ...settings });

export default { fetch };

export const WsConnectionPool = createWsConnectionPoolClass(settings);
```

```toml
# wrangler.toml
[[migrations]]
new_classes = ["WsConnectionPool"]
tag = "v1"

[build]
# your build script
command = 'npm run build'

[[d1_databases]]
binding = "SUBSCRIPTIONS"
database_id = "877f1123-088e-43ed-8d4d-37e71c77157c"
database_name = "SUBSCRIPTIONS"
migrations_dir = "node_modules/graphql-worker-subscriptions/migrations"
preview_database_id = "877f1123-088e-43ed-8d4d-37e71c77157c"

[durable_objects]
bindings = [{name = "WS_CONNECTION_POOL", class_name = "WsConnectionPool"}]
```

### Deployment

```shell
# create db
wrangler d1 create SUBSCRIPTIONS
# apply migrations
wrangler d1 migrations apply SUBSCRIPTIONS
# publish
wrangler publish
```

### Local development

```shell
# create db
wrangler d1 create SUBSCRIPTIONS --local
# apply migrations
wrangler d1 migrations apply SUBSCRIPTIONS --local
# publish
wrangler dev
```

### Publishing from outside Cloudflare

You can use `POST /publish` on your Worker to publish events.

```shell
curl -X POST https://graphql-worker-subscriptions.bubblydoo.workers.dev/publish -H 'Content-Type: application/json' -d '{"topic": "GREETINGS", "payload":{"greetings": {"greeting": "hi!"}}}'
```

To disable this, pass `isAuthorized: () => false` to `handleSubscriptions`, or add custom authorization logic there.

### Pooling

To minimize Durable Objects costs, one Pool can manage many WebSocket connections.

There are 3 pooling options:
- `global`: There is 1 global Pool that manages all WebSocket connections.
- `colo`: There's 1 Pool per datacenter, based on [`request.cf.colo`](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties)
- `continent`: There's 1 Pool per continent, based on [`request.cf.continent`](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties) (default)
- `none`: Every connection uses its own Pool (its own Durable Object)

You can also pass a custom pooling function to `handleSubscriptions`.

### Expected costs

Considering you used up all your included credits in the Paid Plan:

One Pool (one Durable Object) is always charged at 128MB and will not sleep unless all its WebSockets are closed. Having one Pool run for 1 month (2600000 seconds) will be about 325000GBs, which would (at the time of writing) cost $4.0625. With a global pool, that would also be your maximum cost.

1 new connection causes:
- 1 D1 query
- 1 Durable Object request (fetch)

1 GraphQL subscription causes:
- 1 Durable Object fetch (incoming WebSocket message)

1 publish causes:
- 1 D1 query
- 1 Durable Object request (fetch) per Pool that has a connection that the publish will send to

If you would publish a message every second for 1 month to 100 WebSockets in 1 Pool, this would cause only 1 D1 query and 1 Durable Object request per second, and would cost you about $0.648/month. D1 is still free for now.

According to the pricing docs, there is no charge for outgoing WebSocket messages.

### Internal details

Subscriptions are stored inside D1.

The D1 database has 4 columns:

- id (websocket message id that will be matched with the client-side subscription, a string)
- connectionId (a Durable Object id, a string)
- subscription (the query the subscriber has requested, a JSON string)
- topic (a string)
- filter (the filter against which payloads are checked, a JSON string or null)

The Durable Object has a reference to the WebSocket, which can then be used to publish data to.

Filters are compared in-database using:

```sql
SELECT * FROM Subscriptions WHERE topic = ?1 AND (filter is null OR json_patch(?2, filter) = ?2);
```

with `?1: topic and ?2: payload`.

### Contributing

Check out this repo, then run:

```shell
yarn

yarn build
```

Then link the package to your project (you can take the example as start).

### Bundling issue

Due to the dual package hazard in GraphQL (see [this issue](https://github.com/graphql/graphql-js/pull/3617)) you might get `duplicate "graphql" modules cannot be used at the same time` errors.

This is because both the CJS and ESM version of `graphql` are loaded.

In that case, you might have to bundle yourself. When using `esbuild`, the option `--resolve-extensions=.mts,.mjs,.ts,.js,.json` works. See the build-app script in package.json for an example.

### Credits 🙏

This project was inspired by [cloudflare-worker-graphql-ws-template](https://github.com/enisdenjo/cloudflare-worker-graphql-ws-template) and [subscriptionless](https://github.com/andyrichardson/subscriptionless).
