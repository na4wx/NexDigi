// Simple script to find where the syntax error is
const fs = require('fs');
const lines = fs.readFileSync('./lib/bbsSession.js', 'utf8').split('\n');

let braceStack = [];
let parenStack = [];

for (let i = 0; i < lines.length; i++) {
  const line = lines[i];
  
  for (let j = 0; j < line.length; j++) {
    const char = line[j];
    const prev = j > 0 ? line[j-1] : '';
    
    // Skip strings
    if (char === "'" || char === '"' || char === '`') {
      // Find matching quote
      let k = j + 1;
      while (k < line.length && line[k] !== char) {
        if (line[k] === '\\') k++; // Skip escaped chars
        k++;
      }
      j = k;
      continue;
    }
    
    if (char === '{') {
      braceStack.push({line: i+1, col: j+1});
    } else if (char === '}') {
      if (braceStack.length === 0) {
        console.log(`ERROR: Extra closing brace at line ${i+1}, col ${j+1}`);
        process.exit(1);
      }
      braceStack.pop();
    } else if (char === '(') {
      parenStack.push({line: i+1, col: j+1});
    } else if (char === ')') {
      if (parenStack.length === 0) {
        console.log(`ERROR: Extra closing paren at line ${i+1}, col ${j+1}`);
        process.exit(1);
      }
      parenStack.pop();
    }
  }
}

if (braceStack.length > 0) {
  console.log(`ERROR: Unclosed braces (${braceStack.length}):`);
  braceStack.forEach(b => console.log(`  Line ${b.line}, col ${b.col}`));
  process.exit(1);
}

if (parenStack.length > 0) {
  console.log(`ERROR: Unclosed parens (${parenStack.length}):`);
  parenStack.forEach(p => console.log(`  Line ${p.line}, col ${p.col}`));
  process.exit(1);
}

console.log('✅ All braces and parentheses match!');
console.log(`Total lines: ${lines.length}`);
