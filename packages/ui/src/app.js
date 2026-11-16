//The App tab: a form over the App Settings file. Values set for all platforms form the file's top level; a group or a
//platform overrides them in its block (<Windows>). A field shows what applies, grayed out while it's inherited.

//Set by project.js when Roux serves the page: it gets every change, to write it to the App Settings file. Opened as a
//file, the page is the mockup and changes stay in the page.
let onAppEdit = null;

function reportAppEdit(edit)
{
    if (onAppEdit)
        onAppEdit(edit);
}

//The blocks as the core keeps them: "Hiragana, Katakana" is { "Hiragana", "Katakana" }.
function charsetEdit(index)
{
    const charset = charsets[index];
    const blocks = charset.blocks.split(",").map(block => block.trim()).filter(block => "" != block);
    return { kind: "charset", index: index, charset: { name: charset.name, blocks: blocks } };
}

//Fake data from here to the functions.
//Groups a platform belongs to; a platform's own block comes before its group's, the group's before the top level.
const platformGroups =
{
    "Desktop": ["Windows", "Linux"/*, "macOS"*/]/*,
    "Mobile": ["Android", "iOS"],
    "Console": ["GameCube, Wii", "WiiU", "Nintendo3DS", "Switch"]*/
};

//The renderers each platform can have, from the roadmap.
const platformRenderers =
{
    "Windows": ["OpenGL"/*, "DirectX", "Vulkan"*/],
    "Linux": ["OpenGL"/*, "Vulkan"*/]/*,
    "macOS": ["OpenGL", "Vulkan"],
    "Android": ["OpenGL ES"],
    "GameCube": ["GX"],
    "Wii": ["GX"],
    "WiiU": ["GX2"],
    "Nintendo3DS": ["citro3d"],
    "Switch": ["deko3d"],
    "Xbox": ["DirectX"],
    "Dreamcast": ["OpenGL 1.5 + PVR"],
    "PS2": ["ps2gl"]*/
};

//What each platform can provide, for the requirements.
const platformCapabilities =
{
    "Windows": ["MultiWindow", "FileSystem", "Mouse", "Keyboard", "Touch", "Gamepad"],
    "Linux": ["MultiWindow", "FileSystem", "Mouse", "Keyboard", "Touch", "Gamepad"]/*,
    "macOS": ["MultiWindow", "FileSystem", "Mouse", "Keyboard", "Gamepad"],
    "Android": ["FileSystem", "Keyboard", "Touch", "Gamepad"],
    "GameCube": ["FileSystem", "Keyboard", "Gamepad"],
    "Wii": ["FileSystem", "Keyboard", "Gamepad"],
    "WiiU": ["FileSystem", "Touch", "Gamepad"],
    "Nintendo3DS": ["FileSystem", "Touch", "Gamepad"],
    "Switch": ["FileSystem", "Touch", "Gamepad"],
    "Xbox": ["FileSystem", "Mouse", "Keyboard", "Gamepad"],
    "Dreamcast": ["Mouse", "Keyboard", "Gamepad"],
    "PS2": ["FileSystem", "Mouse", "Keyboard", "Gamepad"]*/
};

const capabilityNames =
{
    "MultiWindow": "several windows",
    "FileSystem": "a file system",
    "Mouse": "a mouse",
    "Keyboard": "a keyboard",
    "Touch": "touch",
    "Gamepad": "a gamepad"
};

//What the library uses when the file sets nothing.
const builtInSettings =
{
    appName: "",
    fontFamily: "",
    fontSize: "",
    fontUnit: "Points",
    transitions: "Off",
    layoutFile: "RetroFuturaGUI.ini",
    renderers: [],
    requires: []
};

//The character sets: their blocks hold for every platform, their fonts are settings ("font:<name>").
const charsets =
[
    { name: "Japanese", blocks: "Hiragana, Katakana, CJK Symbols and Punctuation, CJK Unified Ideographs" },
    { name: "Emoji", blocks: "Emoticons, Miscellaneous Symbols and Pictographs" }
];

