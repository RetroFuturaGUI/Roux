//A line and column, both counted from 1. The column counts UTF-16 code units, as VS Code does
export interface Position
{
    readonly line: number;
    readonly column: number;
}

//Turns offsets into lines and columns. \r\n, \n and a lone \r each end a line
export class LineMap
{
    private readonly _lineStarts: number[] = [0];

    constructor(text: string)
    {
        for (let index = 0; text.length > index; ++index)
        {
            const character = text.charCodeAt(index);

            if (13 === character && 10 === text.charCodeAt(index + 1))
                ++index;

            if (10 === character || 13 === character)
                this._lineStarts.push(index + 1);
        }
    }

    position(offset: number): Position
    {
        let low = 0;
        let high = this._lineStarts.length - 1;

        //The last line starting at or before the offset
        while (low < high)
        {
            const middle = (low + high + 1) >> 1;

            if (offset >= (this._lineStarts[middle] ?? 0))
                low = middle;
            else
                high = middle - 1;
        }

        return { line: low + 1, column: offset - (this._lineStarts[low] ?? 0) + 1 };
    }
}
