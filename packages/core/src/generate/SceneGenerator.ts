import path from "node:path";
import type { Attribute, Document, Element, Value } from "../bechaml/Syntax.js";
import type { Schema, SchemaClass } from "../schema/Schema.js";
import type { GenerateProblem } from "./Generator.js";
import type { PrefabModel } from "./PrefabGenerator.js";
import { builtInArguments, cppKeywords, CppWriter, generatedMark, headerName, integerTypes, lowerFirst, MarkupGenerator, upperFirst, type SlotDeclaration, type Statement } from "./MarkupGenerator.js";

//Generate's scenes (Roux plan, 6.1 and 6.2.1): a <Scene> file and Schema.json become the scene's base class
//(<Name>_p.hpp and _setup.cpp in source/generated/impl/Scenes/), and the user's class next to the .bechaml, made once and
//then only given the slots it lacks.

export const generatedScenesFolder = "source/generated/impl/Scenes";

export interface SceneInput
{
    readonly file: string; //Absolute.
    readonly text: string;
    readonly document: Document;
}

export interface SceneProject
{
    readonly folder: string;
    readonly namespace: string;
    readonly schema: Schema;
    readonly sceneNames: ReadonlySet<string>; //Every scene's, for Scenes.X.
    readonly assetFolders: readonly string[]; //The project's, relative to it, as Project.bechaml lists them
    readonly userHeader: string | undefined; //The user's <Name>.hpp as it is now; undefined when it doesn't exist yet.
    readonly userSource: string | undefined;
    readonly prefabs: ReadonlyMap<string, PrefabModel>; //Every prefab a scene may place, RetroFuturaGUI's and the project's, by name
    readonly flavorNames?: ReadonlySet<string>; //Every flavor the project's Flavors files define, for Flavors.X; left out, none are checked
}

export interface SceneResult
{
    readonly name: string | undefined;
    readonly loads: readonly string[]; //The scenes its Slots.LoadScene(Scenes.X) load, so the windows showing it can check they list them
    readonly outputs: Map<string, string>; //Absolute paths.
    readonly problems: GenerateProblem[];
}

//The scene's name as its file gives it, so every scene's name is known before any is generated.
export function sceneName(document: Document): string | undefined
{
    const name = document.root?.attributes.find(attribute => "Name" === attribute.name)?.value;
    return "String" === name?.kind ? name.value : undefined;
}

export function generateScene(scene: SceneInput, project: SceneProject): SceneResult
{
    return new SceneGenerator(scene, project).generate();
}

