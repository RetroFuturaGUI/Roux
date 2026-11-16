//The Setup tab when Roux serves the page: one row per check the core runs, in its order, with the installations to
//choose from and the fixes it offers. Opened as a file, the page is the mockup and its rows stay as they are.
const statusSymbols = { ok: "✔", warning: "⚠", error: "✖", skipped: "–", checking: "…" };
const statusLabels = { ok: "ok", warning: "warning", error: "error", skipped: "not needed", checking: "checking" };

//The row of a component, made the first time the core names it.
function setupRow(component)
{
    const list = document.querySelector("#Setup .checks");
    const existing = [...list.querySelectorAll("li.check[data-component]")].find(row => row.dataset.component == component);

    if (existing)
        return existing;

    const row = document.createElement("li");
    row.className = "check checking";
    row.dataset.component = component;

    const status = document.createElement("span");
    status.className = "status";

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = component;

    row.append(status, name, textDetail(""));
    list.append(row);
    return row;
}

//"3.31.2 · Program Files · on the PATH". One found only on the PATH is named by its folder instead.
function installationLabel(installation)
{
    const folder = installation.path.replace(/[\\/][^\\/]*$/, "");
    const source = "PATH" === installation.source ? folder : installation.source;
    const onPath = installation.isOnPath && "PATH" !== installation.source ? " · on the PATH" : "";
    return installation.version + " · " + source + onPath;
}

function setRowStatus(row, status)
{
    row.className = "check " + status;

    const symbol = row.querySelector(".status");
    symbol.textContent = statusSymbols[status];
    symbol.setAttribute("aria-label", statusLabels[status]);
}

//Replaces the row's detail and fixes with new ones.
function setRowContent(row, detail, actions)
{
    row.querySelector(".detail").replaceWith(detail);

    for (const action of row.querySelectorAll(".action"))
        action.remove();

    row.append(...actions);
}

function textDetail(text)
{
    const detail = document.createElement("span");
    detail.className = "detail";
    detail.textContent = text;
    return detail;
}

function showChecking(component)
{
    const row = setupRow(component);
    setRowStatus(row, "checking");
    setRowContent(row, textDetail("checking…"), []);
}

function showCheck(result)
{
    const row = setupRow(result.component);
    const detail = document.createElement("span");
    detail.className = "detail";

    if (1 < result.installations.length)
    {
        const select = document.createElement("select");
        select.setAttribute("aria-label", result.component + " installation");

        for (const installation of result.installations)
        {
            const option = new Option(installationLabel(installation), installation.path);
            option.title = installation.path;
            select.add(option);
        }

        select.selectedIndex = result.chosenIndex;
        select.addEventListener("change", () => chooseInstallation(result.component, select));
        detail.appendChild(select);
    }
    else if (1 === result.installations.length)
    {
        const installation = result.installations[0];
        const text = document.createElement("span");
        text.textContent = installationLabel(installation);
        text.title = installation.path;
        detail.appendChild(text);
    }

    if (result.detail)
    {
        const hint = document.createElement("span");
        hint.className = 0 === result.installations.length ? "" : "hint";
        hint.textContent = result.detail;
        detail.appendChild(hint);
    }

    setRowStatus(row, result.status);
    setRowContent(row, detail, result.fixes.map(fix => fixAction(result.component, fix)));
    showWaitingFixes(row);
}

//Saves the choice for this computer; the core checks the component again, with what depends on it.
async function chooseInstallation(component, select)
{
    select.disabled = true;

    try
    {
        showCheck(await HostBridge.request("setup.choose", { component: component, path: select.value }));
    }
    catch (error)
    {
        select.disabled = false;
        select.title = "Not saved: " + error.message;
    }
}

//A fix shows its command first and runs only on a click. A link opens its page. A fix that waits for another one (an
//install after its dry run) stays hidden until that one ran.
function fixAction(component, fix)
{
    if ("link" == fix.kind)
    {
        const link = document.createElement("a");
        link.className = "action";
        link.href = fix.command;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = fix.label;
        return link;
    }

    const action = document.createElement("details");
    action.className = "action";
    action.dataset.fix = fix.id;

    if (fix.after)
        action.dataset.after = fix.after;

    const summary = document.createElement("summary");
    summary.textContent = fix.label;

    const command = document.createElement("code");
    command.textContent = fix.command;

    const note = document.createElement("span");
    note.className = "hint";
    note.textContent = "terminal" == fix.kind
        ? "Opens a terminal window, where a password or elevation prompt can be answered. Setup checks again once it's closed."
        : "environment" == fix.kind ? "Sets it for your user account." : "Runs quietly and shows what it prints.";

    const run = document.createElement("button");
    run.type = "button";
    run.textContent = "Run";
    run.addEventListener("click", () => runFix(component, fix, action, run));

    action.append(summary, command, note, run);
    return action;
}

function showWaitingFixes(row)
{
    for (const action of row.querySelectorAll(".action[data-after]"))
        action.hidden = !row.querySelector('.action[data-fix="' + action.dataset.after + '"]')?.classList.contains("ran");
}

async function runFix(component, fix, action, button)
{
    button.disabled = true;
    button.textContent = "terminal" == fix.kind ? "Waiting for the terminal…" : "Running…";
    action.querySelector("pre")?.remove();

    try
    {
        const outcome = await HostBridge.request("setup.runFix", { component: component, fixId: fix.id });

        if (outcome.output)
        {
            const output = document.createElement("pre");
            output.textContent = outcome.output.trim();
            action.append(output);
        }

        if (outcome.isDone)
        {
            action.classList.add("ran");
            showWaitingFixes(action.closest("li.check"));
        }
    }
    catch (error)
    {
        const output = document.createElement("pre");
        output.textContent = error.message;
        action.append(output);
    }
    finally
    {
        //A terminal or environment fix is followed by a new check, which replaces the row; the button stays for a capture.
        button.disabled = false;
        button.textContent = "Run";
    }
}

function showUnreachable(error)
{
    const rows = document.querySelectorAll("#Setup li.check[data-component]");

    for (const row of rows.length ? rows : [setupRow("Core")])
    {
        setRowStatus(row, "error");
        setRowContent(row, textDetail("The core can't be reached: " + error.message), []);
    }
}

async function runSetupChecks()
{
    const button = document.getElementById("setup-search-again");
    button.disabled = true;

    try
    {
        const answer = await HostBridge.request("setup.runChecks");

        for (const result of answer.checks)
            showCheck(result);
    }
    catch (error)
    {
        showUnreachable(error);
    }
    finally
    {
        button.disabled = false;
    }
}

//Opened as a file, the page is the mockup: its rows stay as they are. Served, the core's rows replace them.
if (HostBridge.isAvailable)
{
    document.querySelector("#Setup .checks").replaceChildren();
    HostBridge.onEvent("setup.checkStarted", event => showChecking(event.component));
    HostBridge.onEvent("setup.checkFinished", showCheck);
    document.getElementById("setup-search-again").addEventListener("click", runSetupChecks);
    HostBridge.ready.then(runSetupChecks);
}
