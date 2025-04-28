# Worklog Handler for Jira

This Forge app connects Jira with time tracking systems through Zapier, allowing automatic creation, updating, and deletion of Jira worklogs from external time tracking tools.

## Features

- **OAuth Authentication**: Secure 3-legged OAuth implementation for user authorization
- **Zapier Integration**: Webhook endpoints for creating, updating, and deleting worklogs 
- **Admin Controls**: Secret management for webhook security
- **Token Management**: Automatic handling of OAuth token refresh
- **Role-Based UI**: Different views for admins and regular users

## Architecture

The app consists of:

- **Backend (Forge Functions)**:
  - OAuth handling (`oauth.js`)
  - Worklog operations (`worklogHandler.js`) 
  - App resolver functions (`index.js`)
  
- **Frontend (React)**:
  - Admin control panel
  - OAuth connection UI
  - Token status display

## Setup and Installation

### Prerequisites

1. [Set up Forge CLI](https://developer.atlassian.com/platform/forge/set-up-forge/)
2. [Create an OAuth App in Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)

### Installation

1. Clone the repository:
   ```
   git clone <repository-url>
   cd Worklog-Handler
   ```

2. Install dependencies:
   ```
   npm install
   cd static/hello-world
   npm install
   cd ../..
   ```

3. Configure environment variables (before deploying):
   ```
   forge variables:set CLIENT_ID <your-oauth-client-id>
   forge variables:set CLIENT_SECRET <your-oauth-client-secret>
   ```

4. Deploy the app:
   ```
   npm run build-and-deploy
   ```

5. Install the app on your Jira site:
   ```
   forge install
   ```

## OAuth Configuration

1. Create an OAuth 2.0 (3LO) app in the [Atlassian Developer Console](https://developer.atlassian.com/console/myapps/)
2. Configure the callback URL to match your app's webtrigger URL (found in the admin panel after deployment)
3. Add the required scopes:
   - `read:me`
   - `read:account`
   - `read:jira-user`
   - `read:jira-work`
   - `write:jira-work` 
   - `offline_access`

## Zapier Integration

1. Log in as an admin to generate a secret token
2. Use the Zapier webhook URL displayed in the admin panel
3. Add the secret token as a header (`x-zapier-secret`) in your Zapier webhook action
4. Send JSON payloads in this format:

### For creating worklogs:
```json
{
  "event": "hours:created",
  "userId": "atlassian-account-id",
  "issueKey": "PROJECT-123",
  "started": "2023-05-15T10:00:00.000Z",
  "timeSpentSeconds": 3600
}
```

### For updating worklogs:
```json
{
  "event": "hours:updated",
  "userId": "atlassian-account-id",
  "issueKey": "PROJECT-123",
  "worklogId": "12345",
  "started": "2023-05-15T10:00:00.000Z",
  "timeSpentSeconds": 7200
}
```

### For deleting worklogs:
```json
{
  "event": "hours:deleted",
  "userId": "atlassian-account-id",
  "issueKey": "PROJECT-123",
  "worklogId": "12345"
}
```

## Recent Improvements

- Removed redundant and unused code
- Fixed webhook response formats
- Simplified webtrigger configuration
- Improved error handling
- Consolidated token storage format

## Pushing to GitHub

To push this project to GitHub:

1. Create a new repository on GitHub
2. Initialize Git in your project (if not already done):
   ```
   git init
   ```
3. Add all files:
   ```
   git add .
   ```
4. Create an initial commit:
   ```
   git commit -m "Initial commit of Worklog Handler app"
   ```
5. Add your GitHub repository as remote:
   ```
   git remote add origin https://github.com/yourusername/Worklog-Handler.git
   ```
6. Push to GitHub:
   ```
   git push -u origin main
   ```

## Troubleshooting

- **OAuth Issues**: Check the CLIENT_ID and CLIENT_SECRET environment variables
- **424 Errors**: Ensure the webtrigger response config is set to `type: custom`
- **Missing Tokens**: Verify your OAuth app has the `offline_access` scope

## Support

For issues with this app, please open an issue on the GitHub repository.

For general Forge help, see [Get help](https://developer.atlassian.com/platform/forge/get-help/).

