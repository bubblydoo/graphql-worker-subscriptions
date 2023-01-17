const traverse = (
  obj: any,
  cb: (path: (string | number)[], value: any) => void,
  path: (string | number)[] = []
) => {
  for (const k in obj) {
    const v = obj[k];
    const kWithType = Array.isArray(obj) ? +k : k;
    if (typeof v === "object") {
      traverse(v, cb, [...path, kWithType]);
    } else {
      cb([...path, kWithType], v);
    }
  }
};

const filterObjectToSqliteClauses = (obj: any) => {
  const whereClauses: string[] = [];
  const binds: string[] = [];

  traverse(obj, (path, value) => {
    const pathString = path.reduce(
      (p, c) => (typeof c === "number" ? `${p}[${c}]` : `${p}.${c}`),
      "$"
    );
    whereClauses.push(`json_extract(filter, '${pathString}') = ?`);
    binds.push(value);
  });

  return { whereClauses, binds };
};

const getQuerySubscriptionsSql = (
  dbName: string,
  topic: string,
  filter: any
) => {
  const { whereClauses, binds } = filterObjectToSqliteClauses(filter);
  const allWhereClauses = [`topic = ?`, ...whereClauses];

  return {
    sql: `SELECT * FROM ${dbName} WHERE ${allWhereClauses.join(" AND ")}`,
    binds: [topic, ...binds],
  };
};

export const querySubscriptions = (
  db: D1Database,
  dbName: string,
  topic: string,
  filter: any
) => {
  const { sql, binds } = getQuerySubscriptionsSql(dbName, topic, filter);

  return db
    .prepare(sql)
    .bind(...binds)
    .all();
};