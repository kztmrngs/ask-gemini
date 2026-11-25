function makeMathBox(lines, baseline = 0, inline = lines.join('')) {
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  return {
    lines: lines.map((line) => line.padEnd(width, ' ')),
    width,
    baseline: Math.max(0, Math.min(baseline, lines.length - 1)),
    inline,
  };
}

function textMathBox(text) {
  return makeMathBox([text], 0, text);
}

function joinMathBoxes(boxes) {
  const nonEmpty = boxes.filter((box) => box.width > 0);
  if (nonEmpty.length === 0) return textMathBox('');

  const top = Math.max(...nonEmpty.map((box) => box.baseline));
  const bottom = Math.max(...nonEmpty.map((box) => box.lines.length - box.baseline - 1));
  const height = top + bottom + 1;
  const lines = Array(height).fill('');

  for (const box of boxes) {
    const offset = top - box.baseline;
    for (let row = 0; row < height; row += 1) {
      const boxRow = row - offset;
      lines[row] += boxRow >= 0 && boxRow < box.lines.length
        ? box.lines[boxRow]
        : ' '.repeat(box.width);
    }
  }

  return makeMathBox(lines, top, boxes.map((box) => box.inline).join(''));
}

function fractionMathBox(numerator, denominator) {
  const width = Math.max(1, numerator.width, denominator.width);
  const center = (box) => box.lines.map((line) => {
    const left = Math.floor((width - box.width) / 2);
    return `${' '.repeat(left)}${line}${' '.repeat(width - left - box.width)}`;
  });

  return makeMathBox([
    ...center(numerator),
    '-'.repeat(width),
    ...center(denominator),
  ], numerator.lines.length, `(${numerator.inline})/(${denominator.inline})`);
}

function rootMathBox(radicand) {
  const width = Math.max(1, radicand.width);
  const roof = `  /${'_'.repeat(width)}`;
  const lines = radicand.lines.map((line, index) => {
    const prefix = index === radicand.baseline ? '\\/' : '  ';
    return `${prefix} ${line}`;
  });
  return makeMathBox([roof, ...lines], radicand.baseline + 1, `sqrt(${radicand.inline})`);
}

function environmentMathBox(environment, body) {
  const rows = body.trim().split(/\\\\(?:\[[^\]]*\])?/)
    .map((row) => row.split(/(?<!\\)&/).map((cell) => renderMath(cell.trim())))
    .filter((row) => row.some((cell) => cell.width > 0));
  const columnCount = Math.max(1, ...rows.map((row) => row.length));
  const columnWidths = Array(columnCount).fill(0);
  for (const row of rows) {
    row.forEach((cell, column) => {
      columnWidths[column] = Math.max(columnWidths[column], cell.width);
    });
  }

  const lines = [];
  let baseline = 0;
  rows.forEach((row, rowIndex) => {
    const rowBaseline = Math.max(0, ...row.map((cell) => cell.baseline));
    const rowBottom = Math.max(0, ...row.map((cell) => cell.lines.length - cell.baseline - 1));
    const rowHeight = rowBaseline + rowBottom + 1;
    if (rowIndex === 0) baseline = rowBaseline;
    for (let lineIndex = 0; lineIndex < rowHeight; lineIndex += 1) {
      const cellLines = Array.from({ length: columnCount }, (_, column) => {
        const cell = row[column];
        const sourceLine = lineIndex - rowBaseline + (cell?.baseline || 0);
        const content = cell && sourceLine >= 0 && sourceLine < cell.lines.length
          ? cell.lines[sourceLine]
          : '';
        return content.padEnd(columnWidths[column], ' ');
      });
      lines.push(cellLines.join('  ').trimEnd());
    }
    if (rowIndex < rows.length - 1) lines.push('');
  });

  let result = makeMathBox(lines.length ? lines : [''], baseline,
    rows.map((row) => row.map((cell) => cell.inline).join(', ')).join('; '));
  if (environment === 'pmatrix' || environment === 'bmatrix' || environment === 'Bmatrix'
      || environment === 'vmatrix' || environment === 'Vmatrix') {
    const left = environment === 'pmatrix' ? '(' : environment === 'bmatrix' ? '['
      : environment === 'Bmatrix' ? '{' : '|';
    const right = environment === 'pmatrix' ? ')' : environment === 'bmatrix' ? ']'
      : environment === 'Bmatrix' ? '}' : '|';
    result = makeMathBox(result.lines.map((line) => `${left} ${line} ${right}`), result.baseline,
      `${left}${result.inline}${right}`);
  } else if (environment === 'cases') {
    result = makeMathBox(result.lines.map((line, index) => `${index === result.baseline ? '{' : ' '} ${line}`),
      result.baseline, `{ ${result.inline}`);
  }
  return result;
}

