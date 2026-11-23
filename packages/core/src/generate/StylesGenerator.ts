import path from "node:path";
import type { Document, Element, Value } from "../bechaml/Syntax.js";
import type { Schema, SchemaClass } from "../schema/Schema.js";
import type { GenerateProblem } from "./Generator.js";
import { CppWriter, generatedMark, MarkupGenerator, type Statement } from "./MarkupGenerator.js";

export const generatedStylesFolder = "source/generated/impl/Styles";

//A style file: <Flavors> holding <Flavor Name="…"> entries (.bechaml/Plan.md 6), or an <Aesthetic Name="…"> holding entries
//by widget type (7)
export interface StyleInput
{
    readonly file: string; //Absolute.
    readonly text: string;
    readonly document: Document;
}

export interface StyleResult
{
    readonly kind: "Flavors" | "Aesthetic";
    readonly names: readonly { name: string; element: Element }[]; //The flavors the file defines (Default included), or its Aesthetic
    readonly registerFunction: string | undefined; //What Styles.cpp calls to register them. Undefined after an error
    readonly outputs: Map<string, string>; //Absolute paths
    readonly problems: GenerateProblem[];
}

export function generateStyles(input: StyleInput, folder: string, namespace: string, schema: Schema, assetFolders: readonly string[]): StyleResult
{
    return new StylesGenerator(input, folder, namespace, schema, assetFolders).generate();
}

//Styles.hpp and Styles.cpp: RegisterStyles, which Start calls before the first window is built, so every widget finds its
//flavors and its Aesthetic's entries in StylingManager from its first frame on.
export function stylesFiles(folder: string, namespace: string, registerFunctions: readonly string[]): Map<string, string>
{
    const folderPath = path.join(folder, ...generatedStylesFolder.split("/"));
    const header =
    [
        generatedMark + ". Generate rewrites it.",
        "#pragma once",
        "",
        "namespace " + namespace,
        "{",
        "    /// @brief Writes every flavor and Aesthetic of the project's style files into StylingManager. Start calls it before the first window.",
        "    void RegisterStyles();",
        "",
        ...registerFunctions.map(name => "    void " + name + "();"),
        "}",
        ""
    ];

    const source =
    [
        generatedMark + ". Generate rewrites it.",
        "#include \"Styles.hpp\"",
        "",
        "void " + namespace + "::RegisterStyles()",
        "{",
        ...registerFunctions.map(name => "    " + name + "();"),
        "}",
        ""
    ];

    return new Map([[path.join(folderPath, "Styles.hpp"), header.join("\n")], [path.join(folderPath, "Styles.cpp"), source.join("\n")]]);
}

class StylesGenerator extends MarkupGenerator
{
    private readonly _input: StyleInput;
    private readonly _namespace: string;

    constructor(input: StyleInput, folder: string, namespace: string, schema: Schema, assetFolders: readonly string[])
    {
        super(input.file, input.text, folder, schema, assetFolders);
        this._input = input;
        this._namespace = namespace;
    }

