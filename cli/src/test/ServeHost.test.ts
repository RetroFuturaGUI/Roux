import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { Core } from "@retrofuturagui/roux-core";
import { JsonRpcErrorCode, type JsonRpcFailure } from "@retrofuturagui/roux-protocol";
import { ServeHost } from "../ServeHost.js";

const token = "test-token";
let folder = "";
let core: Core;
let host: ServeHost;

before(async () =>
{
    //A file next to the UI's folder, which must never be served
    folder = mkdtempSync(path.join(os.tmpdir(), "roux-serve-"));
    writeFileSync(path.join(folder, "secret.txt"), "outside");

    const uiDirectory = path.join(folder, "ui");
    mkdirSync(uiDirectory);
    writeFileSync(path.join(uiDirectory, "index.html"), "<!DOCTYPE html><title>Roux</title>");
    writeFileSync(path.join(uiDirectory, "style.css"), "body { }");

    core = new Core();
    host = new ServeHost(core, { uiDirectory: uiDirectory, token: token });
    await host.start();
});

after(async () =>
{
    await host.stop();
    rmSync(folder, { recursive: true, force: true });
});

const cookie = "roux_token=" + token;

//A raw request, since fetch won't let a test send another Host header or an unencoded path
function rawGet(pathname: string, headers: http.OutgoingHttpHeaders): Promise<number>
{
    return new Promise((resolve, reject) =>
    {
        const request = http.request(host.origin + pathname, { headers: headers }, response =>
        {
            response.resume();
            resolve(response.statusCode ?? 0);
        });
        request.on("error", reject);
        request.end();
    });
}

test("refuses everything without the token", async () =>
{
    assert.equal((await fetch(host.origin + "/")).status, 403);
    assert.equal((await fetch(host.origin + "/?token=wrong")).status, 403);
    assert.equal((await fetch(host.origin + "/rpc", { method: "POST", body: "{}" })).status, 403);
});

test("swaps the token in the address for a cookie", async () =>
{
    const response = await fetch(host.startUrl, { redirect: "manual" });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    assert.match(response.headers.get("set-cookie") ?? "", /^roux_token=test-token; HttpOnly; SameSite=Strict; Path=\//);
});

test("serves the UI's files with the cookie, and nothing outside its folder", async () =>
{
    const page = await fetch(host.origin + "/", { headers: { cookie: cookie } });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /^text\/html/);
    assert.match(page.headers.get("content-security-policy") ?? "", /script-src 'self'/);

    const style = await fetch(host.origin + "/style.css", { headers: { cookie: cookie } });
    assert.match(style.headers.get("content-type") ?? "", /^text\/css/);

    assert.equal(await rawGet("/../secret.txt", { cookie: cookie }), 404);
    assert.equal(await rawGet("/%2e%2e/secret.txt", { cookie: cookie }), 404);
    assert.equal((await fetch(host.origin + "/missing.js", { headers: { cookie: cookie } })).status, 404);
});

test("refuses another host name, as a page using DNS rebinding would send", async () =>
{
    assert.equal(await rawGet("/", { cookie: cookie, host: "attacker.example" }), 403);
});

test("answers JSON-RPC requests, and refuses them from another origin", async () =>
{
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nothing.here" });

    const answer = await fetch(host.origin + "/rpc", { method: "POST", body: body, headers: { cookie: cookie, origin: host.origin } });
    assert.equal(answer.status, 200);
    const failure = await answer.json() as JsonRpcFailure;
    assert.equal(failure.error.code, JsonRpcErrorCode.MethodNotFound);

    const foreign = await fetch(host.origin + "/rpc", { method: "POST", body: body, headers: { cookie: cookie, origin: "https://attacker.example" } });
    assert.equal(foreign.status, 403);
});

test("sends the core's events as Server-Sent Events", async () =>
{
    const controller = new AbortController();
    const response = await fetch(host.origin + "/events", { headers: { cookie: cookie }, signal: controller.signal });
    assert.match(response.headers.get("content-type") ?? "", /^text\/event-stream/);

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";

    core.server.emit("setup.checkStarted", { component: "CMake" });

    while (!received.includes("setup.checkStarted"))
    {
        const { value, done } = await reader.read();

        if (done)
            break;

        received += decoder.decode(value);
    }

    controller.abort();
    assert.match(received, /data: \{"jsonrpc":"2.0","method":"setup.checkStarted","params":\{"component":"CMake"\}\}/);
});

test("lets no page frame it, and with --vscode only VS Code's, with a cookie a frame of another site keeps", async () =>
{
    const page = await fetch(host.origin + "/", { headers: { cookie: cookie } });
    assert.match(page.headers.get("content-security-policy") ?? "", /frame-ancestors 'none'$/);

    const vscodeHost = new ServeHost(core, { uiDirectory: path.join(folder, "ui"), token: token, forVSCode: true });
    await vscodeHost.start();

    try
    {
        const unlock = await fetch(vscodeHost.startUrl, { redirect: "manual" });
        assert.match(unlock.headers.get("set-cookie") ?? "", /^roux_token=test-token; HttpOnly; SameSite=None; Secure; Partitioned; Path=\//);

        const framed = await fetch(vscodeHost.origin + "/", { headers: { cookie: cookie } });
        assert.match(framed.headers.get("content-security-policy") ?? "", /frame-ancestors 'self' vscode-webview: vscode-file:$/);

        const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "nothing.here" });
        const foreign = await fetch(vscodeHost.origin + "/rpc", { method: "POST", body: body, headers: { cookie: cookie, origin: "vscode-webview://anything" } });
        assert.equal(foreign.status, 403, "requests still have to come from the page itself");
    }
    finally
    {
        await vscodeHost.stop();
    }
});