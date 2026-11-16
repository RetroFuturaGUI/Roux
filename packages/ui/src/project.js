//Fills the Project and App tabs with the project's real files when Roux serves the page, and sends every change to the
//core, which writes it when it's valid. Opened as a file, the page stays the mockup and none of this runs.

//What the core sent last: { folder, project, app }.
let projectSnapshot = null;

//Typed text is sent once typing pauses, so not every keystroke becomes a write.
const typingDelay = 300;

//Edits go out one after another, so the core gets them in the order they were made.
let editChain = Promise.resolve();
const pendingEdits = new Map();

//The fields of the Project tab that are one text value each.
const projectTextFields =
{
    "project-name": "name",
    "project-identifier": "identifier",
    "project-version": "version",
    "project-cmake": "cmakeVersion",
    "project-appsettings": "appSettings",
    "project-startwindow": "startWindow"
};

function sendEdit(method, edit, onAnswer)
{
    editChain = editChain.then(async () =>
    {
        try
        {
            onAnswer(await HostBridge.request(method, { edit: edit }));
        }
        catch (error)
        {
            showUnreachableCore(error);
        }
    });
}

//Sends the edits still waiting for typing to pause, so an edit made after them can't overtake them.
function flushPendingEdits()
{
    for (const pending of pendingEdits.values())
    {
        clearTimeout(pending.timer);
        pending.send();
    }

    pendingEdits.clear();
}

function delayedEdit(id, send)
{
    clearTimeout(pendingEdits.get(id)?.timer);
    pendingEdits.set(id, { timer: setTimeout(() => { pendingEdits.delete(id); send(); }, typingDelay), send: send });
}

function immediateEdit(send)
{
    flushPendingEdits();
    send();
}

function cancelEdit(id)
{
    clearTimeout(pendingEdits.get(id)?.timer);
    pendingEdits.delete(id);
}

//Shows the core's message under a field, or takes it away.
function setFieldMessage(field, message)
{
    field.classList.toggle("invalid", "" != message);
    let span = field.querySelector(":scope > .message");

    if (!message)
    {
        span?.remove();
        return;
    }

    if (!span)
    {
        span = document.createElement("span");
        span.className = "message";
        field.appendChild(span);
    }

    span.textContent = message;
}

//The box above a form: a missing file with its Create button, or the problems that keep the form read-only. Returns
//whether the form can be edited.
function showFileStatus(box, file, unknownText, createMethod)
{
    box.replaceChildren();
    box.hidden = false;

    const text = document.createElement("p");
    box.append(text);

    if (!file)
    {
        text.textContent = unknownText;
        return false;
    }

    if (!file.exists && file.relativePath)
    {
        text.textContent = file.relativePath + " doesn't exist in " + projectSnapshot.folder + " yet.";

        const create = document.createElement("button");
        create.type = "button";
        create.textContent = "Create " + file.relativePath;
        create.addEventListener("click", async () =>
        {
            create.disabled = true;

            try
            {
                showSnapshot(await HostBridge.request(createMethod));
            }
            catch (error)
            {
                showUnreachableCore(error);
            }
        });

        box.append(create);
        return false;
    }

    if (0 < file.problems.length)
    {
        text.textContent = (file.relativePath || "The file") + " can't be shown here until " + (1 == file.problems.length ? "this is" : "these are") + " fixed:";

        const list = document.createElement("ul");
        list.className = "problems";

        for (const problem of file.problems)
        {
            const item = document.createElement("li");
            item.textContent = 0 < problem.line ? file.relativePath + ":" + problem.line + ":" + problem.column + ": " + problem.message : problem.message;
            list.append(item);
        }

        box.append(list);
        return false;
    }

    box.hidden = true;
    return true;
}

function setFormEditable(form, isEditable)
{
    for (const fieldset of form.querySelectorAll("fieldset"))
        fieldset.disabled = !isEditable;

    form.classList.toggle("read-only", !isEditable);
}

