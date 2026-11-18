import path from "node:path";
import type { Document, Element, Value } from "../bechaml/Syntax.js";
import type { Schema } from "../schema/Schema.js";
import type { GenerateProblem } from "./Generator.js";
import { CppWriter, generatedMark, MarkupGenerator, type Statement } from "./MarkupGenerator.js";

//Generate's windows and start (Roux plan, 6.2.1): a <Window> file lists the scenes it shows, those marked Start shown from
//the beginning, and becomes the window's base class (<Name>_p.hpp and _setup.cpp in source/generated/impl/Windows/); the
//project's start window becomes the start function main.cpp calls (source/generated/impl/Start.cpp).

export const generatedWindowsFolder = "source/generated/impl/Windows";
export const generatedStartFolder = "source/generated/impl";

export interface WindowInput
{
    readonly file: string; //Absolute.
    readonly text: string;
    readonly document: Document;
}

export interface WindowProject
{
    readonly folder: string;
    readonly namespace: string;
    readonly schema: Schema;
    readonly scenes: ReadonlyMap<string, readonly string[]>; //Every scene by name, with the scenes it loads.
    readonly assetFolders: readonly string[]; //The project's, relative to it, as Project.bechaml lists them
    readonly userHeader: string | undefined;
    readonly userSource: string | undefined;
}

export interface WindowResult
{
    readonly name: string | undefined;
    readonly scenes: readonly { name: string; element: Element }[]; //The scenes it lists, so no other window lists them too.
    readonly outputs: Map<string, string>;
    readonly problems: GenerateProblem[];
}

export function generateWindow(window: WindowInput, project: WindowProject): WindowResult
{
    return new WindowGenerator(window, project).generate();
}

