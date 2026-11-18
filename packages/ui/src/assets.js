//The Assets tab: the pictures in the project's asset folders and in RetroFuturaGUI's premade Resources, as tiles grouped
//by folder, each with the reference markup names it by. Images are added through the page's own file picker, which every
//host shows, and sent to the core in pieces. Opened as a file, the page has no project, so the tab shows only its hint

const assetsChunkBytes = 512 * 1024; //a piece of an upload, under roux serve's 1 MiB per request once in base64
let assetsList = null; //the core's last answer
let assetsPreviews = null; //loads a tile's picture once it scrolls into view
const assetsPreviewCache = new Map(); //data URLs by file and modification time, "" for none, so a reload shows them at once
let isAddingAssets = false;

async function loadAssets()
{
    try
    {
        showAssets(await HostBridge.request("assets.list"));
    }
    catch (error)
    {
        showAssetsStatus([error.message], false);
    }
}

function showAssets(list)
{
    assetsList = list;
    const sections = document.getElementById("assets-sections");
    sections.replaceChildren();
    assetsPreviews?.disconnect();
    assetsPreviews = new IntersectionObserver(entries =>
    {
        for (const entry of entries.filter(entry => entry.isIntersecting))
        {
            assetsPreviews.unobserve(entry.target);
            loadAssetPreview(entry.target);
        }
    }, { rootMargin: "200px" });

    document.getElementById("assets-picker").accept = list.extensions.join(",");
    document.getElementById("assets-add").disabled = isAddingAssets || !list.destination;
    document.getElementById("assets-hint").textContent = list.destination
        ? "Added images go to " + list.destination + ". Copy a reference to name a file in a .bechaml: Image=Assets.Images.Logo.png."
        : "The project names no asset folder: add one in the Project tab first.";

    for (const section of list.sections)
        sections.append(assetSection(section));
}

function assetSection(section)
{
    const block = document.createElement("section");
    block.className = "assets-section";
    const title = document.createElement("h4");
    title.textContent = section.folder + (section.isReadOnly ? " (premade, read-only)" : "");
    block.append(title);

    if (0 === section.files.length)
    {
        const empty = document.createElement("span");
        empty.className = "hint";
        empty.textContent = "No pictures yet.";
        block.append(empty);
        return block;
    }

    //By the folder inside the asset folder: Images, Models/backpack
    const groups = new Map();

    for (const file of section.files)
    {
        const slash = file.path.lastIndexOf("/");
        const group = 0 > slash ? "" : file.path.slice(0, slash);

        if (!groups.has(group))
            groups.set(group, []);

        groups.get(group).push(file);
    }

    for (const [group, files] of groups)
    {
        if (group)
        {
            const heading = document.createElement("h5");
            heading.textContent = group;
            block.append(heading);
        }

        const grid = document.createElement("div");
        grid.className = "assets-grid";
        grid.append(...files.map(file => assetTile(section, file)));
        block.append(grid);
    }

    return block;
}

function assetTile(section, file)
{
    const tile = document.createElement("figure");
    tile.className = "asset-tile";

    //The extension until the picture arrives, and for one a page can't show (.tga, .psd)
    const picture = document.createElement("div");
    picture.className = "asset-picture";
    picture.textContent = file.path.slice(file.path.lastIndexOf(".") + 1).toUpperCase();
    picture.dataset.folder = section.folder;
    picture.dataset.path = file.path;
    picture.dataset.key = section.folder + "/" + file.path + "@" + file.modified;

    if (assetsPreviewCache.has(picture.dataset.key))
        showAssetPreview(picture, assetsPreviewCache.get(picture.dataset.key));
    else
        assetsPreviews.observe(picture);

    const caption = document.createElement("figcaption");
    caption.textContent = file.path.slice(file.path.lastIndexOf("/") + 1);
    caption.title = section.folder + "/" + file.path;
    const size = document.createElement("span");
    size.className = "hint";
    size.textContent = assetSize(file.size);
    caption.append(size);

    //Whole, wrapping where it must: it's what goes into the markup.
    const reference = document.createElement("code");
    reference.className = "asset-reference";
    reference.textContent = file.reference;
    reference.title = "How a .bechaml names this file";
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "asset-copy";
    copy.textContent = "Copy reference";
    copy.addEventListener("click", () => copyAssetReference(file.reference, copy));

    tile.append(picture, caption, reference, copy);
    return tile;
}

async function loadAssetPreview(picture)
{
    try
    {
        const { dataUrl } = await HostBridge.request("assets.preview", { folder: picture.dataset.folder, path: picture.dataset.path });
        assetsPreviewCache.set(picture.dataset.key, dataUrl);
        showAssetPreview(picture, dataUrl);
    }
    catch
    {
        //The tile keeps its extension; the list stays usable
    }
}

function showAssetPreview(picture, dataUrl)
{
    if (!dataUrl)
        return;

    const image = document.createElement("img");
    image.src = dataUrl;
    image.alt = picture.dataset.path;
    picture.replaceChildren(image);
}

