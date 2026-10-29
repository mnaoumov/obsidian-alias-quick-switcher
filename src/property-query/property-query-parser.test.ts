import {
  describe,
  expect,
  it
} from 'vitest';

import type {
  PropertyTerm,
  TextPattern,
  ValueExpression
} from './property-query-parser.ts';

import {
  parsePropertyQuery,
  quoteValue,
  TextPatternKind,
  ValueConditionKind
} from './property-query-parser.ts';

describe('parsePropertyQuery', () => {
  it('should leave a query with no term to the path matching', () => {
    expect(parsePropertyQuery('Alpha/Bravo Charlie')).toStrictEqual({ groups: [], openValueTerm: null, pathQuery: 'Alpha/Bravo Charlie' });
  });

  it('should not read a bracket inside a word as a term', () => {
    expect(parsePropertyQuery('Notes[1]').groups).toStrictEqual([]);
  });

  it('should read a plain term', () => {
    expect(onlyTerm('[isoCode:uk]')).toStrictEqual({ key: word('isoCode'), value: expressionOf(patternOf(word('uk'))) });
  });

  it('should read a key with a space unquoted, as core Search does', () => {
    expect(onlyTerm('[birth place:Kyiv]').key).toStrictEqual(word('birth place'));
  });

  it('should read a quoted key, which may hold a colon or a bracket', () => {
    expect(onlyTerm('["key]x:y":val]').key).toStrictEqual(phrase('key]x:y'));
  });

  it('should read a quoted value with an escaped quote', () => {
    expect(onlyTerm(String.raw`[quote:"say \"hi\" now"]`).value).toStrictEqual(expressionOf(patternOf(phrase('say "hi" now'))));
  });

  it('should keep a bracket inside a quoted value', () => {
    expect(onlyTerm('[a:"x]y"]').value).toStrictEqual(expressionOf(patternOf(phrase('x]y'))));
  });

  it('should read several words as all being required', () => {
    expect(onlyTerm('[city:San Miguel]').value).toStrictEqual(expressionOf({
      kind: 'and',
      operands: [patternOf(word('San')), patternOf(word('Miguel'))]
    }));
  });

  it('should read OR inside a value', () => {
    expect(onlyTerm('[status:Draft OR Published]').value).toStrictEqual(expressionOf({
      kind: 'or',
      operands: [patternOf(word('Draft')), patternOf(word('Published'))]
    }));
  });

  it('should read parentheses inside a value', () => {
    expect(onlyTerm('[status:(Draft OR Published) final]').value).toStrictEqual(expressionOf({
      kind: 'and',
      operands: [
        { kind: 'or', operands: [patternOf(word('Draft')), patternOf(word('Published'))] },
        patternOf(word('final'))
      ]
    }));
  });

  it('should keep a bracket inside parentheses in the value', () => {
    expect(onlyTerm('[a:(x]y)]').value).toStrictEqual(expressionOf(patternOf(word('x]y'))));
  });

  it('should skip a stray closing parenthesis and a stray OR', () => {
    expect(onlyTerm('[status:) OR Draft]').value).toStrictEqual(expressionOf(patternOf(word('Draft'))));
  });

  // The `]` is inside the open parenthesis, so it does not close the term; the term runs to the end of the query.
  it('should read an unclosed parenthesis to the end of the query', () => {
    expect(onlyTerm('[status:(Draft]').value).toStrictEqual(expressionOf(patternOf(word('Draft]'))));
  });

  it('should read a regex value, case-insensitively', () => {
    const value = onlyTerm('[isoCode:/^uk$/]').value;
    expect(value).toStrictEqual(expressionOf(patternOf({ kind: TextPatternKind.Regex, regex: /^uk$/i })));
  });

  it('should keep a regex flag the user gave', () => {
    const value = onlyTerm('[isoCode:/^uk$/gi]').value;
    expect(value).toStrictEqual(expressionOf(patternOf({ kind: TextPatternKind.Regex, regex: /^uk$/gi })));
  });

  it('should keep a bracket inside a regex value', () => {
    const value = onlyTerm('[a:/[xy]z/]').value;
    expect(value).toStrictEqual(expressionOf(patternOf({ kind: TextPatternKind.Regex, regex: /[xy]z/i })));
  });

  it('should keep an escaped slash inside a regex value', () => {
    const value = onlyTerm(String.raw`[a:/x\/y/]`).value;
    expect(value).toStrictEqual(expressionOf(patternOf({ kind: TextPatternKind.Regex, regex: /x\/y/i })));
  });

  it('should read an invalid regex as plain text', () => {
    expect(onlyTerm('[a:/(/]').value).toStrictEqual(expressionOf({
      kind: 'and',
      operands: [patternOf(word('/')), patternOf(word('/'))]
    }));
  });

  it('should read an unclosed regex as plain text', () => {
    expect(onlyTerm('[a:/abc]').value).toStrictEqual(expressionOf(patternOf(word('/abc'))));
  });

  it('should read a slash inside a word as plain text', () => {
    expect(onlyTerm('[a:x/y/]').value).toStrictEqual(expressionOf(patternOf(word('x/y/'))));
  });

  it('should read a regex key', () => {
    expect(onlyTerm('[/iso/:uk]').key).toStrictEqual({ kind: TextPatternKind.Regex, regex: /iso/i });
  });

  it('should read an invalid regex key as plain text', () => {
    expect(onlyTerm('[/(/:uk]').key).toStrictEqual(word('/(/'));
  });

  it('should read a term with no value as asking for the property', () => {
    expect(onlyTerm('[isoCode]').value).toStrictEqual({ kind: ValueConditionKind.Exists });
  });

  it('should read an empty value as asking for the property', () => {
    expect(onlyTerm('[isoCode:]').value).toStrictEqual({ kind: ValueConditionKind.Exists });
  });

  it('should read null as asking for an empty property', () => {
    expect(onlyTerm('[empty:null]').value).toStrictEqual({ kind: ValueConditionKind.Null });
  });

  it('should skip whitespace after the colon', () => {
    expect(onlyTerm('[isoCode: uk]').value).toStrictEqual(expressionOf(patternOf(word('uk'))));
  });

  it('should AND two terms side by side', () => {
    expect(parsePropertyQuery('[a:x] [b:y]').groups).toHaveLength(2);
  });

  it('should OR two terms joined by OR', () => {
    const { groups, pathQuery } = parsePropertyQuery('[a:x] OR [b:y]');
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2);
    expect(pathQuery).toBe('');
  });

  it('should keep an OR that joins no two terms as path text', () => {
    expect(parsePropertyQuery('[a:x] OR Bravo').pathQuery).toBe('OR Bravo');
    expect(parsePropertyQuery('OR [a:x]').pathQuery).toBe('OR');
  });

  it('should keep the path text around the terms', () => {
    const { groups, pathQuery } = parsePropertyQuery('Alpha [a:x] Bravo');
    expect(groups).toHaveLength(1);
    expect(pathQuery).toBe('Alpha Bravo');
  });

  describe('a term still being typed', () => {
    it('should count an unclosed term, as core Search does', () => {
      expect(onlyTerm('[isoCode:uk').value).toStrictEqual(expressionOf(patternOf(word('uk'))));
    });

    it('should report the value being typed', () => {
      expect(parsePropertyQuery('Alpha [isoCode:u').openValueTerm).toStrictEqual({ keySource: 'isoCode', partialValue: 'u', startIndex: 6 });
    });

    it('should drop the quote the value opens with', () => {
      expect(parsePropertyQuery('[city: "San Mi').openValueTerm?.partialValue).toBe('San Mi');
    });

    it('should keep the key as typed, quotes included', () => {
      expect(parsePropertyQuery('["birth place":K').openValueTerm?.keySource).toBe('"birth place"');
    });

    it('should report nothing while the key is still being typed', () => {
      const { groups, openValueTerm } = parsePropertyQuery('[isoCo');
      expect(openValueTerm).toBeNull();
      expect(groups[0]?.[0]?.value).toStrictEqual({ kind: ValueConditionKind.Exists });
    });

    it('should report nothing once the term is closed', () => {
      expect(parsePropertyQuery('[isoCode:uk]').openValueTerm).toBeNull();
    });

    it('should report nothing once path text follows the term', () => {
      expect(parsePropertyQuery('[a:x] Bravo').openValueTerm).toBeNull();
    });

    it('should read an unclosed quoted key to the end', () => {
      expect(onlyTerm('["birth').key).toStrictEqual(phrase('birth'));
    });
  });
});

describe('quoteValue', () => {
  it('should quote a value and escape its quotes and backslashes', () => {
    expect(quoteValue(String.raw`a "b" \c`)).toBe(String.raw`"a \"b\" \\c"`);
  });

  it('should round-trip through the parser', () => {
    const value = String.raw`San "Miguel" ] \ de`;
    expect(onlyTerm(`[city:${quoteValue(value)}]`).value).toStrictEqual(expressionOf(patternOf(phrase(value))));
  });
});

function expressionOf(expression: ValueExpression): PropertyTerm['value'] {
  return { expression, kind: ValueConditionKind.Expression };
}

function onlyTerm(query: string): PropertyTerm {
  const { groups } = parsePropertyQuery(query);
  expect(groups).toHaveLength(1);
  expect(groups[0]).toHaveLength(1);
  return groups[0]?.[0] ?? expect.unreachable();
}

function patternOf(pattern: TextPattern): ValueExpression {
  return { kind: 'pattern', pattern };
}

function phrase(text: string): TextPattern {
  return { kind: TextPatternKind.Phrase, text };
}

function word(text: string): TextPattern {
  return { kind: TextPatternKind.Word, text };
}
