//The syntax tree of a .bechaml file. It is lossless: every character of the file sits in exactly one token, spaces and
//comments included, so printing the tree gives back the file byte for byte, even when it has errors

export type TokenKind =
    | "ByteOrderMark"
    | "Whitespace"
    | "Comment"
    | "OpenTag"         //"<"
    | "OpenCloseTag"    //"</"
    | "TagEnd"          //">"
    | "SelfCloseTagEnd" //"/>"
    | "Equals"
    | "Comma"
    | "OpenBrace"
    | "CloseBrace"
    | "Name"            //Button, Colors:Hover, Dictionary.Colors.Accent
    | "String"
    | "Number"
    | "Color"
    | "RawText"         //A <Slot>'s C++ signature
    | "Unknown";        //Text that fits nowhere; it always comes with a diagnostic

//Offsets count UTF-16 code units from the start of the file, as JavaScript strings do
export interface Span
{
    readonly start: number;
    readonly end: number;
}

export interface Token extends Span
{
    readonly kind: TokenKind;
    readonly text: string;
}

export interface Diagnostic extends Span
{
    readonly message: string;
}

export type SyntaxNode = Document | Element | Attribute | Value;
export type SyntaxChild = SyntaxNode | Token;

interface NodeBase extends Span
{
    //Tokens and nodes in the order they appear, covering the node's span without gaps
    readonly children: readonly SyntaxChild[];
}

export interface Document extends NodeBase
{
    readonly kind: "Document";
    readonly source: string;
    readonly root: Element | undefined;
    readonly diagnostics: readonly Diagnostic[];
}

export interface Element extends NodeBase
{
    readonly kind: "Element";
    readonly name: string;
    readonly nameToken: Token | undefined;
    readonly attributes: readonly Attribute[];
    readonly elements: readonly Element[];
    //The element's text as a value: <Version>"0.1.0"</Version>. Undefined for an empty element
    readonly value: Value | undefined;
    //The raw text of an element that holds one, such as <Slot>void Print()</Slot>
    readonly rawText: Token | undefined;
    readonly isSelfClosing: boolean;
}

export interface Attribute extends NodeBase
{
    readonly kind: "Attribute";
    //The whole name, "Colors:Hover"
    readonly name: string;
    //The part before the colon, "Colors"
    readonly setter: string;
    //The color state after the colon, "Hover", if there is one
    readonly state: string | undefined;
    //Undefined for a bare attribute such as Async, which means True
    readonly value: Value | undefined;
}

export type Value =
    | BoolValue
    | IntegerValue
    | FloatValue
    | StringValue
    | ColorValue
    | ListValue
    | ReferenceValue
    | InvalidValue;

export interface BoolValue extends NodeBase
{
    readonly kind: "Bool";
    readonly value: boolean;
}

export interface IntegerValue extends NodeBase
{
    readonly kind: "Integer";
    readonly value: number;
}

export interface FloatValue extends NodeBase
{
    readonly kind: "Float";
    readonly value: number;
}

export interface StringValue extends NodeBase
{
    readonly kind: "String";
    readonly value: string;
}

//Each channel from 0 to 255; alpha is 255 when the color has six digits
export interface ColorValue extends NodeBase
{
    readonly kind: "Color";
    readonly red: number;
    readonly green: number;
    readonly blue: number;
    readonly alpha: number;
}

export interface ListValue extends NodeBase
{
    readonly kind: "List";
    readonly items: readonly Value[];
}

//Dictionary.Colors.Accent is { "Dictionary", "Colors", "Accent" }
export interface ReferenceValue extends NodeBase
{
    readonly kind: "Reference";
    readonly segments: readonly string[];
}

//Where a value should be but the text isn't one. It always comes with a diagnostic
export interface InvalidValue extends NodeBase
{
    readonly kind: "Invalid";
}

export function isToken(child: SyntaxChild): child is Token
{
    return !("children" in child);
}

//Gives back the node's text exactly as it was read
export function printSyntax(node: SyntaxChild): string
{
    if (isToken(node))
        return node.text;

    let text = "";

    for (const child of node.children)
        text += printSyntax(child);

    return text;
}