const fs = require('fs');
const yaml = require('js-yaml');
const { execSync } = require('child_process');

// Configuration - can be modified or passed as arguments
const site = 'testmatrix.atlassian.net';
const product = 'Jira';
const environment = 'development';

try {
  // Read the manifest.yml file
  const manifestFile = fs.readFileSync('./manifest.yml', 'utf8');
  const manifest = yaml.load(manifestFile);

  // Extract all webtrigger keys
  const webtriggers = manifest.modules.webtrigger || [];
  const webtriggerKeys = webtriggers.map(trigger => trigger.key);

  console.log(`Found ${webtriggerKeys.length} webtrigger keys in manifest.yml:`);
  console.log(webtriggerKeys.join(', '));
  console.log('\nGenerating URLs for each webtrigger:\n');

  // Generate and execute forge webtrigger commands for each key
  webtriggerKeys.forEach(key => {
    console.log(`\n--- Webtrigger: ${key} ---`);
    try {
      const command = `forge webtrigger -f ${key} -s ${site} -p ${product} -e ${environment}`;
      console.log(`> ${command}`);
      
      const output = execSync(command, { encoding: 'utf8' });
      
      // Extract the URL from the output (assuming it's the last line of the output)
      const lines = output.trim().split('\n');
      const url = lines[lines.length - 1];
      
      console.log(`URL: ${url}`);
      console.log(`To test this webtrigger, update your test scripts to use this URL.`);
    } catch (cmdError) {
      console.error(`Error getting URL for ${key}:`, cmdError.message);
    }
  });

} catch (error) {
  console.error('Error:', error.message);
} 