function showUnreachableCore(error)
{
    for (const id of ["project-status", "app-status"])
    {
        const box = document.getElementById(id);
        box.hidden = false;
        box.textContent = "The core can't be reached: " + error.message;
    }
}

function showSnapshot(snapshot)
{
    projectSnapshot = snapshot;

    const isProjectEditable = showFileStatus(document.getElementById("project-status"), snapshot.project, "", "project.create");
    setFormEditable(document.getElementById("project-form"), isProjectEditable);

    if (snapshot.project.values)
        showProjectValues(snapshot.project.values, snapshot.project.relativePath);

    const isAppEditable = showFileStatus(document.getElementById("app-status"), snapshot.app,
        "The App Settings file isn't known while Project.bechaml can't be read: it names the file.", "app.create");
    setFormEditable(document.getElementById("app-form"), isAppEditable);
    showAppValues(isAppEditable ? snapshot.app.values : { scopes: {}, charsets: [] }, snapshot.app);
}

//The platforms in the file that this page doesn't offer yet; they stay in the list when the ticks change.
function unofferedPlatforms()
{
    const offered = [...document.querySelectorAll("#project-platforms input")].map(input => input.value);
    return (projectSnapshot.project.values?.platforms ?? []).filter(name => !offered.includes(name));
}

function showProjectValues(values, relativePath)
{
    for (const [id, key] of Object.entries(projectTextFields))
    {
        const input = document.getElementById(id);

        if (document.activeElement != input)
            input.value = values[key];

        if (input.dataset.pattern)
            validateField(input);
        else
            setFieldMessage(input.closest(".field"), "");
    }

    const license = document.getElementById("project-license");

    if (![...license.options].some(option => option.value == values.license))
        license.add(new Option(values.license));

    license.value = values.license;

    for (const box of document.querySelectorAll("#project-platforms input"))
        box.checked = values.platforms.includes(box.value);

    showPlatformSettings(values.platformSettings);

    for (const box of document.querySelectorAll("#project-features input"))
        box.checked = values.features.includes(box.value);

    document.getElementById("project-codecs").checked = values.allowNonRoyaltyFreeCodecs;
    document.getElementById("project-removedslots").value = values.removedSlots;
    showEntries("project-authors", values.authors, "authors");
    showEntries("project-assets", values.assets, "assets");

    const unoffered = unofferedPlatforms();
    document.getElementById("project-file-hint").textContent = "Changes are written to " + relativePath + " as you make them; comments and layout stay."
        + (0 < unoffered.length ? " The file also lists " + unoffered.join(", ") + ", which this page doesn't offer yet; they stay as they are." : "");

    fillPlatforms();
    fillScopes();
}

//Turns the file's compiler families into the indices script.js keeps.
function showPlatformSettings(settings)
{
    for (const name of Object.keys(platformSettings))
        delete platformSettings[name];

    for (const [name, values] of Object.entries(settings))
    {
        const platform = platforms[name];

        if (!platform)
            continue;

        const compiler = platform.compilers.findIndex(entry => entry.family == values.compiler);
        platformSettings[name] = { language: values.language, standard: values.standard, compiler: Math.max(0, compiler), compilerFlags: [...values.compilerFlags] };
    }
}

//A list of names with a remove button each, as the authors and the assets are.
function showEntries(id, items, key)
{
    const list = document.getElementById(id);
    list.replaceChildren();

    items.forEach((item, index) =>
    {
        const entry = document.createElement("li");
        entry.append(item + " ");

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "✕";
        remove.setAttribute("aria-label", "Remove " + item);
        remove.addEventListener("click", () => editProjectList(key, items.filter((_, other) => other != index), list));

        entry.append(remove);
        list.append(entry);
    });
}