//GeneratedScene.hpp and .cpp: what every generated scene derives from.
export function generatedSceneBase(folder: string, namespace: string): Map<string, string>
{
    const folderPath = path.join(folder, ...generatedScenesFolder.split("/"));
    const header =
    [
        generatedMark + ". Generate rewrites it.",
        "#pragma once",
        "#include \"ISceneHost.hpp\"",
        "#include \"Scene.hpp\"",
        "#include \"Window.hpp\"",
        "#include <concepts>",
        "#include <functional>",
        "#include <memory>",
        "#include <string_view>",
        "#include <utility>",
        "",
        "//The labels a class declares its slots under, which Roux looks for.",
        "#ifndef publicSlots",
        "#define publicSlots public",
        "#endif",
        "#ifndef privateSlots",
        "#define privateSlots private",
        "#endif",
        "",
        "namespace " + namespace,
        "{",
        "    /// @brief What every generated scene shares: the scene it builds, the window it sits in, and the slots that load",
        "    ///        scenes into that window and take them out",
        "    class GeneratedScene : public RetroFuturaGUI::ISceneHost",
        "    {",
        "    public:",
        "        /// @brief Whether a scene asks its window to add a scene or to take one out.",
        "        enum class SceneChange : u32",
        "        {",
        "            Load,",
        "            Unload",
        "        };",
        "",
        "        /// @brief What a scene calls to have its window add or take out the named scene once the frame is over",
        "        using SceneRequest = std::function<void(const SceneChange change, std::string_view sceneName)>;",
        "",
        "        GeneratedScene(const GeneratedScene&) = delete;",
        "        GeneratedScene(GeneratedScene&&) = delete;",
        "        auto operator =(const GeneratedScene&) = delete;",
        "        auto operator =(GeneratedScene&&) = delete;",
        "        ~GeneratedScene() override;",
        "",
        "        RetroFuturaGUI::Scene* GetScene() const override;",
        "",
        "        /// @brief Constructs a scene of type T, then builds its widgets, which can only happen once T's own members exist.",
        "        template<std::derived_from<GeneratedScene> T> static std::unique_ptr<T> Create(RetroFuturaGUI::Window* parentWindow, SceneRequest sceneRequest)",
        "        {",
        "            std::unique_ptr<T> scene { std::make_unique<T>(parentWindow) };",
        "            GeneratedScene& generated { *scene };",
        "            generated._sceneRequest = std::move(sceneRequest);",
        "            generated.build();",
        "            return scene;",
        "        }",
        "",
        "    publicSlots:",
        "        /// @brief Adds the named scene to the window this scene sits in, after the scenes it shows, once the frame is over",
        "        ///        and the scene's files are loaded. Does nothing for a scene the window shows or was asked for already.",
        "        void LoadScene(std::string_view sceneName) const;",
        "",
        "        /// @brief Takes the named scene out of the window this scene sits in once the frame is over, this scene too. Does",
        "        ///        nothing for a scene the window doesn't show.",
        "        void UnloadScene(std::string_view sceneName) const;",
        "",
        "    protected:",
        "        explicit GeneratedScene(RetroFuturaGUI::Window* parentWindow);",
        "",
        "        /// @brief Calls one of the window's slots, such as Minimize. Does nothing without a window.",
        "        void callWindowSlot(void (RetroFuturaGUI::Window::*slot)()) const;",
        "",
        "        std::unique_ptr<RetroFuturaGUI::Scene> _scene { nullptr };",
        "        RetroFuturaGUI::Window* _parentWindow { nullptr };",
        "",
        "    private:",
        "        /// @brief Creates the scene and its widgets.",
        "        virtual void build() = 0;",
        "",
        "        SceneRequest _sceneRequest {};",
        "    };",
        "}",
        ""
    ];

    const source =
    [
        generatedMark + ". Generate rewrites it.",
        "#include \"GeneratedScene.hpp\"",
        "#include \"SceneLoader.hpp\"",
        "",
        namespace + "::GeneratedScene::GeneratedScene(RetroFuturaGUI::Window* parentWindow) : _parentWindow(parentWindow)",
        "{",
        "}",
        "",
        namespace + "::GeneratedScene::~GeneratedScene()",
        "{",
        "    if(!_scene)",
        "        return;",
        "",
        "    //Unregistered before the scene is freed, or the loader's registry and the window's draw order keep a pointer to it.",
        "    RetroFuturaGUI::SceneLoader::UnregisterScene(RetroFuturaGUI::SceneLoader::GetSceneID(_scene->GetName()));",
        "}",
        "",
        "RetroFuturaGUI::Scene* " + namespace + "::GeneratedScene::GetScene() const",
        "{",
        "    return _scene.get();",
        "}",
        "",
        "void " + namespace + "::GeneratedScene::LoadScene(std::string_view sceneName) const",
        "{",
        "    if(!_sceneRequest)",
        "        return;",
        "",
        "    _sceneRequest(SceneChange::Load, sceneName);",
        "}",
        "",
        "void " + namespace + "::GeneratedScene::UnloadScene(std::string_view sceneName) const",
        "{",
        "    if(!_sceneRequest)",
        "        return;",
        "",
        "    _sceneRequest(SceneChange::Unload, sceneName);",
        "}",
        "",
        "void " + namespace + "::GeneratedScene::callWindowSlot(void (RetroFuturaGUI::Window::*slot)()) const",
        "{",
        "    if(!_parentWindow)",
        "        return;",
        "",
        "    (_parentWindow->*slot)();",
        "}",
        ""
    ];

    return new Map([[path.join(folderPath, "GeneratedScene.hpp"), header.join("\n")], [path.join(folderPath, "GeneratedScene.cpp"), source.join("\n")]]);
}

//A widget of the scene (or of a prefab), with what its setup needs to know
export interface WidgetNode
{
    readonly element: Element;
    readonly type: string;
    readonly schemaClass: SchemaClass;
    readonly name: string;
    readonly member: string; //_okButton.
    readonly local: string; //okButton.
    readonly parent: WidgetNode | undefined;
    readonly index: number; //Among its parent's widgets.
    readonly children: WidgetNode[];
    readonly parts: Element[]; //its parts, and its elements writing a struct to a setter of its own
    readonly prefab?: PrefabModel; //For a placed prefab: what it is, and the entries for its widgets below
    readonly prefabEntries?: Element[]; //<@ButtonUp …> and <Button …>, in their order
}

//What a widget's name may not be, since it also names a member, a local variable and a setup function.
const reservedNames = new Set(["Scene", "ParentWindow", "LoadScene", "UnloadScene", "Assets", "Build", "GetScene", "Create", "SceneRequest"]);

//The slots every scene has from GeneratedScene, each taking the name of a scene: Slots.LoadScene(Scenes.MainScene).
const sceneSlots = new Set(["LoadScene", "UnloadScene"]);

export class SceneGenerator extends MarkupGenerator
{
    protected readonly _scene: SceneInput;
    protected readonly _project: SceneProject;
    protected readonly _slots = new Map<string, SlotDeclaration>();
    protected readonly _widgets: WidgetNode[] = [];
    private readonly _takenByParent = new Map<WidgetNode, Set<Attribute>>(); //A child's attributes its parent's children setter took.
    private readonly _prefabSetups: { name: string; statements: Statement[] }[] = []; //A placed prefab's setup per widget its entries reach
    protected _name = "";
    protected _usesForward = false;
    private readonly _loads = new Set<string>(); //The scenes its Slots.LoadScene(Scenes.X) load.