function attachScripts(base, superscript, subscript) {
  if (!superscript && !subscript) return base;
  const inline = `${base.inline}${subscript ? `_(${subscript.inline})` : ''}${superscript ? `^(${superscript.inline})` : ''}`;
  return textMathBox(inline);
}

const LATEX_TEXT = {
  alpha: 'alpha', beta: 'beta', gamma: 'gamma', delta: 'delta', epsilon: 'epsilon',
  theta: 'theta', lambda: 'lambda', mu: 'mu', pi: 'pi', rho: 'rho', sigma: 'sigma',
  phi: 'phi', omega: 'omega', Gamma: 'GAMMA', Delta: 'DELTA', Theta: 'THETA',
  Lambda: 'LAMBDA', Pi: 'PI', Sigma: 'SIGMA', Phi: 'PHI', Omega: 'OMEGA',
  infinity: 'infinity', partial: 'd', nabla: 'grad', cdot: '.', times: 'x',
  pm: '+/-', mp: '-/+', neq: '!=', ne: '!=', le: '<=', leq: '<=', ge: '>=', geq: '>=',
  approx: '~=', equiv: '<=>', to: '->', rightarrow: '->', leftarrow: '<-',
  Rightarrow: '=>', Leftarrow: '<=', in: 'in', notin: 'not in',
  sum: 'SUM', prod: 'PROD', int: 'INT', oint: 'OINT', lim: 'lim',
  forall: 'for all', exists: 'exists', emptyset: '{}', ellipsis: '...', ldots: '...',
  sin: 'sin', cos: 'cos', tan: 'tan', log: 'log', ln: 'ln', exp: 'exp',
};

class LatexAsciiParser {
  constructor(source) {
    this.source = source;
    this.index = 0;
  }

  parse() {
    return this.parseSequence();
  }

  parseSequence(stopAtBrace = false) {
    const boxes = [];
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === '}' && stopAtBrace) break;
      if (/\s/.test(char)) {
        this.index += 1;
        if (boxes.length && boxes.at(-1).width) boxes.push(textMathBox(' '));
        continue;
      }
      if (char === '^' || char === '_') {
        this.index += 1;
        const argument = this.parseArgument();
        boxes.push(char === '^'
          ? attachScripts(textMathBox(''), argument, null)
          : attachScripts(textMathBox(''), null, argument));
        continue;
      }

