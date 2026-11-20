package org.retrofuturagui.roux

import com.intellij.lexer.LexerBase
import com.intellij.psi.tree.IElementType

class BechamlLexer : LexerBase()
{
    private var buffer: CharSequence = ""
    private var bufferEnd = 0
    private var tokenStart = 0
    private var tokenEnd = 0
    private var tokenType: IElementType? = null
    private var inTag = false
    private var expectTagName = false
    private var expectingValue = false
    private var listDepth = 0

    override fun start(buffer: CharSequence, startOffset: Int, endOffset: Int, initialState: Int)
    {
        this.buffer = buffer
        bufferEnd = endOffset
        tokenStart = startOffset
        tokenEnd = startOffset
        tokenType = null
        inTag = (initialState and IN_TAG) != 0
        expectTagName = (initialState and EXPECT_TAG_NAME) != 0
        expectingValue = (initialState and EXPECT_VALUE) != 0
        listDepth = initialState ushr LIST_DEPTH_SHIFT
        advance()
    }

    override fun getState(): Int =
        (if (inTag) IN_TAG else 0) or
            (if (expectTagName) EXPECT_TAG_NAME else 0) or
            (if (expectingValue) EXPECT_VALUE else 0) or
            (listDepth shl LIST_DEPTH_SHIFT)

    override fun getTokenType(): IElementType? = tokenType

    override fun getTokenStart(): Int = tokenStart

    override fun getTokenEnd(): Int = tokenEnd

    override fun advance()
    {
        tokenStart = tokenEnd

        if (tokenStart >= bufferEnd)
        {
            tokenType = null
            return
        }

        val character = buffer[tokenStart]
        tokenType = when
        {
            startsWith(tokenStart, "<!--") -> scanComment()
            !inTag && startsWith(tokenStart, "</") -> scanTagDelimiter(2)
            !inTag && '<' == character -> scanTagDelimiter(1)
            !inTag -> scanText()
            character.isWhitespace() -> scanWhitespace()
            startsWith(tokenStart, "/>") -> scanTagEnd(2)
            '>' == character -> scanTagEnd(1)
            '"' == character -> scanString()
            '=' == character -> scanEquals()
            '{' == character -> scanListOpen()
            '}' == character -> scanListClose()
            ',' == character -> scanComma()
            '#' == character -> scanColor()
            isNumberStart(tokenStart) ->
                if (expectingValue || 0 < listDepth) scanNumber() else scanText()
            isNameStart(character) -> scanName()
            else -> scanText()
        }
    }

    override fun getBufferSequence(): CharSequence = buffer

    override fun getBufferEnd(): Int = bufferEnd

    private fun scanComment(): IElementType
    {
        val end = indexOf("-->", tokenStart + 4)
        tokenEnd = if (0 > end) bufferEnd else end + 3
        return BechamlTokenTypes.COMMENT
    }

    private fun scanTagDelimiter(length: Int): IElementType
    {
        tokenEnd = tokenStart + length
        inTag = true
        expectTagName = true
        expectingValue = false
        listDepth = 0
        return BechamlTokenTypes.TAG_DELIMITER
    }

    private fun scanTagEnd(length: Int): IElementType
    {
        tokenEnd = tokenStart + length
        if (0 == listDepth)
        {
            inTag = false
            expectTagName = false
            expectingValue = false
        }
        return BechamlTokenTypes.TAG_DELIMITER
    }

    private fun scanWhitespace(): IElementType
    {
        tokenEnd = tokenStart + 1
        while (tokenEnd < bufferEnd && buffer[tokenEnd].isWhitespace())
            ++tokenEnd
        return BechamlTokenTypes.WHITESPACE
    }

    private fun scanString(): IElementType
    {
        var index = tokenStart + 1
        while (index < bufferEnd)
        {
            when (buffer[index])
            {
                '"' -> {
                    ++index
                    break
                }
                '\\' -> index += if (index + 1 < bufferEnd) 2 else 1
                '\r', '\n' -> break
                else -> ++index
            }
        }
        tokenEnd = index
        if (expectingValue)
            expectingValue = false
        return BechamlTokenTypes.STRING
    }

    private fun scanEquals(): IElementType
    {
        tokenEnd = tokenStart + 1
        expectingValue = true
        return BechamlTokenTypes.EQUALS
    }

    private fun scanListOpen(): IElementType
    {
        tokenEnd = tokenStart + 1
        ++listDepth
        return BechamlTokenTypes.LIST_DELIMITER
    }

    private fun scanListClose(): IElementType
    {
        tokenEnd = tokenStart + 1
        if (0 < listDepth)
            --listDepth
        if (0 == listDepth)
            expectingValue = false
        return BechamlTokenTypes.LIST_DELIMITER
    }