    constructor(scene: SceneInput, project: SceneProject)
    {
        super(scene.file, scene.text, project.folder, project.schema, project.assetFolders);
        this._scene = scene;
        this._project = project;
        this._flavorNames = project.flavorNames;
    }

    generate(): SceneResult
    {
        const outputs = new Map<string, string>();
        const result = (name: string | undefined): SceneResult => ({ name: name, loads: [...this._loads], outputs: outputs, problems: this._problems });
        const root = this._scene.document.root;

        for (const diagnostic of this._scene.document.diagnostics)
            this.error(diagnostic, diagnostic.message);

        if (!root || 0 < this._problems.length)
            return result(undefined);

        if ("Scene" !== root.name)
        {
            this.error(root, "A scene file's root is <Scene>, not <" + root.name + ">.");
            return result(undefined);
        }

        const name = this.readClassName(root, "Scene");

        if (!name)
            return result(undefined);

        this._name = name;
        const rootLasagna = this.readSceneChildren(root);

        if (!rootLasagna)
            return result(name);

        const build = this.buildStatements(root, rootLasagna);
        const setups = this._widgets.filter(widget => widget !== rootLasagna).map(widget => ({ widget: widget, statements: this.setupStatements(widget) }));

        if (this.hasErrors())
            return result(name);

        const generatedFolder = path.join(this._project.folder, ...generatedScenesFolder.split("/"));
        const sourceFile = path.join(generatedFolder, name + "_setup.cpp");
        outputs.set(path.join(generatedFolder, name + "_p.hpp"), this.headerText());
        outputs.set(sourceFile, this.sourceText(sourceFile, build, setups));

        const userFolder = path.dirname(this._scene.file);
        const constructor = "explicit " + name + "(RetroFuturaGUI::Window* parentWindow) : " + name + "_p(parentWindow) {}";
        const user = this.userFiles({ name: name, namespace: this._project.namespace, constructor: constructor, slots: [...this._slots.values()], header: this._project.userHeader, source: this._project.userSource, folder: userFolder });
        user.forEach((text, file) => outputs.set(file, text));
        return result(name);
    }

    //The scene and its widgets

    //The <Slot>s, then the one widget the scene holds: its root Lasagna.
    private readSceneChildren(root: Element): WidgetNode | undefined
    {
        let rootLasagna: WidgetNode | undefined;

        for (const child of root.elements)
        {
            if ("Slot" === child.name)
            {
                const slot = this.readSlot(child, this._slots);

                if (slot && sceneSlots.has(slot.name))
                    this.error(child, "Every scene has the slot " + slot.name + " already: name this one differently.");
                else if (slot)
                    this._slots.set(slot.name, slot);

                continue;
            }

            if ("Layout" === child.name)
            {
                this.error(child, "<Layout> isn't generated yet.");
                continue;
            }

            if (rootLasagna)
            {
                this.error(child, "A scene holds one widget, its root Lasagna; put <" + child.name + "> inside it.");
                continue;
            }

            if ("Lasagna" !== child.name)
            {
                this.error(child, "A scene's widget is its root Lasagna, not a " + child.name + ".");
                continue;
            }

            rootLasagna = this.readWidget(child, undefined, 0);
        }

        if (!rootLasagna && !this._problems.length)
            this.error(root, "The scene has no root <Lasagna>.");

        return rootLasagna;
    }

    protected readWidget(element: Element, parent: WidgetNode | undefined, index: number): WidgetNode | undefined
    {
        if (element.name.startsWith("Prefab:"))
            return this.readPrefabInstance(element, parent, index);

        if (element.name.startsWith("@"))
        {
            this.error(element, "<" + element.name + "> sets a named widget of a placed prefab, so it goes inside <Prefab:…>; in a <Layout> it isn't generated yet.");
            return undefined;
        }

        const schemaClass = this._schema.classes[element.name];

        if (!schemaClass || "widget" !== schemaClass.role)
        {
            this.error(element, element.name + " isn't a widget" + (parent ? " or a part of " + parent.type : "") + ".");
            return undefined;
        }

        const name = this.readWidgetName(element, parent);

        if (!name)
            return undefined;

        if (element.value)
            this.error(element.value, "A widget holds parts and widgets, not a value.");

        const node: WidgetNode = { element: element, type: element.name, schemaClass: schemaClass, name: name, member: this.memberOf(name), local: lowerFirst(name), parent: parent, index: index, children: [], parts: [] };
        this._widgets.push(node);
        this._headers.add(headerName(schemaClass.header));

        for (const child of element.elements)
        {
            //A part, or a setter writing a struct (<Transition Duration=150/>), both of the widget itself
            if (schemaClass.parts[child.name] || this.structSetterOf(schemaClass, child.name))
            {
                node.parts.push(child);
                continue;
            }

            if (!schemaClass.container)
            {
                this.error(child, child.name + " isn't a part of " + element.name + ".");
                continue;
            }

            if (schemaClass.container.widget && schemaClass.container.widget !== child.name)
            {
                this.error(child, "A " + element.name + " holds only " + schemaClass.container.widget + "s and its parts, not a " + child.name + ".");
                continue;
            }

            const widget = this.readWidget(child, node, node.children.length);

            if (widget)
                node.children.push(widget);
        }

        return node;
    }

