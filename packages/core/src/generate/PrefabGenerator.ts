import path from "node:path";
import type { Attribute, Element, Value } from "../bechaml/Syntax.js";
import type { AssetKind } from "../project/Assets.js";
import type { Schema, SchemaClass } from "../schema/Schema.js";
import type { GenerateProblem } from "./Generator.js";
import { builtInArguments, CppWriter, generatedMark, lowerFirst, valueTypes, type Statement } from "./MarkupGenerator.js";
import { SceneGenerator, type SceneInput, type WidgetNode } from "./SceneGenerator.js";

//Generate's prefabs. A <Prefab> file and Schema.json become a struct, <Name>_prefab.hpp and .cpp, whose
//Build adds the prefab to a container with the file's values and keeps a reference to each of its widgets. Scenes reuse it
//for every instance they place. The project's prefabs go to source/generated/Prefabs/, RetroFuturaGUI's predefined ones to
//their own folder's generated/, where GeneratePrefabs writes them

export const generatedPrefabsFolder = "source/generated/Prefabs";

//A prefab as the scenes placing it need to know it
export interface PrefabModel
{
    readonly name: string;
    readonly cpp: string; //RetroFuturaGUI::Prefabs::StepperSlider
    readonly header: string; //StepperSlider_prefab.hpp
    readonly children: ReadonlyMap<string, PrefabChild>; //Every widget of the prefab by name, its root container first
    readonly files: ReadonlyMap<string, AssetKind | undefined>; //What its markup names, which the scenes placing it queue
}

export interface PrefabChild
{
    readonly name: string;
    readonly type: string;
    readonly schemaClass: SchemaClass;
    readonly member: string; //_ButtonUp, in the struct
    readonly valueType: string | undefined; //The C++ type its Type="…" picks, which an instance's entry keeps unless it gives its own
}

export interface PrefabProject
{
    readonly folder: string; //The project's RetroFuturaGUI sits in it
    readonly namespace: string; //The struct's RetroFuturaGUI::Prefabs, or the project's namespace and ::Prefabs
    readonly schema: Schema;
    readonly assetFolders: readonly string[];
    readonly outputFolder: string; //Absolute.
    readonly isLibrary: boolean; //Checked into RetroFuturaGUI, so its #line names files relative to it, the same on every machine
    readonly codeFolder: string; //Where the prefab's own code class goes, absolute. Its folder's code/, or beside a project's .bechaml
    readonly userHeader: string | undefined; //<Name>Code.hpp as it is now; undefined when it doesn't exist yet
    readonly userSource: string | undefined;
}

export interface PrefabResult
{
    readonly model: PrefabModel | undefined;
    readonly outputs: Map<string, string>; //Absolute paths
    readonly problems: GenerateProblem[];
}

export function generatePrefab(input: SceneInput, project: PrefabProject): PrefabResult
{
    return new PrefabGenerator(input, project).generatePrefab();
}

class PrefabGenerator extends SceneGenerator
{
    private readonly _prefabProject: PrefabProject;
    private readonly _signals = new Map<WidgetNode, Attribute[]>(); //Connected once every widget is there, as they may reach one built later
    private _buildSlot: string | undefined; //OnBuild=Slots.X: called once the prefab is built and its signals connected

    //Whether the prefab has code of its own: <Slot>s, which <Name>Code holds
    private hasCode(): boolean
    {
        return 0 < this._slots.size;
    }

    private codeName(): string
    {
        return this._name + "Code";
    }

    //What a connect function takes beside the struct. The code its slots are called on, when the prefab has any
    private codeParameter(): string
    {
        return this.hasCode() ? ", " + this.codeName() + "_p* code" : "";
    }