    generate(): StyleResult
    {
        const outputs = new Map<string, string>();
        const names: { name: string; element: Element }[] = [];
        const root = this._input.document.root;
        const kind = "Aesthetic" === root?.name ? "Aesthetic" : "Flavors";
        const result = (registerFunction: string | undefined): StyleResult => ({ kind: kind, names: names, registerFunction: registerFunction, outputs: outputs, problems: this._problems });

        for (const diagnostic of this._input.document.diagnostics)
            this.error(diagnostic, diagnostic.message);

        if (!root || 0 < this._problems.length)
            return result(undefined);

        const flavorClass = this._schema.classes["Flavor"];

        if (!flavorClass)
        {
            this.error(root, "RetroFuturaGUI/Schema.json has no Flavor: run roux schema.");
            return result(undefined);
        }

        const blocks = "Aesthetic" === kind ? this.aestheticBlocks(root, flavorClass, names) : this.flavorBlocks(root, flavorClass, names);

        if (this.hasErrors())
            return result(undefined);

        const stem = path.basename(this._input.file).replace(/\.bechaml$/i, "");
        const registerFunction = ("Aesthetic" === kind ? "RegisterAesthetic" : "RegisterFlavors") + stem.replace(/\W/g, "_");
        const sourceFile = path.join(this._folder, ...generatedStylesFolder.split("/"), stem + ("Aesthetic" === kind ? "_aesthetic.cpp" : "_flavors.cpp"));
        const writer = new CppWriter(sourceFile, this._input.file);
        writer.write(generatedMark + " from " + path.relative(this._folder, this._input.file).split(path.sep).join("/") + ". Generate rewrites it, so change the .bechaml instead.");
        writer.write("#include \"Styles.hpp\"");
        writer.write("#include \"StylingManager.hpp\"");

        for (const header of [...this._headers].sort())
            writer.write(header.startsWith("<") ? "#include " + header : "#include \"" + header + "\"");

        writer.write("");
        writer.write("void " + this._namespace + "::" + registerFunction + "()");
        writer.write("{");

        blocks.forEach((block, index) =>
        {
            if (0 < index)
                writer.write("");

            writer.write("    {");
            writer.writeAll(block, "        ");
            writer.write("    }");
        });

        writer.write("}");
        outputs.set(sourceFile, writer.text());
        return result(registerFunction);
    }

    //<Flavors>: a block per <Flavor Name="…">.
    private flavorBlocks(root: Element, flavorClass: SchemaClass, names: { name: string; element: Element }[]): Statement[][]
    {
        const blocks: Statement[][] = [];

        for (const attribute of root.attributes)
            this.error(attribute, "<Flavors> only holds <Flavor> entries.");

        for (const element of root.elements)
        {
            if ("Flavor" !== element.name)
            {
                this.error(element, "<Flavors> holds <Flavor Name=\"…\"> entries, not <" + element.name + ">.");
                continue;
            }

            const nameAttribute = element.attributes.find(attribute => "Name" === attribute.name);
            const name = "String" === nameAttribute?.value?.kind ? nameAttribute.value.value : undefined;

            if (!name || !/^[A-Za-z_]\w*$/.test(name))
            {
                this.error(nameAttribute ?? element, "A flavor is named by a string that is a name: <Flavor Name=\"Primary\">.");
                continue;
            }

            if (names.some(known => name === known.name))
            {
                this.error(nameAttribute ?? element, "This file names a flavor " + name + " already.");
                continue;
            }

            names.push({ name: name, element: element });

            //Default is the flavor every widget falls back to, after its own.
            const getter = "Default" === name ? "GetDefaultFlavor()" : "GetFlavor(" + JSON.stringify(name) + ")";
            blocks.push(this.entryStatements(element, "RetroFuturaGUI::StylingManager::" + getter, flavorClass, nameAttribute));
        }

        return blocks;
    }

