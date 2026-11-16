import path from "node:path";
import type { SchemaChildren, SchemaClass, SchemaEnum, SchemaField, SchemaParameter, SchemaPart, SchemaRole, SchemaSetter, SchemaSignal, SchemaSlot } from "./Schema.js";

//A node of Clang's JSON syntax tree, as far as the schema reads it.
export interface AstNode
{
    kind: string;
    name?: string;
    loc?: AstLocation;
    range?: { begin?: AstLocation; end?: AstLocation };
    type?: { qualType: string };
    inner?: AstNode[];
    tagUsed?: string;
    bases?: { access: string; type: { qualType: string } }[];
    access?: string;
    storageClass?: string;
    isImplicit?: boolean;
    completeDefinition?: boolean;
    init?: string;
    text?: string;
    value?: string | boolean; //a literal's.
    opcode?: string;
    referencedDecl?: { kind: string; name?: string };
}

interface AstLocation
{
    file?: string;
    spellingLoc?: AstLocation;
    expansionLoc?: AstLocation;
}

interface RawMethod
{
    name: string;
    qualType: string;
    params: SchemaParameter[];
    isStatic: boolean;
    tags: string[];
    template?: string[];
}

interface RawField
{
    member: string;
    type: string;
    tags: string[];
    default?: string;
}

interface RawClass
{
    name: string;
    key: string; //the name within the library, with the classes it is nested in: MenuBar::FlexDefinition.
    file: string;
    bases: string[];
    methods: RawMethod[];
    constructors: RawMethod[];
    fields: RawField[];
    tags: string[];
}

export interface BuiltSchema
{
    enums: Record<string, SchemaEnum>;
    classes: Record<string, SchemaClass>;
    problems: string[];
}

const libraryNamespace = "RetroFuturaGUI";
export const bridgeNamespace = "PlatformBridge";

//The parameters every widget's constructor starts with; a widget's own come after them.
const widgetConstructorParameters = 5;

//Reads the classes and enums of namespace RetroFuturaGUI out of Clang's dump (-ast-dump=json, one object per declaration
//-ast-dump-filter matched), and keeps what the generator may call: the widgets, the window, the scene, Flavor, the popups
//tagged @bechaml popup, every part reached from them, every placement their containers take and every struct their
//constructors and children setters take.
export function buildSchema(roots: readonly AstNode[], sourceFolder: string): BuiltSchema
{
    const classes = new Map<string, RawClass>();
    const enums: Record<string, SchemaEnum> = {};
    const problems: string[] = [];
    const header = (file: string) => path.relative(sourceFolder, file).split(path.sep).join("/");

    //Clang writes a location's file only when it differs from the location written before, so the file is followed
    //through every location in the order they're written: loc (spelling, then expansion), then range.
    let currentFile = "";
    const follow = (location: AstLocation | undefined) =>
    {
        if (!location)
            return;

        follow(location.spellingLoc);
        follow(location.expansionLoc);

        if (location.file)
            currentFile = location.file;
    };

    const visit = (node: AstNode, scope: readonly string[], records: readonly string[]) =>
    {
        follow(node.loc);
        const file = currentFile;
        follow(node.range?.begin);
        follow(node.range?.end);

        const isLibrary = libraryNamespace === scope.join("::");
        let innerScope = scope;
        let innerRecords = records;

        if ("NamespaceDecl" === node.kind && node.name)
            innerScope = [...scope, node.name];

        //The library's enums by their name inside it, PlatformBridge's (the font slants and weights) by their full name,
        //as the setters' parameters name them.
        if ("EnumDecl" === node.kind && node.name && (isLibrary || bridgeNamespace === scope[0]))
        {
            const name = [...(isLibrary ? [] : scope), ...records, node.name].join("::");
            const values = (node.inner ?? []).filter(child => "EnumConstantDecl" === child.kind && child.name).map(child => child.name as string);
            enums[name] = { cpp: isLibrary ? libraryNamespace + "::" + name : name, header: header(file), values: values };
        }

        if ("CXXRecordDecl" === node.kind && node.name && !node.isImplicit)
        {
            const key = [...records, node.name].join("::");

            if (node.completeDefinition && isLibrary)
                classes.set(key, readClass(node, key, file));

            innerRecords = [...records, node.name];
        }

        for (const child of node.inner ?? [])
            visit(child, innerScope, innerRecords);
    };

    for (const root of roots)
        visit(root, [], []);

    const membersOf = memberResolver(classes);
    const built = new Map<string, SchemaClass>();
    const widgetNames = new Set(enums["WidgetTypeID"]?.values ?? []);

    const add = (name: string, role: SchemaRole) =>
    {
        const raw = classes.get(name);

        if (!raw || built.has(name))
            return;

        built.set(name, toSchemaClass(raw, role, membersOf(name), classes, header, problems));
    };

    for (const raw of classes.values())
    {
        if ("Window" === raw.key)
            add(raw.key, "window");
        else if ("Scene" === raw.key)
            add(raw.key, "scene");
        else if ("Flavor" === raw.key)
            add(raw.key, "flavor");
        else if (widgetNames.has(raw.key))
            add(raw.key, "widget");
        else if (raw.tags.some(tag => tag.startsWith("popup")))
            add(raw.key, "popup");
    }

    //Every part reached through a getter, every placement a container takes and every struct a constructor or a children
    //setter takes, until no new one turns up.
    for (let isGrowing = true; isGrowing;)
    {
        isGrowing = false;

        for (const schemaClass of [...built.values()])
        {
            const reached: [string, SchemaRole][] = Object.values(schemaClass.parts).map(part => [part.type, "part"]);

            if (schemaClass.container && classes.has(schemaClass.container.placement))
                reached.push([schemaClass.container.placement, "placement"]);

            if (schemaClass.container?.children)
                reached.push([schemaClass.container.children.type, "struct"]);

            for (const argument of schemaClass.constructorArgs)
            {
                if (classes.has(argument.type))
                    reached.push([argument.type, "struct"]);
            }

            for (const [name, role] of reached)
            {
                if (built.has(name) || !classes.has(name))
                    continue;

                add(name, role);
                isGrowing = true;
            }
        }
    }

    return { enums: sortedRecord(enums), classes: sortedRecord(Object.fromEntries(built)), problems: problems };
}

