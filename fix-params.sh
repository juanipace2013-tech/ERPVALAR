#!/bin/bash

# Script to fix Next.js 15+ params Promise issue in API routes

echo "Fixing API route params..."

# Find all route.ts files in API directories with dynamic segments
find src/app/api -name "route.ts" | while read -r file; do
  # Check if file contains dynamic route pattern
  if echo "$file" | grep -q '\[.*\]'; then
    echo "Checking: $file"

    # Fix GET method
    sed -i 's/export async function GET(\s*$/export async function GET(/g' "$file"
    sed -i 's/{ params }: { params: { \([^}]*\) } }/{ params }: { params: Promise<{ \1 }> }/g' "$file"

    # Fix POST method
    sed -i 's/export async function POST(\s*$/export async function POST(/g' "$file"
    sed -i 's/{ params }: { params: { \([^}]*\) } }/{ params }: { params: Promise<{ \1 }> }/g' "$file"

    # Fix PUT method
    sed -i 's/export async function PUT(\s*$/export async function PUT(/g' "$file"
    sed -i 's/{ params }: { params: { \([^}]*\) } }/{ params }: { params: Promise<{ \1 }> }/g' "$file"

    # Fix PATCH method
    sed -i 's/export async function PATCH(\s*$/export async function PATCH(/g' "$file"
    sed -i 's/{ params }: { params: { \([^}]*\) } }/{ params }: { params: Promise<{ \1 }> }/g' "$file"

    # Fix DELETE method
    sed -i 's/export async function DELETE(\s*$/export async function DELETE(/g' "$file"
    sed -i 's/{ params }: { params: { \([^}]*\) } }/{ params }: { params: Promise<{ \1 }> }/g' "$file"

    echo "Fixed: $file"
  fi
done

echo "Done!"
