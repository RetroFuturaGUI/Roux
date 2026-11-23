import type
{
    Attribute,
    Diagnostic,
    Document,
    Element,
    InvalidValue,
    ListValue,
    Span,
    SyntaxChild,
    Token,
    TokenKind,
    Value
} from "./Syntax.js";

//Reads a .bechaml file into its lossless syntax tree. It never throws: every problem becomes a diagnostic, and reading
//goes on after it, so one pass reports all of a file's errors
export function parseBechaml(source: string): Document
{
    return new Parser(source).parseDocument();
}

//Reads one value on its own, such as a value typed into a form. The whole text has to be that one value
export function parseBechamlValue(text: string): { value: Value; diagnostics: readonly Diagnostic[] }
{
    return new Parser(text).parseSingleValue();
}

//Elements whose text is kept as it is instead of being read as a value. A slot's C++ signature may hold < and >
const rawTextElements = new Set(["Slot"]);

//Element names, attribute names (Colors:Hover) and references (Dictionary.Colors.Accent). Each place checks the shape
const nameExpression = /[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*/y;
//Element names and references, which may also start with @ to name a widget: <@ButtonUp>, @ActualSlider.StepUp
const namedExpression = /@?[A-Za-z_][A-Za-z0-9_]*(?:[.:][A-Za-z_][A-Za-z0-9_]*)*/y;
//The one prefix an element name may have: Prefab:StepperSlider places a prefab
const prefabPrefix = "Prefab:";
const whitespaceExpression = /[ \t\r\n]+/y;
//Reads more than a number may be (.5, 5., 2px), so the mistake is reported as one
const numberExpression = /[-+]?[0-9.]+(?:[eE][-+]?[0-9]+)?[A-Za-z0-9_.]*/y;
const strictNumberExpression = /^-?[0-9]+(?:\.[0-9]+)?(?:[eE][-+]?[0-9]+)?$/;
const colorExpression = /#[0-9A-Za-z_]*/y;
//Where a run of text that fits nowhere ends
const unknownEndExpression = /[ \t\r\n<>{},"=/]/;

const stringEscapes: Record<string, string> = { "\"": "\"", "\\": "\\", "n": "\n", "t": "\t" };

class Parser
{
    private readonly _source: string;
    private _position = 0;
    private readonly _diagnostics: Diagnostic[] = [];
    //The elements being read, innermost last, so a closing tag can tell which one it belongs to
    private readonly _openElementNames: string[] = [];
    //Whether a signal's value is being read (OnClick=…), the one place a slot may take values in parentheses
    private _isInSignal = false;

    constructor(source: string)
    {
        this._source = source;
    }

    parseDocument(): Document
    {
        const children: SyntaxChild[] = [];
        let root: Element | undefined;

        if (this._source.startsWith("﻿"))
            children.push(this.take("ByteOrderMark", 1));

        for (;;)
        {
            this.skipTrivia(children, undefined);

            if (this.isAtEnd())
                break;

            if (this.isAt("<?"))
            {
                const end = this._source.indexOf("?>", this._position);
                const declaration = this.take("Unknown", (0 > end ? this._source.length : end + 2) - this._position);
                children.push(declaration);
                this.report(declaration, "An XML declaration isn't needed: .bechaml files are always UTF-8.");
                continue;
            }

            if (this.isAt("</"))
            {
                const closeName = this.closeTagNameAhead();
                this.report(this.parseCloseTag(children), "</" + closeName + "> closes nothing: no element is open here.");
                continue;
            }

            if (this.isAt("<"))
            {
                const element = this.parseElement();
                children.push(element);

                if (root)
                    this.report(element.nameToken ?? element, "A file has one root element; <" + element.name + "> is a second one.");
                else
                    root = element;

                continue;
            }

            const text = this.takeTextUntilTag();
            children.push(text);
            this.report(text, "Text can't go outside the root element.");
        }

        if (!root)
            this.report({ start: 0, end: 0 }, "The file has no root element. It needs one, such as <Scene>.");
        else
            this.checkPrefabs(root, true);

        return {
            kind: "Document",
            start: 0,
            end: this._source.length,
            children: children,
            source: this._source,
            root: root,
            diagnostics: this.sortedDiagnostics()
        };
    }

    //A prefab file's root <Prefab> needs its Name and holds one root container, besides its <Slot>s; <Prefab> starts no
    //other element. Whether the root container is a container is the generator's to say, as only the schema knows
    private checkPrefabs(element: Element, isRoot: boolean): void
    {
        if ("Prefab" === element.name)
        {
            const where = element.nameToken ?? element;

            if (!isRoot)
            {
                this.report(where, "<Prefab> only starts a prefab file; a prefab is placed as <Prefab:Name>, such as <Prefab:StepperSlider>.");
            }
            else
            {
                if (!element.attributes.some(attribute => "Name" === attribute.name))
                    this.report(where, "<Prefab> needs a Name, written as a string: Name=\"StepperSlider\".");

                const containers = element.elements.filter(child => "Slot" !== child.name);

                if (0 === containers.length)
                    this.report(where, "<Prefab> needs its root container inside it, such as <Lasagna>.");

                for (const extra of containers.slice(1))
                    this.report(extra.nameToken ?? extra, "A prefab holds one root container; put <" + extra.name + "> inside it.");
            }
        }

        for (const child of element.elements)
            this.checkPrefabs(child, false);
    }

    parseSingleValue(): { value: Value; diagnostics: readonly Diagnostic[] }
    {
        if (this.isAtEnd())
        {
            this.report({ start: 0, end: 0 }, "No value is given.");
            return { value: { kind: "Invalid", start: 0, end: 0, children: [] }, diagnostics: this.sortedDiagnostics() };
        }

        const value = this.parseValue();

        if (!this.isAtEnd())
            this.report({ start: this._position, end: this._source.length }, "Only one value can go here.");

        return { value: value, diagnostics: this.sortedDiagnostics() };
    }

    //At a "<" that isn't a closing tag or a comment.
    private parseElement(): Element
    {
        const start = this._position;
        const children: SyntaxChild[] = [];
        const openTag = this.take("OpenTag", 1);
        children.push(openTag);

        let name = "";
        let nameToken: Token | undefined;
        const nameText = this.match(namedExpression);

        if (undefined === nameText)
        {
            this.report(openTag, "A tag needs a name after <.");
        }
        else
        {
            name = nameText;
            nameToken = this.take("Name", nameText.length);
            children.push(nameToken);
            const plainName = name.startsWith(prefabPrefix) ? name.slice(prefabPrefix.length) : name.replace(/^@/, "");

            if (/[.:]/.test(plainName))
                this.report(nameToken, "<" + name + "> isn't an element name: names have no . or :, only Prefab: before a prefab's name. A part is an element of its own inside its widget, such as <Border> inside <Button>.");
        }

        const where = nameToken ?? openTag;
        const attributes: Attribute[] = [];
        const attributeNames = new Set<string>();
        let isSelfClosing = false;
        let hasContent = false;

        for (;;)
        {
            this.skipTrivia(children, "Comments can't go inside a tag.");

            if (this.isAtEnd())
            {
                this.report(where, "<" + name + "> isn't closed: > is missing.");
                break;
            }

            if (this.isAt("/>"))
            {
                children.push(this.take("SelfCloseTagEnd", 2));
                isSelfClosing = true;
                break;
            }

            if (this.isAt(">"))
            {
                children.push(this.take("TagEnd", 1));
                hasContent = true;
                break;
            }

            if (this.isAt("<"))
            {
                this.report(where, "<" + name + "> is missing its >.");
                break;
            }

            if (undefined !== this.match(nameExpression))
            {
                const [attribute, trailingTrivia] = this.parseAttribute();
                children.push(attribute, ...trailingTrivia);
                attributes.push(attribute);

                if (attributeNames.has(attribute.name))
                    this.report(attribute.children[0] ?? attribute, attribute.name + " is given twice on <" + name + ">.");

                attributeNames.add(attribute.name);
                continue;
            }

            //A value without its name and =, as in Height"720".
            if (this.isAt("\"") || this.isAt("{") || this.isAt("#"))
            {
                const previous = children.findLast(child => "Whitespace" !== child.kind);
                const stray = this.parseValue();
                children.push(stray);

                if (previous && "Attribute" === previous.kind && !previous.value)
                    this.report(stray, previous.name + " needs = before its value.");
                else
                    this.report(stray, "A value in a tag needs an attribute name and = before it.");

                continue;
            }

            const unknown = this.takeUnknown();
            children.push(unknown);

            if ("," === unknown.text)
                this.report(unknown, "Attributes are separated by spaces, not commas.");
            else
                this.report(unknown, unknown.text + " doesn't belong in <" + name + ">'s tag.");
        }

        const elements: Element[] = [];
        let value: Value | undefined;
        let rawText: Token | undefined;

        if (hasContent)
        {
            this._openElementNames.push(name);

            if (rawTextElements.has(name))
            {
                rawText = this.takeRawText(name);

                if (rawText)
                    children.push(rawText);
            }

            let hasReportedMix = false;

            for (;;)
            {
                this.skipTrivia(children, undefined);

                if (this.isAtEnd())
                {
                    this.report(where, "<" + name + "> isn't closed: </" + name + "> is missing.");
                    break;
                }

                if (this.isAt("</"))
                {
                    const closeName = this.closeTagNameAhead();

                    if (closeName === name)
                    {
                        this.parseCloseTag(children);
                        break;
                    }

                    //It closes an outer element, so this one was left open; the outer one takes the tag.
                    if (this._openElementNames.includes(closeName))
                    {
                        this.report(where, "<" + name + "> isn't closed: </" + name + "> is missing before </" + closeName + ">.");
                        break;
                    }

                    this.report(this.parseCloseTag(children), "</" + closeName + "> closes nothing: <" + name + "> is open here.");
                    continue;
                }

                if (this.isAt("<"))
                {
                    const element = this.parseElement();
                    children.push(element);
                    elements.push(element);

                    if (value && !hasReportedMix)
                    {
                        this.report(element.nameToken ?? element, "<" + name + "> holds either one value or elements, not both.");
                        hasReportedMix = true;
                    }

                    continue;
                }

                const parsed = this.parseValue();
                children.push(parsed);

                if (0 < elements.length || value)
                {
                    if (!hasReportedMix)
                        this.report(parsed, value ? "<" + name + "> holds one value; this is a second one." : "<" + name + "> holds either one value or elements, not both.");

                    hasReportedMix = true;
                    continue;
                }

                value = parsed;
            }

            this._openElementNames.pop();
        }

        return {
            kind: "Element",
            start: start,
            end: this._position,
            children: children,
            name: name,
            nameToken: nameToken,
            attributes: attributes,
            elements: elements,
            value: value,
            rawText: rawText,
            isSelfClosing: isSelfClosing
        };
    }

    //Returns the attribute and the spaces after its name when no = follows: those belong to the tag, not the attribute.
    private parseAttribute(): [Attribute, SyntaxChild[]]
    {
        const start = this._position;
        const children: SyntaxChild[] = [];
        const nameToken = this.take("Name", (this.match(nameExpression) ?? "").length);
        children.push(nameToken);

        const name = nameToken.text;
        const [setter = "", state, ...extraStates] = name.split(":");

        if (name.includes("."))
            this.report(nameToken, name + " isn't an attribute name: attribute names have no dots.");
        else if (0 < extraStates.length)
            this.report(nameToken, name + " has more than one colon. A colon names one color state, as in Colors:Hover.");

        const trivia: SyntaxChild[] = [];
        const end = this._position;
        this.skipTrivia(trivia, "Comments can't go inside a tag.");

        if (!this.isAt("="))
            return [this.attribute(start, end, children, name, setter, state, undefined), trivia];

        children.push(...trivia, this.take("Equals", 1));
        this.skipTrivia(children, "Comments can't go inside a tag.");

        let value: Value | undefined;

        if (this.isAtEnd() || this.isAt(">") || this.isAt("/>") || this.isAt("<"))
        {
            this.report(nameToken, name + "= needs a value.");
        }
        else
        {
            this._isInSignal = /^On[A-Z]/.test(name);
            value = this.parseValue();
            this._isInSignal = false;
            children.push(value);
        }

        return [this.attribute(start, this._position, children, name, setter, state, value), []];
    }

    private attribute(start: number, end: number, children: SyntaxChild[], name: string, setter: string, state: string | undefined, value: Value | undefined): Attribute
    {
        return { kind: "Attribute", start: start, end: end, children: children, name: name, setter: setter, state: state, value: value };
    }

    //Called at text that isn't the end of the input.
    private parseValue(): Value
    {
        const character = this._source[this._position];

        if ("{" === character)
            return this.parseList();

        if ("\"" === character)
            return this.parseString();

        if ("#" === character)
            return this.parseColor();

        const number = this.match(numberExpression);

        if (undefined !== number)
            return this.parseNumber(number);

        const name = this.match(namedExpression);

        if (undefined !== name)
            return this.parseName(name);

        const unknown = this.takeUnknown();
        this.report(unknown, unknown.text + " isn't a value.");
        return this.invalid([unknown]);
    }

    private parseList(): ListValue
    {
        const start = this._position;
        const openBrace = this.take("OpenBrace", 1);
        const children: SyntaxChild[] = [openBrace];
        const items: Value[] = [];
        let isAfterComma = false;

        for (;;)
        {
            this.skipTrivia(children, "Comments can't go inside a list.");

            if (this.isAt("}"))
            {
                children.push(this.take("CloseBrace", 1));
                break;
            }

            if (this.isAtEnd() || this.isAt("<") || this.isAt(">") || this.isAt("/>"))
            {
                this.report(openBrace, "The list isn't closed: } is missing.");
                break;
            }

            if (this.isAt(","))
            {
                const comma = this.take("Comma", 1);
                children.push(comma);

                if (0 === items.length || isAfterComma)
                    this.report(comma, "A value is missing before this comma.");

                isAfterComma = true;
                continue;
            }

            const item = this.parseValue();
            children.push(item);

            if (0 < items.length && !isAfterComma)
                this.report(item, "A comma is missing between the list's values.");

            items.push(item);
            isAfterComma = false;
        }

        return { kind: "List", start: start, end: this._position, children: children, items: items };
    }

    private parseString(): Value
    {
        const start = this._position;
        let index = start + 1;
        let value = "";
        let isClosed = false;

        for (;;)
        {
            const character = this._source[index];

            if (undefined === character || "\n" === character || "\r" === character)
                break;

            if ("\"" === character)
            {
                ++index;
                isClosed = true;
                break;
            }

            if ("\\" !== character)
            {
                value += character;
                ++index;
                continue;
            }

            const escaped = this._source[index + 1];
            const resolved = undefined === escaped ? undefined : stringEscapes[escaped];

            if (undefined === escaped || "\n" === escaped || "\r" === escaped)
            {
                ++index;
                break;
            }

            if (undefined === resolved)
                this.report({ start: index, end: index + 2 }, "\\" + escaped + " isn't an escape. Strings know \\\", \\\\, \\n and \\t; paths take / instead of \\.");

            value += resolved ?? escaped;
            index += 2;
        }

        const token = this.take("String", index - start);

        if (!isClosed)
            this.report(token, "The string isn't closed: \" is missing before the end of the line.");

        return { kind: "String", start: start, end: this._position, children: [token], value: value };
    }

    private parseColor(): Value
    {
        const text = this.match(colorExpression) ?? "#";
        const token = this.take("Color", text.length);
        const digits = text.slice(1);

        if (!/^[0-9A-Fa-f]*$/.test(digits) || (6 !== digits.length && 8 !== digits.length))
        {
            this.report(token, text + " isn't a color: write # and 6 or 8 hex digits, #RRGGBB or #RRGGBBAA.");
            return this.invalid([token]);
        }

        const channel = (index: number) => Number.parseInt(digits.slice(index * 2, index * 2 + 2), 16);

        return {
            kind: "Color",
            start: token.start,
            end: token.end,
            children: [token],
            red: channel(0),
            green: channel(1),
            blue: channel(2),
            alpha: 8 === digits.length ? channel(3) : 255
        };
    }

    private parseNumber(text: string): Value
    {
        const token = this.take("Number", text.length);

        if (!strictNumberExpression.test(text))
        {
            this.report(token, numberMistake(text));
            return this.invalid([token]);
        }

        const value = Number(text);

        if (/[.eE]/.test(text))
        {
            if (!Number.isFinite(value))
                this.report(token, text + " is too large for a number.");

            return { kind: "Float", start: token.start, end: token.end, children: [token], value: value };
        }

        if (!Number.isSafeInteger(value))
            this.report(token, text + " is too large for a whole number.");

        return { kind: "Integer", start: token.start, end: token.end, children: [token], value: value };
    }

    private parseName(text: string): Value
    {
        const token = this.take("Name", text.length);

        if ("True" === text || "False" === text)
            return { kind: "Bool", start: token.start, end: token.end, children: [token], value: "True" === text };

        if (text.includes(":"))
            this.report(token, text + " isn't a value: a colon only goes in attribute names, as in Colors:Hover.");
        else if (text.startsWith("@") && !text.includes("."))
            this.report(token, text + " names a widget; a value calls one of its functions, such as " + text + ".StepUp.");
        else if (/^(true|false)$/i.test(text))
            this.report(token, "Write " + text[0]?.toUpperCase() + text.slice(1).toLowerCase() + ": bools are True and False.");
        else if (!text.includes("."))
            this.report(token, text + " needs quotes: \"" + text + "\". Text and enum values are strings.");
        else if (this.isAt("("))
            return this.parseCall(token);
        else
            return { kind: "Reference", start: token.start, end: token.end, children: [token], segments: text.split(".") };

        return this.invalid([token]);
    }

    //At the "(" after a reference: the values a signal hands its slot, Slots.LoadScene(Scenes.MainScene)
    private parseCall(name: Token): Value
    {
        const openParen = this.take("OpenParen", 1);
        const children: SyntaxChild[] = [name, openParen];
        const items: Value[] = [];
        let isAfterComma = false;

        if (!this._isInSignal)
            this.report(openParen, "Values in parentheses only go with the slot a signal calls, as in OnClick=Slots.LoadScene(Scenes.MainScene).");

        for (;;)
        {
            this.skipTrivia(children, "Comments can't go inside a call.");

            if (this.isAt(")"))
            {
                children.push(this.take("CloseParen", 1));
                break;
            }

            if (this.isAtEnd() || this.isAt("<") || this.isAt(">") || this.isAt("/>"))
            {
                this.report(openParen, "The call isn't closed: ) is missing.");
                break;
            }

            if (this.isAt(","))
            {
                const comma = this.take("Comma", 1);
                children.push(comma);

                if (0 === items.length || isAfterComma)
                    this.report(comma, "A value is missing before this comma.");

                isAfterComma = true;
                continue;
            }

            const item = this.parseValue();
            children.push(item);

            if (0 < items.length && !isAfterComma)
                this.report(item, "A comma is missing between the call's values.");

            items.push(item);
            isAfterComma = false;
        }

        return { kind: "Reference", start: name.start, end: this._position, children: children, segments: name.text.split("."), arguments: items };
    }

    //At "</". Reads the closing tag into children and returns its span.
    private parseCloseTag(children: SyntaxChild[]): Span
    {
        const start = this._position;
        const openCloseTag = this.take("OpenCloseTag", 2);
        children.push(openCloseTag);

        const name = this.match(namedExpression);

        if (undefined !== name)
            children.push(this.take("Name", name.length));

        this.skipTrivia(children, "Comments can't go inside a tag.");

        if (this.isAt(">"))
            children.push(this.take("TagEnd", 1));
        else
            this.report(openCloseTag, "</" + (name ?? "") + " is missing its >.");

        return { start: start, end: this._position };
    }

    //The name of the closing tag at the position, without reading it.
    private closeTagNameAhead(): string
    {
        namedExpression.lastIndex = this._position + 2;
        return namedExpression.exec(this._source)?.[0] ?? "";
    }

    //Everything up to the element's closing tag. Undefined when the element is empty.
    private takeRawText(name: string): Token | undefined
    {
        let end = this._source.indexOf("</" + name, this._position);

        //</Slots isn't </Slot.
        while (0 <= end && /[A-Za-z0-9_.:]/.test(this._source[end + 2 + name.length] ?? ""))
            end = this._source.indexOf("</" + name, end + 1);

        if (0 > end)
            end = this._source.length;

        return end > this._position ? this.take("RawText", end - this._position) : undefined;
    }

    //Spaces, line breaks and comments. Where comments aren't allowed, they are still read, with an error.
    private skipTrivia(children: SyntaxChild[], commentMistake: string | undefined): void
    {
        for (;;)
        {
            const whitespace = this.match(whitespaceExpression);

            if (undefined !== whitespace)
            {
                children.push(this.take("Whitespace", whitespace.length));
                continue;
            }

            if (!this.isAt("<!--"))
                return;

            const end = this._source.indexOf("-->", this._position + 4);
            const comment = this.take("Comment", (0 > end ? this._source.length : end + 3) - this._position);
            children.push(comment);

            if (0 > end)
                this.report(comment, "The comment isn't closed: --> is missing.");
            else if (commentMistake)
                this.report(comment, commentMistake);
        }
    }

    //Text outside the root element, up to the next tag, without the spaces before it.
    private takeTextUntilTag(): Token
    {
        let end = this._source.indexOf("<", this._position + 1);

        if (0 > end)
            end = this._source.length;

        while (end - 1 > this._position && /[ \t\r\n]/.test(this._source[end - 1] ?? ""))
            --end;

        return this.take("Unknown", end - this._position);
    }

    //At least one character, then up to where a value, a tag or a list would go on.
    private takeUnknown(): Token
    {
        let end = this._position + 1;

        while (this._source.length > end && !unknownEndExpression.test(this._source[end] ?? ""))
            ++end;

        return this.take("Unknown", end - this._position);
    }

    private invalid(children: SyntaxChild[]): InvalidValue
    {
        const first = children[0];
        const last = children[children.length - 1];
        return { kind: "Invalid", start: first?.start ?? this._position, end: last?.end ?? this._position, children: children };
    }

    private take(kind: TokenKind, length: number): Token
    {
        const start = this._position;
        this._position += length;
        return { kind: kind, text: this._source.slice(start, this._position), start: start, end: this._position };
    }

    private match(expression: RegExp): string | undefined
    {
        expression.lastIndex = this._position;
        return expression.exec(this._source)?.[0];
    }

    private isAt(text: string): boolean
    {
        return this._source.startsWith(text, this._position);
    }

    private isAtEnd(): boolean
    {
        return this._source.length <= this._position;
    }

    private report(span: Span, message: string): void
    {
        this._diagnostics.push({ start: span.start, end: span.end, message: message });
    }

    private sortedDiagnostics(): Diagnostic[]
    {
        return [...this._diagnostics].sort((left, right) => left.start - right.start);
    }
}

//What a number-like text got wrong: .5, 5., +5 or 2px
function numberMistake(text: string): string
{
    if (/^[-+]?\.[0-9]/.test(text))
        return text + " needs a digit before the point: write " + text.replace(".", "0.") + ".";

    if (/^[-+]?[0-9]+\.(?![0-9])/.test(text))
        return text + " needs a digit after the point: write " + text.replace(".", ".0") + ".";

    if (text.startsWith("+"))
        return "Numbers have no + sign: write " + text.slice(1) + ".";

    return text + " isn't a number.";
}