//A class's public members, read in order: access follows its access specifiers, and a class starts private.
function readClass(node: AstNode, key: string, file: string): RawClass
{
    const raw: RawClass = { name: node.name as string, key: key, file: file, bases: [], methods: [], constructors: [], fields: [], tags: [] };
    raw.bases = (node.bases ?? []).filter(base => "public" === base.access).map(base => cleanType(base.type.qualType));
    let access = "class" === node.tagUsed ? "private" : "public";

    for (const child of node.inner ?? [])
    {
        if ("AccessSpecDecl" === child.kind)
        {
            access = child.access ?? access;
            continue;
        }

        if ("FullComment" === child.kind)
        {
            raw.tags.push(...readTags(child));
            continue;
        }

        if ("public" !== access || child.isImplicit)
            continue;

        if ("CXXMethodDecl" === child.kind)
            raw.methods.push(readMethod(child, undefined));
        else if ("CXXConstructorDecl" === child.kind)
            raw.constructors.push(readMethod(child, undefined));
        else if ("FieldDecl" === child.kind && child.name && child.type)
            raw.fields.push(readField(child));
        else if ("FunctionTemplateDecl" === child.kind)
        {
            const method = (child.inner ?? []).find(templated => "CXXMethodDecl" === templated.kind);
            const parameters = (child.inner ?? []).filter(templated => /TemplateTypeParmDecl|NonTypeTemplateParmDecl/.test(templated.kind)).map(templated => templated.name ?? "");

            if (method)
                raw.methods.push(readMethod(method, parameters));
        }
    }

    return raw;
}

function readMethod(node: AstNode, template: string[] | undefined): RawMethod
{
    const inner = node.inner ?? [];
    const params = inner.filter(child => "ParmVarDecl" === child.kind).map(child => parameterOf(child));
    const comment = inner.find(child => "FullComment" === child.kind);

    return {
        name: node.name ?? "",
        qualType: node.type?.qualType ?? "",
        params: params,
        isStatic: "static" === node.storageClass,
        tags: comment ? readTags(comment) : [],
        ...(template ? { template: template } : {})
    };
}

function readField(node: AstNode): RawField
{
    const inner = node.inner ?? [];
    const comment = inner.find(child => "FullComment" === child.kind);
    const field: RawField = { member: node.name as string, type: cleanType(node.type?.qualType ?? ""), tags: comment ? readTags(comment) : [] };
    const initializer = initializerValue(inner.find(child => "FullComment" !== child.kind));

    if (undefined !== initializer)
        field.default = initializer;

    return field;
}

