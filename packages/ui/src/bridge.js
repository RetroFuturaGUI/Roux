//The UI's only way to the core: request(method, params) resolves with the method's result, onEvent(name, handler)
//receives the core's events. In the browser it talks to roux serve: requests are POSTed to /rpc, events come from /events.
//The IDE shells will carry the same JSON-RPC messages over their own channels.
const HostBridge = (() =>
{
    const eventHandlers = new Map();
    let nextId = 1;

    //Opened from the file itself, as the mockup is, the page has no core to reach and keeps its fake data.
    const isAvailable = "http:" === location.protocol || "https:" === location.protocol;

    //Resolves once the event stream is open, so no event of the first request is missed. Also when it can't open, so
    //requests still go through.
    const ready = new Promise(resolve =>
    {
        if (!isAvailable)
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

            for (const handler of eventHandlers.get(notification.method) ?? [])
                handler(notification.params);
        });
    });

    async function request(method, params = {})
    {
        if (!isAvailable)
            throw new Error("There is no core: the page was opened as a file.");

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
