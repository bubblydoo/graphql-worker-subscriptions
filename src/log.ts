declare const DEBUG: boolean;

export const log =
  typeof DEBUG !== "undefined" && DEBUG
    ? console.log.bind(console, "[Subscriptions]")
    : () => undefined;