//A member's initializer written as a .bechaml value, so the generator converts it like any value the markup gives:
//{ 1.0f } is 1.0, { FlexSizing::Fixed } is "Fixed", {} is { }. Undefined for anything else, such as a call.
function initializerValue(node: AstNode | undefined): string | undefined
{
    if (!node)
        return undefined;

    const inner = node.inner ?? [];

    switch (node.kind)
    {
        case "InitListExpr":
        case "CXXConstructExpr":
            if (0 === inner.length)
                return "{ }";

            return 1 === inner.length ? initializerValue(inner[0]) : undefined;
        case "ImplicitCastExpr":
        case "ConstantExpr":
        case "ParenExpr":
        case "MaterializeTemporaryExpr":
        case "CXXFunctionalCastExpr":
            return initializerValue(inner[0]);
        case "CXXBoolLiteralExpr":
            return node.value ? "True" : "False";
        case "IntegerLiteral":
            return String(node.value);
        case "FloatingLiteral":
        {
            const text = String(node.value);
            return /[.eE]/.test(text) ? text : text + ".0";
        }
        case "UnaryOperator":
        {
            const operand = "-" === node.opcode ? initializerValue(inner[0]) : undefined;
            return undefined === operand ? undefined : "-" + operand;
        }
        case "DeclRefExpr":
            return "EnumConstantDecl" === node.referencedDecl?.kind && node.referencedDecl.name ? JSON.stringify(node.referencedDecl.name) : undefined;
        default:
            return undefined;
    }
}

function parameterOf(node: AstNode): SchemaParameter
{
    const type = cleanType(node.type?.qualType ?? "");
    const parameter: SchemaParameter = { name: node.name ?? "", type: type };

    if ("ColorState" === type)
        parameter.isState = true;

    if (node.init)
        parameter.hasDefault = true;

    return parameter;
}

//The @bechaml lines of a doc comment. Clang reads "@bechaml group A B" as an unknown inline command followed by the text
//" group A B", so each tag is the text after the command.
export function readTags(comment: AstNode): string[]
{
    const flat: AstNode[] = [];
    const flatten = (node: AstNode) =>
    {
        flat.push(node);
        (node.inner ?? []).forEach(flatten);
    };

    flatten(comment);
    const tags: string[] = [];

    for (const [index, node] of flat.entries())
    {
        if ("InlineCommandComment" !== node.kind || "bechaml" !== node.name)
            continue;

        const text = flat.slice(index + 1).find(next => "TextComment" === next.kind);
        tags.push((text?.text ?? "").trim());
    }

    return tags;
}

//A class's methods with the ones it inherits, as C++ finds them: a name the class declares hides every base method of
//that name. Bases are searched in order, depth first.
function memberResolver(classes: Map<string, RawClass>): (name: string) => RawMethod[]
{
    const cache = new Map<string, RawMethod[]>();

    const resolve = (name: string, seen: Set<string>): RawMethod[] =>
    {
        const cached = cache.get(name);

        if (cached)
            return cached;

        const raw = classes.get(name);

        if (!raw || seen.has(name))
            return [];

        seen.add(name);
        const methods = [...raw.methods];
        const declared = new Set(methods.map(method => method.name));

        for (const base of raw.bases)
        {
            const inherited = resolve(baseName(base), seen).filter(method => !declared.has(method.name));
            methods.push(...inherited);
            inherited.forEach(method => declared.add(method.name));
        }

        cache.set(name, methods);
        return methods;
    };

    return name => resolve(name, new Set());
}