//GeneratedWindow.hpp and .cpp: what every generated window derives from, with the frame loop.
export function generatedWindowBase(folder: string, namespace: string): Map<string, string>
{
    const folderPath = path.join(folder, ...generatedWindowsFolder.split("/"));
    const header =
    [
        generatedMark + ". Generate rewrites it.",
        "#pragma once",
        "#include \"GeneratedScene.hpp\"",
        "#include \"Window.hpp\"",
        "#include <concepts>",
        "#include <memory>",
        "#include <string>",
        "#include <string_view>",
        "#include <vector>",
        "",
        "namespace " + namespace,
        "{",
        "    /// @brief What every generated window shares: the native window, the scenes it shows, and the swap of a scene for",
        "    ///        another once the frame is over.",
        "    class GeneratedWindow",
        "    {",
        "    public:",
        "        GeneratedWindow(const GeneratedWindow&) = delete;",
        "        GeneratedWindow(GeneratedWindow&&) = delete;",
        "        auto operator =(const GeneratedWindow&) = delete;",
        "        auto operator =(GeneratedWindow&&) = delete;",
        "        virtual ~GeneratedWindow();",
        "",
        "        /// @brief Constructs a window of type T, then builds it with the scenes it starts with, which can only happen once",
        "        ///        T's own members exist.",
        "        template<std::derived_from<GeneratedWindow> T> static std::unique_ptr<T> Create()",
        "        {",
        "            std::unique_ptr<T> window { std::make_unique<T>() };",
        "            GeneratedWindow& generated { *window };",
        "            generated.build();",
        "            return window;",
        "        }",
        "",
        "        /// @brief Runs frames until the first window closes, 60 a second at most. Each frame every window takes the input,",
        "        ///        then does its per-frame work, then draws; then the scenes asked for are swapped in, and any other window",
        "        ///        that was asked to close goes.",
        "        static void RunFrames(std::vector<std::unique_ptr<GeneratedWindow>>& windows);",
        "",
        "        RetroFuturaGUI::Window* GetWindow() const;",
        "",
        "        /// @brief Whether the window was asked to close. True when there is no window.",
        "        bool WindowShouldClose();",
        "",
        "        void Interact();",
        "        void Update();",
        "        void Draw();",
        "",
        "        /// @brief Swaps in the scenes asked for whose files are loaded, each in the place of the scene that asked; the others",
        "        ///        wait for a later frame while the scene that asked keeps running. Call it after every window drew and",
        "        ///        SceneLoader::DrainPending ran, so no widget of a scene that goes is still running.",
        "        void ApplySceneRequests();",
        "",
        "    protected:",
        "        GeneratedWindow() = default;",
        "",
        "        /// @brief Builds the named scene and shows it after the ones shown already. Its files are queued first and finished",
        "        ///        as its widgets ask for them.",
        "        void showScene(std::string_view sceneName);",
        "",
        "        /// @brief What the window's scenes call to be replaced by another.",
        "        GeneratedScene::SceneRequest sceneRequest();",
        "",
        "        std::unique_ptr<RetroFuturaGUI::Window> _window { nullptr }; //Declared before the scenes, so it outlives them.",
        "",
        "    private:",
        "        struct PendingScene",
        "        {",
        "            const GeneratedScene* _Requester { nullptr };",
        "            std::string _SceneName {};",
        "        };",
        "",
        "        /// @brief Creates the native window and shows the scenes it starts with.",
        "        virtual void build() = 0;",
        "",
        "        /// @brief Builds one of the scenes the window lists; nullptr for a name it doesn't list.",
        "        virtual std::unique_ptr<GeneratedScene> createScene(std::string_view sceneName) = 0;",
        "",
        "        /// @brief Queues the files one of the scenes the window lists names, so they load before it is built.",
        "        virtual void queueAssets(std::string_view sceneName) = 0;",
        "",
        "        /// @brief Whether the window lists the scene.",
        "        virtual bool hasScene(std::string_view sceneName) const = 0;",
        "",
        "        /// @brief Keeps a scene's request until its files are loaded and the frame is over, and queues the files; a scene",
        "        ///        asking again before then changes nothing.",
        "        void requestScene(const GeneratedScene& requester, std::string_view sceneName);",
        "",
        "        /// @brief Whether every file queued for the scene is loaded, or failed to load. True for a scene with none.",
        "        static bool areAssetsLoaded(std::string_view sceneName);",
        "",
        "        std::vector<std::unique_ptr<GeneratedScene>> _scenes {}; //In the window's draw order.",
        "        std::vector<PendingScene> _pendingScenes {};",
        "    };",
        "}",
        ""
    ];

    const source =
    [
        generatedMark + ". Generate rewrites it.",
        "#include \"GeneratedWindow.hpp\"",
        "#include \"SceneLoader.hpp\"",
        "#include \"PlatformBridge.hpp\"",
        "#include <algorithm>",
        "#include <chrono>",
        "#include <iterator>",
        "#include <print>",
        "#include <thread>",
        "#include <utility>",
        "",
        namespace + "::GeneratedWindow::~GeneratedWindow()",
        "{",
        "    if(!_window)",
        "        return;",
        "",
        "    //The scenes' widgets go with this window's GL context current, while the window still exists.",
        "    glfwMakeContextCurrent(_window->GetGlfwWindow());",
        "    _scenes.clear();",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::RunFrames(std::vector<std::unique_ptr<GeneratedWindow>>& windows)",
        "{",
        "    constexpr std::chrono::duration<f64> frameTime { 1.0 / 60.0 };",
        "    std::erase(windows, nullptr);",
        "",
        "    while(!windows.empty() && !windows.front()->WindowShouldClose())",
        "    {",
        "        const std::chrono::steady_clock::time_point frameStart { std::chrono::steady_clock::now() };",
        "",
        "        //Once per frame, before any window: the typed text, the wheel and the key strokes since the last frame.",
        "        PlatformBridge::Input::NewFrame();",
        "",
        "        //Every window takes the frame's input before any draws, so what one window's input changes in another shows in",
        "        //this frame.",
        "        for(const std::unique_ptr<GeneratedWindow>& window : windows)",
        "            window->Interact();",
        "",
        "        for(const std::unique_ptr<GeneratedWindow>& window : windows)",
        "            window->Update();",
        "",
        "        for(const std::unique_ptr<GeneratedWindow>& window : windows)",
        "            window->Draw();",
        "",
        "        //After the frame, never during: a scene closed from a widget's slot would otherwise free a widget that is still running.",
        "        RetroFuturaGUI::SceneLoader::DrainPending();",
        "",
        "        for(const std::unique_ptr<GeneratedWindow>& window : windows)",
        "            window->ApplySceneRequests();",
        "",
        "        //Any other window goes once it was asked to close; the first one ends the frames.",
        "        windows.erase(std::remove_if(std::next(windows.begin()), windows.end(), [](const std::unique_ptr<GeneratedWindow>& window) { return window->WindowShouldClose(); }), windows.end());",
        "",
        "        const std::chrono::steady_clock::duration elapsed { std::chrono::steady_clock::now() - frameStart };",
        "",
        "        if(frameTime > elapsed)",
        "            std::this_thread::sleep_for(frameTime - elapsed);",
        "    }",
        "}",
        "",
        "RetroFuturaGUI::Window* " + namespace + "::GeneratedWindow::GetWindow() const",
        "{",
        "    return _window.get();",
        "}",
        "",
        "bool " + namespace + "::GeneratedWindow::WindowShouldClose()",
        "{",
        "    if(!_window)",
        "        return true;",
        "",
        "    return _window->WindowShouldClose();",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::Interact()",
        "{",
        "    if(!_window)",
        "        return;",
        "",
        "    _window->Interact();",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::Update()",
        "{",
        "    if(!_window)",
        "        return;",
        "",
        "    _window->Update();",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::Draw()",
        "{",
        "    if(!_window)",
        "        return;",
        "",
        "    _window->Draw();",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::ApplySceneRequests()",
        "{",
        "    if(!_window)",
        "        return;",
        "",
        "    if(_pendingScenes.empty())",
        "        return;",
        "",
        "    //The scenes' widgets are made and freed with this window's GL context current.",
        "    glfwMakeContextCurrent(_window->GetGlfwWindow());",
        "",
        "    for(PendingScene& pending : std::exchange(_pendingScenes, {}))",
        "    {",
        "        //A scene is built once its files are loaded, so its widgets find them ready. Until then the scene that asked keeps running.",
        "        if(!areAssetsLoaded(pending._SceneName))",
        "        {",
        "            _pendingScenes.push_back(std::move(pending));",
        "            continue;",
        "        }",
        "",
        "        const std::vector<std::unique_ptr<GeneratedScene>>::iterator found { std::find_if(_scenes.begin(), _scenes.end(), [&pending](const std::unique_ptr<GeneratedScene>& scene) { return scene.get() == pending._Requester; }) };",
        "",
        "        if(found == _scenes.end())",
        "            continue;",
        "",
        "        const uSize index { static_cast<uSize>(std::distance(_scenes.begin(), found)) };",
        "",
        "        //The scene that goes is freed before the next one is built, so the two never hold their assets at once.",
        "        found->reset();",
        "        std::unique_ptr<GeneratedScene> scene { createScene(pending._SceneName) };",
        "",
        "        if(!scene || !scene->GetScene())",
        "        {",
        "            _scenes.erase(found);",
        "            continue;",
        "        }",
        "",
        "        _window->InsertScene(scene->GetScene(), index);",
        "        *found = std::move(scene);",
        "    }",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::showScene(std::string_view sceneName)",
        "{",
        "    if(!_window)",
        "        return;",
        "",
        "    queueAssets(sceneName);",
        "    std::unique_ptr<GeneratedScene> scene { createScene(sceneName) };",
        "",
        "    if(!scene)",
        "        return;",
        "",
        "    _window->AddScene(scene->GetScene());",
        "    _scenes.push_back(std::move(scene));",
        "}",
        "",
        namespace + "::GeneratedScene::SceneRequest " + namespace + "::GeneratedWindow::sceneRequest()",
        "{",
        "    return [this](const GeneratedScene& requester, std::string_view sceneName) { requestScene(requester, sceneName); };",
        "}",
        "",
        "void " + namespace + "::GeneratedWindow::requestScene(const GeneratedScene& requester, std::string_view sceneName)",
        "{",
        "    if(!hasScene(sceneName))",
        "    {",
        "        std::println(\"ERROR::GENERATEDWINDOW::SCENE_NOT_LISTED::{}\", sceneName);",
        "        return;",
        "    }",
        "",
        "    if(std::ranges::any_of(_pendingScenes, [&requester](const PendingScene& pending) { return pending._Requester == &requester; }))",
        "        return;",
        "",
        "    _pendingScenes.push_back(PendingScene { ._Requester = &requester, ._SceneName = std::string(sceneName) });",
        "    queueAssets(sceneName);",
        "}",
        "",
        "bool " + namespace + "::GeneratedWindow::areAssetsLoaded(std::string_view sceneName)",
        "{",
        "    //NaN for a scene with no files queued, which waits for nothing.",
        "    const f32 progress { RetroFuturaGUI::SceneLoader::SceneLoadingProgress(RetroFuturaGUI::SceneLoader::GetSceneID(sceneName)) };",
        "    return !(1.0f > progress);",
        "}",
        ""
    ];

    return new Map([[path.join(folderPath, "GeneratedWindow.hpp"), header.join("\n")], [path.join(folderPath, "GeneratedWindow.cpp"), source.join("\n")]]);
}

