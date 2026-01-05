#!/usr/bin/env node

/**
 * Environment Configuration Checker
 * Ensures .env has all required variables from .env.example
 * Adds missing variables with empty values at the correct position
 */

const fs = require('fs')
const path = require('path')

const ENV_PATH = path.resolve('.env')
const EXAMPLE_PATH = path.resolve('.env.example')
const BACKUP_PATH = path.resolve('.env.backup')

console.log('48hr.email Environment Configuration Checker\n')

// Check if .env.example exists
if (!fs.existsSync(EXAMPLE_PATH)) {
    console.error('ERROR: .env.example not found!')
    process.exit(1)
}

// Create .env if it doesn't exist
if (!fs.existsSync(ENV_PATH)) {
    console.log('INFO: .env not found, creating from .env.example...')
    fs.copyFileSync(EXAMPLE_PATH, ENV_PATH)
    console.log('SUCCESS: Created .env - please fill in your configuration values\n')
    process.exit(0)
}

// Parse .env.example to get expected structure
const exampleContent = fs.readFileSync(EXAMPLE_PATH, 'utf8')
const exampleLines = exampleContent.split('\n')

// Parse current .env
const envContent = fs.readFileSync(ENV_PATH, 'utf8')
const envLines = envContent.split('\n')

// Extract variable names from .env
const existingVars = new Set()
envLines.forEach(line => {
    const trimmed = line.trim()
    if (trimmed && !trimmed.startsWith('#')) {
        const varName = trimmed.split('=')[0].trim()
        if (varName) existingVars.add(varName)
    }
})

// Check for deprecated vars and auto-migrate
const deprecatedVars = []
const migrations = []

if (existingVars.has('USER_SESSION_SECRET')) {
    if (!existingVars.has('HTTP_SESSION_SECRET')) {
        // Migrate USER_SESSION_SECRET to HTTP_SESSION_SECRET
        const oldLine = envLines.find(l => l.trim().startsWith('USER_SESSION_SECRET='))
        if (oldLine) {
            const value = oldLine.split('=').slice(1).join('=')
            migrations.push({
                old: 'USER_SESSION_SECRET',
                new: 'HTTP_SESSION_SECRET',
                value: value,
                action: 'migrate'
            })
        }
    }
    deprecatedVars.push('USER_SESSION_SECRET → HTTP_SESSION_SECRET (will be removed)')
}

// Find missing variables
const missingVars = []
const newLines = []
let addedVars = 0

for (let i = 0; i < exampleLines.length; i++) {
    const line = exampleLines[i]
    const trimmed = line.trim()

    // Preserve empty lines and section headers (comment lines)
    if (!trimmed || trimmed.startsWith('#')) {
        newLines.push(line)
        continue
    }

    // Extract variable name (before the = sign)
    const varName = trimmed.split('=')[0].trim()

    // Skip if not a valid variable assignment
    if (!varName || !trimmed.includes('=')) {
        continue
    }

    // Check if this var exists in current .env
    if (existingVars.has(varName)) {
        // Find and copy the existing line from .env
        const existingLine = envLines.find(l => l.trim().startsWith(varName + '='))
        newLines.push(existingLine || varName + '=')
    } else {
        // Check if there's a migration for this variable
        const migration = migrations.find(m => m.new === varName)
        if (migration) {
            // Use migrated value
            newLines.push(`${varName}=${migration.value}`)
            missingVars.push(`${varName} (migrated from ${migration.old})`)
            addedVars++
        } else {
            // Variable is missing - add it with empty value
            missingVars.push(varName)
            newLines.push(`${varName}=`)
            addedVars++
        }
    }
}

// Show results
console.log('Configuration Status:\n')

if (migrations.length > 0) {
    console.log('Auto-migrations applied:')
    migrations.forEach(m => console.log(`   ${m.old} → ${m.new}`))
    console.log()
}

if (deprecatedVars.length > 0) {
    console.log('Deprecated variables found:')
    deprecatedVars.forEach(v => console.log(`   ${v}`))
    console.log()
}

if (missingVars.length > 0) {
    console.log(`Found ${missingVars.length} missing variable(s):`)
    missingVars.forEach(v => console.log(`   * ${v}`))
    console.log()

    // Create backup
    fs.copyFileSync(ENV_PATH, BACKUP_PATH)
    console.log('Created backup: .env.backup')

    // Write updated .env
    fs.writeFileSync(ENV_PATH, newLines.join('\n'))
    console.log('Updated .env with empty placeholders')
    console.log('\nPlease fill in the missing values in your .env file!\n')
} else if (deprecatedVars.length > 0) {
    console.log('All variables present (but some are deprecated)\n')
} else {
    console.log('All variables present and up to date!\n')
}

process.exit(0)