    //The widget's name, checked to name a C++ member and a setup function and to be the only one of the scene's
    protected readWidgetName(element: Element, parent: WidgetNode | undefined): string | undefined
    {
        const nameAttribute = element.attributes.find(attribute => "Name" === attribute.name);
        let name = "String" === nameAttribute?.value?.kind ? nameAttribute.value.value : undefined;

        //The root container is reached through the scene or the prefab, so it may go without a name
        if (!name && !parent && !nameAttribute)
            name = this.rootName();

        if (!name)
        {
            this.error(nameAttribute ?? element, "<" + element.name + "> needs a Name, written as a string: Name=\"Ok" + element.name.replace(/^Prefab:/, "") + "\".");
            return undefined;
        }

        if (!/^[A-Za-z_]\w*$/.test(name) || reservedNames.has(name) || cppKeywords.has(lowerFirst(name)))
        {
            this.error(nameAttribute ?? element, name + " can't name a widget: it names a C++ member and function too.");
            return undefined;
        }

        if (this._widgets.some(widget => widget.name === name))
        {
            this.error(nameAttribute ?? element, "Another widget of the " + this.kind() + " is named " + name + " already.");
            return undefined;
        }

        return name;
    }

    //A placed prefab, <Prefab:StepperSlider Name="Volume" …>: a widget of the scene whose C++ member is the prefab's struct.
    //Its elements are entries for the prefab's widgets: <@ButtonUp …> for one by name, <Button …> for every one of a type
    private readPrefabInstance(element: Element, parent: WidgetNode | undefined, index: number): WidgetNode | undefined
    {
        const prefabName = element.name.slice("Prefab:".length);

        if ("prefab" === this.kind())
        {
            this.error(element, "A prefab inside a prefab isn't generated yet.");
            return undefined;
        }

        const prefab = this._project.prefabs.get(prefabName);
        const prefabClass = this._schema.classes["Prefab"];

        if (!prefab || !prefabClass)
        {
            const known = [...this._project.prefabs.keys()];
            this.error(element, "No prefab is named " + prefabName + (known.length ? ": " + known.join(", ") + "." : "; there are none."));
            return undefined;
        }

        if (!parent)
        {
            this.error(element, "A prefab is placed inside a container, such as the scene's root Lasagna.");
            return undefined;
        }

        const name = this.readWidgetName(element, parent);

        if (!name)
            return undefined;

        if (element.value)
            this.error(element.value, "A placed prefab holds entries for its widgets, not a value.");

        const entries: Element[] = [];

        for (const child of element.elements)
        {
            if (child.name.startsWith("@"))
            {
                if (!prefab.children.has(child.name.slice(1)))
                    this.error(child, prefabName + " has no widget named " + child.name.slice(1) + ": " + [...prefab.children.keys()].join(", ") + ".");
                else
                    entries.push(child);

                continue;
            }

            if ("widget" !== this._schema.classes[child.name]?.role)
            {
                this.error(child, "<" + child.name + "> isn't a widget of " + prefabName + " by name (<@Name>) or by type (<Button>).");
                continue;
            }

            if (![...prefab.children.values()].some(prefabChild => child.name === prefabChild.type))
                this.report(child, "warning", prefabName + " holds no " + child.name + ", so this sets nothing.");

            entries.push(child);
        }

        const node: WidgetNode = { element: element, type: element.name, schemaClass: prefabClass, name: name, member: this.memberOf(name), local: lowerFirst(name), parent: parent, index: index, children: [], parts: [], prefab: prefab, prefabEntries: entries };
        this._widgets.push(node);
        this._headers.add(prefab.header);
        prefab.files.forEach((kind, file) => this._files.set(file, kind));
        return node;
    }

    //Hooks a prefab's generator changes

    //What the generated code is: a "scene" or a "prefab"
    protected kind(): string
    {
        return "scene";
    }

    //The name of a root container written without one
    protected rootName(): string
    {
        return "RootLasagna";
    }

    //A widget's C++ member, as the generated code reaches it
    protected memberOf(name: string): string
    {
        return "_" + lowerFirst(name);
    }

    //How a widget's setup calls a child's
    protected setupCall(child: WidgetNode, parent: WidgetNode): string
    {
        return "setup" + child.name + "(*" + parent.local + ");";
    }

    //The attributes a widget's own setup sets. Those nothing else took
    protected ownAttributes(widget: WidgetNode, consumed: ReadonlySet<Attribute>): Attribute[]
    {
        return widget.element.attributes.filter(attribute => !consumed.has(attribute));
    }