//Start.hpp and Start.cpp: the function main.cpp calls, which opens the start window and runs the frames until it closes.
export function startFiles(folder: string, namespace: string, startWindow: string, projectFile: string): Map<string, string>
{
    const folderPath = path.join(folder, ...generatedStartFolder.split("/"));
    const header =
    [
        generatedMark + " from " + projectFile + ". Generate rewrites it.",
        "#pragma once",
        "#include \"IncludeHelper.hpp\"",
        "",
        "namespace " + namespace,
        "{",
        "    /// @brief Opens the start window and runs the app until it closes. main calls it, and returns what it returns.",
        "    i32 Start();",
        "}",
        ""
    ];

    const source =
    [
        generatedMark + " from " + projectFile + ". Generate rewrites it.",
        "#include \"Start.hpp\"",
        "#include \"" + startWindow + ".hpp\"",
        "#include \"FontManager.hpp\"",
        "#include \"PlatformBridge.hpp\"",
        "#include \"RetroFuturaGuiInit.hpp\"",
        "#include <memory>",
        "#include <string>",
        "#include <vector>",
        "",
        "i32 " + namespace + "::Start()",
        "{",
        "    PlatformBridge::RefreshPlatformBridge();",
        "",
        "    //The app's resources are found next to the program, wherever it was started from.",
        "    std::string programFolder { PlatformBridge::Paths::GetExecutablePath() };",
        "    programFolder = programFolder.substr(0, programFolder.find_last_of(R\"(\\/)\"));",
        "    PlatformBridge::Paths::SetWorkingDir(programFolder.c_str());",
        "",
        "    RetroFuturaGUI::GlfwInit();",
        "    RetroFuturaGUI::FontManager::Init();",
        "",
        "    {",
        "        std::vector<std::unique_ptr<GeneratedWindow>> windows {};",
        "        windows.push_back(GeneratedWindow::Create<" + startWindow + ">());",
        "        GeneratedWindow::RunFrames(windows);",
        "",
        "        //The other windows go first, the start window last.",
        "        while(!windows.empty())",
        "            windows.pop_back();",
        "    }",
        "",
        "    PlatformBridge::Input::Stop();",
        "    RetroFuturaGUI::GlfwTerminate();",
        "    return 0;",
        "}",
        ""
    ];

    return new Map([[path.join(folderPath, "Start.hpp"), header.join("\n")], [path.join(folderPath, "Start.cpp"), source.join("\n")]]);
}

