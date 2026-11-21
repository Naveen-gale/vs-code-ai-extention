'use strict';

class InlineQualityPipeline {
  static detectIndentStyle(prefix) {
    const tabIndented = (prefix.match(/^[\t]+[^ \t]/gm) || []).length;
    const spaceLines = prefix.match(/^([ ]{2,})[^ \t]/gm) || [];
    if (tabIndented > 0 && tabIndented >= spaceLines.length) return '\t';
    if (spaceLines.length) {
      const widths = spaceLines.map(line => line.match(/^ */)[0].length).filter(n => n > 0);
      const min = widths.length ? Math.min(...widths) : 2;
      return ' '.repeat(Math.max(2, min));
    }
    return '  ';
  }

  static detectLineEnding(prefix) {
    return prefix.includes('\r\n') ? '\r\n' : '\n';
  }

  static extractRelevantContext(prefix, suffix = '', language = 'plaintext') {
    const lines = prefix.split(/\r?\n/);
    const declarations = [];
    const variables = [];
    const imports = [];
    const classes = [];
    const patterns = [
      /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/,
      /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
      /^\s*(?:public\s+|private\s+|protected\s+)?(?:static\s+)?[\w<>,[\].?]+\s+([A-Za-z_$][\w$]*)\s*\(/,
      /^\s*(?:def|class)\s+([A-Za-z_][\w]*)/
    ];

    for (const line of lines.slice(-500)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^(?:import\b|from\s+\S+\s+import\b|require\s*\(|using\s+)/i.test(trimmed)) {
        imports.push(trimmed);
      }
      if (/^\s*(?:export\s+)?(?:abstract\s+|final\s+|public\s+|private\s+|protected\s+)?(?:class|interface|struct|enum)\s+([A-Za-z_$][\w$]*)/.test(line) ||
          /^\s*class\s+([A-Za-z_][\w]*)/.test(line)) {
        const match = line.match(/\b(?:class|interface|struct|enum)\s+([A-Za-z_$][\w$]*)/) ||
          line.match(/\bclass\s+([A-Za-z_][\w]*)/);
        if (match) classes.push(match[1]);
      }
      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (!match) continue;
        const name = match[1];
        if (/^\s*(?:const|let|var)\b|^\s*[a-zA-Z_]\w*\s*=/.test(line) || language === 'python') {
          if (name && !variables.includes(name)) variables.push(name);
        } else if (name && !declarations.includes(name)) {
          declarations.push(name);
        }
        break;
      }
    }

    const unique = values => values.filter((value, index) => values.indexOf(value) === index);
    const indentUnit = InlineQualityPipeline.detectIndentStyle(prefix);
    const currentLine = lines.length ? lines[lines.length - 1] : '';
    const indentationMatch = currentLine.match(/^(\s*)/);
    const lineIndent = indentationMatch ? indentationMatch[1] : '';

    return {
      imports: unique(imports).slice(-12),
      declarations: unique(declarations).slice(-20),
      variables: unique(variables).slice(-30),
      classes: unique(classes).slice(-12),
      indentUnit,
      lineIndent,
      lineEnding: InlineQualityPipeline.detectLineEnding(prefix),
      incompleteStatement: (prefix.split(/\r?\n/).pop() || '').trim()
    };
  }

  static buildPrompt(context) {
    const section = (title, values) => values && values.length
      ? `${title}: ${values.join(', ')}`
      : null;
    const relevant = [
      section('Existing imports', context.imports),
      section('Nearby functions', context.declarations),
      section('Nearby variables', context.variables),
      section('Nearby classes', context.classes),
      section('Document symbols', context.projectSymbols)
    ].filter(Boolean).join('\n');

    const systemPrompt =
      `You are a high-precision inline code completion engine for ${context.language || 'code'}.\n` +
      `Insert only the text that belongs exactly at the cursor.\n` +
      `OUTPUT FORMAT: code only. Return no prose, no explanation, no summary, and no Markdown.\n` +
      `Rules:\n` +
      `- Continue the incomplete statement, do not restate code before the cursor.\n` +
      `- Use existing imports, functions, variables and classes.\n` +
      `- Return executable syntax, preserving the cursor's indentation and existing code style.\n` +
      `- Never invent undefined names when a nearby existing name is available.\n` +
      `- Return only raw insertion text: no prose, markdown fences or explanations.\n` +
      `- Do not duplicate text that already exists after the cursor.\n` +
      `- Keep the insertion short and complete the immediate edit, not unrelated code.\n` +
      `Indent unit: ${context.indentUnit === '\t' ? 'tab' : JSON.stringify(context.indentUnit)}.`;

    const userContent =
      `[LANGUAGE: ${context.language}]\n` +
      `[CURSOR LINE INDENT: ${JSON.stringify(context.lineIndent)}]\n` +
      (relevant ? `[NEARBY SYMBOLS]\n${relevant}\n` : '') +
      `[INCOMPLETE STATEMENT]: ${context.incompleteStatement}\n` +
      `[CODE BEFORE CURSOR]\n${context.prefix}\n` +
      (context.suffix ? `[CODE AFTER CURSOR]\n${context.suffix}\n` : '') +
      `[RETURN ONLY THE INSERTION AT <CURSOR>]`;

    return [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];
  }