//What the file sets, per scope: "All" is the top level, the rest are the platforms' and groups' blocks (<Windows>, <Desktop>).
const appSettings =
{
    "All":
    {
        appName: "RetroFuturaGUI Test",
        fontFamily: "Noto Sans",
        fontSize: "25",
        fontUnit: "Points",
        renderers: ["OpenGL"],
        requires: ["FileSystem"]
    },
    "Desktop":
    {
        requires: ["MultiWindow", "FileSystem", "Mouse"]
    },
    "Windows":
    {
        renderers: ["DirectX", "OpenGL"],
        "font:Japanese": "Yu Mincho",
        "font:Emoji": "Segoe UI Emoji"
    },
    "Linux":
    {
        "font:Japanese": "Noto Sans CJK JP",
        "font:Emoji": "Noto Color Emoji"
    },
    "GameCube":
    {
        renderers: ["GX"],
        layoutFile: ""
    },
    "Wii":
    {
        renderers: ["GX"],
        layoutFile: ""
    }
};

function tickedPlatforms()
{
    return [...document.querySelectorAll("#project-platforms input:checked")].map(input => input.value);
}

function currentScope()
{
    return document.getElementById("app-scope").value;
}

function scopeLabel(scope)
{
    return "All" == scope ? "all platforms" : scope;
}

//Where a scope looks for a value, nearest first.
function scopeChain(scope)
{
    if ("All" == scope)
        return ["All"];

    if (platformGroups[scope])
        return [scope, "All"];

    const group = Object.keys(platformGroups).find(name => platformGroups[name].includes(scope));
    return group ? [scope, group, "All"] : [scope, "All"];
}

//The value that applies in a scope, and the scope it comes from ("built-in" when the file sets it nowhere).
function resolveSetting(scope, key)
{
    for (const name of scopeChain(scope))
    {
        if (appSettings[name] && key in appSettings[name])
            return { value: appSettings[name][key], from: name };
    }

    return { value: key in builtInSettings ? builtInSettings[key] : "", from: "built-in" };
}

//The ticked platforms a scope speaks for.
function scopePlatforms(scope)
{
    const ticked = tickedPlatforms();

    if ("All" == scope)
        return ticked;

    if (platformGroups[scope])
        return ticked.filter(name => platformGroups[scope].includes(name));

    return [scope];
}

function setOwn(key, value)
{
    const scope = currentScope();

    if (!appSettings[scope])
        appSettings[scope] = {};

    appSettings[scope][key] = value;
    reportAppEdit({ kind: "set", scope: scope, key: key, value: value });
}

function sourceText(scope, from)
{
    if (from == scope)
        return "Set here.";

    if ("built-in" == from)
        return "Not set: the library's default.";

    return "From " + scopeLabel(from) + ".";
}

//Shows a setting row: its value, grayed out while inherited, where it comes from, and Reset only for its own value.
function showSetting(row)
{
    const scope = currentScope();
    const keys = row.dataset.keys.split(" ");
    const first = resolveSetting(scope, keys[0]);
    const isOwn = first.from == scope;

    for (const control of row.querySelectorAll("[data-key]"))
        control.value = String(resolveSetting(scope, control.dataset.key).value);

    if ("renderers" == keys[0])
        showRenderers(first.value);

    if ("requires" == keys[0])
    {
        for (const box of row.querySelectorAll("#app-requires input"))
            box.checked = first.value.includes(box.value);
    }

    row.classList.toggle("inherited", !isOwn);
    row.querySelector(".source").textContent = sourceText(scope, first.from);
    row.querySelector(".reset").hidden = !isOwn;
}

function showRenderers(renderers)
{
    const list = document.getElementById("app-renderers");
    list.replaceChildren();

    renderers.forEach((name, index) =>
    {
        const item = document.createElement("li");
        item.append(name + " ");

        const buttons = document.createElement("span");

        for (const [text, label, action] of [["▲", "Earlier", "up"], ["▼", "Later", "down"], ["✕", "Remove", "remove"]])
        {
            const button = document.createElement("button");
            button.type = "button";
            button.textContent = text;
            button.setAttribute("aria-label", label + ": " + name);
            button.dataset.action = action;
            button.dataset.index = String(index);
            buttons.append(button);
        }

        item.append(buttons);
        list.append(item);
    });

    //Offers what any of the scope's platforms can have, minus what's listed already.
    const offered = new Set(scopePlatforms(currentScope()).flatMap(name => platformRenderers[name] || []));
    const add = document.getElementById("app-renderer-add");
    add.replaceChildren(...[...offered].filter(name => !renderers.includes(name)).map(name => new Option(name)));
    document.getElementById("app-renderer-add-button").disabled = 0 == add.options.length;
}

