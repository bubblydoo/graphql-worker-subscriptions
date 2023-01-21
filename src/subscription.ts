import { SubscribePayload } from "graphql-ws";

export interface Subscription {
  id: string;
  connectionPoolId: string;
  connectionId: string;
  filter?: any;
  subscription: SubscribePayload;
  topic: string;
}
