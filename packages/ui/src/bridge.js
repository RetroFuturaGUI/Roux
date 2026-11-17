//The UI's only way to the core: request(method, params) resolves with the method's result, onEvent(name, handler)
//receives the core's events. In the browser it talks to roux serve: requests are POSTed to /rpc, events come from /events.
//In an IDE the same JSON-RPC messages go through its channel. postMessage in VS Code, a JCEF query in JetBrains IDEs
const HostBridge = (() =>
{
    const eventHandlers = new Map();
    const pendingAnswers = new Map();
    let nextId = 1;

    //An IDE's channel. VS Code's postMessage (acquireVsCodeApi may be called only once per page), or the send function
    //the JetBrains plugin defines before the page's scripts run, which takes text
    const vscode = "function" === typeof acquireVsCodeApi ? acquireVsCodeApi() : undefined;
    const jetBrains = window.rouxJetBrains;
    const channel = vscode ? { post: message => vscode.postMessage(message) }
        : jetBrains ? { post: message => jetBrains.send(JSON.stringify(message)) }
        : undefined;

    //Opened from the file itself, as the mockup is, the page has no core to reach and keeps its fake data
    const isAvailable = undefined !== channel || "http:" === location.protocol || "https:" === location.protocol;

    function dispatchEvent(notification)
    {
        for (const handler of eventHandlers.get(notification.method) ?? [])
            handler(notification.params);
    }

    //Through an IDE's channel an answer carries its request's id, and an event has none
    function receive(data)
    {
        if (!data || "2.0" !== data.jsonrpc)
            return;

        if (undefined === data.id)
        {
            dispatchEvent(data);
            return;
        }

        const pending = pendingAnswers.get(data.id);
        pendingAnswers.delete(data.id);
        pending?.(data);
    }

    if (vscode)
        window.addEventListener("message", message => receive(message.data));

    if (jetBrains)
        jetBrains.receive = receive;

    //Resolves once the event stream is open, so no event of the first request is missed. Also when it can't open, so
    //requests still go through. Through an IDE's channel, events flow as soon as the page runs
    const ready = new Promise(resolve =>
    {
        if (!isAvailable || channel)
        {
            resolve();
            return;
        }

        const events = new EventSource("/events");
        events.addEventListener("open", () => resolve(), { once: true });
        events.addEventListener("error", () => resolve(), { once: true });
        events.addEventListener("message", message =>
        {
            let notification;

            try
            {
                notification = JSON.parse(message.data);
            }
            catch
            {
                return;
            }

            dispatchEvent(notification);
        });
    });

    async function request(method, params = {})
    {
        if (!isAvailable)
            throw new Error("There is no core: the page was opened as a file.");

        if (channel)
        {
            const id = nextId++;
            const answer = await new Promise(resolve =>
            {
                pendingAnswers.set(id, resolve);
                channel.post({ jsonrpc: "2.0", id: id, method: method, params: params });
            });

            if (answer.error)
                throw new Error(answer.error.message);

            return answer.result;
        }

        const response = await fetch("/rpc",
        {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: method, params: params })
        });

        if (!response.ok)
            throw new Error("The core answered " + response.status + " " + response.statusText + ".");

        const answer = await response.json();

        if (answer.error)
            throw new Error(answer.error.message);

        return answer.result;
    }

    function onEvent(name, handler)
    {
        if (!eventHandlers.has(name))
            eventHandlers.set(name, []);

        eventHandlers.get(name).push(handler);
    }

    return { isAvailable: isAvailable, ready: ready, request: request, onEvent: onEvent };
})();