function changeRenderers(action, index)
{
    const renderers = [...resolveSetting(currentScope(), "renderers").value];

    if ("up" == action && 0 < index)
        renderers.splice(index - 1, 0, renderers.splice(index, 1)[0]);
    else if ("down" == action && renderers.length - 1 > index)
        renderers.splice(index + 1, 0, renderers.splice(index, 1)[0]);
    else if ("remove" == action)
        renderers.splice(index, 1);

    setOwn("renderers", renderers);
}

//One row per character set: its name and blocks (edited for all platforms only) and its font, a setting like any other.
function showCharsets()
{
    const scope = currentScope();
    const isAll = "All" == scope;
    const container = document.getElementById("app-charsets");
    container.replaceChildren();

    charsets.forEach((charset, index) =>
    {
        const block = document.createElement("div");
        block.className = "charset";
        block.innerHTML =
            '<div class="field">' +
                '<label>Name</label>' +
                '<input data-charset="' + index + '" data-part="name"/>' +
            '</div>' +
            '<div class="field">' +
                '<label>Blocks</label>' +
                '<input data-charset="' + index + '" data-part="blocks"/>' +
            '</div>' +
            '<div class="field setting">' +
                '<label>Font</label>' +
                '<div class="inline">' +
                    '<input/>' +
                    '<button type="button" class="reset">Reset</button>' +
                '</div>' +
                '<span class="source"></span>' +
            '</div>' +
            '<div class="field">' +
                '<button type="button" class="add" data-charset-remove="' + index + '"></button>' +
            '</div>';

        const [name, blocks] = block.querySelectorAll("[data-charset]");
        name.value = charset.name;
        blocks.value = charset.blocks;
        name.readOnly = !isAll;
        blocks.readOnly = !isAll;

        //Like name and blocks, the set itself is edited for all platforms only.
        const remove = block.querySelector("[data-charset-remove]");
        remove.textContent = "Remove " + charset.name;
        remove.hidden = !isAll;

        const font = block.querySelector(".setting");
        font.dataset.keys = "font:" + charset.name;
        font.querySelector(".inline input").dataset.key = "font:" + charset.name;
        font.querySelector(".inline input").setAttribute("aria-label", "Font for " + charset.name);

        container.append(block);
        showSetting(font);
    });

    document.getElementById("app-charset-add").hidden = !isAll;
}

//Problems the settings cause on the scope's platforms.
function showWarnings()
{
    const list = document.getElementById("app-warnings");
    const warnings = [];

    for (const platform of scopePlatforms(currentScope()))
    {
        const renderers = resolveSetting(platform, "renderers").value;
        const available = renderers.filter(name => (platformRenderers[platform] || []).includes(name));

        if (0 == available.length)
            warnings.push({ kind: "error", text: platform + ": none of the renderers (" + (renderers.join(", ") || "none") + ") exists there." });
        else if (available.length < renderers.length)
            warnings.push({ kind: "warning", text: platform + ": " + renderers.filter(name => !available.includes(name)).join(", ") + " doesn't exist there and is skipped." });

        for (const need of resolveSetting(platform, "requires").value)
        {
            if (!(platformCapabilities[platform] || []).includes(need))
                warnings.push({ kind: "error", text: platform + " can't provide " + capabilityNames[need] + ", which the app needs." });
        }

        for (const charset of charsets)
        {
            if (!resolveSetting(platform, "font:" + charset.name).value)
                warnings.push({ kind: "warning", text: platform + ": no font for " + charset.name + "; its characters show as gaps." });
        }
    }

    if (0 == warnings.length)
        warnings.push({ kind: "ok", text: "No problems on " + (scopePlatforms(currentScope()).join(", ") || "the ticked platforms") + "." });

    list.replaceChildren(...warnings.map(warning =>
    {
        const item = document.createElement("li");
        item.className = warning.kind;
        item.textContent = warning.text;
        return item;
    }));
}

function showScope()
{
    const scope = currentScope();
    const platforms = scopePlatforms(scope);

    document.getElementById("app-scope-hint").textContent = "All" == scope
        ? "The file's top level: holds wherever a group or platform sets nothing else."
        : "Applies to " + (platforms.join(", ") || "no ticked platform") + ". Grayed-out values are inherited; changing one sets it here.";

    for (const row of document.querySelectorAll("#app-form .setting[data-keys]"))
        showSetting(row);

    showCharsets();
    showWarnings();
}