//Adds a row to type a new entry in: Enter or leaving the field adds it, Escape drops it.
function addEntryInput(id, key, label)
{
    const list = document.getElementById(id);

    if (list.querySelector("input"))
        return list.querySelector("input").focus();

    const entry = document.createElement("li");
    const input = document.createElement("input");
    input.setAttribute("aria-label", label);
    entry.append(input);
    list.append(entry);
    input.focus();

    let isDone = false;

    const finish = shouldAdd =>
    {
        if (isDone)
            return;

        isDone = true;
        const value = input.value.trim();
        entry.remove();

        if (shouldAdd && value)
            editProjectList(key, [...projectSnapshot.project.values[key], value], list);
    };

    input.addEventListener("keydown", event =>
    {
        if ("Enter" == event.key)
        {
            event.preventDefault();
            finish(true);
        }
        else if ("Escape" == event.key)
        {
            finish(false);
        }
    });

    input.addEventListener("blur", () => finish(true));
}

function editProjectList(key, value, element)
{
    immediateEdit(() => sendEdit("project.edit", { key: key, value: value }, answerShower(element, true)));
}

//Handles the core's answer to a Project edit: its message under the field, and the form shown again where an edit
//changes more than the field (a ticked platform gets its block, a list gets its new entry).
function answerShower(element, shouldShowAgain)
{
    return answer =>
    {
        if (shouldShowAgain || !answer.isWritten)
            showSnapshot(answer.snapshot);
        else
            projectSnapshot = answer.snapshot;

        const field = element.closest(".field");

        if (field && !field.classList.contains("codec"))
            setFieldMessage(field, answer.message);
        else if (!answer.isWritten)
            document.getElementById("project-file-hint").textContent = answer.message;
    };
}

function sendProjectEdit(edit, element, shouldShowAgain)
{
    immediateEdit(() => sendEdit("project.edit", edit, answerShower(element, shouldShowAgain)));
}

function showAppValues(values, file)
{
    for (const scope of Object.keys(appSettings))
        delete appSettings[scope];

    for (const [scope, settings] of Object.entries(values.scopes))
        appSettings[scope] = { ...settings };

    charsets.splice(0, charsets.length, ...values.charsets.map(charset => ({ name: charset.name, blocks: charset.blocks.join(", ") })));

    if (file?.relativePath)
        document.getElementById("app-file-hint").textContent = "Changes are written to " + file.relativePath + " as you make them; comments and layout stay.";

    fillScopes();
    appMessages.clear();
    showAppMessages();
}

//Why the core refused a key's last edit, by key ("fontSize", "charset:0"). A row with several keys (the default font)
//shows the first of its keys' messages, so a later key that was written doesn't hide an earlier one that wasn't.
const appMessages = new Map();

function showAppMessages()
{
    for (const row of document.querySelectorAll("#app-form .setting[data-keys]"))
        setFieldMessage(row, row.dataset.keys.split(" ").map(key => appMessages.get(key)).find(Boolean) ?? "");

    document.querySelectorAll("#app-charsets .charset").forEach((charset, index) =>
        setFieldMessage(charset.querySelector(".field"), appMessages.get("charset:" + index) ?? ""));
}

//app.js has already shown the change; the core's answer only says whether it was written.
function sendAppEdit(edit)
{
    const knownCharsets = projectSnapshot?.app?.values?.charsets.length ?? 0;
    const isTyped = ("set" == edit.kind && !Array.isArray(edit.value)) || ("charset" == edit.kind && knownCharsets > edit.index);
    const id = "set" == edit.kind ? "app:" + edit.scope + ":" + edit.key : "charset:" + edit.index;
    const keys = "set" == edit.kind ? [edit.key] : "reset" == edit.kind ? edit.keys : ["charset:" + edit.index];

    const send = () => sendEdit("app.edit", edit, answer =>
    {
        projectSnapshot = answer.snapshot;

        for (const key of keys)
        {
            if (answer.isWritten)
                appMessages.delete(key);
            else
                appMessages.set(key, answer.message);
        }

        showAppMessages();
    });

    if (isTyped)
        delayedEdit(id, send);
    else
        immediateEdit(send);
}