    //build(): the scene, its root Lasagna, then each widget's setup.
    private buildStatements(root: Element, rootLasagna: WidgetNode): Statement[]
    {
        const sceneLine = this.lineOf(root);
        const lasagnaLine = this.lineOf(rootLasagna.element);
        const statements: Statement[] =
        [
            { text: "if(!_parentWindow)" },
            { text: "    return;" },
            { text: "" },
            { text: "_scene = RetroFuturaGUI::SceneLoader::CreateScene(" + JSON.stringify(this._name) + ", _parentWindow);", line: sceneLine },
            { text: "" },
            { text: "if(!_scene)" },
            { text: "    return;" },
            { text: "" },
            { text: "const RetroFuturaGUI::SceneLoader::AssetScope assets { *_scene }; //What the widgets below load counts as this scene's." }
        ];

        //The root Lasagna takes its tracks through the scene; whatever else is written on it goes to the Lasagna itself.
        const consumed = new Set<Attribute>(rootLasagna.element.attributes.filter(attribute => "Name" === attribute.name));
        const axis = this.constructorArguments(rootLasagna, consumed);

        if (undefined !== axis)
            statements.push({ text: "_scene->SetLasagnaAxis(" + axis + ", _parentWindow->GetProjection());", line: lasagnaLine });

        const sceneClass = this._schema.classes["Scene"];

        if (sceneClass)
        {
            const attributes = root.attributes.filter(attribute => "Name" !== attribute.name);
            const aesthetic = attributes.find(attribute => "Aesthetic" === attribute.name);

            if (aesthetic)
                statements.push(...this.aestheticStatements(aesthetic, "_scene->"));

            statements.push(...this.attributeStatements(sceneClass, "Scene", attributes.filter(attribute => attribute !== aesthetic), "_scene->"));
        }

        statements.push(
            { text: "" },
            { text: rootLasagna.member + " = _scene->GetRootContainer<RetroFuturaGUI::Lasagna>();", line: lasagnaLine },
            { text: "RetroFuturaGUI::Lasagna* " + rootLasagna.local + " { " + rootLasagna.member + ".Get() };" },
            { text: "" },
            { text: "if(!" + rootLasagna.local + ")" },
            { text: "    return;" });

        statements.push(...this.widgetBody(rootLasagna, consumed));
        return statements;
    }

    //A widget's setup: it's added to its parent, then given its values, parts, signals and widgets.
    protected setupStatements(widget: WidgetNode): Statement[]
    {
        const parent = widget.parent as WidgetNode;
        const container = parent.schemaClass.container;
        const line = this.lineOf(widget.element);
        const consumed = new Set<Attribute>([...widget.element.attributes.filter(attribute => "Name" === attribute.name), ...(this._takenByParent.get(widget) ?? [])]);
        const placement = this.placementArgument(widget, consumed);

        if (widget.prefab)
            return container && undefined !== placement ? this.prefabInstanceStatements(widget, widget.prefab, placement, consumed) : [];

        //A container adding one kind of widget builds it itself, its constructor's values included: AddRadioButton(name, index)
        const constructor = container?.widget ? "" : this.constructorArguments(widget, consumed);

        if (!container || undefined === placement || undefined === constructor)
            return [];

        const callArguments = [JSON.stringify(widget.name), placement, ...(constructor ? [constructor] : [])];
        const add = container.widget ? container.add : container.add + "<" + widget.schemaClass.cpp + ">";
        const statements: Statement[] =
        [
            { text: widget.member + " = " + parent.local + "." + add + "(" + callArguments.join(", ") + ");", line: line },
            { text: widget.schemaClass.cpp + "* " + widget.local + " { " + widget.member + ".Get() };" },
            { text: "" },
            { text: "if(!" + widget.local + ")" },
            { text: "    return;" }
        ];

        statements.push(...this.widgetBody(widget, consumed));
        return statements;
    }

    //What a widget's element says beyond where it goes: its values, its parts, its signals, then the widgets inside it.
    protected widgetBody(widget: WidgetNode, consumed: Set<Attribute>): Statement[]
    {
        const target = widget.local + "->";
        const statements: Statement[] = [];
        const valueType = this.valueTypeOf(widget.schemaClass, widget.element, consumed);
        const own = this.ownAttributes(widget, consumed);
        const body = this.attributeStatements(widget.schemaClass, widget.type, own, target, valueType);

        for (const part of widget.parts)
            body.push(...this.partStatements(widget.schemaClass, part, target));

        body.push(...this.structSetterStatements(widget.schemaClass, widget.parts.filter(part => !widget.schemaClass.parts[part.name]), target));

        if (0 < body.length)
            statements.push({ text: "" }, ...body);

        const children = widget.schemaClass.container?.children;

        if (children && 0 < widget.children.length)
        {
            const flex = this.childrenStructs(widget, children.type);

            if (undefined !== flex)
            {
                const name = widget.local + "Children";
                statements.push({ text: "" }, { text: "std::array " + name, line: this.lineOf(widget.element) }, { text: "{" });
                flex.forEach((text, index) => statements.push({ text: "    " + text + (index + 1 < flex.length ? "," : ""), line: this.lineOf((widget.children[index] as WidgetNode).element) }));
                statements.push({ text: "};" }, { text: "" }, { text: widget.local + "->" + children.call + "(" + name + ");", line: this.lineOf(widget.element) });
                this._headers.add("<array>");
            }
        }

        if (0 < widget.children.length)
        {
            statements.push({ text: "" });

            for (const child of widget.children)
                statements.push({ text: this.setupCall(child, widget) });
        }

        return statements;
    }