class WindowGenerator extends MarkupGenerator
{
    private readonly _window: WindowInput;
    private readonly _project: WindowProject;
    private readonly _scenes: { name: string; element: Element; isStart: boolean }[] = [];
    private _name = "";

    constructor(window: WindowInput, project: WindowProject)
    {
        super(window.file, window.text, project.folder, project.schema, project.assetFolders);
        this._window = window;
        this._project = project;
    }

    generate(): WindowResult
    {
        const outputs = new Map<string, string>();
        const result = (name: string | undefined): WindowResult => ({ name: name, scenes: this._scenes, outputs: outputs, problems: this._problems });
        const root = this._window.document.root;

        for (const diagnostic of this._window.document.diagnostics)
            this.error(diagnostic, diagnostic.message);

        if (!root || 0 < this._problems.length)
            return result(undefined);

        const name = this.readClassName(root, "Window");
        const windowClass = this._schema.classes["Window"];

        if (!name || !windowClass)
            return result(undefined);

        this._name = name;
        const build = this.buildStatements(root);
        this.checkSceneLoads();

        if (this.hasErrors())
            return result(name);

        const generatedFolder = path.join(this._project.folder, ...generatedWindowsFolder.split("/"));
        const sourceFile = path.join(generatedFolder, name + "_setup.cpp");
        outputs.set(path.join(generatedFolder, name + "_p.hpp"), this.headerText());
        outputs.set(sourceFile, this.sourceText(sourceFile, build));

        const user = this.userFiles({ name: name, namespace: this._project.namespace, constructor: name + "() = default;", slots: [], header: this._project.userHeader, source: this._project.userSource, folder: path.dirname(this._window.file) });
        user.forEach((text, file) => outputs.set(file, text));
        return result(name);
    }

