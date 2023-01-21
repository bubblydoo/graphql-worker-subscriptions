import {
  handleProtocols,
  makeServer,
  MessageType,
  stringifyMessage,
  SubscribeMessage,
} from "graphql-ws";
import { GraphQLSchema } from "graphql";
import type { WebSocket } from "@cloudflare/workers-types";
import { log } from "./log";

/**
 * Accept and handle websocket connection with `graphql-ws`.
 * 
 * Handles messages, close, ping-pong
 */
export async function useWebsocket(
  socket: WebSocket,
  request: Request,
  protocol: ReturnType<typeof handleProtocols>,
  schema: GraphQLSchema,
  context: Record<string, any>,
  createSubscription: (message: SubscribeMessage) => Promise<void>,
  deleteSubscription: () => Promise<void>
) {
  // configure and make server
  const server = makeServer({
    schema,
    context,
  });

  // accept socket to begin
  socket.accept();

  // subprotocol pinger because WS level ping/pongs are not be available
  let pinger: any, pongWait: any;
  function ping() {
    // READY_STATE_OPEN value
    if (socket.readyState === 1) {
      // send the subprotocol level ping message
      socket.send(stringifyMessage({ type: MessageType.Ping }));

      // wait for the pong for 6 seconds and then terminate
      pongWait = setTimeout(() => {
        clearInterval(pinger);
        socket.close();
      }, 6000);
    }
  }

  // ping the client on an interval every 12 seconds
  pinger = setInterval(() => ping(), 12000);
  if (!protocol) {
    throw new Error("invalid_ws_protocol");
  }
  // use the server
  const callOnClosed = server.opened(
    {
      protocol, // will be validated
      send: (data) => {
        log("Sending to connection", data);
        socket.send(data);
      },
      close: (code, reason) => {
        log("Closing connection", code);

        if (code === 4400) console.error(reason);
        socket.close(code, reason);
      },
      onMessage: (cb) =>
        socket.addEventListener("message", async (event) => {
          try {
            // parsing payload so type can be checked
            const data = JSON.parse(event.data.valueOf() as any);

            if (data.type === "subscribe") {
              // handle subscribe with specific handler
              await createSubscription(data);
            } else {
              // or just use default handler
              cb(JSON.stringify(data));
            }
          } catch (err) {
            console.error(err);
            socket.close(1011, (err as any).message);
          }
        }),
      // pong received, clear termination timeout
      onPong: () => clearTimeout(pongWait),
    },
    // pass values to the `extra` field in the context
    { socket, request }
  );

  // notify server that the socket closed and stop the pinger
  socket.addEventListener("close", (async (code: number, reason: any) => {
    clearTimeout(pongWait);
    clearInterval(pinger);

    // this callback is called whenever the socket closes, so deleting from D1 only here is enough

    await deleteSubscription();

    callOnClosed(code, reason);
  }) as any);
}