//Lists all platforms, the groups that have ticked platforms, and the ticked platforms, keeping the shown scope if it's
//still there.
function fillScopes()
{
    const select = document.getElementById("app-scope");
    const shown = select.value;
    const ticked = tickedPlatforms();
    const scopes = [{ label: "All platforms", value: "All" }];

    for (const [group, members] of Object.entries(platformGroups))
    {
        const tickedMembers = members.filter(name => ticked.includes(name));

        if (0 < tickedMembers.length)
            scopes.push({ label: group + " (" + tickedMembers.join(", ") + ")", value: group });
    }

    for (const name of ticked)
        scopes.push({ label: "  " + name, value: name });

    select.replaceChildren(...scopes.map(scope => new Option(scope.label, scope.value)));
    select.value = scopes.some(scope => scope.value == shown) ? shown : "All";
    showScope();
}

//A typed or chosen value becomes the scope's own; a row with several controls (the font) takes all of them.
document.getElementById("app-form").addEventListener("input", event =>
{
    const control = event.target;

    if (control.dataset.charset)
    {
        const charset = charsets[Number(control.dataset.charset)];

        if ("name" == control.dataset.part)
        {
            //Renames the font settings along with the set.
            for (const values of Object.values(appSettings))
            {
                if ("font:" + charset.name in values)
                {
                    values["font:" + control.value] = values["font:" + charset.name];
                    delete values["font:" + charset.name];
                }
            }
        }

        charset[control.dataset.part] = control.value;
        reportAppEdit(charsetEdit(Number(control.dataset.charset)));

        //The font field and the remove button follow the new name.
        const font = control.closest(".charset").querySelector(".setting");
        font.dataset.keys = "font:" + charset.name;
        font.querySelector(".inline input").dataset.key = "font:" + charset.name;
        control.closest(".charset").querySelector("[data-charset-remove]").textContent = "Remove " + charset.name;

        showWarnings();
        return;
    }

    const row = control.closest(".setting");

    if (!row || !control.dataset.key)
        return; //the requirement boxes and the renderer to add change nothing by being touched.

    for (const each of row.querySelectorAll("[data-key]"))
        setOwn(each.dataset.key, each.value);

    row.classList.remove("inherited");
    row.querySelector(".source").textContent = sourceText(currentScope(), currentScope());
    row.querySelector(".reset").hidden = false;
    showWarnings();
});

document.getElementById("app-form").addEventListener("change", event =>
{
    if (event.target.closest("#app-requires"))
    {
        setOwn("requires", [...document.querySelectorAll("#app-requires input:checked")].map(box => box.value));
        showScope();
    }
});

document.getElementById("app-form").addEventListener("click", event =>
{
    const button = event.target.closest("button");

    if (!button)
        return;

    if (button.classList.contains("reset"))
    {
        const scope = currentScope();

        const keys = button.closest(".setting").dataset.keys.split(" ");

        for (const key of keys)
            delete appSettings[scope][key];

        reportAppEdit({ kind: "reset", scope: scope, keys: keys });
        showScope();
    }
    else if (button.dataset.action)
    {
        changeRenderers(button.dataset.action, Number(button.dataset.index));
        showScope();
    }
    else if ("app-renderer-add-button" == button.id)
    {
        const add = document.getElementById("app-renderer-add");
        setOwn("renderers", [...resolveSetting(currentScope(), "renderers").value, add.value]);
        showScope();
    }
    else if ("app-charset-add" == button.id)
    {
        charsets.push({ name: "New set " + (charsets.length + 1), blocks: "" });
        reportAppEdit(charsetEdit(charsets.length - 1));
        showScope();
    }
    else if (button.dataset.charsetRemove)
    {
        const index = Number(button.dataset.charsetRemove);
        const name = charsets[index].name;

        //Its fonts go with it, in every scope.
        for (const values of Object.values(appSettings))
            delete values["font:" + name];

        charsets.splice(index, 1);
        reportAppEdit({ kind: "removeCharset", index: index });
        showScope();
    }
});

document.getElementById("app-scope").addEventListener("change", showScope);

for (const input of document.querySelectorAll("#project-platforms input"))
    input.addEventListener("change", fillScopes);

fillScopes();