function toSchemaClass(raw: RawClass, role: SchemaRole, methods: RawMethod[], classes: Map<string, RawClass>, header: (file: string) => string, problems: string[]): SchemaClass
{
    const parts: Record<string, SchemaPart> = {};
    const setters: Record<string, SchemaSetter[]> = {};
    const signals: Record<string, SchemaSignal> = {};
    const slots: Record<string, SchemaSlot> = {};
    let container: SchemaClass["container"];
    let children: SchemaChildren | undefined;

    for (const method of methods)
    {
        const tags = parseTags(method.tags, raw.key + "::" + method.name, problems);

        if (tags.isInternal || method.isStatic)
            continue;

        if (tags.isSlot)
        {
            slots[tags.name ?? method.name] = { call: method.name, params: method.params };
            continue;
        }

        //The struct a span or vector of it holds, looked up in the class first: std::span<FlexDefinition> in MenuBar is
        //MenuBar::FlexDefinition.
        if (tags.isChildren)
        {
            const element = /^std::(?:span|vector)<(?:const )?(.+)>$/.exec(method.params[0]?.type ?? "")?.[1] ?? "";
            const nested = raw.key + "::" + element;
            const type = classes.has(nested) ? nested : element;

            if (1 === method.params.length && classes.has(type))
                children = { call: method.name, type: type };
            else
                problems.push(raw.key + "::" + method.name + ": @bechaml children needs one parameter, a span or vector of a struct.");

            continue;
        }

        //A non-const getter handing out a class by reference: <Border> is GetBorder().
        const getter = /^Get([A-Z]\w*)$/.exec(method.name);
        const returned = /^([\w:<>, ]+?) &\(\)$/.exec(method.qualType);

        if (getter?.[1] && returned?.[1] && 0 === method.params.length)
        {
            parts[tags.name ?? getter[1]] = { getter: method.name, type: baseName(cleanType(returned[1])) };
            continue;
        }

        const signal = /^Connect_(On[A-Z]\w*)$/.exec(method.name);

        if (signal?.[1] && method.params[0])
        {
            signals[signal[1]] = { connect: method.name, slot: method.params[0].type };
            continue;
        }

        if ("AddWidget" === method.name && method.template && method.params[1])
        {
            container = { add: method.name, placement: baseName(method.params[1].type) };
            continue;
        }

        //A Set* method, or another tagged @bechaml setter (an effect's Show, named Shown).
        const setterName = tags.isSetter ? method.name : /^Set([A-Z]\w*)$/.exec(method.name)?.[1];

        //A StyleKey belongs to the widget that owns the part: SetBuiltIn* is never the markup's.
        if (!setterName || 0 === method.params.length || method.params.some(parameter => parameter.type.includes("StyleKey")))
            continue;

        const entry: SchemaSetter = { call: method.name, params: method.params };

        if (tags.group)
            entry.group = tags.group;

        if (tags.defaults)
            entry.defaults = tags.defaults;

        if (method.template)
            entry.template = method.template;

        (setters[tags.name ?? setterName] ??= []).push(entry);
    }

    //A widget's constructor takes the parent window last of the parameters every widget has; what comes after is its own.
    const constructor = raw.constructors.find(candidate => widgetConstructorParameters <= candidate.params.length && "parentWindow" === candidate.params[widgetConstructorParameters - 1]?.name);
    const fields: Record<string, SchemaField> = {};

    for (const field of raw.fields)
    {
        const tags = parseTags(field.tags, raw.key + "::" + field.member, problems);
        const entry: SchemaField = { member: field.member, type: field.type };

        if (undefined !== field.default)
            entry.default = field.default;

        fields[tags.name ?? field.member.replace(/^_/, "")] = entry;
    }

    const schemaClass: SchemaClass =
    {
        cpp: "RetroFuturaGUI::" + raw.key,
        header: header(raw.file),
        role: role,
        bases: raw.bases,
        parts: sortedRecord(parts),
        setters: sortedRecord(setters),
        signals: sortedRecord(signals),
        slots: sortedRecord(slots),
        fields: fields,
        constructorArgs: constructor ? constructor.params.slice(widgetConstructorParameters) : []
    };

    if (container)
        schemaClass.container = children ? { ...container, children: children } : container;
    else if (children)
        problems.push(raw.key + "::" + children.call + ": @bechaml children on a class without AddWidget.");

    const popup = raw.tags.find(tag => tag.startsWith("popup"));

    if (popup)
        schemaClass.popupScopes = popup.split(/\s+/).slice(1);

    return schemaClass;
}

interface Tags
{
    isInternal: boolean;
    isSlot: boolean;
    isChildren: boolean;
    isSetter: boolean;
    name?: string;
    group?: string[];
    defaults?: Record<string, string>;
}

const tagKinds = "group, default, name, internal, slot, children, setter";

//The tags of one method or field; one that isn't a known kind is reported, so a misspelled tag doesn't pass unnoticed.
function parseTags(tags: readonly string[], where: string, problems: string[]): Tags
{
    const parsed: Tags = { isInternal: false, isSlot: false, isChildren: false, isSetter: false };

    for (const tag of tags)
    {
        const [kind, ...words] = tag.split(/\s+/).filter(Boolean);

        switch (kind)
        {
            case "internal":
                parsed.isInternal = true;
                break;
            case "slot":
                parsed.isSlot = true;
                break;
            case "children":
                parsed.isChildren = true;
                break;
            case "setter":
                parsed.isSetter = true;
                break;
            case "name":
                parsed.name = words[0];
                break;
            case "group":
                parsed.group = words;
                break;
            case "default":
                parsed.defaults = Object.fromEntries(words.map(word => word.split("=")).filter(pair => 2 === pair.length).map(pair => [pair[0] as string, pair[1] as string]));
                break;
            default:
                problems.push(where + ": @bechaml " + (kind ?? "") + " isn't one of " + tagKinds + ".");
        }
    }

    return parsed;
}

//A parameter or field type without its top-level const and reference: "const glm::vec4 &" is glm::vec4.
function cleanType(type: string): string
{
    return type.replace(/\s*&{1,2}$/, "").replace(/^const\s+/, "").replace(/^RetroFuturaGUI::/, "").trim();
}

//The class a base or a returned type names: without namespace and template arguments ("Popup<std::string>" is Popup).
function baseName(type: string): string
{
    return cleanType(type).replace(/<.*>$/, "").replace(/^.*::/, "");
}

function sortedRecord<T>(record: Record<string, T>): Record<string, T>
{
    return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