    //<Name>Code_p.hpp. The base of the prefab's code, with a copy of the references to its widgets and the slots its
    //author's class overrides. The prefab's struct connects to them, so it's a friend
    private codeBaseText(): string
    {
        const base = this.codeName() + "_p";
        return [
            generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.",
            "#pragma once",
            "#include \"" + this._name + "_prefab.hpp\"",
            "#include \"IPrefabCode.hpp\"",
            "",
            "#ifndef publicSlots",
            "#define publicSlots public",
            "#endif",
            "",
            "#ifndef privateSlots",
            "#define privateSlots private",
            "#endif",
            "",
            "namespace " + this._prefabProject.namespace,
            "{",
            "    /// @brief The base of the " + this._name + " prefab's code: its widgets, and the slots " + this.codeName() + " overrides.",
            "    class " + base + " : public RetroFuturaGUI::IPrefabCode",
            "    {",
            "        friend struct " + this._name + "; //connects its widgets' signals to the slots.",
            "",
            "    protected:",
            "        explicit " + base + "(const " + this._name + "& widgets) : _widgets(widgets) {}",
            "",
            "    //Widgets, empty once the prefab is gone.",
            "        const " + this._name + " _widgets;",
            "",
            "    //Slots, which " + this.codeName() + " overrides.",
            ...[...this._slots.values()].map(slot => "        virtual " + slot.returnType + " " + slot.name + "(" + slot.params + ") = 0;"),
            "    };",
            "}",
            ""
        ].join("\n");
    }

    constructor(input: SceneInput, project: PrefabProject)
    {
        super(input, { folder: project.folder, namespace: project.namespace, schema: project.schema, sceneNames: new Set(), assetFolders: project.assetFolders, userHeader: undefined, userSource: undefined, prefabs: new Map() });
        this._prefabProject = project;
    }

    generatePrefab(): PrefabResult
    {
        const outputs = new Map<string, string>();
        const result = (model?: PrefabModel): PrefabResult => ({ model: model, outputs: outputs, problems: this._problems });
        const root = this._scene.document.root;

        for (const diagnostic of this._scene.document.diagnostics)
            this.error(diagnostic, diagnostic.message);

        if (!root || this.hasErrors())
            return result();

        const name = this.readClassName(root, "Prefab");

        if (!name)
            return result();

        this._name = name;

        //Its slots, which its code class holds (<Name>Code in its code folder), as a scene's class holds the scene's
        for (const slot of root.elements.filter(child => "Slot" === child.name))
        {
            const declared = this.readSlot(slot, this._slots);

            if (declared)
                this._slots.set(declared.name, declared);
        }

        for (const attribute of root.attributes.filter(candidate => "Name" !== candidate.name))
        {
            if ("OnBuild" !== attribute.name)
            {
                this.error(attribute, "<Prefab> takes only its Name and OnBuild=Slots.<Name>; its values go on its widgets.");
                continue;
            }

            const [kind, slotName] = "Reference" === attribute.value?.kind && 2 === attribute.value.segments.length ? attribute.value.segments : [];
            const slot = "Slots" === kind && slotName ? this._slots.get(slotName) : undefined;

            if (!slot || 0 < slot.paramCount)
                this.error(attribute.value ?? attribute, "OnBuild names a slot of the prefab without parameters, declared by a <Slot>: OnBuild=Slots.Initialize.");
            else
                this._buildSlot = slot.name;
        }

        const rootElement = root.elements.find(child => "Slot" !== child.name);

        if (!rootElement)
            return result();

        const rootNode = this.readWidget(rootElement, undefined, 0);

        if (!rootNode)
            return result();

        if (!rootNode.schemaClass.container)
        {
            this.error(rootElement, "<" + rootElement.name + "> isn't a container; a prefab's root container is one, such as <Lasagna>.");
            return result();
        }

        //The setups first, as they find the signals build() connects at its end
        const setups = this._widgets.filter(widget => widget.parent).map(widget => ({ widget: widget, statements: this.setupStatements(widget) }));
        const build = this.prefabBuildStatements(rootNode);
        const connections = [...this._signals].map(([widget, attributes]) => ({ widget: widget, statements: this.connectStatements(widget, attributes) }));

        if (this.hasErrors())
            return result();

        const headerFile = path.join(this._prefabProject.outputFolder, name + "_prefab.hpp");
        const sourceFile = path.join(this._prefabProject.outputFolder, name + "_prefab.cpp");
        outputs.set(headerFile, this.prefabHeaderText(setups.map(setup => setup.widget), connections.map(connection => connection.widget)));
        outputs.set(sourceFile, this.prefabSourceText(sourceFile, build, setups, connections));

        //Its code. The generated base, and the class of the prefab's author, made once and then only given the slots it lacks
        if (this.hasCode())
        {
            const project = this._prefabProject;
            outputs.set(path.join(project.outputFolder, this.codeName() + "_p.hpp"), this.codeBaseText());
            const constructor = "explicit " + this.codeName() + "(const " + name + "& widgets) : " + this.codeName() + "_p(widgets) {}";
            this.userFiles({ name: this.codeName(), namespace: project.namespace, constructor: constructor, slots: [...this._slots.values()], header: project.userHeader, source: project.userSource, folder: project.codeFolder }).forEach((text, file) => outputs.set(file, text));
        }

        const children = new Map<string, PrefabChild>();

        for (const widget of this._widgets)
        {
            //Checked when its setup was written, so it only needs reading here
            const type = widget.element.attributes.find(attribute => "Type" === attribute.name)?.value;
            const valueType = "String" === type?.kind ? valueTypes[type.value] : undefined;
            children.set(widget.name, { name: widget.name, type: widget.type, schemaClass: widget.schemaClass, member: "_" + widget.name, valueType: valueType });
        }

        return result({ name: name, cpp: this._prefabProject.namespace + "::" + name, header: name + "_prefab.hpp", children: children, files: new Map(this._files) });
    }