    //A placed prefab's setup: the prefab's Build adds it with the prefab file's values, then its own values go to the
    //Prefab, and every widget its entries reach gets a setup of its own (setupVolumeButtonUp)
    private prefabInstanceStatements(widget: WidgetNode, prefab: PrefabModel, placement: string, consumed: Set<Attribute>): Statement[]
    {
        const parent = widget.parent as WidgetNode;
        const statements: Statement[] =
        [
            { text: widget.member + " = " + prefab.cpp + "::Build(" + parent.local + ", " + JSON.stringify(widget.name) + ", " + placement + ");", line: this.lineOf(widget.element) },
            { text: "RetroFuturaGUI::Prefab* " + widget.local + " { " + widget.member + "._Prefab.Get() };" },
            { text: "" },
            { text: "if(!" + widget.local + ")" },
            { text: "    return;" }
        ];

        const body = this.attributeStatements(widget.schemaClass, widget.type, widget.element.attributes.filter(attribute => !consumed.has(attribute)), widget.local + "->");

        if (0 < body.length)
            statements.push({ text: "" }, ...body);

        //In the prefab's order, each widget its type entries and its name entry reach. The type's values first, so its
        //own win (the cascade).
        const calls: Statement[] = [];

        for (const child of prefab.children.values())
        {
            const entries = (widget.prefabEntries ?? []).filter(entry => child.type === entry.name || "@" + child.name === entry.name);

            if (0 === entries.length)
                continue;

            entries.sort((left, right) => Number(left.name.startsWith("@")) - Number(right.name.startsWith("@")));
            const local = widget.local + child.name;
            const childStatements: Statement[] =
            [
                { text: child.schemaClass.cpp + "* " + local + " { " + widget.member + "." + child.member + ".Get() };" },
                { text: "" },
                { text: "if(!" + local + ")" },
                { text: "    return;" }
            ];

            for (const entry of entries)
            {
                const entryConsumed = new Set<Attribute>();
                const valueType = this.valueTypeOf(child.schemaClass, entry, entryConsumed, child.valueType);
                const elementName = entry.name.startsWith("@") ? child.type + " " + child.name : child.type;
                const entryStatements = this.attributeStatements(child.schemaClass, elementName, entry.attributes.filter(attribute => !entryConsumed.has(attribute)), local + "->", valueType);

                for (const part of entry.elements)
                {
                    if (!child.schemaClass.parts[part.name])
                    {
                        this.error(part, part.name + " isn't a part of " + child.type + ".");
                        continue;
                    }

                    entryStatements.push(...this.partStatements(child.schemaClass, part, local + "->"));
                }

                if (0 < entryStatements.length)
                    childStatements.push({ text: "" }, ...entryStatements);
            }

            const setupName = "setup" + widget.name + child.name;
            this._prefabSetups.push({ name: setupName, statements: childStatements });
            calls.push({ text: setupName + "();" });
        }

        if (0 < calls.length)
            statements.push({ text: "" }, ...calls);

        return statements;
    }

    //Where the widget goes in its container: a Lasagna's CellPlacement, or a MenuBar's index.
    protected placementArgument(widget: WidgetNode, consumed: Set<Attribute>): string | undefined
    {
        const parent = widget.parent as WidgetNode;
        const placement = parent.schemaClass.container?.placement ?? "";

        if (this._schema.classes[placement])
            return this.structLiteral(placement, widget.element, consumed);

        if (integerTypes.has(placement))
            return String(widget.index);

        //A RadioButtonGroup's cell, by its Row and Column, each 0 when left out
        if ("glm::i64vec2" === placement)
        {
            const cell = ["Row", "Column"].map(name =>
            {
                const attribute = widget.element.attributes.find(candidate => name === candidate.name);

                if (!attribute)
                    return "0";

                consumed.add(attribute);

                if ("Integer" !== attribute.value?.kind || 0 > attribute.value.value)
                {
                    this.error(attribute.value ?? attribute, name + " takes a whole number from 0 on.");
                    return "0";
                }

                return String(attribute.value.value);
            });

            return "glm::i64vec2(" + cell.join(", ") + ")";
        }

        this.error(widget.element, parent.type + " adds widgets with a " + placement + ", which Roux can't write yet.");
        return undefined;
    }

