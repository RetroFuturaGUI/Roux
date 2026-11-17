//Packs the extension into a .vsix without vsce or a bundler: the extension's own files, and Roux's packages it loads at
//run time (core, protocol, ui) copied into its node_modules, since none of them has a third-party dependency.
//Usage: npm run package (after npm run build), then code --install-extension roux-vscode-<version>.vsix
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateRawSync } from "node:zlib";

const extensionFolder = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packagesFolder = path.resolve(extensionFolder, "../../packages");
const manifest = JSON.parse(readFileSync(path.join(extensionFolder, "package.json"), "utf8"));
const entries = [];

function addFile(name, file)
{
    entries.push({ name: name, data: readFileSync(file) });
}

//Tests stay out. The core's compiled tests and their fixtures
function addFolder(prefix, folder)
{
    for (const entry of readdirSync(folder, { withFileTypes: true }))
    {
        if (entry.isDirectory() && "test" === entry.name)
            continue;

        const file = path.join(folder, entry.name);

        if (entry.isDirectory())
            addFolder(prefix + entry.name + "/", file);
        else
            addFile(prefix + entry.name, file);
    }
}

function addPackage(name, folder, contentFolder)
{
    const prefix = "extension/node_modules/@retrofuturagui/" + name + "/";
    addFile(prefix + "package.json", path.join(folder, "package.json"));
    addFolder(prefix + contentFolder + "/", path.join(folder, contentFolder));
}

const vsixManifest = `<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
    <Metadata>
        <Identity Language="en-US" Id="${manifest.name}" Version="${manifest.version}" Publisher="${manifest.publisher}"/>
        <DisplayName>${manifest.displayName}</DisplayName>
        <Description xml:space="preserve">${manifest.description}</Description>
        <Properties>
            <Property Id="Microsoft.VisualStudio.Code.Engine" Value="${manifest.engines.vscode}"/>
        </Properties>
    </Metadata>
    <Installation>
        <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
    </Installation>
    <Dependencies/>
    <Assets>
        <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/>
    </Assets>
</PackageManifest>
`;

const contentTypes = `<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">${[["json", "application/json"], ["js", "application/javascript"], ["map", "application/json"], ["ts", "text/plain"], ["html", "text/html"], ["css", "text/css"], ["vsixmanifest", "text/xml"]].map(([extension, type]) => `<Default Extension=".${extension}" ContentType="${type}"/>`).join("")}</Types>
`;

entries.push({ name: "extension.vsixmanifest", data: Buffer.from(vsixManifest) });
entries.push({ name: "[Content_Types].xml", data: Buffer.from(contentTypes) });
addFile("extension/package.json", path.join(extensionFolder, "package.json"));
addFolder("extension/out/", path.join(extensionFolder, "out"));
addPackage("roux-core", path.join(packagesFolder, "core"), "out");
addPackage("roux-protocol", path.join(packagesFolder, "protocol"), "out");
addPackage("roux-ui", path.join(packagesFolder, "ui"), "src");

//A plain zip. Deflated entries, UTF-8 names, then the central directory
const parts = [];
const directory = [];
let offset = 0;

for (const entry of entries)
{
    const name = Buffer.from(entry.name);
    const compressed = deflateRawSync(entry.data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc32(entry.data), 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    header.copy(central, 8, 6, 30); //flags, method, time, date, crc, sizes, name length
    central.writeUInt32LE(offset, 42);

    parts.push(header, name, compressed);
    directory.push(central, name);
    offset += header.length + name.length + compressed.length;
}

const directorySize = directory.reduce((total, part) => total + part.length, 0);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(directorySize, 12);
end.writeUInt32LE(offset, 16);

const vsix = path.join(extensionFolder, manifest.name + "-" + manifest.version + ".vsix");
writeFileSync(vsix, Buffer.concat([...parts, ...directory, end]));
console.log("Wrote " + vsix + " (" + entries.length + " files)");