    //Hooks

    protected override kind(): string
    {
        return "prefab";
    }

    protected override rootName(): string
    {
        return "Root";
    }

    //The struct's member, reached through the struct being built
    protected override memberOf(name: string): string
    {
        return "built._" + name;
    }

    protected override setupCall(child: WidgetNode, parent: WidgetNode): string
    {
        return "setup" + child.name + "(built, *" + parent.local + ");";
    }

    //Signals wait for connect<Name>. A widget built earlier may call one built later
    protected override ownAttributes(widget: WidgetNode, consumed: ReadonlySet<Attribute>): Attribute[]
    {
        const own = super.ownAttributes(widget, consumed);
        const signals = own.filter(attribute => /^On[A-Z]/.test(attribute.name));

        if (0 < signals.length)
            this._signals.set(widget, signals);

        return own.filter(attribute => !signals.includes(attribute));
    }

    //@ActualSlider.StepUp: a function of one of the prefab's widgets, reached through a copy of its reference, taken once
    //every widget is built. Slots.X. A slot of the prefab's code, which the Prefab owns. A prefab's own wiring reaches nothing else
    protected override connection(value: Value, argumentCount: number): { lambda: string; isAsync: boolean } | undefined
    {
        const [kind, name] = "Reference" === value.kind && 2 === value.segments.length ? value.segments : [];

        if ("Slots" === kind && name)
        {
            const slot = this._slots.get(name);

            if (!slot)
            {
                this.error(value, "The prefab declares no slot " + name + ": add <Slot>void " + name + "()</Slot>.");
                return undefined;
            }

            if (0 === slot.paramCount)
                return { lambda: "[code]" + (0 === argumentCount ? "()" : "(auto&&...)") + " { code->" + name + "(); }", isAsync: slot.isAsync };

            if (slot.paramCount !== argumentCount)
            {
                this.error(value, name + " takes " + slot.paramCount + " values, but the signal hands over " + argumentCount + ".");
                return undefined;
            }

            this._usesForward = true;
            return { lambda: "[code](auto&&... arguments) { code->" + name + "(std::forward<decltype(arguments)>(arguments)...); }", isAsync: slot.isAsync };
        }

        if (!kind?.startsWith("@") || !name)
        {
            this.unknownTarget(value, "a function of one of the prefab's widgets (@<Widget>.<Function>) or one of its slots (Slots.<Name>),");
            return undefined;
        }

        const widgetName = kind.slice(1);
        const widget = this._widgets.find(node => widgetName === node.name);

        if (!widget)
        {
            this.error(value, "The prefab has no widget named " + widgetName + ".");
            return undefined;
        }

        const slot = widget.schemaClass.slots[name];
        const callArguments = slot ? builtInArguments(slot.params) : undefined;

        if (!slot || !callArguments)
        {
            const names = Object.entries(widget.schemaClass.slots).filter(([, entry]) => builtInArguments(entry.params)).map(([slotName]) => slotName);
            this.error(value, "A " + widget.type + " has no function " + name + (names.length ? ": " + names.join(", ") + "." : "; it has none to call yet."));
            return undefined;
        }

        const target = lowerFirst(widgetName) + "Target";
        const parameters = 0 === argumentCount ? "()" : "(auto&&...)";
        return { lambda: "[" + target + " = built._" + widgetName + "]" + parameters + " { if(!" + target + ") return; " + target + "->" + slot.call + "(" + callArguments.join(", ") + "); }", isAsync: false };
    }