//What this page can't do yet when Roux serves it: the IDE's file picker and editor come with the IDE hosts, and Setup
//doesn't look for compilers or Python yet, so none is grayed out as missing.
function prepareServedPage()
{
    for (const button of document.querySelectorAll("#project-form .change, #project-open-text, #app-open-text"))
    {
        button.disabled = true;
        button.title = "Needs an IDE: comes with the VS Code and JetBrains hosts. Type the path, or edit the file in your editor.";
    }

    for (const platform of Object.values(platforms))
    {
        const families = [];

        for (const compiler of platform.compilers)
        {
            if (!families.some(entry => entry.family == compiler.family))
                families.push(compiler.elsewhere ? compiler : { name: compiler.family, family: compiler.family, unknown: true });
        }

        platform.compilers = families;
    }

    installedPython = null;
    document.querySelector("#project-cmake ~ .hint").textContent = "For every platform: CMakeLists.txt's cmake_minimum_required. RetroFuturaGUI needs 3.16 or newer; every later CMake is accepted.";
}

function wireProjectForm()
{
    for (const [id, key] of Object.entries(projectTextFields))
    {
        const input = document.getElementById(id);

        //script.js has checked the pattern by now; a value that fails it isn't sent.
        input.addEventListener("input", () =>
        {
            if (input.closest(".field").classList.contains("invalid") && input.dataset.pattern)
                return cancelEdit(id);

            delayedEdit(id, () => sendEdit("project.edit", { key: key, value: input.value }, answerShower(input, false)));
        });
    }

    const license = document.getElementById("project-license");
    license.addEventListener("change", () => sendProjectEdit({ key: "license", value: license.value }, license, false));

    const removedSlots = document.getElementById("project-removedslots");
    removedSlots.addEventListener("change", () => sendProjectEdit({ key: "removedSlots", value: removedSlots.value }, removedSlots, false));

    const codecs = document.getElementById("project-codecs");
    codecs.addEventListener("change", () => sendProjectEdit({ key: "allowNonRoyaltyFreeCodecs", value: codecs.checked }, codecs, false));

    const features = document.getElementById("project-features");
    features.addEventListener("change", () =>
        sendProjectEdit({ key: "features", value: [...features.querySelectorAll("input:checked")].map(box => box.value) }, features, true));

    //Keeps the file's order and the platforms this page doesn't offer; newly ticked ones go last.
    const platformBoxes = document.getElementById("project-platforms");
    platformBoxes.addEventListener("change", () =>
    {
        const ticked = [...platformBoxes.querySelectorAll("input:checked")].map(box => box.value);
        const unoffered = unofferedPlatforms();
        const listed = projectSnapshot.project.values.platforms.filter(name => ticked.includes(name) || unoffered.includes(name));
        sendProjectEdit({ key: "platforms", value: [...listed, ...ticked.filter(name => !listed.includes(name))] }, platformBoxes, true);
    });

    //script.js has updated the platform's settings by now, including a standard it picked for a new language.
    for (const id of ["project-language", "project-standard", "project-compiler", "project-flags"])
    {
        const select = document.getElementById(id);

        select.addEventListener("change", () =>
        {
            const name = currentPlatform();
            const settings = platformSettings[name];
            const compiler = platforms[name].compilers[settings.compiler];
            sendProjectEdit({ key: "platform", platform: name, value: { language: settings.language, standard: settings.standard, compiler: compiler.family, compilerFlags: settings.compilerFlags } }, select, false);
        });
    }

    document.getElementById("project-author-add").addEventListener("click", () => addEntryInput("project-authors", "authors", "New author"));
    document.getElementById("project-asset-add").addEventListener("click", () => addEntryInput("project-assets", "assets", "New asset folder, relative to the project"));
}

async function loadProject()
{
    try
    {
        showSnapshot(await HostBridge.request("project.load"));
    }
    catch (error)
    {
        showUnreachableCore(error);
    }
}

if (HostBridge.isAvailable)
{
    prepareServedPage();
    wireProjectForm();
    onAppEdit = sendAppEdit;

    //A message belongs to the scope it was made in.
    document.getElementById("app-scope").addEventListener("change", () =>
    {
        appMessages.clear();
        showAppMessages();
    });

    HostBridge.onEvent("project.changed", showSnapshot);
    HostBridge.ready.then(loadProject);
}
