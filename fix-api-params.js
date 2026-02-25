#!/usr/bin/env node

/**
 * Script to fix Next.js 15+ params Promise issue in API routes
 * Converts: { params }: { params: { id: string } }
 * To: { params }: { params: Promise<{ id: string }> }
 */

/* eslint-disable @typescript-eslint/no-require-imports */
/* eslint-disable @typescript-eslint/no-unused-vars */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔧 Fixing API route params for Next.js 15+...\n');

// Find all route.ts files in dynamic routes
const findCommand = 'find src/app/api -name "route.ts" -path "*/[*]/*"';
let files;

try {
  files = execSync(findCommand, { encoding: 'utf-8' })
    .trim()
    .split('\n')
    .filter(f => f.length > 0);
} catch (error) {
  console.error('Error finding files:', error.message);
  process.exit(1);
}

console.log(`Found ${files.length} files to process\n`);

let fixedCount = 0;
let skippedCount = 0;
let errorCount = 0;

files.forEach((file, index) => {
  console.log(`[${index + 1}/${files.length}] Processing: ${file}`);

  try {
    let content = fs.readFileSync(file, 'utf-8');
    let modified = false;
    let changes = [];

    // Pattern 1: Single param (id, cuit, itemId, etc.)
    const singleParamRegex = /\{\s*params\s*\}:\s*\{\s*params:\s*\{\s*(\w+):\s*string\s*\}\s*\}/g;
    if (singleParamRegex.test(content)) {
      content = content.replace(
        /\{\s*params\s*\}:\s*\{\s*params:\s*\{\s*(\w+):\s*string\s*\}\s*\}/g,
        '{ params }: { params: Promise<{ $1: string }> }'
      );
      changes.push('Single param pattern');
      modified = true;
    }

    // Pattern 2: Multiple params (less common but possible)
    const multiParamRegex = /\{\s*params\s*\}:\s*\{\s*params:\s*\{\s*(\w+:\s*string[,\s]*)+\}\s*\}/g;
    if (multiParamRegex.test(content)) {
      content = content.replace(
        /\{\s*params\s*\}:\s*\{\s*params:\s*(\{[^}]+\})\s*\}/g,
        '{ params }: { params: Promise<$1> }'
      );
      changes.push('Multi param pattern');
      modified = true;
    }

    // Now fix the usage of params inside the function
    // Look for: const someVar = params.id or params.somefield
    // Need to add: const { id } = await params (or similar)

    if (modified) {
      // Find all functions that were modified
      const functionRegex = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\s*\([^)]+Promise<\{[^}]+\}>\s*\)[^{]*\{/g;
      let match;
      const functionsToFix = [];

      let tempContent = content;
      while ((match = functionRegex.exec(tempContent)) !== null) {
        functionsToFix.push({
          method: match[1],
          start: match.index,
          fullMatch: match[0]
        });
      }

      // For each function, check if it uses params directly and fix it
      functionsToFix.forEach(func => {
        const funcStart = func.start + func.fullMatch.length;
        const funcContent = content.substring(funcStart, funcStart + 1000);

        // Check if params is used directly (params.id, params.cuit, etc.)
        const directUsage = /params\.(\w+)/g;
        const matches = [...funcContent.matchAll(directUsage)];

        if (matches.length > 0) {
          // Get unique param names
          const paramNames = [...new Set(matches.map(m => m[1]))];

          // Find where to insert the await params line
          // Look for the try block or first line after function declaration
          const tryMatch = content.substring(funcStart).match(/try\s*\{/);
          if (tryMatch) {
            const insertPos = funcStart + tryMatch.index + tryMatch[0].length;
            const indent = '    '; // 4 spaces

            // Check if await params already exists
            const checkExisting = content.substring(insertPos, insertPos + 200);
            if (!checkExisting.includes('await params')) {
              const destructure = paramNames.length === 1
                ? `const { ${paramNames[0]} } = await params`
                : `const { ${paramNames.join(', ')} } = await params`;

              content = content.substring(0, insertPos) +
                       '\n' + indent + destructure + '\n' +
                       content.substring(insertPos);

              // Now replace all params.field with just field
              paramNames.forEach(paramName => {
                const regex = new RegExp(`params\\.${paramName}\\b`, 'g');
                content = content.replace(regex, paramName);
              });

              changes.push(`Fixed ${func.method} params usage`);
            }
          }
        }
      });

      fs.writeFileSync(file, content, 'utf-8');
      console.log(`  ✅ Fixed: ${changes.join(', ')}`);
      fixedCount++;
    } else {
      console.log(`  ⏭️  Skipped: Already correct or no params`);
      skippedCount++;
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}`);
    errorCount++;
  }
});

console.log('\n' + '='.repeat(50));
console.log('Summary:');
console.log(`  ✅ Fixed: ${fixedCount}`);
console.log(`  ⏭️  Skipped: ${skippedCount}`);
console.log(`  ❌ Errors: ${errorCount}`);
console.log('='.repeat(50) + '\n');

if (errorCount === 0) {
  console.log('✨ All files processed successfully!');
  console.log('\nRun `npm run build` to verify the fixes.');
} else {
  console.log('⚠️  Some files had errors. Please check them manually.');
  process.exit(1);
}