async function copyAssetReference(reference, button)
{
    try
    {
        await navigator.clipboard.writeText(reference);
    }
    catch
    {
        //A host that keeps the clipboard API from its page still copies a selection
        const selection = document.createElement("textarea");
        selection.value = reference;
        document.body.append(selection);
        selection.select();
        document.execCommand("copy");
        selection.remove();
    }

    button.textContent = "Copied";
    setTimeout(() => button.textContent = "Copy reference", 1500);
}

//Adds the picked files one after another. Those whose name is taken ask first, and what isn't a picture the library
//loads is left out and named
async function addAssets(files)
{
    const extensions = assetsList?.extensions ?? [];
    const isPicture = file => extensions.includes(file.name.slice(file.name.lastIndexOf(".")).toLowerCase());
    const pictures = files.filter(isPicture);
    const lines = files.filter(file => !isPicture(file)).map(file => "Left out " + file.name + ": not a picture the library loads (" + extensions.join(", ") + ").");
    let hasFailed = 0 < lines.length;

    isAddingAssets = true;
    document.getElementById("assets-add").disabled = true;

    try
    {
        const { clashes } = await HostBridge.request("assets.clashes", { names: pictures.map(file => file.name) });

        for (const file of pictures)
        {
            let onClash = "keepBoth"; //also when the name is taken after the check. Nothing is overwritten unasked

            if (clashes.includes(file.name))
            {
                const choice = await askAssetClash(file.name);

                if ("skip" === choice)
                {
                    lines.push("Skipped " + file.name + ".");
                    continue;
                }

                onClash = choice;
            }

            showAssetsStatus(lines.concat("Adding " + file.name + "…"), !hasFailed);

            try
            {
                lines.push("Added " + await uploadAsset(file, onClash) + ".");
            }
            catch (error)
            {
                lines.push(file.name + ": " + error.message);
                hasFailed = true;
            }
        }
    }
    catch (error)
    {
        lines.push(error.message);
        hasFailed = true;
    }
    finally
    {
        isAddingAssets = false;
    }

    showAssetsStatus(lines, !hasFailed);
    await loadAssets();
}

async function uploadAsset(file, onClash)
{
    const { uploadId } = await HostBridge.request("assets.uploadStart", { name: file.name, onClash: onClash });

    for (let offset = 0; offset < file.size; offset += assetsChunkBytes)
    {
        const data = assetBase64(await file.slice(offset, offset + assetsChunkBytes).arrayBuffer());
        await HostBridge.request("assets.uploadChunk", { uploadId: uploadId, data: data });
    }

    return (await HostBridge.request("assets.uploadEnd", { uploadId: uploadId })).savedAs;
}

//Resolves with replace, keepBoth or skip. Escape skips.
function askAssetClash(name)
{
    const dialog = document.getElementById("assets-clash");
    document.getElementById("assets-clash-text").textContent = name + " is in the folder already.";

    return new Promise(resolve =>
    {
        const listening = new AbortController();
        const choose = choice =>
        {
            listening.abort();
            dialog.close();
            resolve(choice);
        };

        for (const button of dialog.querySelectorAll("button"))
            button.addEventListener("click", () => choose(button.value), { signal: listening.signal });

        dialog.addEventListener("cancel", event =>
        {
            event.preventDefault();
            choose("skip");
        }, { signal: listening.signal });

        dialog.showModal();
    });
}

function showAssetsStatus(lines, isOk)
{
    const status = document.getElementById("assets-status");
    status.hidden = 0 === lines.length;
    status.classList.toggle("ok", isOk);
    const list = document.createElement("ul");
    list.className = "problems";

    for (const line of lines)
    {
        const item = document.createElement("li");
        item.textContent = line;
        list.append(item);
    }

    status.replaceChildren(list);
}

function assetSize(bytes)
{
    if (1024 > bytes)
        return bytes + " B";

    if (1024 * 1024 > bytes)
        return Math.round(bytes / 1024) + " KB";

    return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

//Base64 in slices, as one String.fromCharCode call over a whole piece would exceed the argument limit
function assetBase64(buffer)
{
    const bytes = new Uint8Array(buffer);
    let binary = "";

    for (let start = 0; start < bytes.length; start += 0x8000)
        binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));

    return btoa(binary);
}

if (HostBridge.isAvailable)
{
    const picker = document.getElementById("assets-picker");
    document.getElementById("assets-add").addEventListener("click", () => picker.click());
    document.getElementById("assets-refresh").addEventListener("click", loadAssets);

    picker.addEventListener("change", () =>
    {
        const files = [...picker.files];
        picker.value = ""; //so picking the same file again still reports a change

        if (0 < files.length)
            addAssets(files);
    });

    //Opening the tab shows the folders as they are now, and a change to Project.bechaml may name other asset folders
    document.querySelector(".tablinks[data-tab='Assets']").addEventListener("click", loadAssets);
    HostBridge.onEvent("project.changed", loadAssets);
    HostBridge.ready.then(loadAssets);
}
else
{
    document.getElementById("assets-add").disabled = true;
    document.getElementById("assets-refresh").disabled = true;
}
