#!/usr/bin/env node

/**
 * Script to fix Next.js 15+ params Promise issue in API routes
 */

/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const path = require('path');

console.log('🔧 Fixing API route params for Next.js 15+...\n');

function findRouteFiles(dir, files = []) {
  const items = fs.readdirSync(dir, { withFileTypes: true });

  for (const item of items) {
    const fullPath = path.join(dir, item.name);

    if (item.isDirectory()) {
      // Check if directory name contains brackets (dynamic route)
      if (item.name.startsWith('[') && item.name.endsWith(']')) {
        findRouteFiles(fullPath, files);
      } else if (!item.name.startsWith('.')) {
        findRouteFiles(fullPath, files);
      }
    } else if (item.name === 'route.ts') {
      // Only include if parent path has a dynamic segment
      if (fullPath.includes('[') && fullPath.includes(']')) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

const apiDir = path.join(process.cwd(), 'src', 'app', 'api');
const files = findRouteFiles(apiDir);

console.log(`Found ${files.length} files to process\n`);

let fixedCount = 0;
let skippedCount = 0;
let errorCount = 0;

files.forEach((file, index) => {
  const relativePath = path.relative(process.cwd(), file);
  console.log(`[${index + 1}/${files.length}] ${relativePath}`);

  try {
    let content = fs.readFileSync(file, 'utf-8');
    const original = content;
    let changes = [];

    // Fix the function signature
    // Pattern: { params }: { params: { id: string } }
    // To: { params }: { params: Promise<{ id: string }> }
    const paramPattern = /\{\s*params\s*\}:\s*\{\s*params:\s*(\{[^}]+\})\s*\}/g;

    if (paramPattern.test(content)) {
      content = content.replace(
        /\{\s*params\s*\}:\s*\{\s*params:\s*(\{[^}]+\})\s*\}/g,
        '{ params }: { params: Promise<$1> }'
      );
      changes.push('Updated signature');
    }

    // Find all HTTP method functions
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

    for (const method of methods) {
      const methodRegex = new RegExp(
        `export\\s+async\\s+function\\s+${method}\\s*\\([^)]*Promise<\\{[^}]+\\}>[^)]*\\)\\s*\\{`,
        'g'
      );

      let match;
      while ((match = methodRegex.exec(content)) !== null) {
        const functionStart = match.index + match[0].length;

        // Find the next 500 characters to analyze
        const snippet = content.substring(functionStart, functionStart + 800);

        // Check if params is used directly
        const directUsageRegex = /params\.(\w+)/g;
        const usages = [...snippet.matchAll(directUsageRegex)];

        if (usages.length > 0) {
          // Get unique param names
          const paramNames = [...new Set(usages.map(m => m[1]))];

          // Check if already has await params
          if (!snippet.includes('await params')) {
            // Find insertion point (after try { or at function start)
            const tryMatch = snippet.match(/try\s*\{/);
            const insertOffset = tryMatch ? tryMatch.index + tryMatch[0].length : 0;
            const insertPos = functionStart + insertOffset;

            // Create destructuring line
            const indent = '    ';
            const destructure = `\n${indent}const { ${paramNames.join(', ')} } = await params\n`;

            // Insert the await params line
            content = content.substring(0, insertPos) + destructure + content.substring(insertPos);

            // Replace all params.field with just field in this function
            // Find the function body end (next function or end of file)
            let functionEnd = content.length;
            const nextFunction = content.substring(insertPos + destructure.length).search(/\nexport\s+async\s+function/);
            if (nextFunction !== -1) {
              functionEnd = insertPos + destructure.length + nextFunction;
            }

            const functionBody = content.substring(insertPos, functionEnd);
            let fixedBody = functionBody;

            paramNames.forEach(paramName => {
              const regex = new RegExp(`params\\.${paramName}\\b`, 'g');
              fixedBody = fixedBody.replace(regex, paramName);
            });

            content = content.substring(0, insertPos) + fixedBody + content.substring(functionEnd);

            changes.push(`Fixed ${method}`);
          }
        }
      }
    }

    if (content !== original) {
      fs.writeFileSync(file, content, 'utf-8');
      console.log(`  ✅ ${changes.join(', ')}\n`);
      fixedCount++;
    } else {
      console.log(`  ⏭️  Already correct\n`);
      skippedCount++;
    }
  } catch (error) {
    console.log(`  ❌ Error: ${error.message}\n`);
    errorCount++;
  }
});

console.log('='.repeat(60));
console.log('Summary:');
console.log(`  ✅ Fixed: ${fixedCount}`);
console.log(`  ⏭️  Skipped: ${skippedCount}`);
console.log(`  ❌ Errors: ${errorCount}`);
console.log('='.repeat(60) + '\n');

if (errorCount === 0 && fixedCount > 0) {
  console.log('✨ All files processed successfully!');
  console.log('\nNext step: Run `npm run build` to verify.');
} else if (fixedCount === 0 && errorCount === 0) {
  console.log('ℹ️  All files were already correct.');
} else {
  console.log('⚠️  Some files had errors. Check them manually.');
}