    //build(): the native window, its values and parts, then the scenes it starts with.
    private buildStatements(root: Element): Statement[]
    {
        const windowClass = this._schema.classes["Window"];

        if (!windowClass)
            return [];

        const size = (attributeName: string) =>
        {
            const attribute = root.attributes.find(candidate => attributeName === candidate.name);

            if (!attribute)
            {
                this.error(root, "<Window> needs " + attributeName + ", its size at the first start.");
                return "0";
            }

            if ("Integer" !== attribute.value?.kind || 0 >= attribute.value.value)
            {
                this.error(attribute.value ?? attribute, attributeName + " takes a whole number of pixels.");
                return "0";
            }

            return String(attribute.value.value);
        };

        //Width and Height only hold for a first start: RetroFuturaGUI.ini gives the window's size after that.
        const statements: Statement[] = [{ text: "_window = std::make_unique<RetroFuturaGUI::Window>(" + JSON.stringify(this._name) + ", " + size("Width") + ", " + size("Height") + ");", line: this.lineOf(root) }];
        const attributes = root.attributes.filter(attribute => !["Name", "Width", "Height"].includes(attribute.name));
        const aesthetic = attributes.find(attribute => "Aesthetic" === attribute.name);

        if (aesthetic)
            statements.push(...this.aestheticStatements(aesthetic, "_window->"));

        statements.push(...this.attributeStatements(windowClass, "Window", attributes.filter(attribute => attribute !== aesthetic), "_window->"));

        for (const child of root.elements)
        {
            if ("Scene" === child.name)
            {
                this.readSceneEntry(child);
                continue;
            }

            if (windowClass.parts[child.name])
            {
                statements.push(...this.partStatements(windowClass, child, "_window->"));
                continue;
            }

            this.error(child, child.name + " is neither a part of Window nor a <Scene>.");
        }

        const shown = this._scenes.filter(scene => scene.isStart);

        if (0 < shown.length)
            statements.push({ text: "" });

        //In the order they're listed, which is also the order docked scenes take their strips in.
        for (const scene of shown)
            statements.push({ text: "showScene(" + JSON.stringify(scene.name) + ");", line: this.lineOf(scene.element) });

        return statements;
    }

    //<Scene Name="MainMenuScene" Start/>: a scene the window can show, shown from the start when marked Start.
    private readSceneEntry(element: Element): void
    {
        let name: string | undefined;
        let isStart = false;

        for (const attribute of element.attributes)
        {
            if ("Name" === attribute.name && "String" === attribute.value?.kind)
                name = attribute.value.value;
            else if ("Start" === attribute.name && (!attribute.value || "Bool" === attribute.value.kind))
                isStart = !attribute.value || ("Bool" === attribute.value.kind && attribute.value.value);
            else
                this.error(attribute, "A window's <Scene> takes Name=\"…\" and Start.");
        }

        if (!name)
        {
            this.error(element, "<Scene> names the scene: <Scene Name=\"MainScene\"/>.");
            return;
        }

        if (!this._project.scenes.has(name))
        {
            this.error(element, "No scene is named " + name + ".");
            return;
        }

        if (this._scenes.some(scene => scene.name === name))
        {
            this.error(element, "The window lists " + name + " twice.");
            return;
        }

        this._scenes.push({ name: name, element: element, isStart: isStart });
    }