    //Statements

    //build(). The root container in the Prefab's place, its values, its widgets' setups, then their signals
    private prefabBuildStatements(rootNode: WidgetNode): Statement[]
    {
        const consumed = new Set<Attribute>(rootNode.element.attributes.filter(attribute => "Name" === attribute.name));
        const constructor = this.constructorArguments(rootNode, consumed);
        const line = this.lineOf(rootNode.element);
        const statements: Statement[] =
        [
            { text: "RetroFuturaGUI::Prefab* prefab { built._Prefab.Get() };" },
            { text: "" },
            { text: "if(!prefab)" },
            { text: "    return;" },
            { text: "" },
            { text: rootNode.member + " = prefab->SetRootContainer<" + rootNode.schemaClass.cpp + ">(" + [JSON.stringify(rootNode.name), ...(constructor ? [constructor] : [])].join(", ") + ");", line: line },
            { text: rootNode.schemaClass.cpp + "* " + rootNode.local + " { " + rootNode.member + ".Get() };" },
            { text: "" },
            { text: "if(!" + rootNode.local + ")" },
            { text: "    return;" }
        ];

        statements.push(...this.widgetBody(rootNode, consumed));

        //The prefab's code, owned by the Prefab, so its slots live exactly as long as the widgets calling them
        if (this.hasCode())
        {
            statements.push(
                { text: "" },
                { text: "std::unique_ptr<" + this.codeName() + "> ownCode { std::make_unique<" + this.codeName() + ">(built) };" },
                { text: this.codeName() + "_p* code { ownCode.get() };" },
                { text: "prefab->AdoptCode(std::move(ownCode));" });
        }

        const codeArgument = this.hasCode() ? ", code" : "";

        if (0 < this._signals.size)
        {
            statements.push({ text: "" });

            for (const widget of this._signals.keys())
                statements.push({ text: "connect" + widget.name + "(built" + codeArgument + ");" });
        }

        if (this._buildSlot)
            statements.push({ text: "" }, { text: "code->" + this._buildSlot + "();" });

        return statements;
    }

    private connectStatements(widget: WidgetNode, signals: readonly Attribute[]): Statement[]
    {
        return [
            { text: widget.schemaClass.cpp + "* " + widget.local + " { " + widget.member + ".Get() };" },
            { text: "" },
            { text: "if(!" + widget.local + ")" },
            { text: "    return;" },
            { text: "" },
            ...this.attributeStatements(widget.schemaClass, widget.type, signals, widget.local + "->")
        ];
    }

    //Files