    private fun scanComma(): IElementType
    {
        tokenEnd = tokenStart + 1
        return BechamlTokenTypes.COMMA
    }

    private fun scanColor(): IElementType
    {
        tokenEnd = tokenStart + 1
        while (tokenEnd < bufferEnd && (buffer[tokenEnd].isLetterOrDigit() || '_' == buffer[tokenEnd]))
            ++tokenEnd
        if (expectingValue && 0 == listDepth)
            expectingValue = false
        return BechamlTokenTypes.COLOR
    }

    private fun scanNumber(): IElementType
    {
        tokenEnd = tokenStart
        if ('-' == buffer[tokenEnd] || '+' == buffer[tokenEnd])
            ++tokenEnd
        while (tokenEnd < bufferEnd && (buffer[tokenEnd].isDigit() || '.' == buffer[tokenEnd]))
            ++tokenEnd
        if (tokenEnd < bufferEnd && ('e' == buffer[tokenEnd] || 'E' == buffer[tokenEnd]))
        {
            var exponentEnd = tokenEnd + 1
            if (exponentEnd < bufferEnd && ('+' == buffer[exponentEnd] || '-' == buffer[exponentEnd]))
                ++exponentEnd
            val digitsStart = exponentEnd
            while (exponentEnd < bufferEnd && buffer[exponentEnd].isDigit())
                ++exponentEnd
            if (digitsStart < exponentEnd)
                tokenEnd = exponentEnd
        }
        if (expectingValue && 0 == listDepth)
            expectingValue = false
        return BechamlTokenTypes.NUMBER
    }

    private fun scanName(): IElementType
    {
        tokenEnd = tokenStart + 1
        while (tokenEnd < bufferEnd && isNamePart(buffer[tokenEnd]))
            ++tokenEnd

        val name = buffer.subSequence(tokenStart, tokenEnd).toString()

        if (expectTagName)
        {
            expectTagName = false
            return BechamlTokenTypes.TAG_NAME
        }

        if (expectingValue || 0 < listDepth)
        {
            if (("True" == name || "False" == name) && '.' !in name)
            {
                if (expectingValue && 0 == listDepth)
                    expectingValue = false
                return BechamlTokenTypes.BOOLEAN
            }
            if ('.' in name)
            {
                if (expectingValue && 0 == listDepth)
                    expectingValue = false
                return BechamlTokenTypes.REFERENCE
            }
            if (expectingValue && 0 == listDepth)
                expectingValue = false
            return BechamlTokenTypes.TEXT
        }

        var lookahead = tokenEnd
        while (lookahead < bufferEnd && buffer[lookahead].isWhitespace())
            ++lookahead
        if (lookahead < bufferEnd && '=' == buffer[lookahead])
            return BechamlTokenTypes.ATTRIBUTE_NAME

        if ('.' in name)
            return BechamlTokenTypes.REFERENCE

        return BechamlTokenTypes.ATTRIBUTE_NAME
    }

    private fun scanText(): IElementType
    {
        tokenEnd = tokenStart + 1

        if (!inTag)
        {
            while (tokenEnd < bufferEnd && '<' != buffer[tokenEnd])
                ++tokenEnd
        }
        else if (!buffer[tokenStart].isWhitespace())
        {
            while (tokenEnd < bufferEnd &&
                !buffer[tokenEnd].isWhitespace() &&
                '>' != buffer[tokenEnd] &&
                !startsWith(tokenEnd, "/>"))
                ++tokenEnd
        }

        return BechamlTokenTypes.TEXT
    }

    private fun startsWith(offset: Int, text: String): Boolean
    {
        if (offset + text.length > bufferEnd)
            return false
        for (index in text.indices)
            if (buffer[offset + index] != text[index])
                return false
        return true
    }

    private fun indexOf(text: String, from: Int): Int
    {
        var index = from
        while (index + text.length <= bufferEnd)
        {
            if (startsWith(index, text))
                return index
            ++index
        }
        return -1
    }

    private fun nextChar(index: Int): Char = if (index < bufferEnd) buffer[index] else '\u0000'

    private fun isNameStart(character: Char): Boolean = character.isLetter() || '_' == character

    private fun isNumberStart(index: Int): Boolean
    {
        val character = buffer[index]
        if (character.isDigit())
            return true

        if ('+' != character && '-' != character && '.' != character)
            return false

        return nextChar(index + 1).isDigit() ||
            ('.' == nextChar(index + 1) && nextChar(index + 2).isDigit())
    }

    private fun isNamePart(character: Char): Boolean =
        character.isLetterOrDigit() || '_' == character || '.' == character || ':' == character

    companion object
    {
        private const val IN_TAG = 1
        private const val EXPECT_TAG_NAME = 1 shl 1
        private const val EXPECT_VALUE = 1 shl 2
        private const val LIST_DEPTH_SHIFT = 3
    }
}