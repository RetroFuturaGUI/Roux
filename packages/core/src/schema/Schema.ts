//RetroFuturaGUI/Schema.json (Roux plan, 2.5): what the generator may call, as roux schema reads it from the library's
//headers. Names are the C++ ones within namespace RetroFuturaGUI; types are written as the headers write them, without a
//parameter's top-level const and reference

export const schemaVersion = 2;

export interface SchemaParameter
{
    name: string;
    type: string;
    isState?: boolean; //a ColorState: Colors:Hover=… fills it
    hasDefault?: boolean;
}

//One overload of a setter. A .bechaml attribute is the setter's name without Set, unless @bechaml name says otherwise
export interface SchemaSetter
{
    call: string;
    params: SchemaParameter[];
    group?: string[]; //@bechaml group: the attributes this one call takes, in its parameters' order
    defaults?: Record<string, string>; //@bechaml default: what goes in for parameters the markup leaves out
    template?: string[]; //the template parameters of a setter template
}

//A part reached through a getter: <Border> is GetBorder()
export interface SchemaPart
{
    getter: string;
    type: string;
}

export interface SchemaSignal
{
    connect: string;
    slot: string; //the slot's type, which tells what the signal hands over
}

//A function tagged @bechaml slot, which any widget's signal may connect to: OnClick=Window.Minimize
export interface SchemaSlot
{
    call: string;
    params: SchemaParameter[];
}

//A struct's field. A .bechaml attribute is the member's name without the leading _, unless @bechaml name says otherwise
export interface SchemaField
{
    member: string; //_RowDefinition
    type: string;
    default?: string; //the member's initializer as a .bechaml value (False, 1.0, "Fixed", { }), when it is a plain one
}

//A setter tagged @bechaml children: each child element gives one struct of its type, in the children's order
export interface SchemaChildren
{
    call: string;
    type: string; //the struct's key in classes: MenuBar::FlexDefinition
}

//placement: what a container's AddWidget takes. struct: what a constructor or a children setter takes.
export type SchemaRole = "widget" | "window" | "scene" | "part" | "placement" | "struct" | "flavor" | "popup";

export interface SchemaClass
{
    cpp: string;
    header: string; //relative to the library's source folder, with /.
    role: SchemaRole;
    bases: string[];
    parts: Record<string, SchemaPart>; //inherited ones included, by .bechaml name
    setters: Record<string, SchemaSetter[]>; //likewise
    signals: Record<string, SchemaSignal>; //likewise
    slots: Record<string, SchemaSlot>; //likewise
    fields: Record<string, SchemaField>; //a struct's fields by .bechaml name: CellPlacement's Row
    constructorArgs: SchemaParameter[]; //a widget's after the parent window: an Image's path, a Lasagna's AxisDefinition
    //A widget that builds widgets inside it: Lasagna's AddWidget and CellPlacement; a MenuBar's AddWidget takes an index
    container?: { add: string; placement: string; children?: SchemaChildren };
    popupScopes?: string[]; //@bechaml popup: the StyleScope values a popup type styles under
}

export interface SchemaEnum
{
    cpp: string;
    header: string;
    values: string[];
}

export interface Schema
{
    schemaVersion: number;
    headersHash: string; //sha256 of every header of the library's source folder, so Generate can tell when they changed
    enums: Record<string, SchemaEnum>;
    classes: Record<string, SchemaClass>;
}
