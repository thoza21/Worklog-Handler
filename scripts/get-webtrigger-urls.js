#!/usr/bin/env node

const fs = require('fs');
const yaml = require('js-yaml');
const { execSync } = require('child_process');
const readline = require('readline');

// Default parameters
const DEFAULT_ENV = 'development';
const DEFAULT_PRODUCT = 'jira';

// Function to read and parse manifest.yml
function getWebTriggerKeysFromManifest() {
  try {
    const manifestFile = fs.readFileSync('./manifest.yml', 'utf8');
    const manifest = yaml.load(manifestFile);
    
    if (!manifest.modules || !manifest.modules.webtrigger) {
      console.log('No webtrigger modules found in manifest.yml');
      return [];
    }
    
    return manifest.modules.webtrigger.map(trigger => trigger.key);
  } catch (err) {
    console.error('Error reading manifest.yml:', err);
    return [];
  }
}

// Create interactive CLI
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

// Main function
async function main() {
  // Get webtrigger keys
  const webTriggerKeys = getWebTriggerKeysFromManifest();
  
  if (webTriggerKeys.length === 0) {
    console.log('No webtrigger keys found in manifest.yml');
    rl.close();
    return;
  }
  
  console.log(`Found ${webTriggerKeys.length} webtrigger key(s): ${webTriggerKeys.join(', ')}`);
  
  // Ask for site
  rl.question('Enter your Atlassian site (e.g., yoursite.atlassian.net): ', (site) => {
    if (!site) {
      console.error('Site is required');
      rl.close();
      return;
    }
    
    // Ask for environment (with default)
    rl.question(`Enter environment [${DEFAULT_ENV}]: `, (env) => {
      const environment = env || DEFAULT_ENV;
      
      // Ask for product (with default)
      rl.question(`Enter product [${DEFAULT_PRODUCT}]: `, (product) => {
        const productValue = product || DEFAULT_PRODUCT;
        
        console.log('\nGenerating webtrigger URLs...\n');
        
        // Generate and execute forge webtrigger commands for each key
        webTriggerKeys.forEach(key => {
          try {
            console.log(`\n===== Generating URL for ${key} =====`);
            const command = `forge webtrigger -f ${key} -s ${site} -p ${productValue} -e ${environment}`;
            console.log(`Executing: ${command}`);
            
            const output = execSync(command, { encoding: 'utf8' });
            console.log(output);
          } catch (error) {
            console.error(`Error generating URL for ${key}:`, error.message);
          }
        });
        
        rl.close();
      });
    });
  });
}

// Run the main function
main().catch(err => {
  console.error('Error:', err);
  rl.close();
  process.exit(1);
}); 