    //<Aesthetic Name="…">: a block per entry. <Button> styles every Button in the scenes using it, <AnyWidget> every widget
    //after its type's entry; a popup type (<FileExplorer>, or <Popup> for every popup) holds the entries for the widgets
    //inside that kind of popup, with its <Title> and <Icon>.
    private aestheticBlocks(root: Element, flavorClass: SchemaClass, names: { name: string; element: Element }[]): Statement[][]
    {
        const blocks: Statement[][] = [];
        const nameAttribute = root.attributes.find(attribute => "Name" === attribute.name);
        const name = "String" === nameAttribute?.value?.kind ? nameAttribute.value.value : undefined;

        for (const attribute of root.attributes.filter(attribute => attribute !== nameAttribute))
            this.error(attribute, "An Aesthetic holds entries by widget type, not values of its own.");

        if (!name || !/^[A-Za-z_]\w*$/.test(name))
        {
            this.error(nameAttribute ?? root, "An Aesthetic is named by a string that is a name: <Aesthetic Name=\"ColorfulPop\">.");
            return blocks;
        }

        names.push({ name: name, element: root });
        const stem = path.basename(this._input.file).replace(/\.bechaml$/i, "");

        if (stem !== name)
            this.error(nameAttribute ?? root, "The Aesthetic is named " + name + ", but its file " + stem + ".bechaml: the two have to match.");

        const aesthetic = JSON.stringify(name);
        const popupScopes = new Map<string, readonly string[]>(Object.entries(this._schema.classes).flatMap(([popup, schemaClass]) => schemaClass.popupScopes ? [[popup, schemaClass.popupScopes] as [string, readonly string[]]] : []));
        popupScopes.set("Popup", ["Popup"]);

        for (const element of root.elements)
        {
            const scopes = popupScopes.get(element.name);

            if (!scopes)
            {
                const entry = this.entryGetter(element);

                if (entry)
                    blocks.push(this.entryStatements(element, "RetroFuturaGUI::StylingManager::GetAesthetic(" + aesthetic + ")." + entry, flavorClass));

                continue;
            }

            for (const attribute of element.attributes)
                this.error(attribute, "<" + element.name + "> holds entries by widget type, not values of its own.");

            //A popup type with several scopes, as a MessagePopup's message, warning and error, takes its entries in each.
            for (const child of element.elements)
            {
                const entry = this.entryGetter(child, true);

                if (!entry)
                    continue;

                for (const scope of scopes)
                    blocks.push(this.entryStatements(child, "RetroFuturaGUI::StylingManager::GetAesthetic(" + aesthetic + ", RetroFuturaGUI::StyleScope::" + scope + ")." + entry, flavorClass));
            }
        }

        return blocks;
    }

    //The FlavorScope call an Aesthetic's entry is reached by: GetEntry(WidgetTypeID::Button), GetAnyWidget(), and inside a
    //popup type GetTitle() and GetIcon().
    private entryGetter(element: Element, isInPopup = false): string | undefined
    {
        if ("AnyWidget" === element.name)
            return "GetAnyWidget()";

        if (isInPopup && ("Title" === element.name || "Icon" === element.name))
            return "Get" + element.name + "()";

        const widgetTypes = this._schema.enums["WidgetTypeID"]?.values ?? [];

        if ("widget" === this._schema.classes[element.name]?.role && widgetTypes.includes(element.name))
            return "GetEntry(RetroFuturaGUI::WidgetTypeID::" + element.name + ")";

        this.error(element, "<" + element.name + "> isn't a widget type, <AnyWidget>" + (isInPopup ? ", <Title> or <Icon>." : " or a popup type."));
        return undefined;
    }

    //A flavor's or an entry's values, parts and struct elements, set on the Flavor the getter reaches.
    private entryStatements(element: Element, getter: string, flavorClass: SchemaClass, nameAttribute?: Element["attributes"][number]): Statement[]
    {
        if (element.value)
            this.error(element.value, "<" + element.name + "> holds parts and settings, not a value.");

        const statements: Statement[] = [{ text: "RetroFuturaGUI::Flavor& flavor { " + getter + " };", line: this.lineOf(element) }];
        statements.push(...this.attributeStatements(flavorClass, element.name, element.attributes.filter(attribute => attribute !== nameAttribute), "flavor."));
        const structElements: Element[] = [];

        for (const child of element.elements)
        {
            if (this.structSetterOf(flavorClass, child.name))
            {
                structElements.push(child);
                continue;
            }

            if (!flavorClass.parts[child.name])
            {
                this.error(child, child.name + " isn't a part a style sets: " + Object.keys(flavorClass.parts).join(", ") + ".");
                continue;
            }

            statements.push(...this.partStatements(flavorClass, child, "flavor."));
        }

        statements.push(...this.structSetterStatements(flavorClass, structElements, "flavor."));
        return statements;
    }

    //A style holds looks only.
    protected connection(value: Value): { lambda: string; isAsync: boolean } | undefined
    {
        this.error(value, "A style connects no signals: it holds looks only.");
        return undefined;
    }
}
