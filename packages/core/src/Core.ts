import { BuildSession, buildSteps, type BuildContext } from "./build/BuildSession.js";
import { InvalidParamsError, JsonRpcServer } from "./JsonRpcServer.js";
import { isAppEdit } from "./project/AppSettingsFile.js";
import { AssetSession } from "./project/Assets.js";
import { hostPlatform } from "./project/Catalog.js";
import { isProjectEdit, minimumCMakeVersion, projectEditMistake } from "./project/ProjectFile.js";
import { ProjectSession } from "./project/ProjectSession.js";
import { currentEnvironment, type MachineEnvironment } from "./setup/Environment.js";
import { systemFixRunner, type FixRunner } from "./setup/FixRunner.js";
import { machineFilePath, MachineSettings } from "./setup/Machine.js";
import { SetupChecks, type SetupContext } from "./setup/SetupChecks.js";

//RetroFuturaGUI's own cmake_minimum_required. Every later CMake is accepted. Used while Project.bechaml gives no valid CMakeVersion
export const defaultCMakeVersion = minimumCMakeVersion;

export interface CoreOptions
{
    projectFolder?: string;
    machineFile?: string; //Machine.bechaml. The user's profile by default
    fixRunner?: FixRunner; //What runs fixes. Tests pass one that installs nothing
}

//Every method the UI can call, behind one JSON-RPC server. Hosts only carry its messages
export class Core
{
    readonly server = new JsonRpcServer();
    private readonly _environment: MachineEnvironment;
    private readonly _project: ProjectSession | undefined;
    private readonly _assets: AssetSession | undefined;
    private readonly _setup: SetupChecks;
    private readonly _build: BuildSession;

    //Without a project folder, only Setup works; the project methods answer that there's no project
    constructor(environment: MachineEnvironment = currentEnvironment(), options: CoreOptions = {})
    {
        this._environment = environment;

        if (undefined !== options.projectFolder)
        {
            const project = new ProjectSession(options.projectFolder, hostPlatform(environment.platform), snapshot => this.server.emit("project.changed", snapshot));
            this._project = project;
            this._assets = new AssetSession(options.projectFolder, async () => (await project.load()).project.values?.assets ?? []);
        }

        const machine = new MachineSettings(options.machineFile ?? machineFilePath(environment));
        this._setup = new SetupChecks(environment, machine, options.fixRunner ?? systemFixRunner(environment), (event, params) => this.server.emit(event, params));

        this.server.register("setup.runChecks", async () => ({ checks: await this._setup.run(await this.setupContext()) }));

        this.server.register("setup.choose", async params =>
        {
            if ("string" !== typeof params?.component || "string" !== typeof params.path)
                throw new InvalidParamsError("setup.choose needs a component and a path.");

            return this._setup.choose(params.component, params.path, await this.setupContext());
        });

        this.server.register("setup.runFix", async params =>
        {
            if ("string" !== typeof params?.component || "string" !== typeof params.fixId)
                throw new InvalidParamsError("setup.runFix needs a component and a fix id.");

            return this._setup.runFix(params.component, params.fixId, await this.setupContext());
        });

        this._build = new BuildSession(environment, this._setup, () => this.buildContext(), (event, params) => this.server.emit(event, params));
        this.server.register("build.load", () => this._build.load());
        this.server.register("build.stop", () => this._build.stop());
        this.server.register("build.clean", () => this._build.clean());

        this.server.register("build.setTarget", params =>
        {
            if ("string" !== typeof params?.platform || "string" !== typeof params.buildType)
                throw new InvalidParamsError("build.setTarget needs a platform and a build type.");

            return this._build.setTarget(params.platform, params.buildType);
        });

        this.server.register("build.start", params =>
        {
            if (!Array.isArray(params?.steps) || !params.steps.every(step => buildSteps.includes(step)))
                throw new InvalidParamsError("build.start needs steps out of " + buildSteps.join(", ") + ".");

            return this._build.start(params.steps);
        });

        this.server.register("project.load", () => this.project().load());
        this.server.register("project.create", () => this.project().createProject());
        this.server.register("app.create", () => this.project().createApp());

        this.server.register("project.edit", params =>
        {
            if (!isProjectEdit(params?.edit))
                throw new InvalidParamsError("edit isn't a Project edit.");

            return this.project().editProject(params.edit);
        });

        this.server.register("app.edit", params =>
        {
            if (!isAppEdit(params?.edit))
                throw new InvalidParamsError("edit isn't an App Settings edit.");

            return this.project().editApp(params.edit);
        });

        this.server.register("assets.list", () => this.assets().list());

        this.server.register("assets.preview", params =>
        {
            if ("string" !== typeof params?.folder || "string" !== typeof params.path)
                throw new InvalidParamsError("assets.preview needs a folder and a path.");

            return this.assets().preview(params.folder, params.path);
        });

        this.server.register("assets.clashes", params =>
        {
            if (!Array.isArray(params?.names) || !params.names.every(name => "string" === typeof name))
                throw new InvalidParamsError("assets.clashes needs names.");

            return this.assets().clashes(params.names);
        });

        this.server.register("assets.uploadStart", params =>
        {
            if ("string" !== typeof params?.name || ("replace" !== params.onClash && "keepBoth" !== params.onClash))
                throw new InvalidParamsError("assets.uploadStart needs a name and onClash, replace or keepBoth.");

            return this.assets().uploadStart(params.name, params.onClash);
        });

        this.server.register("assets.uploadChunk", params =>
        {
            if ("string" !== typeof params?.uploadId || "string" !== typeof params.data)
                throw new InvalidParamsError("assets.uploadChunk needs an uploadId and data.");

            return this.assets().uploadChunk(params.uploadId, params.data);
        });

        this.server.register("assets.uploadEnd", params =>
        {
            if ("string" !== typeof params?.uploadId)
                throw new InvalidParamsError("assets.uploadEnd needs an uploadId.");

            return this.assets().uploadEnd(params.uploadId);
        });
    }

    //Stops watching the project's files, and removes uploads that never ended
    close(): void
    {
        this._project?.close();
        void this._assets?.close();
    }

    private project(): ProjectSession
    {
        if (!this._project)
            throw new InvalidParamsError("Roux was started without a project folder.");

        return this._project;
    }

    private assets(): AssetSession
    {
        if (!this._assets)
            throw new InvalidParamsError("Roux was started without a project folder.");

        return this._assets;
    }

    private async buildContext(): Promise<BuildContext>
    {
        const values = this._project ? (await this._project.load()).project.values : undefined;
        return { folder: this._project?.folder, values: values, setup: await this.setupContext() };
    }

    //What Setup checks against. The project's CMakeVersion, features and language for this computer's platform. Without
    //a readable Project.bechaml, RetroFuturaGUI's defaults (tracker modules are on there)
    private async setupContext(): Promise<SetupContext>
    {
        if (!this._project)
            return { requiredCMakeVersion: defaultCMakeVersion, hasTrackerModules: true };

        const values = (await this._project.load()).project.values;
        const version = values?.cmakeVersion ?? "";

        return {
            projectFolder: this._project.folder,
            requiredCMakeVersion: version && !projectEditMistake({ key: "cmakeVersion", value: version }) ? version : defaultCMakeVersion,
            hasTrackerModules: values ? values.features.includes("TrackerModules") : true,
            platformSettings: values?.platformSettings[hostPlatform(this._environment.platform)]
        };
    }
}