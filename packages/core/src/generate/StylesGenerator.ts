import path from "node:path";
import type { Document, Element, Value } from "../bechaml/Syntax.js";
import type { Schema } from "../schema/Schema.js";
import type { GenerateProblem } from "./Generator.js";
import { CppWriter, generatedMark, MarkupGenerator, type Statement } from "./MarkupGenerator.js";

export const generatedStylesFolder = "source/generated/impl/Styles";

//A Flavors file: <Flavors> holding <Flavor Name="…"> entries (.bechaml/Plan.md 6)
export interface FlavorsInput
{
    readonly file: string; //Absolute.
    readonly text: string;
    readonly document: Document;
}

export interface FlavorsResult
{
    readonly names: readonly { name: string; element: Element }[]; //The flavors the file defines, Default included
    readonly registerFunction: string | undefined; //What Styles.cpp calls to register them. Undefined after an error
    readonly outputs: Map<string, string>; //Absolute paths
    readonly problems: GenerateProblem[];
}

export function generateFlavors(input: FlavorsInput, folder: string, namespace: string, schema: Schema, assetFolders: readonly string[]): FlavorsResult
{
    return new FlavorsGenerator(input, folder, namespace, schema, assetFolders).generate();
}

//Styles.hpp and Styles.cpp: RegisterStyles, which Start calls before the first window is built, so every widget finds its
//flavors in StylingManager from its first frame on.
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
        "    /// @brief Writes every flavor of the project's Flavors files into StylingManager. Start calls it before the first window.",
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

class FlavorsGenerator extends MarkupGenerator
{
    private readonly _input: FlavorsInput;
    private readonly _namespace: string;

    constructor(input: FlavorsInput, folder: string, namespace: string, schema: Schema, assetFolders: readonly string[])
    {
        super(input.file, input.text, folder, schema, assetFolders);
        this._input = input;
        this._namespace = namespace;
    }

    generate(): FlavorsResult
    {
        const outputs = new Map<string, string>();
        const names: { name: string; element: Element }[] = [];
        const result = (registerFunction: string | undefined): FlavorsResult => ({ names: names, registerFunction: registerFunction, outputs: outputs, problems: this._problems });
        const root = this._input.document.root;

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

        for (const attribute of root.attributes)
            this.error(attribute, "<Flavors> only holds <Flavor> entries.");

        const blocks: Statement[][] = [];

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

            if (element.value)
                this.error(element.value, "A flavor holds parts and settings, not a value.");

            //Default is the flavor every widget falls back to, after its own.
            const getter = "Default" === name ? "GetDefaultFlavor()" : "GetFlavor(" + JSON.stringify(name) + ")";
            const statements: Statement[] = [{ text: "RetroFuturaGUI::Flavor& flavor { RetroFuturaGUI::StylingManager::" + getter + " };", line: this.lineOf(element) }];
            statements.push(...this.attributeStatements(flavorClass, "Flavor", element.attributes.filter(attribute => attribute !== nameAttribute), "flavor."));
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
                    this.error(child, child.name + " isn't a part a flavor styles: " + Object.keys(flavorClass.parts).join(", ") + ".");
                    continue;
                }

                statements.push(...this.partStatements(flavorClass, child, "flavor."));
            }

            statements.push(...this.structSetterStatements(flavorClass, structElements, "flavor."));
            blocks.push(statements);
        }

        if (this.hasErrors())
            return result(undefined);

        const stem = path.basename(this._input.file).replace(/\.bechaml$/i, "");
        const registerFunction = "RegisterFlavors" + stem.replace(/\W/g, "_");
        const sourceFile = path.join(this._folder, ...generatedStylesFolder.split("/"), stem + "_flavors.cpp");
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

    //A flavor holds looks only.
    protected connection(value: Value): { lambda: string; isAsync: boolean } | undefined
    {
        this.error(value, "A flavor connects no signals: it holds looks only.");
        return undefined;
    }
}