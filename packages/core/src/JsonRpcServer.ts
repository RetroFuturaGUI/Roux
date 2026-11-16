import
{
    JsonRpcErrorCode,
    type EventName,
    type Events,
    type JsonRpcId,
    type JsonRpcNotification,
    type JsonRpcResponse,
    type MethodName,
    type Methods
} from "@retrofuturagui/roux-protocol";

export type MethodHandler<M extends MethodName> = (params: Methods[M]["params"]) => Promise<Methods[M]["result"]>;

//Receives the core's events, for example one browser connection
export type EventSink = (notification: JsonRpcNotification) => void;

//Thrown by a handler for parameters it can't use. It is answered with InvalidParams instead of InternalError
export class InvalidParamsError extends Error
{
}

//Dispatches JSON-RPC 2.0 requests to the core's methods and sends its events out, whatever the transport is
export class JsonRpcServer
{
    private readonly _handlers = new Map<string, (params: unknown) => Promise<unknown>>();
    private readonly _eventSinks = new Set<EventSink>();

    register<M extends MethodName>(method: M, handler: MethodHandler<M>): void
    {
        this._handlers.set(method, handler as (params: unknown) => Promise<unknown>);
    }

    //Returns the function that removes the sink again
    addEventSink(sink: EventSink): () => void
    {
        this._eventSinks.add(sink);
        return () => { this._eventSinks.delete(sink); };
    }

    emit<E extends EventName>(event: E, params: Events[E]): void
    {
        const notification: JsonRpcNotification = { jsonrpc: "2.0", method: event, params: params };

        for (const sink of this._eventSinks)
        {
            try
            {
                sink(notification);
            }
            catch
            {
                //A sink that fails
            }
        }
    }

    //Answers text as it arrives from a transport. Text that isn't JSON gets ParseError
    async handleText(text: string): Promise<JsonRpcResponse | undefined>
    {
        let message: unknown;

        try
        {
            message = JSON.parse(text);
        }
        catch
        {
            return failure(null, JsonRpcErrorCode.ParseError, "The message isn't valid JSON.");
        }

        return this.handle(message);
    }

    //Answers one message. A notification (a request without an id) gets no answer, so undefined comes back
    async handle(message: unknown): Promise<JsonRpcResponse | undefined>
    {
        if (!isRecord(message) || "2.0" !== message.jsonrpc || "string" !== typeof message.method)
            return failure(validId(message), JsonRpcErrorCode.InvalidRequest, "Not a JSON-RPC 2.0 request.");

        const hasId = "id" in message;
        const id = validId(message);

        if (hasId && null === id)
            return failure(null, JsonRpcErrorCode.InvalidRequest, "The id must be a number or a string.");

        const handler = this._handlers.get(message.method);

        if (!handler)
            return hasId ? failure(id, JsonRpcErrorCode.MethodNotFound, "No method " + message.method + ".") : undefined;

        try
        {
            const result = await handler(message.params ?? {});
            return hasId ? { jsonrpc: "2.0", id: id as JsonRpcId, result: result } : undefined;
        }
        catch (error)
        {
            if (!hasId)
                return undefined;

            const code = error instanceof InvalidParamsError ? JsonRpcErrorCode.InvalidParams : JsonRpcErrorCode.InternalError;
            return failure(id, code, error instanceof Error ? error.message : String(error));
        }
    }
}

function isRecord(value: unknown): value is Record<string, unknown>
{
    return "object" === typeof value && null !== value && !Array.isArray(value);
}

//The message's id when it is one JSON-RPC allows, else null
function validId(message: unknown): JsonRpcId | null
{
    if (!isRecord(message))
        return null;

    const id = message.id;
    return "number" === typeof id || "string" === typeof id ? id : null;
}

function failure(id: JsonRpcId | null, code: number, message: string): JsonRpcResponse
{
    return { jsonrpc: "2.0", id: id, error: { code: code, message: message } };
}