  static stripDuplicateLines(text, context) {
    if (!text) return '';
    const lineEnding = context.lineEnding || '\n';
    let result = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const linePrefix = context.linePrefix || '';
    if (linePrefix) {
      const prefixNoIndent = linePrefix.trimStart();
      if (prefixNoIndent && result.startsWith(prefixNoIndent)) {
        result = result.slice(prefixNoIndent.length);
      }
      const maxOverlap = Math.min(40, linePrefix.length, result.length);
      for (let length = maxOverlap; length > 0; length--) {
        if (linePrefix.slice(-length) === result.slice(0, length)) {
          result = result.slice(length);
          break;
        }
      }
    }

    const lineSuffix = (context.lineSuffix || '').trim();
    if (lineSuffix && result.trim().endsWith(lineSuffix)) {
      result = result.trim().slice(0, -lineSuffix.length).trimEnd();
    }

    result = result.replace(/^\n+/, '');
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/\n/g, lineEnding);
    return result;
  }

  static looksLikeProse(text) {
    if (!text) return true;
    const trimmed = text.trim();
    if (!trimmed) return true;

    if (/^(?:```|#\s|Here(?:'s| is)\b|Sure(?: thing)?[,.]?\b|Certainly\b|Explanation\b|The following\b|This (?:code|function|suggestion)\b|I (?:have |would |can |will )|You (?:can|could|should)\b|Note:?\b)/i.test(trimmed)) {
      return true;
    }

    const lines = trimmed.split(/\r?\n/).filter(Boolean);
    if (lines.length === 1) {
      const codeSignals = /[{}()[\];=<>_$\\]|^\s*(?:def|class|if|for|while|try|except|return|print|import|from|const|let|var|function|async|await|public|private|protected|using|select|insert|update)\b/i.test(trimmed);
      const sentenceSignal = /^(?:[A-Za-z][^{}()[\];=<>]*[.!?])$/.test(trimmed);
      if (sentenceSignal && !codeSignals) return true;
    }
    return false;
  }

  static basicStructureValidation(text) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    let quote = null;
    let escaped = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char === quote) quote = null;
        continue;
      }
      if (char === '"' || char === "'" || char === '`') {
        quote = char;
        continue;
      }
      if (pairs[char]) stack.push(pairs[char]);
      else if (Object.values(pairs).includes(char)) {
        if (stack.pop() !== char) return false;
      }
    }
    return !quote && stack.length === 0;
  }

  static validateSyntax(text, context) {
    if (!text || !text.trim()) return false;
    if (!InlineQualityPipeline.basicStructureValidation(text)) return false;
    return true;
  }

  static postProcess(rawText, context) {
    if (!rawText || typeof rawText !== 'string') return '';
    const original = rawText.trimStart();
    if (/^(?:Here(?:'s| is)\b|Sure(?: thing)?[,.]?\b|Certainly\b|Explanation\b|The following\b|This (?:code|function|suggestion)\b|I (?:have |would |can |will )|You (?:can|could|should)\b|Note:?\b)/i.test(original)) {
      return '';
    }
    let text = rawText
      .replace(/^```[A-Za-z0-9_-]*\r?\n?/i, '')
      .replace(/\r?\n?```\s*$/i, '')
      .replace(/```/g, '')
      .replace(/<MID>|<PRE>|<SUF>|<EOT>|<FILL_ME>|<\|[^>]+\|>/g, '')
      .replace(/^(?:Here(?:'s| is) (?:the |your )?(?:code|completion|suggestion|solution|snippet):?|Sure(?: thing)?,?\s*(?:here(?:'s| is) )?(?:the |your )?(?:code|snippet):?|Output:?|Solution:?)/i, '')
      .trimStart();

    if (/```/.test(rawText)) {
      text = text.replace(/^```[A-Za-z0-9_-]*\r?\n?/i, '');
    }

    text = InlineQualityPipeline.stripDuplicateLines(text, context);
    if (InlineQualityPipeline.looksLikeProse(text)) return '';

    if (context.language === 'python') {
      const indent = context.lineIndent || '';
      if (text && indent && !text.startsWith(indent) && !text.startsWith(context.lineEnding || '\n')) {
        const firstLine = text.split(/\r?\n/, 1)[0];
        if (!/^\s/.test(firstLine)) text = indent + text;
      }
    }

    if (!InlineQualityPipeline.validateSyntax(text, context)) return '';
    return text;
  }
}

module.exports = { InlineQualityPipeline };