    //What the widget's constructor takes after the parent window, from its attributes: an Image's ImagePath, or a struct
    //such as a Lasagna's AxisDefinition from the struct's fields (Rows, Columns, Layers). An empty string when it takes
    //nothing; undefined after an error.
    protected constructorArguments(widget: WidgetNode, consumed: Set<Attribute>): string | undefined
    {
        const values: string[] = [];

        for (const parameter of widget.schemaClass.constructorArgs)
        {
            if ("struct" === this._schema.classes[parameter.type]?.role)
            {
                const literal = this.structLiteral(parameter.type, widget.element, consumed);

                if (undefined === literal)
                    return undefined;

                values.push(literal);
                continue;
            }

            const attributeName = upperFirst(parameter.name);
            const attribute = widget.element.attributes.find(candidate => attributeName === candidate.name);

            if (!attribute)
            {
                if (parameter.hasDefault)
                    break;

                this.error(widget.element, "<" + widget.type + "> needs " + attributeName + ".");
                return undefined;
            }

            consumed.add(attribute);
            const value = this.convertAt(attribute, parameter.type, widget.schemaClass.cpp, parameter.name);

            if (undefined === value)
                return undefined;

            values.push(value);
        }

        return values.join(", ");
    }

    //One struct per child of a widget whose children setter takes them: a MenuBar's FlexDefinitions. What each child gives
    //to it is kept, so the child's own setup leaves it out.
    protected childrenStructs(widget: WidgetNode, type: string): string[] | undefined
    {
        const literals: string[] = [];
        let isValid = true;

        for (const child of widget.children)
        {
            const consumed = new Set<Attribute>();
            this._takenByParent.set(child, consumed);
            const literal = this.structLiteral(type, child.element, consumed);

            if (undefined === literal)
                isValid = false;
            else
                literals.push(literal);
        }

        return isValid ? literals : undefined;
    }

    //Signals