      let base = this.parsePrimary();
      let superscript = null;
      let subscript = null;
      while (this.source[this.index] === '^' || this.source[this.index] === '_') {
        const marker = this.source[this.index++];
        const argument = this.parseArgument();
        if (marker === '^') superscript = argument;
        else subscript = argument;
      }
      base = attachScripts(base, superscript, subscript);
      boxes.push(base);
    }
    return joinMathBoxes(boxes);
  }

  parsePrimary() {
    const char = this.source[this.index++];
    if (char === '{') {
      const group = this.parseSequence(true);
      if (this.source[this.index] === '}') this.index += 1;
      return group;
    }
    if (char !== '\\') return textMathBox(char);

    if (this.index >= this.source.length) return textMathBox('\\');
    if (!/[A-Za-z]/.test(this.source[this.index])) {
      return textMathBox(this.source[this.index++]);
    }

    const start = this.index;
    while (/[A-Za-z]/.test(this.source[this.index] || '')) this.index += 1;
    const command = this.source.slice(start, this.index);
    if (command === 'frac' || command === 'dfrac' || command === 'tfrac') {
      return fractionMathBox(this.parseArgument(), this.parseArgument());
    }
    if (command === 'sqrt') {
      this.skipSpaces();
      if (this.source[this.index] === '[') {
        while (this.index < this.source.length && this.source[this.index++] !== ']') {}
      }
      return rootMathBox(this.parseArgument());
    }
    if (command === 'begin') {
      const environment = this.parseArgument().inline;
      const endMarker = `\\end{${environment}}`;
      const endIndex = this.source.indexOf(endMarker, this.index);
      if (endIndex >= 0) {
        const body = this.source.slice(this.index, endIndex);
        this.index = endIndex + endMarker.length;
        if (['matrix', 'pmatrix', 'bmatrix', 'Bmatrix', 'vmatrix', 'Vmatrix', 'cases', 'aligned', 'align', 'gathered'].includes(environment)) {
          return environmentMathBox(environment, body);
        }
        return renderMath(body);
      }
      return textMathBox(`begin ${environment}`);
    }
    if (['text', 'textrm', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname'].includes(command)) {
      return this.parseArgument();
    }
    if (['left', 'right', 'big', 'Big', 'bigg', 'Bigg', 'displaystyle', 'textstyle'].includes(command)) {
      return textMathBox('');
    }
    if (command === 'quad') return textMathBox('  ');
    if (command === 'qquad') return textMathBox('    ');
    return textMathBox(LATEX_TEXT[command] ?? command);
  }

  parseArgument() {
    this.skipSpaces();
    if (this.source[this.index] === '{') return this.parsePrimary();
    if (this.index >= this.source.length) return textMathBox('');
    let box = this.parsePrimary();
    let superscript = null;
    let subscript = null;
    while (this.source[this.index] === '^' || this.source[this.index] === '_') {
      const marker = this.source[this.index++];
      const argument = this.parseArgument();
      if (marker === '^') superscript = argument;
      else subscript = argument;
    }
    box = attachScripts(box, superscript, subscript);
    return box;
  }

  skipSpaces() {
    while (/\s/.test(this.source[this.index] || '') && this.index < this.source.length) this.index += 1;
  }
}

function renderMath(latex) {
  return new LatexAsciiParser(latex.trim()).parse();
}

function transformMathText(text) {
  const mathPattern = /\\\[([\s\S]*?)\\\]|\\\(([\s\S]*?)\\\)|\$\$([\s\S]*?)\$\$|\$([^$\n]+)\$/g;
  let result = '';
  let cursor = 0;
  let match;
  while ((match = mathPattern.exec(text))) {
    result += text.slice(cursor, match.index);
    const display = match[1] !== undefined || match[3] !== undefined;
    const box = renderMath(match[1] ?? match[2] ?? match[3] ?? match[4]);
    if (display) {
      result += `\n\`\`\`text\n${box.lines.join('\n').trimEnd()}\n\`\`\`\n`;
    } else {
      result += `\`${box.inline.replaceAll('`', '\\`')}\``;
    }
    cursor = mathPattern.lastIndex;
  }
  return result + text.slice(cursor);
}

function transformMathOutsideInlineCode(text) {
  const codeSpan = /(`+)[\s\S]*?\1/g;
  let result = '';
  let cursor = 0;
  let match;
  while ((match = codeSpan.exec(text))) {
    result += transformMathText(text.slice(cursor, match.index));
    result += match[0];
    cursor = codeSpan.lastIndex;
  }
  return result + transformMathText(text.slice(cursor));
}

export function convertLatexInMarkdown(markdown) {
  const lines = markdown.match(/[^\n]*\n|[^\n]+$/g) || [];
  let output = '';
  let plainText = '';
  let fence = null;

  const flushPlainText = () => {
    output += transformMathOutsideInlineCode(plainText);
    plainText = '';
  };

  for (const line of lines) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (!fence && marker) {
      flushPlainText();
      fence = { char: marker[1][0], length: marker[1].length };
      output += line;
      continue;
    }
    if (fence) {
      output += line;
      const closing = line.match(/^ {0,3}(`+|~+)[ \t]*\n?$/);
      if (closing && closing[1][0] === fence.char && closing[1].length >= fence.length) fence = null;
      continue;
    }
    plainText += line;
  }

  flushPlainText();
  return output;
}
