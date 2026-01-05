#!/usr/bin/env node

// Test script to verify domains are loaded correctly
const helper = new Helper()
const domains = helper.getDomains()
console.log('\nDomains from helper.getDomains():', domains)
console.log('Length:', domains ? domains.length : undefined)
console.log('Type:', typeof config.email.domains)
console.log('Is Array:', Array.isArray(config.email.domains))
console.log('Length:', config.email.domains ? config.email.domains.length : undefined)

if (Array.isArray(config.email.domains) && config.email.domains.length > 0) {
    console.log('\nDomains list:')
    config.email.domains.forEach((d, i) => console.log(`  ${i + 1}. ${d}`))
} else {
    console.log('\nERROR: No domains configured!')
}

console.log('\nHTTP Config:', JSON.stringify(config.http, null, 2))
console.log('\nDomains from helper.getDomains():', domains)
console.log('Length:', domains ? domains.length : undefined)
process.exit(0)