    //The function a signal calls for Slots.X, Scenes.X or Window.X.
    protected connection(value: Value, argumentCount: number): { lambda: string; isAsync: boolean } | undefined
    {
        const [kind, name] = "Reference" === value.kind && 2 === value.segments.length ? value.segments : [];
        const ignoring = 0 === argumentCount ? "[this]()" : "[this](auto&&...)";

        if ("Slots" === kind && name && sceneSlots.has(name))
            return this.sceneSlotConnection(value, name);

        if ("Reference" === value.kind && value.arguments)
        {
            this.error(value, "Only LoadScene and UnloadScene take values in parentheses: OnClick=Slots.LoadScene(Scenes.MainScene).");
            return undefined;
        }

        if ("Slots" === kind && name)
        {
            const slot = this._slots.get(name);

            if (!slot)
            {
                this.error(value, "The scene declares no slot " + name + ": add <Slot>void " + name + "()</Slot>.");
                return undefined;
            }

            if (0 === slot.paramCount)
                return { lambda: ignoring + " { " + name + "(); }", isAsync: slot.isAsync };

            if (slot.paramCount !== argumentCount)
            {
                this.error(value, name + " takes " + slot.paramCount + " values, but the signal hands over " + argumentCount + ".");
                return undefined;
            }

            this._usesForward = true;
            return { lambda: "[this](auto&&... arguments) { " + name + "(std::forward<decltype(arguments)>(arguments)...); }", isAsync: slot.isAsync };
        }

        if ("Scenes" === kind && name)
        {
            this.error(value, "A signal loads a scene with Slots.LoadScene(Scenes." + name + "), and takes one out with Slots.UnloadScene(Scenes." + this._name + ").");
            return undefined;
        }

        if ("Window" === kind && name)
        {
            const slot = this._schema.classes["Window"]?.slots[name];

            if (!slot || 0 < slot.params.length)
            {
                const names = Object.keys(this._schema.classes["Window"]?.slots ?? {});
                this.error(value, "The window has no slot " + name + ": " + names.join(", ") + ".");
                return undefined;
            }

            return { lambda: ignoring + " { callWindowSlot(&RetroFuturaGUI::Window::" + slot.call + "); }", isAsync: false };
        }

        //@Bars.StepUp: a function of one of the scene's widgets, a library method tagged @bechaml slot.
        if (kind?.startsWith("@") && name)
        {
            const widgetName = kind.slice(1);
            const widget = this._widgets.find(node => widgetName === node.name);

            if (!widget)
            {
                this.error(value, "The scene has no widget named " + widgetName + ".");
                return undefined;
            }

            if (widget.prefab)
            {
                this.error(value, widgetName + " is a placed prefab; connect one of its widgets' signals instead, inside <Prefab:" + widget.prefab.name + "> as <@Name On…=…>.");
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

            return { lambda: ignoring + " { if(!" + widget.member + ") return; " + widget.member + "->" + slot.call + "(" + callArguments.join(", ") + "); }", isAsync: false };
        }

        this.unknownTarget(value, "Slots.<Name>, Slots.LoadScene(Scenes.<Name>), Window.<Name> or @<Widget>.<Function>");
        return undefined;
    }

    //Slots.LoadScene(Scenes.MainScene) and Slots.UnloadScene(Scenes.MainScene): the scene's own slots, from GeneratedScene
    private sceneSlotConnection(value: Value, slotName: string): { lambda: string; isAsync: boolean } | undefined
    {
        const [scene, ...extra] = "Reference" === value.kind ? value.arguments ?? [] : [];
        const [kind, name, ...rest] = "Reference" === scene?.kind && !scene.arguments ? scene.segments : [];

        if ("Scenes" !== kind || !name || 0 < rest.length || 0 < extra.length)
        {
            this.error(value, slotName + " takes the scene it means: Slots." + slotName + "(Scenes.MainScene).");
            return undefined;
        }

        if (!this._project.sceneNames.has(name))
        {
            this.error(scene ?? value, "No scene is named " + name + ".");
            return undefined;
        }

        if ("LoadScene" === slotName)
            this._loads.add(name);

        return { lambda: "[this](auto&&...) { " + slotName + "(" + JSON.stringify(name) + "); }", isAsync: false };
    }

    //Files

    private headerText(): string
    {
        const lines: string[] =
        [
            generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.",
            "#pragma once",
            "#include \"GeneratedScene.hpp\"",
            "#include \"WidgetReference.hpp\"",
            ...[...this._headers].filter(header => !header.startsWith("<")).sort().map(header => "#include \"" + header + "\""),
            "",
            "namespace " + this._project.namespace,
            "{",
            "    class " + this._name + "_p : public GeneratedScene",
            "    {",
            "    public:",
            "        /// @brief Queues the files the scene's markup names with SceneLoader::AddAsset, counted as the scene's, so they",
            "        ///        load before the scene is built and its widgets find them ready.",
            "        static void QueueAssets();",
            "",
            "    protected:",
            "        explicit " + this._name + "_p(RetroFuturaGUI::Window* parentWindow);",
            "",
            "    //Widgets, empty once the scene is gone."
        ];

        //A placed prefab's member is its struct, which holds a reference to each of its widgets (_volume._ButtonUp)
        for (const widget of this._widgets)
            lines.push(widget.prefab ? "        " + widget.prefab.cpp + " " + widget.member + " {};" : "        RetroFuturaGUI::WidgetReference<" + widget.schemaClass.cpp + "> " + widget.member + " { nullptr };");

        if (0 < this._slots.size)
        {
            lines.push("", "    //Slots, which the scene's class overrides.");

            for (const slot of this._slots.values())
                lines.push("        virtual " + slot.returnType + " " + slot.name + "(" + slot.params + ") = 0;");
        }

        lines.push("", "    private:", "        void build() override;");

        const setups = this._widgets.filter(widget => widget.parent);

        if (0 < setups.length)
        {
            lines.push("", "    //Setup of each widget, so a widget that can't be built skips only its own.");

            for (const widget of setups)
                lines.push("        void setup" + widget.name + "(" + (widget.parent as WidgetNode).schemaClass.cpp + "& " + (widget.parent as WidgetNode).local + ");");

            for (const setup of this._prefabSetups)
                lines.push("        void " + setup.name + "();");
        }

        lines.push("    };", "}", "");
        return lines.join("\n");
    }

    private sourceText(file: string, build: Statement[], setups: { widget: WidgetNode; statements: Statement[] }[]): string
    {
        const writer = new CppWriter(file, this._scene.file);
        const name = this._project.namespace + "::" + this._name + "_p";
        const includes = ["\"" + this._name + "_p.hpp\"", "\"SceneLoader.hpp\"", ...[...this._headers].filter(header => header.startsWith("<"))];

        if (this._usesForward)
            includes.push("<utility>");

        writer.write(generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.");

        for (const include of [...new Set(includes)])
            writer.write("#include " + include);

        writer.write("");
        writer.write(name + "::" + this._name + "_p(RetroFuturaGUI::Window* parentWindow) : GeneratedScene(parentWindow)");
        writer.write("{");
        writer.write("}");
        writer.write("");
        writer.write("void " + name + "::QueueAssets()");
        writer.write("{");
        const queued = [...this._files].filter(([, kind]) => undefined !== kind);

        if (0 < queued.length)
            writer.write("    const u32 sceneID { RetroFuturaGUI::SceneLoader::GetSceneID(" + JSON.stringify(this._name) + ") };");

        for (const [file, kind] of queued)
            writer.write("    RetroFuturaGUI::SceneLoader::AddAsset(sceneID, " + JSON.stringify(file) + ", RetroFuturaGUI::AssetKind::" + kind + ");");

        writer.write("}");
        writer.write("");
        writer.write("void " + name + "::build()");
        writer.write("{");
        writer.writeAll(build, "    ");
        writer.write("}");

        for (const { widget, statements } of setups)
        {
            const parent = widget.parent as WidgetNode;
            writer.write("");
            writer.write("void " + name + "::setup" + widget.name + "(" + parent.schemaClass.cpp + "& " + parent.local + ")");
            writer.write("{");
            writer.writeAll(statements, "    ");
            writer.write("}");
        }

        for (const setup of this._prefabSetups)
        {
            writer.write("");
            writer.write("void " + name + "::" + setup.name + "()");
            writer.write("{");
            writer.writeAll(setup.statements, "    ");
            writer.write("}");
        }

        return writer.text();
    }
}
