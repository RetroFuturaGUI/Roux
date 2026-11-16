import { randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream, statSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import type { Core } from "@retrofuturagui/roux-core";

export interface ServeOptions
{
    uiDirectory: string; //the folder holding index.html
    port?: number; //0 or none: a free port chosen by the system
    token?: string; //none: a new random one
    forVSCode?: boolean; //lets VS Code's Simple Browser show the page (see contentSecurityPolicy)
}

const cookieName = "roux_token";
const maximumBodyBytes = 1024 * 1024;
const heartbeatMs = 15000;

const contentTypes: Record<string, string> =
{
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".woff2": "font/woff2"
};

//The page may load only its own files and talk only to this server, and no other page may frame it.
//For VS Code (roux serve --vscode), VS Code's own pages opens. Its Simple Browser shows a page in a frame of a webview
//(vscode-webview:), inside the workbench (vscode-file:). The cookie then has to be one a frame of another site keeps:
//SameSite=None, which the browser sends to this server from any site. Requests stay safe through the token, the origin
//every POST is checked against and the host name; reading the event stream from another site is refused by the browser.
function contentSecurityPolicy(forVSCode: boolean): string
{
    const frameAncestors = forVSCode ? "'self' vscode-webview: vscode-file:" : "'none'";
    return "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors " + frameAncestors;
}

function cookieAttributes(forVSCode: boolean): string
{
    return forVSCode ? "HttpOnly; SameSite=None; Secure; Partitioned; Path=/" : "HttpOnly; SameSite=Strict; Path=/";
}

//Browser mode: serves the UI and carries the core's messages over HTTP, on 127.0.0.1 only. Requests go to POST /rpc, and
//events come from GET /events as Server-Sent Events. Every request needs the token. The start URL hands it to the browser
//as a cookie that other websites can't send, so neither another website nor another machine can reach the core, which
//can start builds and programs.
export class ServeHost
{
    readonly token: string;
    private readonly _core: Core;
    private readonly _uiDirectory: string;
    private readonly _requestedPort: number;
    private readonly _forVSCode: boolean;
    private readonly _server: http.Server;
    private readonly _eventStreams = new Set<http.ServerResponse>();
    private _port = 0;

    constructor(core: Core, options: ServeOptions)
    {
        this._core = core;
        this._uiDirectory = path.resolve(options.uiDirectory);
        this._requestedPort = options.port ?? 0;
        this._forVSCode = options.forVSCode ?? false;
        this.token = options.token ?? randomBytes(24).toString("base64url");
        this._server = http.createServer((request, response) =>
        {
            this.handle(request, response).catch(error =>
            {
                if (!response.headersSent)
                    send(response, 500, "text/plain; charset=utf-8", error instanceof Error ? error.message : String(error));
                else
                    response.destroy();
            });
        });
    }

    get origin(): string
    {
        return "http://127.0.0.1:" + this._port;
    }

    //The address to open: the page, with the token that unlocks it
    get startUrl(): string
    {
        return this.origin + "/?token=" + this.token;
    }

    start(): Promise<string>
    {
        return new Promise((resolve, reject) =>
        {
            this._server.once("error", reject);
            this._server.listen(this._requestedPort, "127.0.0.1", () =>
            {
                this._server.off("error", reject);
                this._port = (this._server.address() as AddressInfo).port;
                resolve(this.startUrl);
            });
        });
    }

    stop(): Promise<void>
    {
        for (const stream of this._eventStreams)
            stream.end();

        this._eventStreams.clear();

        return new Promise(resolve =>
        {
            this._server.close(() => resolve());
            this._server.closeAllConnections();
        });
    }

    private async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>
    {
        const url = new URL(request.url ?? "/", this.origin);

        //A page on another site that resolves its own name to 127.0.0.1 still sends its own name as the host
        if (!this.isOwnHost(request.headers.host))
        {
            send(response, 403, "text/plain; charset=utf-8", "Wrong host.");
            return;
        }

        if ("/" === url.pathname && url.searchParams.has("token"))
        {
            this.unlock(url.searchParams.get("token") ?? "", response);
            return;
        }

        if (!this.hasToken(request))
        {
            send(response, 403, "text/plain; charset=utf-8", "Open the address that roux serve printed.");
            return;
        }

        if ("/rpc" === url.pathname)
        {
            await this.answerRequest(request, response);
            return;
        }

        if ("/events" === url.pathname)
        {
            this.openEventStream(request, response);
            return;
        }

        this.serveFile(url.pathname, request, response);
    }

    //Swaps the token in the address for a cookie, so it leaves the address bar and the page's files load with it
    private unlock(token: string, response: http.ServerResponse): void
    {
        if (!this.isToken(token))
        {
            send(response, 403, "text/plain; charset=utf-8", "Wrong token.");
            return;
        }

        response.writeHead(302,
        {
            "Location": "/",
            "Set-Cookie": cookieName + "=" + this.token + "; " + cookieAttributes(this._forVSCode),
            "Cache-Control": "no-store"
        });
        response.end();
    }

    private async answerRequest(request: http.IncomingMessage, response: http.ServerResponse): Promise<void>
    {
        if ("POST" !== request.method)
        {
            send(response, 405, "text/plain; charset=utf-8", "Requests are POSTed.");
            return;
        }

        //Browsers send the page's origin with every POST; another site's page would send its own
        const origin = request.headers.origin;

        if (undefined !== origin && origin !== this.origin && origin !== this.origin.replace("127.0.0.1", "localhost"))
        {
            send(response, 403, "text/plain; charset=utf-8", "Wrong origin.");
            return;
        }

        const body = await readBody(request);

        if (undefined === body)
        {
            send(response, 413, "text/plain; charset=utf-8", "The request is too large.");
            return;
        }

        const answer = await this._core.server.handleText(body);

        if (undefined === answer)
        {
            response.writeHead(204);
            response.end();
            return;
        }

        send(response, 200, "application/json; charset=utf-8", JSON.stringify(answer));
    }

    private openEventStream(request: http.IncomingMessage, response: http.ServerResponse): void
    {
        response.writeHead(200,
        {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-store",
            "Connection": "keep-alive",
            "X-Content-Type-Options": "nosniff"
        });
        response.write("retry: 2000\n\n");

        const removeSink = this._core.server.addEventSink(notification =>
        {
            response.write("data: " + JSON.stringify(notification) + "\n\n");
        });

        //A comment line now and then keeps proxies and the browser from closing a quiet stream
        const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), heartbeatMs);

        this._eventStreams.add(response);
        request.on("close", () =>
        {
            clearInterval(heartbeat);
            removeSink();
            this._eventStreams.delete(response);
        });
    }

    private serveFile(pathname: string, request: http.IncomingMessage, response: http.ServerResponse): void
    {
        if ("GET" !== request.method && "HEAD" !== request.method)
        {
            send(response, 405, "text/plain; charset=utf-8", "Files are only read.");
            return;
        }

        let relative: string;

        try
        {
            relative = decodeURIComponent("/" === pathname ? "/index.html" : pathname);
        }
        catch
        {
            send(response, 400, "text/plain; charset=utf-8", "Bad path.");
            return;
        }

        const file = path.resolve(this._uiDirectory, "." + relative);

        //Nothing outside the UI's folder is served, however the path is written
        if (file !== this._uiDirectory && !file.startsWith(this._uiDirectory + path.sep))
        {
            send(response, 404, "text/plain; charset=utf-8", "Not found.");
            return;
        }

        let size = 0;

        try
        {
            const stat = statSync(file);

            if (!stat.isFile())
                throw new Error("not a file");

            size = stat.size;
        }
        catch
        {
            send(response, 404, "text/plain; charset=utf-8", "Not found.");
            return;
        }

        response.writeHead(200,
        {
            "Content-Type": contentTypes[path.extname(file).toLowerCase()] ?? "application/octet-stream",
            "Content-Length": size,
            "Cache-Control": "no-store",
            "Content-Security-Policy": contentSecurityPolicy(this._forVSCode),
            "X-Content-Type-Options": "nosniff"
        });

        if ("HEAD" === request.method)
        {
            response.end();
            return;
        }

        createReadStream(file).pipe(response);
    }

    private isOwnHost(host: string | undefined): boolean
    {
        return "127.0.0.1:" + this._port === host || "localhost:" + this._port === host;
    }

    private hasToken(request: http.IncomingMessage): boolean
    {
        const header = request.headers["x-roux-token"];

        if ("string" === typeof header)
            return this.isToken(header);

        for (const cookie of (request.headers.cookie ?? "").split(";"))
        {
            const [name, ...value] = cookie.trim().split("=");

            if (cookieName === name)
                return this.isToken(value.join("="));
        }

        return false;
    }

    //Compares in constant time, so the answer's timing doesn't give the token away
    private isToken(candidate: string): boolean
    {
        const expected = Buffer.from(this.token);
        const given = Buffer.from(candidate);
        return expected.length === given.length && timingSafeEqual(expected, given);
    }
}

function send(response: http.ServerResponse, status: number, contentType: string, body: string): void
{
    response.writeHead(status, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(body);
}

//The request's body as text, or undefined when it's larger than maximumBodyBytes
function readBody(request: http.IncomingMessage): Promise<string | undefined>
{
    return new Promise((resolve, reject) =>
    {
        const chunks: Buffer[] = [];
        let byteCount = 0;

        request.on("data", (chunk: Buffer) =>
        {
            byteCount += chunk.length;

            if (maximumBodyBytes < byteCount)
            {
                resolve(undefined);
                request.destroy();
                return;
            }

            chunks.push(chunk);
        });
        request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        request.on("error", reject);
    });
}