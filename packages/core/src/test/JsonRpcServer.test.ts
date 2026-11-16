import assert from "node:assert/strict";
import { test } from "node:test";
import { JsonRpcErrorCode, type JsonRpcNotification } from "@retrofuturagui/roux-protocol";
import { InvalidParamsError, JsonRpcServer } from "../JsonRpcServer.js";

function serverWithChecks(): JsonRpcServer
{
    const server = new JsonRpcServer();
    server.register("setup.runChecks", async () => ({ checks: [] }));
    return server;
}

test("answers a request with its result and id", async () =>
{
    const response = await serverWithChecks().handle({ jsonrpc: "2.0", id: 7, method: "setup.runChecks" });
    assert.deepEqual(response, { jsonrpc: "2.0", id: 7, result: { checks: [] } });
});

test("gives a notification no answer", async () =>
{
    assert.equal(await serverWithChecks().handle({ jsonrpc: "2.0", method: "setup.runChecks" }), undefined);
});

test("answers an unknown method with MethodNotFound", async () =>
{
    const response = await serverWithChecks().handle({ jsonrpc: "2.0", id: "a", method: "nothing.here" });
    assert.ok(response && "error" in response);
    assert.equal(response.error.code, JsonRpcErrorCode.MethodNotFound);
    assert.equal(response.id, "a");
});

test("answers text that isn't JSON with ParseError", async () =>
{
    const response = await serverWithChecks().handleText("{ not json");
    assert.ok(response && "error" in response);
    assert.equal(response.error.code, JsonRpcErrorCode.ParseError);
    assert.equal(response.id, null);
});

test("answers a message that isn't JSON-RPC 2.0 with InvalidRequest", async () =>
{
    for (const message of [[], 5, { id: 1, method: "setup.runChecks" }, { jsonrpc: "2.0", id: { nested: true }, method: "setup.runChecks" }])
    {
        const response = await serverWithChecks().handle(message);
        assert.ok(response && "error" in response, JSON.stringify(message));
        assert.equal(response.error.code, JsonRpcErrorCode.InvalidRequest);
    }
});

test("answers a failing handler with InternalError, and bad parameters with InvalidParams", async () =>
{
    const server = new JsonRpcServer();
    server.register("setup.runChecks", async () => { throw new Error("broken"); });

    const internal = await server.handle({ jsonrpc: "2.0", id: 1, method: "setup.runChecks" });
    assert.ok(internal && "error" in internal);
    assert.equal(internal.error.code, JsonRpcErrorCode.InternalError);
    assert.equal(internal.error.message, "broken");

    server.register("setup.runChecks", async () => { throw new InvalidParamsError("no such component"); });

    const invalid = await server.handle({ jsonrpc: "2.0", id: 2, method: "setup.runChecks" });
    assert.ok(invalid && "error" in invalid);
    assert.equal(invalid.error.code, JsonRpcErrorCode.InvalidParams);
});

test("sends events to every sink until it is removed, even when one throws", () =>
{
    const server = new JsonRpcServer();
    const received: JsonRpcNotification[] = [];

    server.addEventSink(() => { throw new Error("closed connection"); });
    const remove = server.addEventSink(notification => received.push(notification));

    server.emit("setup.checkStarted", { component: "CMake" });
    remove();
    server.emit("setup.checkStarted", { component: "Git" });

    assert.deepEqual(received, [{ jsonrpc: "2.0", method: "setup.checkStarted", params: { component: "CMake" } }]);
});
