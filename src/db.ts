import { log } from "./log";
import { Subscription } from "./subscription";

const tableName = "Subscriptions";

/** Creates a subscription in the database */
export const insertSubscription = async (
  subscriptionsDb: D1Database,
  subscription: Subscription
) => {
  // write subscription to D1
  await subscriptionsDb
    .prepare(
      `INSERT INTO ${tableName}(id,connectionId,connectionPoolId,subscription,topic,filter) VALUES(?,?,?,?,?,?)`
    )
    .bind(
      subscription.id,
      subscription.connectionId,
      subscription.connectionPoolId,
      JSON.stringify(subscription.subscription),
      subscription.topic,
      subscription.filter === null || subscription.filter === undefined
        ? null
        : JSON.stringify(subscription.filter)
    )
    .run();
};

export const deleteSubscription = async (
  subscriptionsDb: D1Database,
  connectionId: string
) => {
  log("Deleting connection from db", connectionId);
  await subscriptionsDb
    .prepare(`DELETE FROM ${tableName} WHERE connectionId = ?`)
    .bind(connectionId)
    .run();
};

/**
 * Query all subscriptions in the db by topic and filter
 */
export const querySubscriptions = async (
  subscriptionsDb: D1Database,
  topic: string,
  filter: any
) => {
  log("Querying db", topic, filter);

  const sql = `SELECT * FROM ${tableName} WHERE topic = ?1 AND (filter is null OR json_patch(?2, filter) = ?2)`;
  const binds = [topic, JSON.stringify(filter)];

  const { results } = await subscriptionsDb
    .prepare(sql)
    .bind(...binds)
    .all();

  const subscriptions = results?.map((res: any) => ({
    ...res,
    filter: typeof res.filter === "string" ? JSON.parse(res.filter) : undefined,
    subscription:
      typeof res.subscription === "string"
        ? JSON.parse(res.subscription)
        : undefined,
  })) as Subscription[];

  return subscriptions;
};
