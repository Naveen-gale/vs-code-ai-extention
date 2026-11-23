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

    const prefix = context.prefix || '';
    let removedFullPrefix = false;
    if (prefix && result.startsWith(prefix)) {
      result = result.slice(prefix.length);
      removedFullPrefix = true;
    }

    const linePrefix = context.linePrefix || '';
    if (!removedFullPrefix && linePrefix && result.startsWith(linePrefix)) {
      result = result.slice(linePrefix.length);
    } else if (!removedFullPrefix && linePrefix) {
      const maxOverlap = Math.min(40, linePrefix.length, result.length);
      for (let length = maxOverlap; length > 0; length--) {
        if (linePrefix.slice(-length) === result.slice(0, length)) {
          result = result.slice(length);
          break;
        }
      }
    }

    const suffix = context.suffix || '';
    if (suffix && result.endsWith(suffix)) {
      result = result.slice(0, -suffix.length);
    }

    const lineSuffix = context.lineSuffix || '';
    if (lineSuffix && result.endsWith(lineSuffix)) {
      result = result.slice(0, -lineSuffix.length);
    } else if (lineSuffix) {
      const maxOverlap = Math.min(40, result.length, lineSuffix.length);
      for (let length = maxOverlap; length > 0; length--) {
        if (result.slice(-length) === lineSuffix.slice(0, length)) {
          result = result.slice(0, -length);
          break;
        }
      }
    }

    result = result.replace(/^\n+/, '');
    result = result.replace(/\n{3,}/g, '\n\n');
    result = result.replace(/\n/g, lineEnding);
    return result;
  }

  static isCommentLine(line, language) {
    const trimmed = line.trimStart();
    if (/^(?:\/\/|\/\*|\*|<!--|-->|--\s)/.test(trimmed)) return true;
    if (language === 'python' || language === 'shellscript' || language === 'ruby' ||
        language === 'yaml' || language === 'r' || language === 'powershell' ||
        language === 'bat' || language === 'toml' || language === 'ini') {
      return trimmed.startsWith('#');
    }
    return false;
  }

  static looksLikeProse(text, language) {
    if (!text) return true;
    const trimmed = text.trim();
    if (!trimmed) return true;

    if (/^(?:Here(?:'s| is)\b|Sure(?: thing)?[,.]?\b|Certainly\b|Explanation\b|The following\b|This (?:code|function|suggestion)\b|I (?:have |would |can |will )|You (?:can|could|should)\b|Note:?\b|We need to\b|The code before cursor\b|Let me think\b|Thinking through\b|To complete (?:this|the)\b|The task is to\b|Error:|Provider error:|Request failed:)/i.test(trimmed)) {
      return true;
    }

    const lines = trimmed.split(/\r?\n/).filter(line => line.trim());
    for (const line of lines) {
      const lineText = line.trim();
      if (InlineQualityPipeline.isCommentLine(line, language) ||
          /^(?:["'`])/.test(lineText)) continue;
      if (/^(?:We need to\b|The code before cursor\b|Here(?:'s| is)\b|Let me think\b|I think\b|This (?:code|function|suggestion)\b|The following\b|Explanation\b|In summary\b|First,?\s+we\b)/i.test(lineText)) {
        return true;
      }
    }
    return false;
  }

  static basicStructureValidation(text, language) {
    const pairs = { '(': ')', '[': ']', '{': '}' };
    const stack = [];
    let quote = null;
    let escaped = false;
    let blockComment = false;
    let lineComment = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const next = text[i + 1];
      if (lineComment) {
        if (char === '\n') lineComment = false;
        continue;
      }
      if (blockComment) {
        if (char === '*' && next === '/') {
          blockComment = false;
          i++;
        }
        continue;
      }
      if (quote) {
        if (escaped) { escaped = false; continue; }
        if (char === '\\') { escaped = true; continue; }
        if (char === quote) quote = null;
        continue;
      }
      if (char === '/' && next === '*') {
        blockComment = true;
        i++;
        continue;
      }
      if ((char === '/' && next === '/') ||
          (language === 'sql' && char === '-' && next === '-') ||
          (['python', 'shellscript', 'ruby', 'yaml', 'r', 'powershell', 'bat', 'toml', 'ini'].includes(language) && char === '#')) {
        lineComment = true;
        i += char === '/' || char === '-' ? 1 : 0;
        continue;
      }
      if (char === '<' && text.slice(i, i + 4) === '<!--') {
        blockComment = true;
        const close = text.indexOf('-->', i + 4);
        if (close === -1) return true;
        i = close + 2;
        blockComment = false;
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
    const language = context.language || '';
    if (language !== 'markdown' && language !== 'plaintext') {
      const surroundingCode = `${context.prefix || ''}${text}${context.suffix || ''}`;
      if (!InlineQualityPipeline.basicStructureValidation(surroundingCode, language)) return false;
    }
    return true;
  }

  static postProcess(rawText, context) {
    if (!rawText || typeof rawText !== 'string') return '';
    let text = rawText;
    const trimmed = text.trim();
    const fenced = trimmed.match(/^```[A-Za-z0-9_-]*\r?\n([\s\S]*?)\r?\n```$/);
    if (fenced) {
      text = fenced[1];
    } else if (trimmed.includes('```')) {
      return '';
    }

    if (InlineQualityPipeline.looksLikeProse(text, context.language)) return '';

    text = text
      .replace(/<MID>|<PRE>|<SUF>|<EOT>|<FILL_ME>|<\|[^>]+\|>/g, '')
      .trimStart();

    text = InlineQualityPipeline.stripDuplicateLines(text, context);
    if (InlineQualityPipeline.looksLikeProse(text, context.language)) return '';

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