    private prefabHeaderText(setups: readonly WidgetNode[], connected: readonly WidgetNode[]): string
    {
        const namespace = this._prefabProject.namespace;
        const headers = [...new Set(["Prefab.hpp", "WidgetReference.hpp", ...this._headers])].filter(header => !header.startsWith("<")).sort();
        const lines: string[] =
        [
            generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.",
            "#pragma once",
            ...headers.map(header => "#include \"" + header + "\""),
            "#include <string_view>",
            "",
            "namespace " + namespace,
            "{",
            ...(this.hasCode() ? ["    class " + this.codeName() + "_p;", ""] : []),
            "    /// @brief The " + this._name + " prefab. Build adds it to a container and returns a reference to each of its widgets.",
            "    struct " + this._name,
            "    {",
            "    //Widgets, empty once the prefab is gone.",
            "        RetroFuturaGUI::WidgetReference<RetroFuturaGUI::Prefab> _Prefab { nullptr };"
        ];

        for (const widget of this._widgets)
            lines.push("        RetroFuturaGUI::WidgetReference<" + widget.schemaClass.cpp + "> " + widget.member.slice("built.".length) + " { nullptr };");

        lines.push(
            "",
            "        /// @brief Adds the prefab to the container under the name, builds its widgets with the prefab file's values and",
            "        ///        connects their signals. A placing scene sets its own values on the widgets afterwards.",
            "        template<typename Container, typename Placement>",
            "        static " + this._name + " Build(Container& container, std::string_view name, const Placement& placement)",
            "        {",
            "            " + this._name + " built {};",
            "            built._Prefab = container.template AddWidget<RetroFuturaGUI::Prefab>(name, placement);",
            "            build(built);",
            "            return built;",
            "        }",
            "",
            "    private:",
            "        static void build(" + this._name + "& built);");

        if (0 < setups.length)
        {
            lines.push("", "    //Setup of each widget, so a widget that can't be built skips only its own.");

            for (const widget of setups)
                lines.push("        static void setup" + widget.name + "(" + this._name + "& built, " + (widget.parent as WidgetNode).schemaClass.cpp + "& " + (widget.parent as WidgetNode).local + ");");
        }

        if (0 < connected.length)
        {
            lines.push("", "    //Signals of each widget, connected once every widget is there.");

            for (const widget of connected)
                lines.push("        static void connect" + widget.name + "(" + this._name + "& built" + this.codeParameter() + ");");
        }

        lines.push("    };", "}", "");
        return lines.join("\n");
    }

    private prefabSourceText(file: string, build: Statement[], setups: { widget: WidgetNode; statements: Statement[] }[], connections: { widget: WidgetNode; statements: Statement[] }[]): string
    {
        //RetroFuturaGUI's copy names the files relative to itself, so #line reads the same on every machine
        const writer = this._prefabProject.isLibrary
            ? new CppWriter(path.basename(file), path.relative(path.dirname(file), this._scene.file))
            : new CppWriter(file, this._scene.file);
        const name = this._prefabProject.namespace + "::" + this._name;
        const includes = ["\"" + this._name + "_prefab.hpp\"", ...(this.hasCode() ? ["\"" + this.codeName() + ".hpp\"", "<memory>"] : []), ...[...this._headers].filter(header => header.startsWith("<"))];

        if (this._usesForward)
            includes.push("<utility>");

        writer.write(generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.");

        for (const include of [...new Set(includes)])
            writer.write("#include " + include);

        writer.write("");
        writer.write("void " + name + "::build(" + this._name + "& built)");
        writer.write("{");
        writer.writeAll(build, "    ");
        writer.write("}");

        for (const { widget, statements } of setups)
        {
            const parent = widget.parent as WidgetNode;
            writer.write("");
            writer.write("void " + name + "::setup" + widget.name + "(" + this._name + "& built, " + parent.schemaClass.cpp + "& " + parent.local + ")");
            writer.write("{");
            writer.writeAll(statements, "    ");
            writer.write("}");
        }

        for (const { widget, statements } of connections)
        {
            writer.write("");
            writer.write("void " + name + "::connect" + widget.name + "(" + this._name + "& built" + this.codeParameter() + ")");
            writer.write("{");
            writer.writeAll(statements, "    ");
            writer.write("}");
        }

        return writer.text();
    }
}

//The prefab's name as its file gives it, so every prefab is known before the scenes placing them are generated
export function prefabName(root: Element | undefined): string | undefined
{
    const name = root?.attributes.find(attribute => "Name" === attribute.name)?.value;
    return "String" === name?.kind ? name.value : undefined;
}