    //A scene the window shows may only load scenes the window lists, since the window builds them.
    private checkSceneLoads(): void
    {
        const listed = new Set(this._scenes.map(scene => scene.name));

        for (const scene of this._scenes)
        {
            for (const loaded of this._project.scenes.get(scene.name) ?? [])
            {
                if (!listed.has(loaded))
                    this.error(scene.element, scene.name + " loads " + loaded + ", which " + this._name + " doesn't list.");
            }
        }
    }

    //A window's own signals wait for its slots, which come later.
    protected connection(value: Value): { lambda: string; isAsync: boolean } | undefined
    {
        this.error(value, "A window's signals aren't generated yet.");
        return undefined;
    }

    private headerText(): string
    {
        return [
            generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.",
            "#pragma once",
            "#include \"GeneratedWindow.hpp\"",
            "",
            "namespace " + this._project.namespace,
            "{",
            "    class " + this._name + "_p : public GeneratedWindow",
            "    {",
            "    protected:",
            "        " + this._name + "_p() = default;",
            "",
            "    private:",
            "        void build() override;",
            "        std::unique_ptr<GeneratedScene> createScene(std::string_view sceneName) override;",
            "        void queueAssets(std::string_view sceneName) override;",
            "        bool hasScene(std::string_view sceneName) const override;",
            "    };",
            "}",
            ""
        ].join("\n");
    }

    private sourceText(file: string, build: Statement[]): string
    {
        const writer = new CppWriter(file, this._window.file);
        const name = this._project.namespace + "::" + this._name + "_p";
        const includes =
        [
            "\"" + this._name + "_p.hpp\"",
            ...this._scenes.map(scene => "\"" + scene.name + ".hpp\""),
            ...[...this._headers].filter(header => !header.startsWith("<")).sort().map(header => "\"" + header + "\""),
            ...[...this._headers].filter(header => header.startsWith("<"))
        ];

        writer.write(generatedMark + " from " + this.markupPath() + ". Generate rewrites it, so change the .bechaml instead.");

        for (const include of [...new Set(includes)])
            writer.write("#include " + include);

        writer.write("");
        writer.write("void " + name + "::build()");
        writer.write("{");
        writer.writeAll(build, "    ");
        writer.write("}");
        writer.write("");
        //A window that lists no scene doesn't name the parameter, which it wouldn't use.
        const parameter = 0 < this._scenes.length ? "std::string_view sceneName" : "std::string_view";
        writer.write("std::unique_ptr<" + this._project.namespace + "::GeneratedScene> " + name + "::createScene(" + parameter + ")");
        writer.write("{");

        for (const scene of this._scenes)
        {
            writer.write("    if(" + JSON.stringify(scene.name) + " == sceneName)", this.lineOf(scene.element));
            writer.write("        return GeneratedScene::Create<" + scene.name + ">(_window.get(), sceneRequest());", this.lineOf(scene.element));
            writer.write("");
        }

        writer.write("    return nullptr;");
        writer.write("}");
        writer.write("");
        writer.write("void " + name + "::queueAssets(" + parameter + ")");
        writer.write("{");

        for (const [index, scene] of this._scenes.entries())
        {
            writer.write((0 === index ? "    " : "    else ") + "if(" + JSON.stringify(scene.name) + " == sceneName)", this.lineOf(scene.element));
            writer.write("        " + scene.name + "::QueueAssets();", this.lineOf(scene.element));
        }

        writer.write("}");
        writer.write("");
        writer.write("bool " + name + "::hasScene(" + parameter + ") const");
        writer.write("{");

        if (0 === this._scenes.length)
            writer.write("    return false;");
        else
            writer.write("    return " + this._scenes.map(scene => JSON.stringify(scene.name) + " == sceneName").join(" || ") + ";");

        writer.write("}");
        return writer.text();
    }
}
